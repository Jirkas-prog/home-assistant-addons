import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/index.js";
import { serialize } from "../server/store.js";
import { atlasStructure, filterNodes } from "../src/atlas-model.js";
import { createAtlasSync } from "../src/atlas-sync.js";
import { mapNodeRadius } from "../src/map-node-geometry.js";
const record = (id, parent = null, type = "knowledge") => ({
  schema: 1,
  id,
  parent,
  type,
  title: id,
  status: "draft",
  color: "#73c8ed",
  summary: "",
  tags: [],
  related: [],
  resources: [],
  body: "",
});
async function appFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-auto-"));
  const { app } = await createApp({
    directory,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.ok(
      path.resolve(directory).startsWith(path.join(os.tmpdir(), "atlas-auto-")),
    );
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  });
  return {
    directory,
    url: `http://127.0.0.1:${server.address().port}/api/nodes`,
  };
}
test("custom roots, nested categories and all record types drive counts and search", () => {
  const nodes = [
    record("my-world", null, "category"),
    record("cooking", "my-world", "category"),
    record("baking", "cooking", "category"),
    {
      ...record("bread", "baking", "project"),
      body: "Rye sourdough",
      resources: [
        {
          label: "Guide",
          path: "D:\\\\Recipes\\\\Bread.md",
        },
      ],
    },
    record("practice", "bread", "skill"),
    record("example", "practice", "code"),
    record("note", "my-world"),
  ];
  const structure = atlasStructure(nodes);
  assert.equal(structure.homeId, "my-world");
  assert.deepEqual(structure.stats, {
    total: 7,
    projects: 1,
    notes: 3,
    areas: 2,
    items: 0,
    units: 0,
    tasks: 0,
    tools: 0,
  });
  assert.deepEqual(
    structure.mainBranches.map((n) => n.id),
    ["cooking"],
  );
  assert.deepEqual(
    filterNodes(nodes, {
      query: "sourdough rye",
    }).map((n) => n.id),
    ["bread"],
  );
  assert.deepEqual(
    filterNodes(nodes, {
      query: "recipes",
    }).map((n) => n.id),
    ["bread"],
  );
  assert.equal(
    filterNodes(nodes, {
      scope: "baking",
    }).length,
    4,
  );
  assert.equal(
    filterNodes(nodes, {
      scope: "baking",
      type: "skill",
    })[0].id,
    "practice",
  );
  assert.equal(atlasStructure([]).homeId, "");
  assert.equal(
    atlasStructure([record("solo", null, "project")]).stats.projects,
    1,
  );
  assert.equal(
    atlasStructure([
      record("a", null, "category"),
      record("b", null, "category"),
    ]).stats.areas,
    2,
  );
});
test("conditional reads change after external edits, type changes, deletion and invalid-file recovery", async (t) => {
  const { directory, url } = await appFixture(t);
  const initial = await fetch(url),
    etag = initial.headers.get("etag");
  assert.equal(
    (
      await fetch(url, {
        headers: {
          "If-None-Match": etag,
        },
      })
    ).status,
    304,
  );
  const file = path.join(directory, "external.md");
  await fs.writeFile(file, serialize(record("external", null, "project")));
  const added = await fetch(url, {
    headers: {
      "If-None-Match": etag,
    },
  });
  assert.equal(added.status, 200);
  const nextEtag = added.headers.get("etag");
  assert.notEqual(nextEtag, etag);
  await fs.writeFile(
    file,
    serialize({
      ...record("external", null, "skill"),
      body: "New content",
    }),
  );
  const changed = await (
    await fetch(url, {
      headers: {
        "If-None-Match": nextEtag,
      },
    })
  ).json();
  assert.equal(atlasStructure(changed.nodes).stats.notes, 1);
  assert.equal(
    filterNodes(changed.nodes, {
      query: "new content",
    }).length,
    1,
  );
  await fs.writeFile(file, "unfinished invalid header");
  assert.equal((await (await fetch(url)).json()).errors.length, 1);
  await fs.writeFile(file, serialize(record("external")));
  assert.equal((await (await fetch(url)).json()).errors.length, 0);
  await fs.unlink(file);
  assert.equal((await (await fetch(url)).json()).nodes.length, 0);
});
test("running client automatically discovers external create/edit/delete without refresh or restart", async (t) => {
  const { directory, url } = await appFixture(t);
  let current,
    deliveries = 0;
  const waiters = new Set();
  const waitFor = (predicate) => {
    if (current && predicate(current)) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const listener = (value) => {
        if (predicate(value)) {
          clearTimeout(timeout);
          waiters.delete(listener);
          resolve(value);
        }
      };
      const timeout = setTimeout(() => {
        waiters.delete(listener);
        reject(new Error("Automatic refresh did not arrive."));
      }, 3000);
      waiters.add(listener);
    });
  };
  const sync = createAtlasSync({
    url,
    intervalMs: 30,
    onSnapshot(value) {
      current = value;
      deliveries++;
      for (const listener of waiters) listener(value);
    },
  });
  t.after(() => sync.stop());
  await sync.start();
  await sync.refresh();
  assert.equal(deliveries, 1, "unchanged content must not reset the graph");
  const file = path.join(directory, "custom.md");
  await fs.writeFile(
    file,
    serialize({
      ...record("custom", null, "project"),
      title: "My new work",
    }),
  );
  await waitFor((s) => atlasStructure(s.nodes).stats.projects === 1);
  const normalRadius = mapNodeRadius(current.nodes[0], 2);
  await fs.writeFile(
    file,
    serialize({
      ...record("custom", null, "project"),
      title: "My new work",
      importance: 5,
    }),
  );
  await waitFor((s) => s.nodes[0]?.importance === 5);
  assert.ok(mapNodeRadius(current.nodes[0], 2) > normalRadius);
  assert.equal(atlasStructure(current.nodes).stats.projects, 1);
  assert.equal(filterNodes(current.nodes, { query: "My new work" }).length, 1);
  await fs.writeFile(
    file,
    serialize({
      ...record("custom", null, "skill"),
      body: "Newly acquired experience",
    }),
  );
  await waitFor(
    (s) =>
      filterNodes(s.nodes, {
        query: "experience",
        type: "skill",
      }).length === 1,
  );
  assert.equal(atlasStructure(current.nodes).stats.projects, 0);
  await fs.unlink(file);
  await waitFor((s) => s.nodes.length === 0);
  assert.equal(atlasStructure(current.nodes).stats.total, 0);
});
test("client retries after connection loss and keeps the last delivered snapshot", async () => {
  let calls = 0,
    failures = 0;
  const delivered = [];
  let recover;
  const recovered = new Promise((resolve) => {
    recover = resolve;
  });
  const sync = createAtlasSync({
    intervalMs: 10,
    fetchImpl: async () => {
      calls++;
      if (calls === 2) throw new Error("offline");
      return new Response(
        JSON.stringify({
          nodes: [record(calls === 1 ? "before" : "after")],
        }),
        {
          headers: {
            etag: calls === 1 ? "first" : "second",
          },
        },
      );
    },
    onSnapshot(snapshot) {
      delivered.push(snapshot);
      if (snapshot.nodes[0].id === "after") recover();
    },
    onError() {
      failures++;
      assert.equal(delivered.at(-1).nodes[0].id, "before");
    },
  });
  try {
    await sync.start();
    await Promise.race([
      recovered,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Reconnect failed")),
          3000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(failures, 1);
    assert.equal(delivered.at(-1).nodes[0].id, "after");
  } finally {
    sync.stop();
  }
});
