import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { Backups, operationRoot, recoverRestore } from "../server/backups.js";
import { Store } from "../server/store.js";
import { Settings } from "../server/settings.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-backup-")),
    directory = path.join(root, "library");
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-backup-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = new Store(directory);
  await store.init();
  const settings = new Settings(directory, false);
  await settings.init();
  const service = new Backups(directory, settings);
  await store.save({
    schema: 1,
    id: "note",
    title: "A note",
    type: "knowledge",
    status: "draft",
    parent: null,
    summary: "",
    body: "Original",
    color: "#a7e87b",
    tags: [],
    related: [],
    resources: [
      { label: "File", locationId: "addon", path: "school/data.txt" },
    ],
  });
  const config = await settings.read();
  await fs.mkdir(path.join(config.documentRoot, "school"), { recursive: true });
  await fs.writeFile(
    path.join(config.documentRoot, "school/data.txt"),
    "Attached text\n",
  );
  await fs.writeFile(
    path.join(config.documentRoot, "unlinked.bin"),
    Buffer.alloc(1024 * 1024, 7),
  );
  return { root, directory, store, settings, service, config };
}
test("full backup restores records, unlinked attachments, settings and history to a new path without overwriting the previous library", async (t) => {
  const f = await fixture(t),
    zip = path.join(f.root, "backup.zip");
  let node = (await f.store.read()).nodes[0];
  await f.store.save(
    { ...node, body: "Second version" },
    node.id,
    node.revision,
  );
  await f.service.export(createWriteStream(zip));
  node = (await f.store.read()).nodes[0];
  await f.store.save(
    { ...node, body: "Keep in rollback" },
    node.id,
    node.revision,
  );
  const preview = await f.service.prepare(createReadStream(zip));
  assert.equal(preview.records, 1);
  assert.deepEqual(preview.collisions, ["note"]);
  const restored = await f.service.restore(preview.id, preview.revision);
  assert.equal((await f.store.read()).nodes[0].body, "Second version");
  assert.equal(
    (await new Store(restored.rollbackDirectory).read()).nodes[0].body,
    "Keep in rollback",
  );
  const config = await f.settings.read();
  assert.notEqual(config.documentRoot, f.config.documentRoot);
  assert.equal(
    await fs.readFile(
      path.join(config.documentRoot, "school/data.txt"),
      "utf8",
    ),
    "Attached text\n",
  );
  assert.equal(
    (await fs.stat(path.join(config.documentRoot, "unlinked.bin"))).size,
    1024 * 1024,
  );
  assert.equal(
    (await fs.readdir(path.join(f.directory, ".history/note"))).length,
    1,
  );
  // A restored library must itself remain portable and exportable.
  await f.service.export(createWriteStream(path.join(f.root, "again.zip")));
  const freshDir = path.join(f.root, "fresh"),
    freshStore = new Store(freshDir);
  await freshStore.init();
  const freshSettings = new Settings(freshDir, false);
  await freshSettings.init();
  const fresh = new Backups(freshDir, freshSettings),
    next = await fresh.prepare(createReadStream(zip));
  await fresh.restore(next.id, next.revision);
  assert.equal((await freshStore.read()).nodes[0].body, "Second version");
});
test("restore detects attachment changes after preview and preserves both current files and staging", async (t) => {
  const f = await fixture(t),
    zip = path.join(f.root, "backup.zip");
  await f.service.export(createWriteStream(zip));
  const plan = await f.service.prepare(createReadStream(zip));
  await fs.writeFile(
    path.join(f.config.documentRoot, "school/data.txt"),
    "External edit",
  );
  await assert.rejects(
    f.service.restore(plan.id, plan.revision),
    /changed after preview/,
  );
  assert.equal(
    await fs.readFile(
      path.join(f.config.documentRoot, "school/data.txt"),
      "utf8",
    ),
    "External edit",
  );
});
test("restore rejects traversal, duplicate paths and checksum tampering without changing the library", async (t) => {
  const f = await fixture(t),
    zip = path.join(f.root, "invalid.zip");
  const cases = [
    { "../escape": strToU8("bad") },
    { "library/NOTE.md": strToU8("a"), "library/note.md": strToU8("b") },
    {
      "library/settings.json": strToU8("{}"),
      "manifest.json": strToU8(
        JSON.stringify({
          format: "knowledge-atlas-backup",
          version: 1,
          files: [{ path: "library/settings.json", bytes: 2, sha256: "wrong" }],
        }),
      ),
    },
  ];
  for (const files of cases) {
    await fs.writeFile(zip, zipSync(files));
    await assert.rejects(f.service.prepare(createReadStream(zip)));
    assert.equal((await f.store.read()).nodes[0].body, "Original");
  }
  assert.equal(
    await fs.stat(path.join(f.root, "escape")).catch(() => null),
    null,
  );
});
test("restore startup recovers a library interrupted between directory renames", async (t) => {
  const f = await fixture(t),
    id = randomUUID(),
    root = operationRoot(f.directory),
    rollback = path.join(root, id, "previous-library");
  await fs.mkdir(path.dirname(rollback), { recursive: true });
  await fs.writeFile(
    path.join(root, "restore-journal.json"),
    JSON.stringify({ id }),
  );
  await fs.rename(f.directory, rollback);
  await recoverRestore(f.directory);
  assert.equal((await f.store.read()).nodes[0].body, "Original");
  await recoverRestore(f.directory);
});
test("a failed final directory replacement rolls back the original library", async (t) => {
  const f = await fixture(t),
    zip = path.join(f.root, "backup.zip");
  await f.service.export(createWriteStream(zip));
  const plan = await f.service.prepare(createReadStream(zip));
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (source, target) => {
    if (
      source ===
      path.join(operationRoot(f.directory), plan.id, "extracted", "library")
    )
      throw Object.assign(new Error("Simulated unavailable destination"), {
        code: "EACCES",
      });
    return rename(source, target);
  });
  await assert.rejects(f.service.restore(plan.id, plan.revision), /Simulated/);
  assert.equal((await f.store.read()).nodes[0].body, "Original");
  assert.equal(
    await fs.readFile(
      path.join(f.config.documentRoot, "school/data.txt"),
      "utf8",
    ),
    "Attached text\n",
  );
});
