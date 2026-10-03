import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store,
  serialize,
  parseMarkdown,
  validateNode,
} from "../server/store.js";
import { createApp } from "../server/index.js";
import { Backups } from "../server/backups.js";
import { Settings } from "../server/settings.js";
import { recordDate, sortRecords } from "../shared/record-list.js";
import { readOrder, writeOrder } from "../server/record-order.js";
import { filterNodes } from "../src/atlas-model.js";
import { setLanguage, localizeMessage, translate } from "../shared/i18n.js";

const record = (id, extra = {}) => ({
  schema: 2,
  id,
  title: id,
  type: "knowledge",
  status: "active",
  parent: null,
  color: "#a7e87b",
  summary: "A generic record",
  body: "Notes",
  tags: [],
  related: [],
  resources: [],
  ...extra,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-list-"));
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-list-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "library"),
    store = new Store(directory, { persistentIndex: true });
  await store.init();
  return { root, directory, store };
}
const ids = (snapshot) => snapshot.nodes.map((node) => node.id);
function contiguous(snapshot) {
  assert.deepEqual(
    snapshot.nodes.map((node) => node.position),
    snapshot.nodes.map((_, index) => index + 1),
  );
  assert.equal(new Set(ids(snapshot)).size, snapshot.nodes.length);
}

test("new entries take position one; moving to fifty shifts only the sequence and survives restart", async (t) => {
  const { store, directory } = await fixture(t);
  for (let i = 1; i <= 55; i++)
    await store.save(record(`note-${i}`, { importance: (i % 5) + 1 }));
  const initial = await store.read();
  assert.equal(ids(initial)[0], "note-55");
  contiguous(initial);
  const raw = await Promise.all(
    initial.nodes.map((node) =>
      fs.readFile(path.join(directory, node.file), "utf8"),
    ),
  );
  const moved = await store.move("note-55", 50, initial.orderRevision);
  assert.deepEqual(ids(moved).slice(48, 52), [
    "note-6",
    "note-55",
    "note-5",
    "note-4",
  ]);
  contiguous(moved);
  assert.deepEqual(
    await Promise.all(
      initial.nodes.map((node) =>
        fs.readFile(path.join(directory, node.file), "utf8"),
      ),
    ),
    raw,
    "changing position must not rewrite Markdown, dates, importance or content revisions",
  );
  assert.deepEqual(
    await new Store(directory, { persistentIndex: true }).read(),
    moved,
  );
  await assert.rejects(
    store.move("note-1", 2, initial.orderRevision),
    (error) => error.status === 409,
  );
  const top = await store.move("note-1", 1, moved.orderRevision);
  assert.equal(ids(top)[0], "note-1");
  const bottom = await store.move("note-1", 999, top.orderRevision);
  assert.equal(ids(bottom).at(-1), "note-1");
  contiguous(bottom);
  for (const position of [0, -1, 1.5, "3", null, Infinity])
    await assert.rejects(
      store.move("note-1", position, bottom.orderRevision),
      /positive integer/,
    );
  const visible = filterNodes(bottom.nodes, { importance: [5] });
  assert.ok(
    visible.every(
      (node) =>
        node.position === bottom.nodes.find((n) => n.id === node.id).position,
    ),
  );
  assert.deepEqual(
    sortRecords(visible).map((node) => node.position),
    visible.map((node) => node.position),
  );
});

test("manual Markdown additions, edits and removals update the sequence without rewriting legacy records", async (t) => {
  const { store, directory } = await fixture(t);
  const legacy = serialize(record("legacy"));
  await fs.writeFile(path.join(directory, "legacy.md"), legacy);
  await store.read();
  await fs.writeFile(
    path.join(directory, "manual.md"),
    serialize(record("manual", { date: "2025-03-04" })),
  );
  let snapshot = await store.read();
  assert.deepEqual(ids(snapshot), ["manual", "legacy"]);
  const current = snapshot.nodes[1];
  await store.save(
    { ...current, date: "2026-05-07", importance: 5, position: 1 },
    current.id,
    current.revision,
  );
  snapshot = await store.read();
  assert.deepEqual(
    ids(snapshot),
    ["manual", "legacy"],
    "content edits do not change ordering",
  );
  assert.equal(
    parseMarkdown(await fs.readFile(path.join(directory, "legacy.md"), "utf8"))
      .position,
    undefined,
  );
  await store.archive(snapshot.nodes[0].id, snapshot.nodes[0].revision);
  snapshot = await store.read();
  assert.equal(snapshot.nodes[0].position, 1);
  await fs.writeFile(
    path.join(directory, "later.md"),
    serialize(record("later", { date: "2001-01-01" })),
  );
  assert.deepEqual(
    ids(await store.read()),
    ["later", "legacy"],
    "event date does not change new-record insertion",
  );
});

test("date sorting uses event dates, task deadlines and honest metadata fallbacks with stable ties", () => {
  const nodes = [
    record("unknown", { position: 1 }),
    record("created", {
      position: 2,
      created: "2026-01-02T23:30:00-05:00",
      updated: "2026-12-12",
    }),
    record("task", {
      position: 3,
      type: "task",
      task: { start: "2026-01-01", due: "2026-04-02" },
    }),
    record("event", { position: 4, date: "2026-06-02", importance: 5 }),
    record("journal", {
      position: 5,
      tool: { kind: "journal", date: "2026-06-02" },
    }),
  ];
  assert.deepEqual(recordDate(nodes[1]), {
    date: "2026-01-02",
    source: "created",
  });
  assert.deepEqual(
    sortRecords(nodes, "newest").map((n) => n.id),
    ["event", "journal", "task", "created", "unknown"],
  );
  assert.deepEqual(
    sortRecords(nodes, "oldest").map((n) => n.id),
    ["created", "task", "event", "journal", "unknown"],
  );
  assert.equal(sortRecords(nodes, "importance")[0].id, "event");
  assert.deepEqual(
    sortRecords(nodes).map((n) => n.position),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(recordDate(record("fallback", { updated: "2026-04-05" })), {
    date: "2026-04-05",
    source: "updated",
  });
  for (const date of ["2026-02-29", "2026-13-01", "tomorrow", 123, {}, []])
    assert.throws(
      () => validateNode(record("invalid", { date })),
      /Invalid record date/,
    );
  for (const date of ["2024-02-29", "2026-10-02", "", undefined])
    validateNode(record("valid", { date }));
});

test("list order and record dates survive a full backup and restore without changing stable IDs", async (t) => {
  const { store, root, directory } = await fixture(t);
  const settings = new Settings(directory, false);
  await settings.init();
  const backups = new Backups(directory, settings);
  await store.save(record("first", { date: "2024-02-29" }));
  await store.save(
    record("second", { type: "task", task: { due: "2026-11-01" } }),
  );
  const before = await store.read();
  const ordered = await store.move("first", 1, before.orderRevision, true);
  const archive = path.join(root, "portable.zip");
  await backups.export(createWriteStream(archive));
  await store.save(record("temporary"));
  const plan = await backups.prepare(createReadStream(archive));
  await backups.restore(plan.id, plan.revision);
  const after = await store.read();
  assert.deepEqual(ids(after), ids(ordered));
  assert.equal(after.nodes[0].date, "2024-02-29");
  assert.equal(after.orderRevision, ordered.orderRevision);
  assert.equal(after.nodes[0].positionFixed, true);
  contiguous(after);
});

test("API ordering is optimistic, keeps node revisions valid and refreshes the indexed response", async (t) => {
  const { directory } = await fixture(t);
  const { app, store } = await createApp({ directory });
  await store.save(record("one"));
  await store.save(record("two"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const first = await (await fetch(base + "nodes")).json();
  const put = (body) =>
    fetch(base + "nodes/one/position", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify(body),
    });
  const changed = await put({
    position: 1,
    positionFixed: true,
    revision: first.orderRevision,
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).positionFixed, true);
  assert.equal(
    (await put({ position: 2, revision: first.orderRevision })).status,
    409,
  );
  const snapshot = await (await fetch(base + "atlas")).json();
  assert.deepEqual(ids(snapshot), ["one", "two"]);
  await store.save(record("three"));
  assert.deepEqual(ids(await store.read()), ["one", "three", "two"]);
  assert.equal(
    snapshot.nodes[0].revision,
    first.nodes.find((node) => node.id === "one").revision,
  );
});

test("invalid ordering metadata is reported without replacing the file or hiding records", async (t) => {
  const { directory, store } = await fixture(t);
  await store.save(record("note"));
  const file = path.join(directory, "list-order.json");
  for (const raw of [
    '{"schema":1,"ids":["note","note"]}',
    "null",
    "{broken",
    '{"schema":1,"ids":["note"],"fixed":null}',
    '{"schema":1,"ids":["note"],"fixed":{"missing":1}}',
    '{"schema":1,"ids":["note"],"fixed":{"note":0}}',
    '{"schema":1,"ids":["note"],"fixed":{"note":"1"}}',
    '{"schema":1,"ids":["note"],"fixed":{"note":9007199254740992}}',
    '{"schema":1,"ids":["note","other"],"fixed":{"note":1,"other":1}}',
  ]) {
    await fs.writeFile(file, raw);
    const snapshot = await store.read();
    assert.equal(snapshot.nodes.length, 1);
    assert.equal(snapshot.errors[0].file, "list-order.json");
    await assert.rejects(
      store.move("note", 1, snapshot.orderRevision),
      /Invalid list order/,
    );
    assert.equal(await fs.readFile(file, "utf8"), raw);
  }
  await fs.writeFile(file, JSON.stringify({ schema: 1, ids: [] }));
  assert.deepEqual((await store.read()).errors, []);
});

test("English and Czech list controls translate labels without changing stored record fields", () => {
  const node = record("note", {
    date: "2026-10-02",
    importance: 4,
    position: 3,
  });
  const raw = serialize(node);
  for (const language of ["en", "cs"]) {
    setLanguage(language);
    for (const key of [
      "list.sort",
      "list.sort.order",
      "list.position",
      "list.recordDate",
      "list.move",
      "list.fixed",
      "list.fixedHelp",
    ])
      assert.notEqual(translate(language, key), key);
    assert.equal(serialize(node), raw);
    assert.deepEqual(recordDate(node), { date: "2026-10-02", source: "event" });
    assert.equal(
      localizeMessage("List position must be a positive integer."),
      translate(language, "list.invalidPosition"),
    );
  }
  setLanguage("en");
});

test("a failed atomic order replacement leaves the previous sequence and Markdown intact", async (t) => {
  const { directory, store } = await fixture(t);
  await store.save(record("first"));
  await store.save(record("second"));
  const before = await store.read();
  const file = path.join(directory, "list-order.json");
  const raw = await fs.readFile(file, "utf8");
  const rename = fs.rename.bind(fs);
  const mock = t.mock.method(fs, "rename", async (source, target) => {
    if (target === file)
      throw Object.assign(new Error("No space left on device."), {
        code: "ENOSPC",
      });
    return rename(source, target);
  });
  await assert.rejects(store.move("first", 1, before.orderRevision), {
    code: "ENOSPC",
  });
  mock.mock.restore();
  assert.equal(await fs.readFile(file, "utf8"), raw);
  assert.deepEqual(await store.read(), before);
  assert.equal(
    (await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))
      .length,
    0,
  );
});

test("fixed first and fifth positions survive additions, file imports, moves and restart", async (t) => {
  const { directory, store } = await fixture(t);
  for (const id of ["a", "b", "c", "d", "e", "f"])
    await fs.writeFile(path.join(directory, `${id}.md`), serialize(record(id)));
  let snapshot = await store.read();
  snapshot = await store.move("a", 1, snapshot.orderRevision, true);
  snapshot = await store.move("e", 5, snapshot.orderRevision, true);
  const raw = await fs.readFile(path.join(directory, "e.md"), "utf8");
  const created = await store.save(record("new"));
  assert.equal(
    created.position,
    2,
    "new records use the first unreserved position",
  );
  snapshot = await store.read();
  assert.deepEqual(ids(snapshot), ["a", "new", "b", "c", "e", "d", "f"]);
  contiguous(snapshot);
  for (const id of ["manual-one", "manual-two"])
    await fs.writeFile(path.join(directory, `${id}.md`), serialize(record(id)));
  snapshot = await store.read();
  assert.equal(snapshot.nodes.find((n) => n.id === "a").position, 1);
  assert.equal(snapshot.nodes.find((n) => n.id === "e").position, 5);
  snapshot = await store.move("f", 2, snapshot.orderRevision);
  assert.equal(snapshot.nodes[1].id, "f");
  assert.equal(snapshot.nodes[4].id, "e");
  snapshot = await store.move("e", 7, snapshot.orderRevision);
  assert.equal(snapshot.nodes[6].id, "e");
  assert.equal(
    snapshot.nodes[6].positionFixed,
    true,
    "explicit moves retain the lock at its new number",
  );
  assert.equal(await fs.readFile(path.join(directory, "e.md"), "utf8"), raw);
  assert.equal(
    parseMarkdown(serialize(snapshot.nodes[6])).positionFixed,
    undefined,
  );
  assert.deepEqual(
    await new Store(directory, { persistentIndex: true }).read(),
    snapshot,
  );
});

test("occupied fixed positions and stale pin writes are rejected; unpinning restores renumbering", async (t) => {
  const { store } = await fixture(t);
  for (const id of ["c", "b", "a"]) await store.save(record(id));
  const before = await store.read();
  let snapshot = await store.move("a", 1, before.orderRevision, true);
  await assert.rejects(
    store.move("b", 2, before.orderRevision, true),
    (e) => e.status === 409,
  );
  for (const locked of [true, false, undefined])
    await assert.rejects(
      store.move("b", 1, snapshot.orderRevision, locked),
      /fixed by another record/,
    );
  for (const locked of ["true", 1, null, {}])
    await assert.rejects(
      store.move("b", 2, snapshot.orderRevision, locked),
      /boolean/,
    );
  assert.deepEqual(await store.read(), snapshot);
  snapshot = await store.move("a", 1, snapshot.orderRevision, false);
  assert.equal(snapshot.nodes[0].positionFixed, false);
  await store.save(record("new"));
  assert.deepEqual(ids(await store.read()), ["new", "a", "b", "c"]);
});

test("archiving or temporarily invalid files cannot renumber fixed records, even beyond the count", async (t) => {
  const { store, directory } = await fixture(t);
  for (const id of ["e", "d", "c", "b", "a"]) await store.save(record(id));
  let snapshot = await store.read();
  snapshot = await store.move("e", 5, snapshot.orderRevision, true);
  for (const id of ["a", "b", "c", "d"]) {
    const n = snapshot.nodes.find((n) => n.id === id);
    await store.archive(id, n.revision);
    snapshot = await store.read();
    assert.equal(snapshot.nodes.find((n) => n.id === "e").position, 5);
  }
  const raw = await fs.readFile(path.join(directory, "e.md"), "utf8");
  await fs.writeFile(
    path.join(directory, "e.md"),
    "Temporarily invalid header",
  );
  await store.read();
  assert.deepEqual((await readOrder(directory)).fixed, { e: 5 });
  await store.save(record("new"));
  await fs.writeFile(path.join(directory, "e.md"), raw);
  snapshot = await store.read();
  assert.deepEqual(
    snapshot.nodes.map((n) => [n.id, n.position]),
    [
      ["new", 1],
      ["e", 5],
    ],
  );
  assert.equal(snapshot.nodes[1].positionFixed, true);
  await store.archive("e", snapshot.nodes[1].revision);
  await store.read();
  assert.deepEqual(
    (await readOrder(directory)).fixed,
    {},
    "archiving a fixed record releases its reservation",
  );
});

test("legacy order files remain unchanged until an edit and every type supports fixed positions", async (t) => {
  const { store, directory } = await fixture(t);
  const types = [
    "category",
    "project",
    "knowledge",
    "skill",
    "code",
    "item",
    "task",
  ];
  const sequence = types.map((type) => `record-${type}`);
  for (const type of types)
    await fs.writeFile(
      path.join(directory, `record-${type}.md`),
      serialize(record(`record-${type}`, { type })),
    );
  const file = path.join(directory, "list-order.json"),
    legacy = JSON.stringify({ schema: 1, ids: sequence });
  await fs.writeFile(file, legacy);
  let snapshot = await store.read();
  assert.deepEqual(ids(snapshot), sequence);
  assert.equal(await fs.readFile(file, "utf8"), legacy);
  for (let i = 0; i < sequence.length; i++)
    snapshot = await store.move(
      sequence[i],
      i + 1,
      snapshot.orderRevision,
      true,
    );
  await store.save(record("new"));
  snapshot = await store.read();
  assert.deepEqual(ids(snapshot), [...sequence, "new"]);
  assert.ok(snapshot.nodes.slice(0, -1).every((n) => n.positionFixed));
  const fixed = {
    ...(await readOrder(directory)).fixed,
    [sequence[0]]: 1000000,
  };
  await writeOrder(directory, { ids: ids(snapshot), fixed });
  assert.equal(
    (await store.read()).nodes.at(-1).position,
    1000000,
    "sparse positions do not allocate empty rows",
  );
});
