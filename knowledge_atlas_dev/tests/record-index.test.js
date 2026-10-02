import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, serialize } from "../server/store.js";
import { createApp } from "../server/index.js";
import { createAtlasSync } from "../src/atlas-sync.js";

const record = (id, body = "Searchable notes") => ({
  schema: 2,
  id,
  title: id,
  type: "knowledge",
  parent: null,
  status: "active",
  color: "#a7e87b",
  summary: "",
  tags: [],
  related: [],
  resources: [],
  body,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-index-"));
  const directory = path.join(root, "library");
  const store = new Store(directory, { persistentIndex: true });
  await store.init();
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-index-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, directory, store };
}

test("indexed reads reuse unchanged Markdown across concurrent requests and restarts", async (t) => {
  const { store, directory } = await fixture(t);
  for (let i = 0; i < 40; i++)
    await fs.writeFile(
      path.join(directory, `note-${i}.md`),
      serialize(record(`note-${i}`)),
    );
  const read = fs.readFile.bind(fs);
  let markdownReads = 0;
  const mocked = t.mock.method(fs, "readFile", async (file, ...args) => {
    if (String(file).endsWith(".md")) markdownReads++;
    return read(file, ...args);
  });
  t.after(() => mocked.mock.restore());
  const [first, concurrent] = await Promise.all([store.read(), store.read()]);
  assert.deepEqual(first, concurrent);
  assert.equal(markdownReads, 40);
  first.nodes[0].body = "Caller mutation";
  first.errors.push({ file: "test", message: "Caller diagnostic" });
  assert.deepEqual(await store.read(), concurrent);
  assert.equal(markdownReads, 40, "unchanged reads only inspect file metadata");
  const restart = new Store(directory, { persistentIndex: true });
  assert.deepEqual(await restart.read(), concurrent);
  assert.equal(markdownReads, 40, "restart uses the saved validated index");
  await fs.writeFile(
    path.join(directory, "note-1.md"),
    serialize(record("note-1", "Changed externally")),
  );
  const changed = await store.read();
  assert.equal(markdownReads, 41, "only the modified record is read again");
  assert.notEqual(changed.revision, concurrent.revision);
  assert.equal(
    changed.nodes.find((n) => n.id === "note-1").body,
    "Changed externally",
  );
  await fs.writeFile(path.join(directory, "note-1.md"), "Invalid Markdown");
  assert.equal((await store.read()).errors.length, 1);
  const readsWithError = markdownReads;
  assert.equal((await store.read()).errors.length, 1);
  assert.equal(markdownReads, readsWithError);
  await fs.writeFile(
    path.join(directory, "note-1.md"),
    serialize(record("note-1", "Repaired")),
  );
  assert.deepEqual((await store.read()).errors, []);
  await fs.unlink(path.join(directory, "note-1.md"));
  assert.equal((await store.read()).nodes.length, 39);
});

test("damaged caches rebuild and directory replacement drops records from the old library", async (t) => {
  const { root, directory, store } = await fixture(t);
  await fs.writeFile(
    path.join(directory, "before.md"),
    serialize(record("before")),
  );
  const first = await store.read();
  await fs.writeFile(
    path.join(directory, ".cache", "atlas-index.json"),
    "broken cache",
  );
  assert.deepEqual(
    await new Store(directory, { persistentIndex: true }).read(),
    first,
  );
  await fs.rename(directory, path.join(root, "previous"));
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, "after.md"),
    serialize(record("after")),
  );
  const restored = await store.read();
  assert.deepEqual(
    restored.nodes.map((n) => n.id),
    ["after"],
  );
  assert.notEqual(restored.revision, first.revision);
  assert.deepEqual(
    await new Store(directory, { persistentIndex: true }).read(),
    restored,
  );
});

test("stat-based index catches equal-length edits with restored modification times", async (t) => {
  const { store, directory } = await fixture(t);
  const file = path.join(directory, "note.md");
  await fs.writeFile(file, serialize(record("note", "Before")));
  const first = await store.read();
  const stat = await fs.stat(file);
  await fs.writeFile(file, serialize(record("note", "After!")));
  await fs.utimes(file, stat.atime, stat.mtime);
  const next = await store.read();
  assert.equal(next.nodes[0].body, "After!");
  assert.notEqual(next.revision, first.revision);
});

test("cached API snapshots support compression, conditional reads and current settings", async (t) => {
  const { directory } = await fixture(t);
  await fs.writeFile(
    path.join(directory, "note.md"),
    serialize(record("note", "Body text ".repeat(1000))),
  );
  const { app, settings } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/nodes`;
  const compressed = await fetch(url, {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
  const snapshot = await compressed.json();
  const etag = compressed.headers.get("ETag");
  const plain = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(plain.headers.get("Content-Encoding"), null);
  assert.deepEqual(await plain.json(), snapshot);
  assert.equal(
    (await fetch(url, { headers: { "If-None-Match": etag } })).status,
    304,
  );
  await fs.writeFile(
    settings.file,
    JSON.stringify({ ...(await settings.read()), language: "cs" }),
  );
  const updated = await fetch(url, { headers: { "If-None-Match": etag } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).settings.language, "cs");
  await fs.writeFile(
    path.join(directory, "missing.md"),
    serialize({
      ...record("missing"),
      resources: [
        { label: "Missing place", path: "manual.pdf", locationId: "unknown" },
      ],
    }),
  );
  const invalid = await (await fetch(url)).json();
  assert.equal(invalid.errors.length, 1);
  assert.equal(
    (await (await fetch(url)).json()).errors.length,
    1,
    "cached errors must not accumulate",
  );
});

test("background indexing reports progress without blocking first load or the previous map", async (t) => {
  const { directory } = await fixture(t);
  const file = path.join(directory, "note.md");
  await fs.writeFile(file, serialize(record("note", "Before")));
  const { app, store } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const read = fs.readFile.bind(fs);
  let gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  const mocked = t.mock.method(fs, "readFile", async (target, ...args) => {
    if (target === file) {
      entered.resolve();
      await gate.promise;
    }
    return read(target, ...args);
  });
  t.after(() => {
    gate.resolve();
    mocked.mock.restore();
    store.stopBackground();
  });
  const url = `http://127.0.0.1:${server.address().port}/api/atlas`;
  assert.equal((await fetch(url)).status, 202);
  await entered.promise;
  const pending = await fetch(url, { signal: AbortSignal.timeout(2000) });
  assert.equal(pending.status, 202);
  const progress = JSON.parse(pending.headers.get("X-Atlas-Index"));
  assert.equal(progress.phase, "building");
  assert.equal(progress.total, 1);
  assert.equal(progress.processed, 0);
  assert.ok(progress.elapsedMs >= 0);
  gate.resolve();
  await store.reading;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).nodes[0].body, "Before");
  assert.equal(JSON.parse(first.headers.get("X-Atlas-Index")).phase, "ready");
  gate = Promise.withResolvers();
  entered = Promise.withResolvers();
  await fs.writeFile(file, serialize(record("note", "After")));
  store.refreshBackground();
  await entered.promise;
  const rebuilding = await fetch(url, { signal: AbortSignal.timeout(2000) });
  assert.equal(rebuilding.status, 200);
  assert.equal((await rebuilding.json()).nodes[0].body, "Before");
  assert.equal(
    JSON.parse(rebuilding.headers.get("X-Atlas-Index")).phase,
    "building",
  );
  gate.resolve();
  await store.reading;
  const after = await fetch(url);
  assert.equal((await after.json()).nodes[0].body, "After");
  assert.notEqual(after.headers.get("ETag"), first.headers.get("ETag"));
});

test("client reports indexing without treating an accepted build as an empty library or error", async () => {
  let calls = 0;
  const snapshots = [],
    progress = [],
    errors = [];
  const sync = createAtlasSync({
    fetchImpl: async () =>
      ++calls === 1
        ? new Response(JSON.stringify({ index: { phase: "building" } }), {
            status: 202,
            headers: {
              "X-Atlas-Index": JSON.stringify({
                phase: "building",
                processed: 4,
                total: 10,
              }),
            },
          })
        : new Response(JSON.stringify({ nodes: [record("ready")] }), {
            headers: {
              etag: "ready",
              "X-Atlas-Index": JSON.stringify({
                phase: "ready",
                processed: 10,
                total: 10,
              }),
            },
          }),
    onSnapshot: (value) => snapshots.push(value),
    onIndex: (value) => progress.push(value),
    onError: (error) => errors.push(error),
  });
  try {
    await sync.start();
    assert.equal(snapshots.length, 0);
    assert.equal(errors.length, 0);
    assert.equal(progress[0].processed, 4);
    await sync.refresh();
    assert.equal(snapshots[0].nodes[0].id, "ready");
    assert.equal(progress[1].phase, "ready");
  } finally {
    sync.stop();
  }
});

test("slow explicit requests get sixty seconds and report timeout separately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const errors = [];
  const sync = createAtlasSync({
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    },
    onSnapshot: () => assert.fail("No response was delivered"),
    onError: (error) => errors.push(error),
  });
  try {
    const request = sync.start();
    await Promise.resolve();
    t.mock.timers.tick(10_000);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(50_000);
    await request;
    assert.equal(errors[0].name, "TimeoutError");
  } finally {
    sync.stop();
  }
});
