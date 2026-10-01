import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateNode } from "../shared/schema.js";
import {
  checkpoints,
  pendingDeadlines,
  taskUrgencies,
  withCheckpointDone,
  dateDay,
  urgencyStyle,
} from "../shared/checkpoints.js";
import { createApp } from "../server/index.js";
import { serialize } from "../server/store.js";
import { filterNodes, atlasStructure } from "../src/atlas-model.js";
import { fitTimeline, taskInterval } from "../src/timeline-model.js";
import { setLanguage, localizeMessage, translate } from "../shared/i18n.js";
import en from "../shared/locales/en.json" with { type: "json" };
import cs from "../shared/locales/cs.json" with { type: "json" };

const point = (id = "review", due = "2026-10-06", done = false) => ({
  id,
  due,
  done,
  description: "Verify acceptance criteria",
});
const task = (id = "task", extra = {}) => ({
  schema: 2,
  id,
  title: "Example task",
  type: "task",
  parent: null,
  status: "active",
  color: "#73c8ed",
  importance: 3,
  summary: "",
  tags: [],
  related: [],
  resources: [],
  body: "Notes",
  ...extra,
});
const urgency = (node, today = "2026-10-01", others = []) =>
  taskUrgencies([node, ...others], today).get(node.id);

test("checkpoint validation accepts legacy tasks and enforces dates, criteria, stable IDs and completion types", () => {
  assert.doesNotThrow(() => validateNode(task()));
  assert.deepEqual(checkpoints(task()), []);
  assert.doesNotThrow(() =>
    validateNode(
      task("task", {
        task: {
          start: "2026-10-01",
          due: "2026-10-06",
          checkpoints: [point()],
        },
      }),
    ),
  );
  for (const bad of [
    null,
    {},
    { ...point(), id: "Bad ID" },
    { ...point(), due: "2026-02-30" },
    { ...point(), due: "" },
    { ...point(), description: "  " },
    { ...point(), description: "x".repeat(2001) },
    { ...point(), done: "false" },
    { ...point(), completedAt: "2026-10-01T10:00:00Z" },
    { ...point(), done: true, completedAt: "2026-02-30T10:00:00Z" },
  ])
    assert.throws(() =>
      validateNode(task("task", { task: { checkpoints: [bad] } })),
    );
  for (const list of [
    {},
    [point(), point()],
    Array.from({ length: 201 }, (_, i) => point(`c-${i}`)),
  ])
    assert.throws(() =>
      validateNode(task("task", { task: { checkpoints: list } })),
    );
  for (const range of [{ start: "2026-10-07" }, { due: "2026-10-05" }])
    assert.throws(
      () =>
        validateNode(
          task("task", { task: { ...range, checkpoints: [point()] } }),
        ),
      /within the task/,
    );
  assert.doesNotThrow(() =>
    validateNode(
      task("task", {
        task: {
          checkpoints: [
            { ...point(), done: true, completedAt: "2026-10-01T10:00:00.000Z" },
          ],
        },
      }),
    ),
  );
});

test("checking and reopening preserve task metadata, importance and schedule", () => {
  const before = task("task", {
    custom: { source: "Manual" },
    task: {
      start: "",
      due: "",
      assignee: "Team",
      checkpoints: [{ ...point(), evidence: "Notes" }],
    },
  });
  const after = withCheckpointDone(
    before,
    "review",
    true,
    "2026-10-01T12:00:00.000Z",
  );
  assert.equal(checkpoints(before)[0].done, false);
  assert.equal(checkpoints(after)[0].completedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(
    checkpoints(withCheckpointDone(after, "review", true))[0].completedAt,
    checkpoints(after)[0].completedAt,
  );
  const reopened = withCheckpointDone(after, "review", false);
  assert.deepEqual(reopened, {
    ...before,
    task: {
      ...before.task,
      checkpoints: [{ ...checkpoints(before)[0], completedAt: null }],
    },
  });
  assert.throws(
    () => withCheckpointDone(before, "removed", true),
    /no longer exists/,
  );
  assert.deepEqual(taskInterval(after), {
    node: after,
    start: -Infinity,
    end: Infinity,
  });
});

test("an unchecked overdue checkpoint makes the entire task red, including a task marked completed", () => {
  for (const status of ["active", "done"]) {
    const node = task("task", {
      status,
      task: { due: "2026-12-01", checkpoints: [point("late", "2026-09-30")] },
    });
    const result = urgency(node);
    assert.equal(result.score, 1);
    assert.equal(result.overdueCheckpoints, 1);
    assert.equal(result.level, "urgent");
    assert.equal(urgencyStyle(result)["--urgency-border"], "hsl(0 70% 64%)");
    const completed = urgency(withCheckpointDone(node, "late", true));
    assert.equal(completed.score, 0);
    assert.equal(completed.completed, status === "done");
  }
});

test("due dates include the full day and urgency advances across month boundaries", () => {
  const node = task("task", {
    task: { checkpoints: [point("review", "2026-10-31")] },
  });
  assert.equal(urgency(node, "2026-10-31").overdue, false);
  assert.equal(urgency(node, "2026-11-01").overdue, true);
  assert.equal(urgency(node, "2026-10-30").daysLeft, 1);
  assert.equal(dateDay("2026-10-26") - dateDay("2026-10-25"), 1);
  const deadline = task("due", {
    task: { due: "2026-09-30", checkpoints: [point("ok", "2026-09-29", true)] },
  });
  assert.equal(urgency(deadline).overdueTask, true);
  assert.equal(urgency({ ...deadline, status: "done" }).score, 0);
});

test("importance warns earlier, while undated tasks stay green until a pending checkpoint approaches", () => {
  const node = task("task", { task: { checkpoints: [point()] } });
  assert.equal(urgency({ ...node, importance: 1 }).level, "onTrack");
  assert.equal(urgency({ ...node, importance: 5 }).level, "attention");
  assert.equal(urgency(node, "2026-10-05").level, "urgent");
  assert.equal(urgency(task("none", { importance: 5 })).score, 0);
  assert.equal(
    urgency({
      ...node,
      task: { checkpoints: [point("done", "2026-09-01", true)] },
    }).score,
    0,
  );
  const dated = {
    ...node,
    task: {
      due: "2026-10-20",
      checkpoints: [point("b"), point("a"), point("done", "2026-09-01", true)],
    },
  };
  assert.equal(pendingDeadlines(dated)[0].checkpointId, "a");
  assert.equal(
    pendingDeadlines({
      ...node,
      task: { due: "2026-10-06", checkpoints: [point()] },
    })[0].checkpointId,
    "review",
  );
});

test("nearby pending deadlines add bounded pressure once per other task and completed checkpoints do not", () => {
  const target = task("target", { task: { due: "2026-10-06" } });
  const other = task("other", {
    importance: 5,
    task: { due: "2026-10-06", checkpoints: [point()] },
  });
  const alone = urgency(target),
    crowded = urgency(target, "2026-10-01", [other]);
  assert.ok(crowded.score > alone.score);
  assert.equal(crowded.nearbyCount, 1);
  assert.equal(
    crowded.score,
    urgency(target, "2026-10-01", [{ ...other, task: { due: "2026-10-06" } }])
      .score,
  );
  assert.ok(
    crowded.score >
      urgency(target, "2026-10-01", [{ ...other, importance: 1 }]).score,
  );
  assert.equal(
    urgency(target, "2026-10-01", [
      {
        ...other,
        status: "done",
        task: { checkpoints: [point("done", "2026-10-06", true)] },
      },
    ]).score,
    alone.score,
  );
  assert.equal(
    urgency(target, "2026-10-01", [{ ...other, task: { due: "2026-11-01" } }])
      .nearbyCount,
    0,
  );
  assert.ok(
    urgency(
      target,
      "2026-10-01",
      Array.from({ length: 20 }, (_, i) => ({ ...other, id: `other-${i}` })),
    ).score <=
      alone.score * 1.2 + 1e-12,
  );
  // The shared calculation is independent of which tasks a view chooses to display.
  const all = [target, other],
    scores = taskUrgencies(all, "2026-10-01");
  assert.equal(
    all.filter((n) => n.id === "target").map((n) => scores.get(n.id).score)[0],
    crowded.score,
  );
});

test("fitting all dates includes checkpoints on tasks without start or due dates", () => {
  const node = task("task", {
    task: { checkpoints: [point("future", "2028-01-01")] },
  });
  const view = fitTimeline([node], dateDay("2026-10-01"));
  assert.ok(view.start < dateDay("2028-01-01"));
  assert.ok(view.start + view.days > dateDay("2028-01-02"));
});

test("manual Markdown, API toggles, conflict protection, restart and language changes preserve checkpoints", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-checkpoints-"),
  );
  t.after(async () => {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "atlas-checkpoints-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const { app, settings } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const file = path.join(directory, "manual.md");
  await fs.writeFile(
    file,
    serialize(
      task("manual", {
        task: {
          start: "",
          due: "",
          checkpoints: [{ ...point(), evidence: "Review attachment" }],
        },
      }),
    ),
  );
  const read = async () => (await (await fetch(`${base}/nodes`)).json()).nodes;
  const put = (value) =>
    fetch(`${base}/nodes/manual`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify(value),
    });
  let nodes = await read(),
    original = nodes[0];
  assert.equal(atlasStructure(nodes).stats.tasks, 1);
  assert.equal(
    filterNodes(nodes, { query: "acceptance 2026-10-06" })[0].id,
    "manual",
  );
  let response = await put(withCheckpointDone(original, "review", true));
  assert.equal(response.status, 200);
  const saved = (await read())[0];
  assert.equal(checkpoints(saved)[0].done, true);
  assert.equal(checkpoints(saved)[0].evidence, "Review attachment");
  assert.equal(
    (await put(withCheckpointDone(original, "review", false))).status,
    409,
  );
  assert.equal(
    (
      await put({
        ...saved,
        task: { ...saved.task, checkpoints: [{ ...point(), due: "invalid" }] },
      })
    ).status,
    400,
  );
  assert.deepEqual((await read())[0], saved);
  const raw = await fs.readFile(file, "utf8");
  const config = await settings.read();
  await settings.save(
    { ...config, language: "cs", languageSelectionCompleted: true },
    [saved],
  );
  const restarted = await createApp({ directory });
  assert.equal((await restarted.settings.read()).language, "cs");
  assert.equal(await fs.readFile(file, "utf8"), raw);
  assert.deepEqual((await restarted.store.read()).nodes[0], saved);
  await fs.writeFile(
    file,
    serialize({
      ...saved,
      task: {
        ...saved.task,
        checkpoints: [
          {
            ...checkpoints(saved)[0],
            description: "New manual condition",
            done: false,
            completedAt: null,
          },
        ],
      },
    }),
  );
  nodes = await read();
  assert.equal(
    filterNodes(nodes, { query: "New manual condition" })[0].id,
    "manual",
  );
  assert.equal(checkpoints(nodes[0])[0].done, false);
});

test("checkpoint translations localize errors and labels without changing stored IDs or user text", () => {
  const node = task("task", { task: { checkpoints: [point()] } }),
    before = structuredClone(node);
  for (const code of ["en", "cs"]) {
    setLanguage(code);
    const catalog = code === "en" ? en : cs;
    for (const [key, text] of Object.entries(en).filter(([key]) =>
      key.startsWith("checkpoint."),
    )) {
      assert.equal(translate(code, key), catalog[key]);
      if (key.startsWith("checkpoint.invalid"))
        assert.equal(localizeMessage(text), catalog[key]);
    }
    const content = 'function sampleCode() { return "{1}"; }';
    assert.equal(
      translate(code, "checkpoint.toggle", content),
      catalog["checkpoint.toggle"].replace("{0}", () => content),
    );
    assert.deepEqual(node, before);
  }
  setLanguage("en");
});
