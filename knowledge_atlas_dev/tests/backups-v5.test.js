import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { Backups } from "../server/backups.js";
import { Settings } from "../server/settings.js";
import { Store } from "../server/store.js";
import { initializeLibrary } from "../server/initialize.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-v5-"));
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-v5-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  async function library(name) {
    const directory = path.join(root, name);
    await initializeLibrary(directory);
    const store = new Store(directory);
    await store.init();
    const settings = new Settings(directory, false);
    await settings.init();
    return {
      directory,
      store,
      settings,
      backups: new Backups(directory, settings),
    };
  }
  return { root, library, source: await library("source") };
}
const note = (id, extra = {}) => ({
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
  body: "Saved content",
  ...extra,
});

test("V5 initializes an empty library with a unique persistent draft identity and first-launch setup", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.source.store.read()).nodes, []);
  const settings = await f.source.settings.read();
  assert.equal(settings.language, "en");
  assert.equal(settings.languageSelectionCompleted, false);
  await initializeLibrary(f.source.directory);
  const reopened = new Settings(f.source.directory, false);
  await reopened.init();
  assert.equal((await reopened.read()).libraryId, settings.libraryId);
  const other = await f.library("other");
  assert.notEqual((await other.settings.read()).libraryId, settings.libraryId);
});

test("complete backup round trip preserves every saved record kind, metadata, files, history, trash and empty folders", async (t) => {
  const f = await fixture(t),
    s = f.source;
  for (const type of [
    "category",
    "project",
    "knowledge",
    "skill",
    "code",
    "task",
    "item",
  ])
    await s.store.save(
      note(type, {
        type,
        ...(["project", "item", "task"].includes(type)
          ? { importance: 5 }
          : {}),
        ...(type === "task"
          ? { task: { start: "", due: "", priority: "normal", assignee: "" } }
          : {}),
        provenance: { source: "Manual author", custom: 42 },
      }),
    );
  for (const kind of ["journal", "cards", "procedure", "bom", "view"]) {
    const tool = {
      journal: {
        date: "2026-10-01",
        minutes: 42,
        next: "Continue the experiment",
      },
      cards: {
        cards: [
          {
            id: "card",
            question: "Question?",
            answer: "Answer",
            sourcePage: "1",
          },
        ],
        reviews: [],
      },
      procedure: { steps: [{ id: "step", label: "Check the result" }] },
      bom: {
        reserve: true,
        lines: [
          {
            id: "line",
            label: "Part",
            itemId: "item",
            quantity: 2,
            note: "Required",
          },
        ],
      },
      view: {
        filter: {
          rule: "all",
          query: "",
          tag: "",
          type: "all",
          status: "all",
          projectId: "",
        },
      },
    }[kind];
    await s.store.save(
      note(`tool-${kind}`, {
        projectId: "project",
        tool: { schema: 1, kind, ...tool },
      }),
    );
  }
  let edited = (await s.store.read()).nodes.find((n) => n.id === "knowledge");
  await s.store.save(
    { ...edited, body: 'const myFunction = () => "saved";' },
    edited.id,
    edited.revision,
  );
  await s.store.save(note("archived"));
  const archived = (await s.store.read()).nodes.find(
    (n) => n.id === "archived",
  );
  await s.store.archive(archived.id, archived.revision);
  const old = await s.settings.read();
  const config = await s.settings.save(
    { ...old, language: "cs", languageSelectionCompleted: true },
    (await s.store.read()).nodes,
  );
  await fs.mkdir(path.join(config.documentRoot, "empty/nested"), {
    recursive: true,
  });
  await fs.mkdir(path.join(config.documentRoot, ".history"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(config.documentRoot, "document.pdf"),
    Buffer.from("%PDF-1.7\nPortable test document"),
  );
  await fs.writeFile(
    path.join(config.documentRoot, "unlinked.bin"),
    Buffer.alloc(2048, 42),
  );
  await fs.writeFile(
    path.join(config.documentRoot, ".history/old.txt"),
    "Prior attachment",
  );
  const expectedNodes = (await s.store.read()).nodes;
  const archive = path.join(f.root, "complete.zip");
  await s.backups.export(createWriteStream(archive));
  const entries = unzipSync(await fs.readFile(archive));
  const manifest = JSON.parse(Buffer.from(entries["manifest.json"]));
  assert.equal(manifest.version, 2);
  assert.ok(manifest.directories.includes("documents/empty/nested"));
  const target = await f.library("restored"),
    plan = await target.backups.prepare(createReadStream(archive));
  assert.equal(plan.records, 12);
  assert.equal(plan.checksumVerified, true);
  assert.equal(plan.includesHistory, true);
  const restored = await target.backups.restore(plan.id, plan.revision);
  const restoredSettings = await target.settings.read();
  assert.equal(restoredSettings.language, "cs");
  assert.equal(restoredSettings.libraryId, config.libraryId);
  assert.deepEqual(restoredSettings.locations, config.locations);
  assert.deepEqual((await target.store.read()).nodes, expectedNodes);
  for (const file of manifest.files) {
    if (file.path === "library/settings.json") continue;
    const destination = file.path.startsWith("documents/")
      ? path.join(restored.documentRoot, file.path.slice(10))
      : path.join(target.directory, file.path.slice(8));
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(destination))
        .digest("hex"),
      file.sha256,
      file.path,
    );
  }
  assert.ok(
    (
      await fs.stat(path.join(restored.documentRoot, "empty/nested"))
    ).isDirectory(),
  );
  const summary = await target.backups.summary();
  assert.equal(summary.records, 12);
  assert.equal(summary.documents, 3);
  assert.ok(summary.history >= 2);
  assert.ok(summary.trash > 0);
  await target.backups.export(
    createWriteStream(path.join(f.root, "export-again.zip")),
  );
});

test("V5 accepts earlier version-one archives and detects changed empty folders after preview", async (t) => {
  const f = await fixture(t),
    archive = path.join(f.root, "legacy.zip");
  await f.source.store.save(note("legacy"));
  await f.source.backups.export(createWriteStream(archive));
  const entries = unzipSync(await fs.readFile(archive));
  const manifest = JSON.parse(Buffer.from(entries["manifest.json"]));
  manifest.version = 1;
  delete manifest.directories;
  for (const name of Object.keys(entries))
    if (name.endsWith("/")) delete entries[name];
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  await fs.writeFile(archive, zipSync(entries));
  const target = await f.library("target"),
    preview = await target.backups.prepare(createReadStream(archive));
  await fs.mkdir(path.join(target.directory, "new-empty-folder"));
  await assert.rejects(
    target.backups.restore(preview.id, preview.revision),
    /changed after preview/,
  );
  const second = await target.backups.prepare(createReadStream(archive));
  await target.backups.restore(second.id, second.revision);
  assert.equal((await target.store.read()).nodes[0].id, "legacy");
});

test("export rejects files added while the archive is being streamed", async (t) => {
  const f = await fixture(t);
  await f.source.store.save(note("existing"));
  let changed = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!changed) {
        changed = true;
        fs.writeFile(
          path.join(f.source.directory, "added.txt"),
          "External write",
        ).then(() => done(), done);
      } else done();
    },
  });
  await assert.rejects(
    f.source.backups.export(output),
    /changed during backup/,
  );
});

test("restore rejects duplicate directory names and incomplete directory manifests", async (t) => {
  const f = await fixture(t),
    archive = path.join(f.root, "invalid.zip");
  await f.source.backups.export(createWriteStream(archive));
  const entries = unzipSync(await fs.readFile(archive));
  entries["LIBRARY/"] = new Uint8Array();
  await fs.writeFile(archive, zipSync(entries));
  await assert.rejects(f.source.backups.prepare(createReadStream(archive)));
  delete entries["LIBRARY/"];
  const manifest = JSON.parse(Buffer.from(entries["manifest.json"]));
  manifest.directories = [];
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  await fs.writeFile(archive, zipSync(entries));
  await assert.rejects(
    f.source.backups.prepare(createReadStream(archive)),
    /Invalid backup manifest/,
  );
});
