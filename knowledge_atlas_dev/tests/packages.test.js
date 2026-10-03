import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createApp } from "../server/index.js";
import { Backups } from "../server/backups.js";
import { PackageImports, recoverPackage } from "../server/packages.js";
import { BackupTransfers } from "../server/backup-transfers.js";
import { BackupTransfer } from "../src/backup-transfer.js";
import { createPackage } from "../scripts/create-package.js";
import { serialize } from "../server/store.js";
import { MapPositions } from "../server/map-positions.js";
import { setLanguage, localizeMessage, translate } from "../shared/i18n.js";

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
  body: "Package notes",
  ...extra,
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-package-"));
  t.after(async () => {
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-package-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "library");
  const app = await createApp({ directory });
  const config = await app.settings.read();
  await app.settings.save(
    { ...config, language: "cs", languageSelectionCompleted: true },
    [],
  );
  await app.store.save(
    note("existing", { type: "category", body: "Keep existing content" }),
  );
  await fs.mkdir(config.documentRoot, { recursive: true });
  await fs.writeFile(
    path.join(config.documentRoot, "keep.bin"),
    Buffer.from([0, 255, 10]),
  );
  const backups = new Backups(directory, app.settings);
  const transfers = new BackupTransfers(backups, (fn) => fn());
  await transfers.init();
  const manager = new PackageImports(backups, (fn) => fn(), transfers);
  const input = path.join(root, "input");
  await fs.mkdir(path.join(input, "library"), { recursive: true });
  await fs.mkdir(path.join(input, "documents/school"), { recursive: true });
  const document = Buffer.from("%PDF-1.4\nGeneric notebook fixture\n");
  await fs.writeFile(path.join(input, "documents/school/notes.pdf"), document);
  const school = note("school", { type: "category" });
  const physics = note("physics", {
    parent: "school",
    related: ["existing"],
    resources: [
      {
        id: "notes",
        label: "Notebook",
        locationId: "addon",
        path: "school/notes.pdf",
      },
    ],
    previewResourceId: "notes",
  });
  await fs.writeFile(path.join(input, "library/school.md"), serialize(school));
  await fs.writeFile(
    path.join(input, "library/physics.md"),
    serialize(physics),
  );
  let sequence = 0;
  const prepare = async () => {
    const zip = path.join(root, `package-${sequence++}.zip`);
    await createPackage(input, zip, "School notebooks");
    const preview = await backups.prepare(createReadStream(zip), {
      purpose: "merge",
    });
    return { zip, preview };
  };
  const apply = async (preview, choices = {}) => {
    await manager.start(preview.id, { revision: preview.revision, ...choices });
    await manager.jobs.get(preview.id)?.promise;
    return manager.status(preview.id);
  };
  return {
    ...app,
    root,
    directory,
    config,
    backups,
    transfers,
    manager,
    input,
    school,
    physics,
    document,
    prepare,
    apply,
  };
}

test("a partial package adds nested records and documents while retaining the library, settings and original file bytes", async (t) => {
  const f = await fixture(t);
  const positions = new MapPositions(f.directory),
    initial = await positions.read();
  const arrangement = await positions.save(
    "nebula:3",
    [{ id: "existing", x: 800, y: -200, z: 150 }],
    initial.revision,
  );
  const beforeSettings = await fs.readFile(f.settings.file),
    beforeRecord = await fs.readFile(path.join(f.directory, "existing.md"));
  const { preview, zip } = await f.prepare();
  assert.equal(preview.kind, "merge");
  assert.equal(preview.records.length, 2);
  assert.equal(preview.documents, 1);
  assert.equal(preview.issue, null);
  await assert.rejects(
    f.backups.restore(preview.id, preview.revision),
    /package import/,
  );
  const result = await f.apply(preview, { parent: "existing" });
  assert.equal(result.phase, "complete");
  assert.deepEqual(
    await new MapPositions(f.directory).read(),
    arrangement,
    "package merge preserves custom geometry",
  );
  assert.equal(result.added, 2);
  const snapshot = await f.store.read();
  assert.deepEqual(snapshot.errors, []);
  assert.equal(
    snapshot.nodes.find((n) => n.id === "school").parent,
    "existing",
  );
  const physics = snapshot.nodes.find((n) => n.id === "physics");
  assert.equal(physics.parent, "school");
  assert.equal(physics.previewResourceId, "notes");
  assert.match(
    physics.resources[0].path,
    /^imports\/[a-f0-9]{64}\/school\/notes.pdf$/,
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(f.config.documentRoot, physics.resources[0].path),
    ),
    f.document,
  );
  assert.deepEqual(await fs.readFile(f.settings.file), beforeSettings);
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "existing.md")),
    beforeRecord,
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.config.documentRoot, "keep.bin")),
    Buffer.from([0, 255, 10]),
  );
  assert.ok(snapshot.nodes.some((n) => n.body.includes("Package notes")));
  await f.store.move("physics", 1, snapshot.orderRevision, true);
  const repeated = await f.backups.prepare(createReadStream(zip), {
    purpose: "merge",
  });
  assert.equal(repeated.reused, 1);
  const second = await f.apply(repeated, { parent: "existing" });
  assert.equal(second.phase, "complete");
  assert.equal(second.added, 0);
  assert.equal(second.documents, 0);
  assert.equal(
    second.replaced,
    0,
    "list positions are not package content conflicts",
  );
  assert.equal((await f.store.read()).nodes[0].id, "physics");
  assert.equal((await f.store.read()).nodes[0].positionFixed, true);
  assert.equal((await f.store.read()).nodes.length, 3);
  const full = path.join(f.root, "full.zip"),
    output = createWriteStream(full);
  await f.backups.export(output);
  const roundtrip = await f.backups.prepare(createReadStream(full));
  assert.equal(roundtrip.records, 3);
  assert.equal(roundtrip.checksumVerified, true);
});

test("conflicts default to keeping the current record; choosing incoming saves its previous version", async (t) => {
  const f = await fixture(t);
  await f.store.save(
    note("physics", { title: "Current physics", body: "Keep this note" }),
  );
  const initial = await fs.readFile(path.join(f.directory, "physics.md"));
  let { preview } = await f.prepare();
  assert.equal(
    preview.records.find((r) => r.id === "physics").status,
    "conflict",
  );
  assert.equal((await f.apply(preview)).phase, "complete");
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "physics.md")),
    initial,
  );
  ({ preview } = await f.prepare());
  const result = await f.apply(preview, { decisions: { physics: "replace" } });
  assert.equal(result.replaced, 1);
  assert.equal(
    (await f.store.read()).nodes.find((n) => n.id === "physics").body.trim(),
    "Package notes",
  );
  const history = path.join(f.directory, ".history/physics");
  const previous = await fs.readdir(history);
  assert.equal(previous.length, 1);
  assert.deepEqual(await fs.readFile(path.join(history, previous[0])), initial);
  ({ preview } = await f.prepare());
  const repeated = await f.apply(preview, {
    parent: "existing",
    decisions: { school: "replace" },
  });
  assert.equal(repeated.phase, "complete");
  assert.equal(repeated.replaced, 0);
  assert.equal(
    (await f.store.read()).nodes.find((n) => n.id === "school").parent,
    null,
  );
});

test("stale previews and changed staged documents cannot modify the active library", async (t) => {
  const f = await fixture(t);
  const { preview } = await f.prepare();
  await f.store.save(note("extra"));
  let result = await f.apply(preview);
  assert.equal(result.phase, "error");
  assert.match(result.error, /changed after the package preview/);
  await assert.rejects(fs.stat(path.join(f.directory, "school.md")), {
    code: "ENOENT",
  });
  const fresh = (await f.prepare()).preview;
  await fs.writeFile(
    path.join(f.backups.root, fresh.id, "extracted/documents/school/notes.pdf"),
    "changed",
  );
  result = await f.apply(fresh);
  assert.equal(result.phase, "error");
  assert.match(result.error, /Staged package/);
  assert.deepEqual(await fs.readdir(f.config.documentRoot), ["keep.bin"]);
});

test("dependency validation rejects broken graphs, missing attachments and unknown locations before applying", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.input, "library/school.md"),
    serialize({ ...f.school, parent: "physics" }),
  );
  const { preview } = await f.prepare();
  assert.match(preview.issue, /descendants/);
  const result = await f.apply(preview);
  assert.equal(result.phase, "error");
  assert.equal((await f.store.read()).nodes.length, 1);
  await fs.writeFile(
    path.join(f.input, "library/physics.md"),
    serialize({
      ...f.physics,
      resources: [{ ...f.physics.resources[0], path: "missing.pdf" }],
    }),
  );
  await assert.rejects(f.prepare(), /must be included/);
  await fs.writeFile(
    path.join(f.input, "library/physics.md"),
    serialize({
      ...f.physics,
      resources: [{ ...f.physics.resources[0], locationId: "unknown" }],
    }),
  );
  await assert.rejects(f.prepare(), /referenced location/);
});

test("a failure midway through package commit rolls back changed records and removes only imported documents", async (t) => {
  const f = await fixture(t);
  await f.store.save(note("physics", { body: "Original" }));
  const before = await fs.readFile(path.join(f.directory, "physics.md"));
  const { preview } = await f.prepare();
  const original = fs.link;
  const injected = t.mock.method(fs, "link", async (from, to) => {
    if (to === path.join(f.directory, "school.md"))
      throw new Error("Injected storage failure");
    return original(from, to);
  });
  const result = await f.apply(preview, { decisions: { physics: "replace" } });
  injected.mock.restore();
  assert.equal(result.phase, "error");
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "physics.md")),
    before,
  );
  await assert.rejects(fs.stat(path.join(f.directory, "school.md")), {
    code: "ENOENT",
  });
  await assert.rejects(
    fs.stat(
      path.join(
        f.config.documentRoot,
        `imports/${preview.packageHash}/school/notes.pdf`,
      ),
    ),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    await fs.readFile(path.join(f.config.documentRoot, "keep.bin")),
    Buffer.from([0, 255, 10]),
  );
  await assert.rejects(
    fs.stat(path.join(f.backups.root, "package-journal.json")),
    { code: "ENOENT" },
  );
});

test("startup rolls back a package interrupted by actual process exit after replacing a record", async (t) => {
  const f = await fixture(t);
  await f.store.save(note("physics", { body: "Original" }));
  const before = await fs.readFile(path.join(f.directory, "physics.md"));
  const { preview } = await f.prepare();
  const code = `
    import fs from 'node:fs/promises';
    import { Backups } from ${JSON.stringify(new URL("../server/backups.js", import.meta.url).href)};
    import { PackageImports } from ${JSON.stringify(new URL("../server/packages.js", import.meta.url).href)};
    import { Settings } from ${JSON.stringify(new URL("../server/settings.js", import.meta.url).href)};
    const directory = process.argv[1], id = process.argv[2], revision = process.argv[3];
    const original = fs.rename;
    fs.rename = async (from, to) => { await original(from, to); if (to.endsWith('physics.md')) process.exit(73); };
    const service = new PackageImports(new Backups(directory, new Settings(directory, false)), fn => fn(), { sessions: new Map() });
    await service.start(id, { revision, decisions: { physics: 'replace' } });
    await service.wait();
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      code,
      f.directory,
      preview.id,
      preview.revision,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  const exit = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.equal(exit, 73);
  assert.notDeepEqual(
    await fs.readFile(path.join(f.directory, "physics.md")),
    before,
  );
  await createApp({ directory: f.directory });
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, "physics.md")),
    before,
  );
  assert.deepEqual((await f.store.read()).errors, []);
  assert.equal((await f.manager.status(preview.id)).phase, "error");
  await assert.rejects(
    fs.stat(
      path.join(
        f.config.documentRoot,
        `imports/${preview.packageHash}/school/notes.pdf`,
      ),
    ),
    { code: "ENOENT" },
  );
});

test("merge upload purpose survives restart and the client never sends a full restore request", async (t) => {
  const f = await fixture(t);
  const { zip } = await f.prepare();
  const bytes = await fs.readFile(zip);
  const upload = await f.transfers.create({
    direction: "upload",
    purpose: "merge",
    size: bytes.length,
  });
  await f.transfers.upload(upload.id, 0, createReadStream(zip));
  const restarted = new BackupTransfers(f.backups, (fn) => fn());
  await restarted.init();
  assert.equal(restarted.get(upload.id).purpose, "merge");
  restarted.complete(upload.id);
  await restarted.get(upload.id).job;
  const preview = restarted.get(upload.id).preview;
  assert.equal(preview.kind, "merge");
  const service = new PackageImports(f.backups, (fn) => fn(), restarted);
  await service.start(preview.id, { revision: preview.revision });
  await service.wait();
  assert.equal((await service.status(preview.id)).phase, "complete");
  assert.equal(restarted.sessions.size, 0);
  const requests = [];
  const client = new BackupTransfer({
    request: async (url) => {
      requests.push(url);
      return {
        phase: "complete",
        added: 2,
        replaced: 0,
        kept: 0,
        documents: 1,
      };
    },
  });
  await client.merge(preview, { decisions: {} });
  assert.equal(client.state.mergeResult.added, 2);
  assert.ok(requests.every((url) => !url.endsWith("/restore")));
});

test("package HTTP import checks the protection header and retries a completed operation idempotently", async (t) => {
  const f = await fixture(t);
  const { preview } = await f.prepare();
  const { app } = await createApp({ directory: f.directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/packages/${preview.id}`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: preview.revision }),
    };
    assert.equal((await fetch(`${base}/import`, options)).status, 403);
    options.headers["X-Knowledge-Client"] = "atlas";
    assert.equal((await fetch(`${base}/import`, options)).status, 202);
    let status;
    for (let i = 0; i < 200; i++) {
      status = await (await fetch(`${base}/status`)).json();
      if (status.phase !== "applying") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(status.phase, "complete");
    assert.equal(
      (await (await fetch(`${base}/import`, options)).json()).phase,
      "complete",
    );
    assert.equal((await f.store.read()).nodes.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("duplicate concurrent import requests reserve one operation and preserve matching record IDs", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.input, "library/constructor.md"),
    serialize(note("constructor", { parent: "school" })),
  );
  const { preview } = await f.prepare();
  await Promise.all([
    f.manager.start(preview.id, { revision: preview.revision }),
    f.manager.start(preview.id, { revision: preview.revision }),
  ]);
  await f.manager.wait();
  const status = await f.manager.status(preview.id);
  assert.equal(status.phase, "complete");
  assert.equal(status.added, 3);
  assert.deepEqual((await f.store.read()).errors, []);
  assert.equal((await f.store.read()).nodes.length, 4);
});

test("a document-root link cannot redirect package writes outside managed storage", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep.txt"), "Unrelated fixture");
  await fs.symlink(
    outside,
    path.join(f.config.documentRoot, "imports"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(f.prepare(), /symlink|Links outside/);
  assert.deepEqual(await fs.readdir(outside), ["keep.txt"]);
});

test("rollback preserves external edits, retains its journal and blocks already queued writes", async (t) => {
  const f = await fixture(t);
  await f.store.save(note("physics", { body: "Original" }));
  const { preview } = await f.prepare();
  const original = fs.link;
  const external = serialize(
    note("physics", { body: "External edit during import" }),
  );
  const blocked = Promise.withResolvers(),
    release = Promise.withResolvers(),
    received = Promise.withResolvers();
  const injected = t.mock.method(fs, "link", async (from, to) => {
    if (to === path.join(f.directory, "school.md")) {
      blocked.resolve();
      await release.promise;
      await fs.writeFile(path.join(f.directory, "physics.md"), external);
      throw new Error("Injected failure after an external edit");
    }
    return original(from, to);
  });
  const server = f.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  server.on("request", (req) => {
    if (req.url === "/api/nodes" && req.method === "POST")
      req.on("end", () => received.resolve());
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (url, body) =>
    fetch(`${base}/${url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post(`packages/${preview.id}/import`, {
          revision: preview.revision,
          decisions: { physics: "replace" },
        })
      ).status,
      202,
    );
    await blocked.promise;
    let settled = false;
    const queued = post("nodes", note("queued")).then((response) => {
      settled = true;
      return response;
    });
    await received.promise;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(settled, false);
    release.resolve();
    assert.equal((await queued).status, 503);
    assert.equal((await fetch(`${base}/nodes`)).status, 503);
    const status = await (
      await fetch(`${base}/packages/${preview.id}/status`)
    ).json();
    assert.equal(status.phase, "error");
    assert.equal(
      await fs.readFile(path.join(f.directory, "physics.md"), "utf8"),
      external,
    );
    await assert.rejects(fs.stat(path.join(f.directory, "queued.md")), {
      code: "ENOENT",
    });
    assert.ok(await fs.stat(path.join(f.backups.root, "package-journal.json")));
    await assert.rejects(recoverPackage(f.directory), /externally changed/);
  } finally {
    release.resolve();
    injected.mock.restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("package controls and server errors translate in both languages without changing record identifiers", () => {
  for (const key of [
    "package.upload",
    "package.preview",
    "package.confirm",
    "package.apply",
    "package.stale",
    "package.failed",
    "package.stagedChanged",
    "package.locationMissing",
    "package.alreadyUploaded",
  ]) {
    assert.notEqual(translate("en", key, "physics"), key);
    assert.notEqual(
      translate("en", key, "physics"),
      translate("cs", key, "physics"),
    );
    setLanguage("cs");
    assert.equal(
      localizeMessage(translate("en", key, "physics")),
      translate("cs", key, "physics"),
    );
  }
  setLanguage("en");
});
