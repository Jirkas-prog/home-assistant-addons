import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/index.js";
import { Store, serialize, validateNode } from "../server/store.js";
import { matchesQuery, atlasStructure } from "../src/atlas-model.js";
import {
  bomModel,
  cardState,
  matchesToolFilter,
  nextReview,
  toolStats,
} from "../shared/tools.js";

const record = (id, type = "knowledge", extra = {}) => ({
  schema: 2,
  id,
  type,
  title: id,
  parent: null,
  status: "active",
  summary: "",
  body: "",
  color: "#b0ef88",
  tags: [],
  related: [],
  resources: [],
  ...extra,
});
const tool = (kind, extra = {}) => ({ schema: 1, kind, ...extra });
const line = (id, itemId, quantity) => ({
  id,
  itemId,
  quantity,
  label: itemId || id,
  note: "",
});
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-tools-v3-"));
  const { app, store } = await createApp({ directory, allowOpen: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "atlas-tools-v3-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const request = (url, method = "GET", body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { directory, store, request };
}
test("manual journal and card metadata update search, statistics and saved views without an import", async (t) => {
  const f = await fixture(t);
  await f.store.save(record("project", "project"));
  const journal = record("log", "knowledge", {
    parent: "project",
    projectId: "project",
    tool: tool("journal", {
      date: "2026-10-01",
      minutes: 45,
      next: "Calibrate the multimeter",
    }),
  });
  const deck = record("deck", "knowledge", {
    tool: tool("cards", {
      cards: [
        {
          id: "one",
          question: "What is impedance?",
          answer: "A frequency dependent opposition.",
          sourceId: "project",
          sourcePage: "12",
        },
      ],
      reviews: [],
    }),
  });
  await fs.writeFile(path.join(f.directory, "log.md"), serialize(journal));
  await fs.writeFile(path.join(f.directory, "deck.md"), serialize(deck));
  const first = await f.request("nodes"),
    etag = first.headers.get("etag"),
    snapshot = await first.json();
  assert.deepEqual(snapshot.errors, []);
  assert.equal(atlasStructure(snapshot.nodes).stats.tools, 2);
  assert.equal(toolStats(snapshot.nodes, "2026-10-01").minutes, 45);
  assert.equal(toolStats(snapshot.nodes, "2026-10-01").due, 1);
  assert.ok(
    matchesQuery(
      snapshot.nodes.find((n) => n.id === "log"),
      "multimeter",
    ),
  );
  assert.ok(
    matchesQuery(
      snapshot.nodes.find((n) => n.id === "deck"),
      "impedance frequency",
    ),
  );
  const filter = {
    rule: "study-due",
    type: "all",
    status: "all",
    query: "",
    tag: "",
    projectId: "",
  };
  assert.deepEqual(
    snapshot.nodes
      .filter((n) =>
        matchesToolFilter(
          n,
          filter,
          snapshot.nodes,
          "2026-10-01",
          matchesQuery,
        ),
      )
      .map((n) => n.id),
    ["deck"],
  );
  journal.tool.minutes = 90;
  journal.tool.next = "Measure the oscillator";
  await fs.writeFile(path.join(f.directory, "log.md"), serialize(journal));
  const second = await f.request("nodes"),
    changed = await second.json();
  assert.notEqual(second.headers.get("etag"), etag);
  assert.equal(toolStats(changed.nodes, "2026-10-01").minutes, 90);
  assert.ok(
    matchesQuery(
      changed.nodes.find((n) => n.id === "log"),
      "oscillator",
    ),
  );
});
test("bills account for other active planned demand, never double count themselves and export safe shortages", async (t) => {
  const f = await fixture(t);
  await f.store.save(record("component", "item", { quantity: 10 }));
  const first = await f.store.save(
    record("first", "knowledge", {
      tool: tool("bom", {
        reserve: true,
        lines: [
          line("a", "component", 6),
          { ...line("free", "", 2), label: "=FORMULA", note: "Alternative" },
        ],
      }),
    }),
  );
  let second = await f.store.save(
    record("second", "knowledge", {
      tool: tool("bom", { reserve: true, lines: [line("b", "component", 7)] }),
    }),
  );
  let { nodes } = await f.store.read();
  let rows = bomModel(first, nodes);
  assert.deepEqual(
    [rows[0].available, rows[0].planned, rows[0].free, rows[0].shortage],
    [10, 7, 3, 3],
  );
  assert.equal(rows[0].overbooked, true);
  const csv = await (await f.request("tools/first/bom.csv")).text();
  assert.match(csv, /"component";"3"/);
  assert.match(csv, /"'=FORMULA";"2"/);
  second = await f.store.save(
    { ...second, status: "done" },
    second.id,
    second.revision,
  );
  nodes = (await f.store.read()).nodes;
  rows = bomModel(first, nodes);
  assert.equal(rows[0].shortage, 0);
  assert.equal(rows[0].planned, 0);
  await assert.rejects(
    () =>
      f.store.archive(
        "component",
        nodes.find((n) => n.id === "component").revision,
      ),
    /tool references/,
  );
});
test("procedure starts are idempotent and keep a snapshot after the original procedure changes", async (t) => {
  const f = await fixture(t);
  let procedure = await f.store.save(
    record("procedure", "knowledge", {
      body: "Original instructions",
      tool: tool("procedure", {
        steps: [
          { id: "first", label: "Disconnect power" },
          { id: "second", label: "Measure continuity" },
        ],
      }),
    }),
  );
  const start = {
    revision: procedure.revision,
    operationId: "start-one",
    date: "2026-10-01",
  };
  const created = await f.request("tools/procedure/runs", "POST", start);
  assert.equal(created.status, 201);
  let run = await created.json();
  const duplicate = await (
    await f.request("tools/procedure/runs", "POST", start)
  ).json();
  assert.equal(duplicate.id, run.id);
  procedure = await f.store.save(
    {
      ...procedure,
      body: "Changed instructions",
      tool: {
        ...procedure.tool,
        steps: [{ id: "new", label: "New procedure" }],
      },
    },
    procedure.id,
    procedure.revision,
  );
  const saved = (await f.store.read()).nodes.find((n) => n.id === run.id);
  assert.equal(saved.body, "Original instructions");
  assert.equal(saved.tool.steps.length, 2);
  let response = await f.request(`tools/${run.id}/steps`, "POST", {
    revision: run.revision,
    stepId: "first",
    completed: true,
  });
  assert.equal(response.status, 200);
  run = await response.json();
  response = await f.request(`tools/${run.id}/steps`, "POST", {
    revision: saved.revision,
    stepId: "second",
    completed: true,
  });
  assert.equal(response.status, 409);
  response = await f.request(`tools/${run.id}/steps`, "POST", {
    revision: run.revision,
    stepId: "second",
    completed: true,
  });
  run = await response.json();
  assert.equal(run.status, "done");
  assert.equal(
    toolStats((await new Store(f.directory).read()).nodes, "2026-10-01").runs,
    1,
  );
  response = await f.request(`tools/${run.id}/steps`, "POST", {
    revision: run.revision,
    stepId: "first",
    completed: false,
  });
  assert.equal((await response.json()).status, "active");
  assert.equal(
    (await f.store.read()).nodes.filter((n) => n.tool?.kind === "run").length,
    1,
  );
});
test("card reviews survive restart, reject stale writers and deduplicate retried submissions", async (t) => {
  const f = await fixture(t);
  let deck = await f.store.save(
    record("deck", "knowledge", {
      tool: tool("cards", {
        cards: [
          {
            id: "first",
            question: "Voltage unit?",
            answer: "Volt",
            sourceId: "",
            sourcePage: "",
          },
        ],
        reviews: [],
      }),
    }),
  );
  const input = {
    revision: deck.revision,
    operationId: "review-one",
    cardId: "first",
    rating: "good",
    date: "2026-10-01",
  };
  const response = await f.request("tools/deck/reviews", "POST", input);
  assert.equal(response.status, 200);
  deck = await response.json();
  assert.equal(cardState(deck, "first", "2026-10-01").ready, false);
  assert.equal(cardState(deck, "first", "2026-10-02").ready, true);
  assert.equal(
    (await (await f.request("tools/deck/reviews", "POST", input)).json()).tool
      .reviews.length,
    1,
  );
  assert.equal(
    (
      await f.request("tools/deck/reviews", "POST", {
        ...input,
        rating: "easy",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request("tools/deck/reviews", "POST", {
        ...input,
        operationId: "stale",
      })
    ).status,
    409,
  );
  const restarted = (await new Store(f.directory).read()).nodes[0];
  assert.equal(restarted.tool.reviews[0].due, "2026-10-02");
  assert.deepEqual(nextReview(0, "again", "2026-10-01"), {
    interval: 0,
    due: "2026-10-01",
  });
  assert.equal(nextReview(1, "easy", "2026-10-31").due, "2026-11-03");
});
test("concurrent reviews cannot lose a previously recorded answer", async (t) => {
  const f = await fixture(t);
  const deck = await f.store.save(
    record("deck", "knowledge", {
      tool: tool("cards", {
        cards: [
          {
            id: "first",
            question: "Q?",
            answer: "A",
            sourceId: "",
            sourcePage: "",
          },
        ],
        reviews: [],
      }),
    }),
  );
  const submit = (id) =>
    f.request("tools/deck/reviews", "POST", {
      revision: deck.revision,
      operationId: id,
      cardId: "first",
      rating: "good",
      date: "2026-10-01",
    });
  const responses = await Promise.all([submit("one"), submit("two")]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.store.read()).nodes[0].tool.reviews.length, 1);
});
test("invalid tool fields and broken references are preserved as diagnostics beside healthy files", async (t) => {
  const f = await fixture(t);
  const bad = record("bad", "knowledge", {
    tool: tool("bom", { reserve: true, lines: [line("one", "missing", -1)] }),
  });
  assert.throws(() => validateNode(bad), /quantity/);
  await fs.writeFile(path.join(f.directory, "bad.md"), serialize(bad));
  await f.store.save(record("healthy"));
  let snapshot = await f.store.read();
  assert.equal(snapshot.nodes.length, 1);
  assert.match(snapshot.errors[0].message, /quantity/);
  const missing = record("missing-ref", "knowledge", {
    tool: tool("bom", { reserve: false, lines: [line("one", "missing", 1)] }),
  });
  await assert.rejects(() => f.store.save(missing), /tool reference/);
  bad.tool.lines[0].quantity = 1;
  await fs.writeFile(path.join(f.directory, "bad.md"), serialize(bad));
  snapshot = await f.store.read();
  assert.ok(
    snapshot.errors.some(
      (e) => e.message === "Invalid tool reference: missing.",
    ),
  );
  assert.ok(await fs.readFile(path.join(f.directory, "bad.md"), "utf8"));
});
test("saved project and overdue views recompute from current tasks and local dates", () => {
  const project = record("p", "project"),
    branch = record("branch", "category", { parent: "p" }),
    task = record("task", "task", {
      parent: "branch",
      task: { due: "2026-10-01" },
    });
  const filter = {
    rule: "projects-no-next",
    type: "all",
    status: "all",
    projectId: "",
    tag: "",
    query: "",
  };
  assert.equal(
    matchesToolFilter(
      project,
      filter,
      [project, branch],
      "2026-10-01",
      matchesQuery,
    ),
    true,
  );
  assert.equal(
    matchesToolFilter(
      project,
      filter,
      [project, branch, task],
      "2026-10-01",
      matchesQuery,
    ),
    false,
  );
  const overdue = { ...filter, rule: "overdue", projectId: "p" };
  assert.equal(
    matchesToolFilter(
      task,
      overdue,
      [project, branch, task],
      "2026-10-01",
      matchesQuery,
    ),
    false,
  );
  assert.equal(
    matchesToolFilter(
      task,
      overdue,
      [project, branch, task],
      "2026-10-02",
      matchesQuery,
    ),
    true,
  );
});
