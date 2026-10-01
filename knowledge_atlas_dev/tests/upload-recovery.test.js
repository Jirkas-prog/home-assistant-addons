import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import { createApp } from "../server/index.js";
import { Backups } from "../server/backups.js";
import { BackupTransfers, TRANSFER_CHUNK } from "../server/backup-transfers.js";
import { recoverUpload, saveUpload } from "../server/upload-journal.js";
import { BackupTransfer } from "../src/backup-transfer.js";
import { fileIdentity, verifyUploadFile } from "../src/upload-identity.js";
import { translate, setLanguage, localizeMessage } from "../shared/i18n.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const input = (bytes) => Readable.from([bytes]);
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "atlas-upload-recovery-"),
  );
  t.after(async () => {
    assert.ok(
      path
        .resolve(root)
        .startsWith(path.join(os.tmpdir(), "atlas-upload-recovery-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, "library");
  const { settings, store } = await createApp({ directory });
  const config = await settings.read();
  await settings.save(
    { ...config, language: "cs", languageSelectionCompleted: true },
    [],
  );
  await store.save({
    schema: 2,
    id: "sample",
    title: "Sample project",
    type: "project",
    parent: null,
    body: "Saved notes",
    status: "active",
    color: "#a7e87b",
    summary: "",
    tags: [],
    related: [],
    resources: [],
  });
  const backups = new Backups(directory, settings);
  const restart = async () => {
    const service = new BackupTransfers(backups, (fn) => fn());
    await service.init();
    return service;
  };
  return {
    root,
    directory,
    settings,
    store,
    backups,
    restart,
    service: await restart(),
  };
}

test("restart retains confirmed upload bytes indefinitely and truncates only an unacknowledged tail", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.settings.file);
  const file = new File(["abcdefgh"], "sample.zip", { lastModified: 123 });
  const { id } = await f.service.create({
    direction: "upload",
    size: file.size,
    source: await fileIdentity(file),
  });
  await f.service.upload(id, 0, input("abcd"));
  const session = f.service.get(id);
  session.touched = 0;
  await saveUpload(session);
  await fs.appendFile(session.file, "unacknowledged");
  await fs.writeFile(path.join(session.folder, "chunk.tmp"), "partial");
  const restarted = await f.restart();
  const recovered = restarted.get(id);
  assert.equal(recovered.offset, 4);
  assert.equal(recovered.source.name, "sample.zip");
  assert.deepEqual(recovered.chunks, [{ bytes: 4, sha256: hash("abcd") }]);
  assert.equal(await fs.readFile(recovered.file, "utf8"), "abcd");
  await assert.rejects(fs.stat(path.join(recovered.folder, "chunk.tmp")), {
    code: "ENOENT",
  });
  await restarted.upload(id, 4, input("efgh"));
  assert.equal(await fs.readFile(recovered.file, "utf8"), "abcdefgh");
  assert.deepEqual(await fs.readFile(f.settings.file), before);
  assert.equal((await f.store.read()).nodes[0].body.trim(), "Saved notes");
  await restarted.remove(id);
  assert.equal((await f.restart()).sessions.size, 0);
});

test("upload status never exposes a partially received chunk", async (t) => {
  const f = await fixture(t);
  const { id } = await f.service.create({ direction: "upload", size: 8 });
  const stream = new PassThrough();
  const writing = f.service.upload(id, 0, stream);
  stream.write("abcd");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.service.describe(f.service.get(id)).offset, 0);
  assert.deepEqual(f.service.get(id).chunks, []);
  stream.end("efgh");
  assert.equal((await writing).offset, 8);
  const journal = JSON.parse(
    await fs.readFile(path.join(f.service.get(id).folder, "session.json")),
  );
  assert.equal(journal.offset, 8);
  assert.equal(journal.chunks[0].sha256, hash("abcdefgh"));
});

test("a restarted HTTP app lists saved uploads and their bounded chunk proofs", async (t) => {
  const f = await fixture(t);
  const { id } = await f.service.create({ direction: "upload", size: 8 });
  await f.service.upload(id, 0, input("abcd"));
  const { app } = await createApp({ directory: f.directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/backup-transfers`;
    const list = await fetch(base);
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.equal((await list.json()).uploads[0].offset, 4);
    const proof = await (await fetch(`${base}/${id}/proof`)).json();
    assert.equal(proof.chunks[0].sha256, hash("abcd"));
    const blocked = await fetch(`${base}/${id}`, { method: "DELETE" });
    assert.equal(blocked.status, 403);
    const removed = await fetch(`${base}/${id}`, {
      method: "DELETE",
      headers: { "X-Knowledge-Client": "atlas" },
    });
    assert.equal(removed.status, 200);
    assert.deepEqual((await (await fetch(base)).json()).uploads, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a failed journal commit cannot acknowledge or retain uncommitted archive bytes", async (t) => {
  const f = await fixture(t);
  const { id } = await f.service.create({ direction: "upload", size: 8 });
  await f.service.upload(id, 0, input("abcd"));
  const rename = fs.rename;
  const mocked = t.mock.method(fs, "rename", async (from, to) => {
    if (path.basename(to) === "session.json") {
      throw Object.assign(new Error("Disk failure fixture"), {
        code: "ENOSPC",
      });
    }
    return rename(from, to);
  });
  await assert.rejects(f.service.upload(id, 4, input("efgh")), /Disk failure/);
  assert.equal(f.service.get(id).offset, 4);
  assert.equal(await fs.readFile(f.service.get(id).file, "utf8"), "abcd");
  mocked.mock.restore();
  const restarted = await f.restart();
  assert.equal(restarted.get(id).offset, 4);
  await restarted.upload(id, 4, input("efgh"));
  assert.equal(await fs.readFile(restarted.get(id).file, "utf8"), "abcdefgh");
});

test("verification survives restart, refreshes an old preview and preserves a restored rollback", async (t) => {
  const f = await fixture(t);
  const exported = await f.service.create({ direction: "download" });
  await f.service.get(exported.id).job;
  const archive = await fs.readFile(f.service.get(exported.id).file);
  const { id } = await f.service.create({
    direction: "upload",
    size: archive.length,
  });
  await f.service.upload(id, 0, input(archive));
  const session = f.service.get(id);
  session.state = "verifying";
  session.verificationId = randomUUID();
  const partial = path.join(f.backups.root, session.verificationId);
  await fs.mkdir(partial);
  await fs.writeFile(path.join(partial, "plan.tmp"), "incomplete");
  await saveUpload(session);
  const restarted = await f.restart();
  await assert.rejects(fs.stat(partial), { code: "ENOENT" });
  assert.equal(restarted.get(id).offset, archive.length);
  restarted.complete(id);
  await restarted.get(id).job;
  const first = restarted.get(id).preview;
  assert.equal(first.checksumVerified, true);
  const returned = await f.restart();
  assert.equal(returned.get(id).state, "ready");
  assert.equal(returned.get(id).preview.id, first.id);
  const planPath = path.join(f.backups.root, first.id, "plan.json");
  await fs.writeFile(
    planPath,
    JSON.stringify({ ...first, created: "2000-01-01T00:00:00.000Z" }),
  );
  returned.complete(id);
  await returned.get(id).job;
  const preview = returned.get(id).preview;
  assert.notEqual(preview.id, first.id);
  assert.equal(returned.get(id).state, "ready");
  const result = await f.backups.restore(preview.id, preview.revision);
  const afterRestore = await f.restart();
  assert.equal(afterRestore.sessions.has(id), false);
  assert.ok((await fs.stat(result.rollbackDirectory)).isDirectory());
  assert.equal((await f.settings.read()).language, "cs");
  assert.equal((await f.store.read()).nodes[0].title, "Sample project");
});

test("restart completes cancellation and rejects malformed journals without removing unrelated files", async (t) => {
  const f = await fixture(t);
  const { id } = await f.service.create({ direction: "upload", size: 8 });
  const session = f.service.get(id);
  session.state = "cancelling";
  await saveUpload(session);
  assert.equal((await f.restart()).sessions.size, 0);
  await assert.rejects(fs.stat(session.folder), { code: "ENOENT" });
  const other = await f.service.create({ direction: "upload", size: 8 });
  const folder = f.service.get(other.id).folder;
  const journal = path.join(folder, "session.json");
  const saved = JSON.parse(await fs.readFile(journal));
  await fs.writeFile(
    journal,
    JSON.stringify({ ...saved, verificationId: "../library" }),
  );
  await assert.rejects(
    recoverUpload(folder, f.backups, TRANSFER_CHUNK),
    /Invalid upload recovery journal/,
  );
  assert.ok(await fs.stat(folder));
  assert.ok(await fs.stat(f.settings.file));
  await fs.writeFile(journal, JSON.stringify({ ...saved, offset: 2 }));
  await assert.rejects(
    recoverUpload(folder, f.backups, TRANSFER_CHUNK),
    /Invalid upload recovery journal/,
  );
});

test("local verification detects wrong files even outside the identity samples without uploading the prefix", async () => {
  const bytes = Buffer.alloc(1024 ** 2, 42);
  const file = new File([bytes], "sample.zip");
  const proof = {
    total: file.size,
    offset: 512 * 1024,
    source: await fileIdentity(file),
    chunks: [
      { bytes: 512 * 1024, sha256: hash(bytes.subarray(0, 512 * 1024)) },
    ],
  };
  const progress = [];
  await verifyUploadFile(file, proof, (checked) => progress.push(checked));
  assert.deepEqual(progress, [proof.offset]);
  const wrong = Buffer.from(bytes);
  wrong[200000] = 1;
  const changed = new File([wrong], "sample.zip");
  assert.equal(
    (await fileIdentity(changed)).fingerprint,
    proof.source.fingerprint,
  );
  await assert.rejects(
    verifyUploadFile(changed, proof),
    /differs from the uploaded parts/,
  );
  await assert.rejects(
    verifyUploadFile(new File(["wrong"], "sample.zip"), proof),
    /same ZIP/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    verifyUploadFile(file, proof, () => {}, cancelled.signal),
    { name: "AbortError" },
  );
});

test("a fresh client resumes from saved bytes, retains the preview, and rejects a wrong ZIP without deleting data", async () => {
  const file = new File(["abcdefghijkl"], "sample.zip");
  const proof = {
    id: "sample",
    chunkSize: 4,
    total: 12,
    offset: 4,
    source: await fileIdentity(file),
    chunks: [{ bytes: 4, sha256: hash("abcd") }],
  };
  let offset = 4,
    removed = false;
  const sent = [];
  const request = async (url, options) => {
    assert.notEqual(
      url,
      "backup-transfers",
      "Resuming must not create a new transfer.",
    );
    if (options?.method === "DELETE") {
      removed = true;
      return {};
    }
    if (url.endsWith("/proof")) return proof;
    return {
      offset,
      state: offset === 12 ? "ready" : "transferring",
      preview: { id: "preview" },
    };
  };
  const transfer = new BackupTransfer({
    request,
    upload: async (url, data) => {
      sent.push(url);
      offset += data.size;
      return { offset };
    },
  });
  await transfer.start(
    "upload",
    new File(["xxxxxxxxxxxx"], "sample.zip"),
    proof,
  );
  assert.equal(transfer.state.phase, "error");
  assert.equal(removed, false);
  assert.deepEqual(sent, []);
  await transfer.start("upload", file, proof);
  assert.equal(transfer.state.phase, "complete");
  assert.deepEqual(
    sent.map((url) => Number(url.split("=")[1])),
    [4, 8],
  );
  assert.equal(removed, false);
  await transfer.clearPreview();
  assert.equal(removed, true);
});

test("a complete saved upload needs no local file and survives a lost verification response", async () => {
  const proof = { id: "sample", chunkSize: 4, total: 8, offset: 8 };
  let fail = true,
    removed = false;
  const request = async (url, options) => {
    if (options?.method === "DELETE") {
      removed = true;
      return {};
    }
    if (url.endsWith("/proof")) return proof;
    if (fail) throw new TypeError("Failed to fetch");
    return { state: "ready", preview: { id: "preview" } };
  };
  const transfer = new BackupTransfer({
    request,
    upload: () => assert.fail("Already uploaded bytes must not be resent."),
  });
  await transfer.start("upload", null, proof);
  assert.equal(transfer.state.phase, "error");
  assert.equal(removed, false);
  fail = false;
  await transfer.start("upload", null, proof);
  assert.equal(transfer.state.phase, "complete");
  assert.equal(transfer.state.preview.id, "preview");
});

test("recovery controls and file validation errors are translated without changing identifiers", () => {
  for (const key of [
    "transfer.checking",
    "transfer.recoveryTitle",
    "transfer.recoveryHelp",
    "transfer.selectOriginal",
    "transfer.wrongFile",
    "transfer.wrongPrefix",
    "transfer.cancelRetry",
  ]) {
    assert.notEqual(translate("en", key), key);
    assert.notEqual(translate("cs", key), translate("en", key));
    setLanguage("cs");
    assert.equal(localizeMessage(translate("en", key)), translate("cs", key));
  }
  setLanguage("en");
});
