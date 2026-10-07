import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { serialize } from "../server/store.js";
import { createAtlasSync } from "../src/atlas-sync.js";

const record = (id, type = "knowledge") => ({
  schema: 2,
  id,
  title: `Example ${id}`,
  type,
  parent: null,
  status: "active",
  importance: 3,
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [],
  summary: "Example summary",
  body: "Detailed example notes. ".repeat(1500),
});

test("task landing data omits knowledge contents and map positions while full records remain editable", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-startup-"));
  const directory = path.join(root, "library");
  await fs.mkdir(directory);
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-startup-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  for (let i = 0; i < 24; i++)
    await fs.writeFile(
      path.join(directory, `note-${i}.md`),
      serialize(record(`note-${i}`)),
    );
  const task = {
    ...record("task", "task"),
    body: "Complete task notes",
    task: {
      start: "2026-10-01",
      due: "2026-10-09",
      checkpoints: [
        {
          id: "review",
          due: "2026-10-05",
          description: "Review example",
          done: false,
        },
      ],
    },
  };
  await fs.writeFile(path.join(directory, "task.md"), serialize(task));
  await fs.writeFile(
    path.join(directory, "map-positions.json"),
    JSON.stringify({
      schema: 1,
      views: { "grid:2": [{ id: "task", x: 5, y: 6, z: 0 }] },
    }),
  );
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
  let mapReads = 0;
  const original = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", async (file, ...args) => {
    if (path.basename(String(file)) === "map-positions.json") mapReads++;
    return original(file, ...args);
  });
  const response = await fetch(base + "workspace?refresh=1");
  assert.equal(response.status, 200);
  const light = await response.json();
  assert.equal(light.content, "tasks");
  assert.equal(light.nodes.length, 25);
  assert.equal(light.mapPositions, undefined);
  assert.equal(mapReads, 0);
  assert.equal(light.nodes.find((n) => n.id === "task").body, task.body);
  assert.equal(
    light.nodes.find((n) => n.id === "task").task.checkpoints[0].description,
    "Review example",
  );
  const partial = light.nodes.find((n) => n.id === "note-0");
  assert.equal(partial.partial, true);
  assert.equal(partial.body, "");
  assert.deepEqual(partial.resources, []);
  assert.equal(
    (
      await fetch(base + "workspace", {
        headers: { "If-None-Match": response.headers.get("ETag") },
      })
    ).status,
    304,
  );
  const fullResponse = await fetch(base + "workspace?content=records", {
    headers: { "If-None-Match": response.headers.get("ETag") },
  });
  assert.equal(
    fullResponse.status,
    200,
    "content variants never share a 304 response",
  );
  const full = await fullResponse.json();
  assert.equal(full.content, "records");
  assert.equal(
    full.nodes.find((n) => n.id === "note-0").body,
    record("note-0").body.trim(),
  );
  assert.equal(full.mapPositions, undefined);
  assert.equal(
    mapReads,
    0,
    "even opening the record library does not load positions",
  );
  assert.ok(
    JSON.stringify(light).length < JSON.stringify(full).length / 20,
    "task bootstrap avoids knowledge bodies",
  );
  const rejected = await fetch(base + "nodes/note-0", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Knowledge-Client": "atlas",
    },
    body: JSON.stringify({
      ...partial,
      schema: 2,
      revision: full.nodes.find((n) => n.id === "note-0").revision,
    }),
  });
  assert.equal(
    rejected.status,
    400,
    "navigation summaries cannot overwrite records",
  );
  assert.match((await rejected.json()).error, /complete record/);
  const map = await (await fetch(base + "atlas")).json();
  assert.ok(mapReads > 0);
  assert.equal(map.content, "map");
  assert.equal(map.mapPositions.views["grid:2"][0].x, 5);
  assert.equal(map.nodes.find((n) => n.id === "note-0").body, "");
  assert.equal(map.nodes.find((n) => n.id === "note-0").partial, true);
  const overview = await (
    await fetch(base + "workspace?content=overview")
  ).json();
  assert.equal(overview.content, "overview");
  assert.ok(overview.nodes.every((n) => n.partial && !n.body));
  const note = await (await fetch(base + "nodes/note-0")).json();
  assert.equal(note.body, record("note-0").body.trim());
  const search = await (
    await fetch(base + "search?q=Detailed%20example%20notes")
  ).json();
  assert.ok(
    search.ids.includes("note-0"),
    "full-text search still finds unloaded contents",
  );
  assert.ok(!search.ids.includes("task"));
  const legacy = await (await fetch(base + "nodes")).json();
  assert.equal(legacy.nodes.find((n) => n.id === "note-0").body, note.body);
  await fs.writeFile(
    path.join(directory, "task.md"),
    serialize({
      ...task,
      title: "Updated task",
      body: "Updated from Markdown",
    }),
  );
  const fresh = await (await fetch(base + "workspace?refresh=1")).json();
  assert.equal(
    fresh.nodes.find((n) => n.id === "task").body,
    "Updated from Markdown",
  );
  assert.notEqual(fresh.revision, light.revision);
});

test("changing loading profiles cancels pending responses without replacing the active page", async () => {
  let resolveOld;
  const seen = [];
  const old = createAtlasSync({
    url: "./api/workspace?content=tasks",
    fetchImpl: () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    onSnapshot: (value) => seen.push(value.content),
  });
  const pending = old.start();
  await Promise.resolve();
  old.stop();
  const next = createAtlasSync({
    url: "./api/atlas",
    fetchImpl: async (url) => {
      assert.equal(url, "./api/atlas");
      return new Response(JSON.stringify({ content: "map" }), {
        headers: { ETag: "map" },
      });
    },
    onSnapshot: (value) => seen.push(value.content),
  });
  await next.start();
  resolveOld(
    new Response(JSON.stringify({ content: "tasks" }), {
      headers: { ETag: "tasks" },
    }),
  );
  await pending;
  next.stop();
  assert.deepEqual(seen, ["map"]);
});

test("production assets negotiate precompressed bytes and retain the original content type", async (t) => {
  const { default: express } = await import("express");
  const { gzipSync } = await import("node:zlib");
  const { compressedAssets } = await import("../server/assets.js");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-assets-"));
  t.after(async () => {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.join(os.tmpdir(), "atlas-assets-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const body = "/* Example asset */\n".repeat(3000);
  await fs.writeFile(path.join(directory, "index-example.js"), body);
  await fs.writeFile(
    path.join(directory, "index-example.js.gz"),
    gzipSync(body),
  );
  const app = express();
  app.use("/assets", compressedAssets(directory), express.static(directory));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/assets/index-example.js`;
  const compressed = await fetch(url, {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
  assert.match(compressed.headers.get("Content-Type"), /javascript/);
  assert.match(compressed.headers.get("Vary"), /Accept-Encoding/);
  assert.match(compressed.headers.get("Cache-Control"), /immutable/);
  assert.ok(
    Number(compressed.headers.get("Content-Length")) < body.length / 10,
  );
  assert.equal(await compressed.text(), body);
  const plain = await fetch(url, {
    headers: { "Accept-Encoding": "identity" },
  });
  assert.equal(plain.headers.get("Content-Encoding"), null);
  assert.equal(await plain.text(), body);
  assert.equal(
    (await fetch(url.replace("index-example", "missing"))).status,
    404,
  );
});
