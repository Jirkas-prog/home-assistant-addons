import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/index.js";
import { UndoHistory } from "../server/undo.js";
import { serialize } from "../server/store.js";
import { translate } from "../shared/i18n.js";

const record = (id, extra = {}) => ({
  schema: 2,
  id,
  title: `Example ${id}`,
  type: "project",
  parent: null,
  status: "active",
  importance: 3,
  color: "#a7e87b",
  summary: "Example",
  body: "Original notes",
  tags: [],
  related: [],
  resources: [],
  ...extra,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-undo-"));
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-undo-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "library");
  await fs.mkdir(directory);
  return { root, directory };
}
async function start(t, directory) {
  const { app, store } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        store.stopBackground();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function request(url, method = "GET", body, expected = 200) {
    const response = await fetch(base + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  }
  const travel = async (direction) =>
    request(`undo/${direction}`, "POST", {
      revision: (await request("undo")).revision,
    });
  return { request, travel, store, base };
}

test("ratings, task checkpoints, order, fixed positions, map moves and settings share a persistent undo/redo stack", async (t) => {
  const { directory } = await fixture(t),
    { request, travel, store } = await start(t, directory);
  for (let i = 0; i < 4; i++) await store.save(record(`existing-${i}`));
  let node = await request(
    "nodes",
    "POST",
    record("task", {
      type: "task",
      task: {
        start: "2026-10-01",
        due: "2026-10-09",
        checkpoints: [
          {
            id: "review",
            due: "2026-10-05",
            done: false,
            description: "Review the result",
          },
        ],
      },
    }),
    201,
  );
  node = await request("nodes/task", "PUT", { ...node, importance: 5 });
  node = await request("nodes/task", "PUT", {
    ...node,
    task: {
      ...node.task,
      checkpoints: [{ ...node.task.checkpoints[0], done: true }],
    },
  });
  const snapshot = await request("nodes");
  await request("nodes/task/position", "PUT", {
    position: 5,
    positionFixed: true,
    revision: snapshot.orderRevision,
  });
  const positions = [{ id: "task", x: 210, y: -100, z: 35 }];
  const map = await request("map-positions");
  await request("map-positions/constellations:3", "PUT", {
    positions,
    revision: map.revision,
  });
  const config = await request("settings");
  await request("settings", "PUT", {
    ...config,
    language: "cs",
    appearance: "graphite",
  });
  assert.equal((await request("undo")).undo, 6);
  assert.equal(
    (await new UndoHistory(directory).status()).undo,
    6,
    "survives a new history instance",
  );
  await travel("undo");
  assert.equal((await request("settings")).language, "en");
  assert.equal((await request("settings")).appearance, "sage");
  await travel("undo");
  assert.deepEqual((await request("map-positions")).views, {});
  await travel("undo");
  assert.equal((await request("nodes/task")).positionFixed, false);
  await travel("undo");
  assert.equal((await request("nodes/task")).task.checkpoints[0].done, false);
  await travel("undo");
  assert.equal((await request("nodes/task")).importance, 3);
  await travel("undo");
  assert.equal((await request("nodes")).nodes.length, 4);
  assert.equal((await request("undo")).redo, 6);
  for (let i = 0; i < 6; i++) await travel("redo");
  const restored = await request("nodes/task");
  assert.equal(restored.importance, 5);
  assert.equal(restored.positionFixed, true);
  assert.equal(restored.position, 5);
  assert.equal(restored.task.checkpoints[0].done, true);
  assert.deepEqual(
    (await request("map-positions")).views["constellations:3"],
    positions,
  );
  assert.equal((await request("settings")).language, "cs");
  assert.equal((await request("settings")).appearance, "graphite");
  const atlas = await request("atlas");
  assert.equal(atlas.undo.undo, 6);
  assert.equal(atlas.undo.redo, 0);
});

test("archive, new branches and edits after undo preserve records and discard only the redo branch", async (t) => {
  const { directory } = await fixture(t),
    { request, travel } = await start(t, directory);
  const first = await request("nodes", "POST", record("first"), 201);
  await request("nodes", "POST", record("second"), 201);
  await request("nodes/first", "DELETE", { revision: first.revision });
  assert.equal((await request("nodes")).nodes.length, 1);
  await travel("undo");
  assert.equal((await request("nodes")).nodes.length, 2);
  await travel("undo");
  const old = await request("nodes/first");
  await request("nodes/first", "PUT", {
    ...old,
    body: "A different direction",
  });
  const status = await request("undo");
  assert.equal(status.undo, 2);
  assert.equal(status.redo, 0);
  await travel("undo");
  assert.equal((await request("nodes/first")).body, "Original notes");
  assert.equal((await fs.readdir(path.join(directory, ".trash"))).length, 1);
});

test("failed and unchanged operations add no steps; stale and unprotected travel cannot undo twice", async (t) => {
  const { directory } = await fixture(t),
    { request, travel, base } = await start(t, directory);
  const node = await request("nodes", "POST", record("note"), 201);
  const state = await request("undo"),
    map = await request("map-positions");
  await request("map-positions/grid:2", "PUT", {
    positions: null,
    revision: map.revision,
  });
  await request("nodes/note", "PUT", { ...node, revision: "stale" }, 409);
  assert.deepEqual(await request("undo"), state);
  assert.equal(
    (
      await fetch(base + "undo/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: state.revision }),
      })
    ).status,
    403,
  );
  await travel("undo");
  await request("undo/undo", "POST", { revision: state.revision }, 409);
  assert.equal((await request("undo")).redo, 1);
});

test("external edits and newer incoming references are never silently overwritten", async (t) => {
  const { directory } = await fixture(t),
    { request, store } = await start(t, directory);
  const node = await request("nodes", "POST", record("parent"), 201);
  const saved = await request("nodes/parent", "PUT", {
    ...node,
    importance: 4,
  });
  let state = await request("undo");
  await fs.writeFile(
    path.join(directory, "parent.md"),
    serialize({ ...saved, body: "External edit" }),
  );
  await request("undo/undo", "POST", { revision: state.revision }, 409);
  assert.equal((await request("nodes/parent")).body, "External edit");
  await fs.writeFile(path.join(directory, "parent.md"), serialize(saved));
  await request("undo/undo", "POST", { revision: state.revision });
  await store.save(record("child", { parent: "parent" }));
  state = await request("undo");
  await request("undo/undo", "POST", { revision: state.revision }, 409);
  assert.equal((await request("nodes")).nodes.length, 2);
});

test("integrated text edits undo and redo; unrelated attachments are not read or copied", async (t) => {
  const { directory } = await fixture(t),
    { request, travel } = await start(t, directory);
  const config = await request("settings"),
    root = config.documentRoot;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "notes.txt"), "Before");
  await fs.writeFile(path.join(root, "large.bin"), Buffer.alloc(1_000_000, 7));
  await request(
    "nodes",
    "POST",
    record("note", {
      resources: [
        { id: "text", label: "Notes", locationId: "addon", path: "notes.txt" },
      ],
    }),
    201,
  );
  const originalRead = fs.readFile.bind(fs);
  const mock = t.mock.method(fs, "readFile", async (file, ...args) => {
    assert.notEqual(path.basename(String(file)), "large.bin");
    return originalRead(file, ...args);
  });
  const doc = await request("nodes/note/resources/text");
  await request("nodes/note/resources/text/text", "PUT", {
    body: "After",
    revision: doc.revision,
    targetRevision: doc.targetRevision,
  });
  assert.equal((await request("undo")).undo, 2);
  await travel("undo");
  assert.equal(
    await fs.readFile(path.join(root, "notes.txt"), "utf8"),
    "Before",
  );
  await travel("redo");
  assert.equal(
    await fs.readFile(path.join(root, "notes.txt"), "utf8"),
    "After",
  );
  mock.mock.restore();
  const node = await request("nodes/note");
  await fs.writeFile(path.join(root, "different.txt"), "After");
  await fs.writeFile(
    path.join(directory, "note.md"),
    serialize({
      ...node,
      resources: [{ ...node.resources[0], path: "different.txt" }],
    }),
  );
  const state = await request("undo");
  await request("undo/undo", "POST", { revision: state.revision }, 409);
  assert.equal(
    await fs.readFile(path.join(root, "different.txt"), "utf8"),
    "After",
  );
});

test("a failed history commit rolls back its edit and a failed multi-file undo rolls back completed writes", async (t) => {
  const { directory } = await fixture(t),
    { request } = await start(t, directory);
  const first = await request("nodes", "POST", record("first"), 201);
  const before = await fs.readFile(path.join(directory, "first.md"), "utf8");
  const rename = fs.rename.bind(fs);
  let failIndex = true;
  let mock = t.mock.method(fs, "rename", async (source, target) => {
    if (
      failIndex &&
      target === path.join(directory, ".history", "actions", "index.json")
    ) {
      failIndex = false;
      throw new Error("Simulated disk failure");
    }
    return rename(source, target);
  });
  await request("nodes/first", "PUT", { ...first, importance: 5 }, 500);
  mock.mock.restore();
  assert.equal(
    await fs.readFile(path.join(directory, "first.md"), "utf8"),
    before,
  );
  assert.equal((await request("undo")).undo, 1);
  await request("nodes", "POST", record("second"), 201);
  const state = await request("undo");
  let failOrder = true;
  mock = t.mock.method(fs, "rename", async (source, target) => {
    if (failOrder && target === path.join(directory, "list-order.json")) {
      failOrder = false;
      throw new Error("Simulated order failure");
    }
    return rename(source, target);
  });
  await request("undo/undo", "POST", { revision: state.revision }, 500);
  mock.mock.restore();
  assert.equal((await request("nodes")).nodes.length, 2);
  assert.equal((await request("undo")).revision, state.revision);
});

test("restart recovers a partial undo and preserves an interrupted edit without overwriting it", async (t) => {
  const { directory } = await fixture(t);
  const file = path.join(directory, "note.md"),
    history = new UndoHistory(directory, { validate: async () => {} });
  await fs.writeFile(file, "Before");
  await history.record(async () => {
    await history.watch(
      { kind: "record", id: "note" },
      { kind: "record", title: "Example" },
    );
    await fs.writeFile(file, "After");
  });
  const state = await history.state();
  await history.packed("pending.json.gz", {
    mode: "travel",
    root: state.root,
    revision: state.revision,
    nextRevision: randomUUID(),
    changes: [
      {
        target: { kind: "record", id: "note" },
        before: "After",
        after: "Before",
      },
    ],
  });
  await fs.writeFile(file, "Before");
  const restarted = new UndoHistory(directory, { validate: async () => {} });
  await restarted.recover();
  assert.equal(await fs.readFile(file, "utf8"), "After");
  assert.equal((await restarted.status()).undo, 1);
  await history.packed("pending.json.gz", {
    mode: "edit",
    root: state.root,
    revision: state.revision,
    changes: [{ target: { kind: "record", id: "note" }, before: "After" }],
  });
  await fs.writeFile(file, "Interrupted edit");
  await restarted.recover();
  assert.equal(await fs.readFile(file, "utf8"), "Interrupted edit");
  assert.equal((await restarted.status()).undo, 0);
  assert.ok(
    (await fs.readdir(await restarted.folder())).some((name) =>
      name.startsWith("interrupted-"),
    ),
  );
});

test("history retains one thousand steps across restart and trims only the oldest steps", async (t) => {
  const { directory } = await fixture(t),
    file = path.join(directory, "note.md");
  const history = new UndoHistory(directory, { validate: async () => {} });
  await fs.writeFile(file, "0");
  for (let i = 1; i <= 1003; i++)
    await history.record(async () => {
      await history.watch(
        { kind: "record", id: "note" },
        { kind: "record", title: "Example" },
      );
      await fs.writeFile(file, String(i));
    });
  const restarted = new UndoHistory(directory, { validate: async () => {} });
  let status = await restarted.status();
  assert.equal(status.undo, 1000);
  assert.equal(
    (await fs.readdir(await restarted.folder())).filter((name) =>
      /^[a-f0-9-]{36}\.json\.gz$/.test(name),
    ).length,
    1000,
  );
  for (let i = 0; i < 3; i++)
    status = await restarted.travel("undo", status.revision);
  assert.equal(await fs.readFile(file, "utf8"), "1000");
  assert.equal(status.redo, 3);
  for (let i = 0; i < 3; i++)
    status = await restarted.travel("redo", status.revision);
  assert.equal(await fs.readFile(file, "utf8"), "1003");
  await restarted.clear();
  assert.equal((await restarted.status()).undo, 0);
  assert.deepEqual(await fs.readdir(await restarted.folder()), ["index.json"]);
  assert.equal(await fs.readFile(file, "utf8"), "1003");
});

test("copied or replaced libraries start a new undo boundary and reject untrusted target paths", async (t) => {
  const { root, directory } = await fixture(t),
    history = new UndoHistory(directory, { validate: async () => {} });
  await history.record(async () => {
    await history.watch({ kind: "record", id: "note" }, { kind: "create" });
    await fs.writeFile(path.join(directory, "note.md"), "Example");
  });
  const copied = path.join(root, "copy");
  await fs.cp(directory, copied, { recursive: true });
  assert.equal((await new UndoHistory(copied).status()).undo, 0);
  await assert.rejects(
    history.target({ kind: "record", id: "../outside" }),
    /damaged/,
  );
  await assert.rejects(
    history.target({ kind: "metadata", name: "../settings.json" }),
    /damaged/,
  );
  const state = await history.state();
  await history.packed(`${state.entries[0].id}.json.gz`, {
    changes: [
      {
        target: { kind: "record", id: "../outside" },
        before: null,
        after: "bad",
      },
    ],
  });
  await assert.rejects(history.travel("undo", state.revision), /damaged/);
  assert.equal(
    await fs.readFile(path.join(directory, "note.md"), "utf8"),
    "Example",
  );
});

test("history labels and confirmations are available in both languages", () => {
  for (const language of ["en", "cs"])
    for (const key of [
      "undo.undo",
      "undo.redo",
      "undo.section",
      "undo.confirmHelp.undo",
      "undo.confirmHelp.redo",
      "undo.conflict",
      "undo.action.map",
    ])
      assert.notEqual(translate(language, key), key);
});

test("history lists saved descriptions without file contents and selected ranges undo and redo atomically", async (t) => {
  const { directory } = await fixture(t),
    { request } = await start(t, directory);
  let node = await request("nodes", "POST", record("note"), 201);
  node = await request("nodes/note", "PUT", { ...node, importance: 5 });
  node = await request("nodes/note", "PUT", {
    ...node,
    title: "Revised title",
    body: "Private example body",
  });
  const list = await request("undo/history");
  assert.equal(list.entries.length, 3);
  assert.equal(list.entries[0].title, "Revised title");
  assert.deepEqual(list.entries[0].fields.toSorted(), ["body", "title"]);
  assert.deepEqual(list.entries[1].fields, ["importance"]);
  assert.ok(Number.isFinite(Date.parse(list.entries[0].at)));
  assert.equal(JSON.stringify(list).includes("Private example body"), false);
  assert.equal((await request("undo")).entries, undefined);
  assert.deepEqual(
    list.entries.map((e) => e.steps),
    [1, 2, 3],
  );
  assert.deepEqual(
    (await new UndoHistory(directory).history()).entries,
    list.entries,
  );
  const undo = await request("undo/undo", "POST", {
    revision: list.revision,
    entryId: list.entries[1].id,
  });
  const restored = await request("nodes/note");
  assert.equal(restored.importance, 3);
  assert.equal(restored.title, "Example note");
  assert.equal(restored.body, "Original notes");
  assert.equal(undo.redo, 2);
  const undone = await request("undo/history");
  assert.deepEqual(
    undone.entries.map((e) => [e.applied, e.direction, e.steps]),
    [
      [false, "redo", 2],
      [false, "redo", 1],
      [true, "undo", 1],
    ],
  );
  await request("undo/redo", "POST", {
    revision: undone.revision,
    entryId: list.entries[0].id,
  });
  assert.equal((await request("nodes/note")).importance, 5);
  assert.equal((await request("nodes/note")).body, "Private example body");
  await request(
    "undo/undo",
    "POST",
    { revision: list.revision, entryId: list.entries[0].id },
    409,
  );
  const state = await request("undo");
  await request(
    "undo/redo",
    "POST",
    { revision: state.revision, entryId: list.entries[0].id },
    409,
  );
  await request(
    "undo/undo",
    "POST",
    { revision: state.revision, entryId: "missing" },
    409,
  );
  assert.equal((await request("undo")).revision, state.revision);
});

test("history pages remain small, accept legacy entries and reject invalid page offsets", async (t) => {
  const { directory } = await fixture(t),
    { request } = await start(t, directory);
  const history = new UndoHistory(directory, { validate: async () => {} });
  const file = path.join(directory, "note.md");
  await fs.writeFile(file, "0");
  for (let i = 1; i <= 43; i++)
    await history.record(async () => {
      await history.watch(
        { kind: "record", id: "note" },
        { kind: "record", title: `Revision ${i}` },
      );
      await fs.writeFile(file, String(i));
    });
  const state = await history.state();
  delete state.entries[0].at;
  delete state.entries[0].fields;
  await history.saveState(state);
  const first = await request("undo/history"),
    last = await request("undo/history?offset=40");
  assert.equal(first.entries.length, 40);
  assert.equal(first.entries[0].title, "Revision 43");
  assert.equal(first.next, 40);
  assert.equal(last.entries.length, 3);
  assert.equal(last.next, null);
  assert.equal(last.previous, 0);
  assert.equal(last.entries.at(-1).at, undefined);
  assert.equal((await request("undo/history?offset=1000")).offset, 40);
  for (const offset of ["-1", "1.5", "no", "1001"])
    await request(`undo/history?offset=${offset}`, "GET", undefined, 400);
  assert.equal((await request("undo")).undo, 43);
});

test("a selected range rejects external edits before writes and rolls back every file after a disk failure", async (t) => {
  const { directory } = await fixture(t),
    { request, store } = await start(t, directory);
  const a = await store.save(record("first")),
    b = await store.save(record("second"));
  await request("nodes/first", "PUT", { ...a, importance: 4 });
  await request("nodes/second", "PUT", { ...b, importance: 5 });
  const list = await request("undo/history");
  const firstFile = path.join(directory, "first.md"),
    secondFile = path.join(directory, "second.md");
  const originalFirst = await fs.readFile(firstFile, "utf8"),
    originalSecond = await fs.readFile(secondFile, "utf8");
  await fs.writeFile(firstFile, originalFirst + "\nExternal edit");
  const body = { revision: list.revision, entryId: list.entries[1].id };
  await request("undo/undo", "POST", body, 409);
  assert.equal(await fs.readFile(secondFile, "utf8"), originalSecond);
  await fs.writeFile(firstFile, originalFirst);
  const rename = fs.rename.bind(fs);
  let reject = true;
  const mock = t.mock.method(fs, "rename", async (source, target) => {
    if (reject && target === firstFile) {
      reject = false;
      throw new Error("Simulated range write failure");
    }
    return rename(source, target);
  });
  await request("undo/undo", "POST", body, 500);
  mock.mock.restore();
  assert.equal(await fs.readFile(firstFile, "utf8"), originalFirst);
  assert.equal(await fs.readFile(secondFile, "utf8"), originalSecond);
  assert.equal((await request("undo")).revision, list.revision);
  await request("undo/undo", "POST", body);
  assert.equal((await request("nodes/first")).importance, 3);
  assert.equal((await request("nodes/second")).importance, 3);
});

test("a range with no net file changes still moves the history cursor and remains reversible", async (t) => {
  const { directory } = await fixture(t);
  const history = new UndoHistory(directory, { validate: async () => {} });
  const file = path.join(directory, "temporary.md");
  await history.record(async () => {
    await history.watch(
      { kind: "record", id: "temporary" },
      { kind: "create" },
    );
    await fs.writeFile(file, "Temporary note");
  });
  await history.record(async () => {
    await history.watch(
      { kind: "record", id: "temporary" },
      { kind: "archive" },
    );
    await fs.unlink(file);
  });
  const list = await history.history();
  let state = await history.travel("undo", list.revision, list.entries[1].id);
  assert.equal(state.undo, 0);
  assert.equal(state.redo, 2);
  state = await history.travel("redo", state.revision, list.entries[0].id);
  assert.equal(state.undo, 2);
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});

test("combined ranges stay within the recovery file limit before writing any data", async (t) => {
  const { directory } = await fixture(t);
  const history = new UndoHistory(directory, {
    validate: async () => assert.fail("Validation must not start"),
  });
  const state = await history.state();
  state.entries = Array.from({ length: 2 }, () => ({
    id: randomUUID(),
    bytes: 1,
    kind: "record",
    title: "Batch edit",
  }));
  state.cursor = 2;
  await history.saveState(state);
  t.mock.method(history, "unpack", async (name) => ({
    changes: Array.from({ length: 6000 }, (_, i) => ({
      target: { kind: "record", id: `${name.slice(0, 36)}-${i}` },
      before: "Before",
      after: "After",
    })),
  }));
  await assert.rejects(
    history.travel("undo", state.revision, state.entries[0].id),
    /too large/,
  );
  assert.equal((await history.status()).revision, state.revision);
  assert.deepEqual(await fs.readdir(directory), [".history"]);
});
