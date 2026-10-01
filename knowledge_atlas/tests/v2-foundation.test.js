import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import {
  Store,
  serialize,
  parseMarkdown,
  upgradeNode,
} from "../server/store.js";
import { Backups } from "../server/backups.js";
import { Maintenance } from "../server/maintenance.js";
import { compareChanges } from "../shared/merge.js";

const record = (id) => ({
  schema: 1,
  id,
  title: id,
  type: "knowledge",
  status: "draft",
  parent: null,
  summary: "",
  color: "#a7e87b",
  body: "Original",
  tags: [],
  related: [],
  resources: [],
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-v2-")),
    directory = path.join(root, "library");
  const { app, store, settings } = await createApp({
    directory,
    allowOpen: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-v2-")),
    );
    await fs.rm(root, { recursive: true, force: true });
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
  return { root, directory, store, settings, request };
}
test("schema migration previews, backs up, preserves unknown metadata and is idempotent", async (t) => {
  const f = await fixture(t),
    source = {
      ...record("legacy"),
      custom: { source: "School", arbitrary: [1, 2, 3] },
      resources: [
        {
          label: "Reference",
          locationId: "internet",
          url: "https://example.com",
        },
      ],
    };
  await fs.writeFile(path.join(f.directory, "legacy.md"), serialize(source));
  const preview = await (await f.request("migrations")).json();
  assert.equal(preview.files.length, 1);
  const result = await (
    await f.request("migrations", "POST", { revision: preview.revision })
  ).json();
  assert.equal(result.changed, 1);
  const migrated = (await f.store.read()).nodes[0];
  assert.equal(migrated.schema, 2);
  assert.ok(migrated.resources[0].id);
  assert.deepEqual(migrated.custom, source.custom);
  assert.equal(
    parseMarkdown(
      await fs.readFile(
        path.join(result.rollbackDirectory, "legacy.md"),
        "utf8",
      ),
    ).schema,
    1,
  );
  assert.ok((await fs.stat(result.backup)).size > 0);
  const second = await (await f.request("migrations")).json();
  assert.equal(second.files.length, 0);
  assert.equal(
    (
      await (
        await f.request("migrations", "POST", { revision: second.revision })
      ).json()
    ).changed,
    0,
  );
  assert.deepEqual(upgradeNode(upgradeNode(source)), upgradeNode(source));
});
test("stable attachment routes survive reorder and stale saves cannot write to an equal-content replacement", async (t) => {
  const f = await fixture(t),
    config = await f.settings.read();
  await fs.mkdir(config.documentRoot, { recursive: true });
  for (const name of ["a.txt", "b.txt"])
    await fs.writeFile(path.join(config.documentRoot, name), "Identical");
  let node = await f.store.save({
    ...record("note"),
    resources: [
      { id: "file-a", label: "A", locationId: "addon", path: "a.txt" },
      { id: "file-b", label: "B", locationId: "addon", path: "b.txt" },
    ],
  });
  const doc = await (await f.request("nodes/note/resources/file-a")).json();
  node = await f.store.save(
    { ...node, resources: [...node.resources].reverse() },
    node.id,
    node.revision,
  );
  const success = await f.request("nodes/note/resources/file-a/text", "PUT", {
    body: "Edited A",
    revision: doc.revision,
    targetRevision: doc.targetRevision,
  });
  assert.equal(success.status, 200);
  assert.equal(
    await fs.readFile(path.join(config.documentRoot, "b.txt"), "utf8"),
    "Identical",
  );
  const b = await (await f.request("nodes/note/resources/file-b")).json();
  await fs.writeFile(path.join(config.documentRoot, "c.txt"), "Identical");
  node = await f.store.save(
    {
      ...node,
      resources: node.resources.map((r) =>
        r.id === "file-b" ? { ...r, path: "c.txt" } : r,
      ),
    },
    node.id,
    node.revision,
  );
  assert.equal(
    (
      await f.request("nodes/note/resources/file-b/text", "PUT", {
        body: "Must not leak",
        revision: b.revision,
        targetRevision: b.targetRevision,
      })
    ).status,
    409,
  );
  assert.equal(
    await fs.readFile(path.join(config.documentRoot, "c.txt"), "utf8"),
    "Identical",
  );
  node = await f.store.save(
    { ...node, resources: node.resources.filter((r) => r.id !== "file-b") },
    node.id,
    node.revision,
  );
  assert.equal((await f.request("nodes/note/resources/file-b")).status, 404);
});
test("a settings path change invalidates an open document even when file content is identical", async (t) => {
  const f = await fixture(t),
    config = await f.settings.read();
  const other = path.join(f.root, "other");
  for (const folder of [config.documentRoot, other]) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "file.txt"), "Same");
  }
  await f.store.save({
    ...record("note"),
    resources: [
      { id: "file", label: "File", locationId: "addon", path: "file.txt" },
    ],
  });
  const doc = await (await f.request("nodes/note/resources/file")).json();
  await f.settings.save(
    { ...config, documentRoot: other },
    (await f.store.read()).nodes,
  );
  assert.equal(
    (
      await f.request("nodes/note/resources/file/text", "PUT", {
        ...doc,
        body: "Wrong",
      })
    ).status,
    409,
  );
  assert.equal(await fs.readFile(path.join(other, "file.txt"), "utf8"), "Same");
});
test("invalid settings keep the record snapshot readable and repairs preserve the broken original", async (t) => {
  const f = await fixture(t);
  await f.store.save(record("note"));
  const config = await fs.readFile(f.settings.file, "utf8");
  await fs.writeFile(f.settings.file, "{ broken");
  const snapshot = await (await f.request("nodes")).json();
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(snapshot.settings.invalid, true);
  assert.ok(snapshot.errors.some((e) => e.file === "settings.json"));
  const raw = await (await f.request("repair/settings.json")).json();
  assert.equal(
    (await f.request("repair/settings.json", "PUT", { ...raw, body: config }))
      .status,
    200,
  );
  const history = path.join(f.directory, ".history/repairs");
  assert.equal(
    await fs.readFile(
      path.join(history, (await fs.readdir(history))[0]),
      "utf8",
    ),
    "{ broken",
  );
  assert.equal(
    (await (await f.request("nodes")).json()).settings.invalid,
    undefined,
  );
});
test("file repairs reject invalid graphs and stale writes without damaging healthy files", async (t) => {
  const f = await fixture(t);
  await f.store.save(record("healthy"));
  await fs.writeFile(path.join(f.directory, "broken.md"), "invalid header");
  const before = await (await f.request("repair/broken.md")).json();
  assert.equal(
    (
      await f.request("repair/broken.md", "PUT", {
        ...before,
        body: serialize({ ...record("broken"), parent: "missing" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("repair/broken.md", "PUT", {
        ...before,
        body: serialize(record("broken")),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request("repair/broken.md", "PUT", {
        ...before,
        body: serialize(record("broken")),
      })
    ).status,
    409,
  );
  assert.equal((await f.store.read()).nodes.length, 2);
});
test("three-way field comparison preserves independent metadata and requires a choice for overlapping text", () => {
  const base = {
    title: "Title",
    body: "Old",
    custom: { preserved: true },
    revision: "old",
  };
  const mine = { ...base, title: "My title", body: "My text" };
  const current = {
    ...base,
    body: "Their text",
    tags: ["external"],
    revision: "new",
  };
  const result = compareChanges(base, mine, current);
  assert.equal(result.merged.title, "My title");
  assert.equal(result.merged.revision, "new");
  assert.deepEqual(result.merged.tags, ["external"]);
  assert.deepEqual(result.merged.custom, { preserved: true });
  assert.deepEqual(result.conflicts, [
    { key: "body", base: "Old", mine: "My text", current: "Their text" },
  ]);
});
test("a full disk while writing a draft file cannot replace the saved record", async (t) => {
  const f = await fixture(t),
    node = await f.store.save(record("note"));
  const original = await fs.readFile(path.join(f.directory, "note.md"));
  const write = fs.writeFile.bind(fs);
  t.mock.method(fs, "writeFile", async (file, ...args) => {
    if (String(file).endsWith(".tmp"))
      throw Object.assign(new Error("Simulated full disk"), { code: "ENOSPC" });
    return write(file, ...args);
  });
  await assert.rejects(
    f.store.save({ ...node, body: "Unsaved" }, node.id, node.revision),
    (e) => e.code === "ENOSPC",
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "note.md")),
    original,
  );
});
test("HTTP backup download, streamed preview and confirmed restore work end to end", async (t) => {
  const f = await fixture(t);
  const note = await f.store.save(record("note"));
  const download = await f.request("export");
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /application\/zip/);
  const archive = await download.arrayBuffer();
  await f.store.save({ ...note, body: "Later change" }, note.id, note.revision);
  const preview = await fetch(
    download.url.replace(/export$/, "backups/preview"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Knowledge-Client": "atlas",
      },
      body: archive,
    },
  );
  assert.equal(preview.status, 201);
  const plan = await preview.json();
  assert.equal(plan.records, 1);
  const restore = await f.request(`backups/${plan.id}/restore`, "POST", {
    revision: plan.revision,
  });
  assert.equal(restore.status, 200);
  assert.equal((await f.store.read()).nodes[0].body, "Original");
  assert.equal(
    (await new Store((await restore.json()).rollbackDirectory).read()).nodes[0]
      .body,
    "Later change",
  );
});
test("history writes reject linked ancestors instead of writing outside the library", async (t) => {
  const f = await fixture(t),
    node = await f.store.save(record("note")),
    outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.symlink(
    outside,
    path.join(f.directory, ".history"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    f.store.save({ ...node, body: "Unsaved" }, node.id, node.revision),
    (e) => e.status === 403,
  );
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal((await f.store.read()).nodes[0].body, "Original");
});
