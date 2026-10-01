import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { createApp } from "../server/index.js";
import { BackupTransfers, TRANSFER_CHUNK } from "../server/backup-transfers.js";
import { Backups } from "../server/backups.js";
import { BackupTransfer } from "../src/backup-transfer.js";
import {
  TransferMeter,
  formatPercent,
  transferPercent,
  formatDuration,
} from "../src/transfer-progress.js";
import { setLanguage, localizeMessage } from "../shared/i18n.js";

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await wait();
  }
  assert.fail("Timed out waiting for transfer state.");
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-transfer-"));
  const directory = path.join(root, "library");
  const { app, store, settings } = await createApp({ directory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-transfer-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = async (url, options = {}) => {
    const response = await fetch(base + url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
        ...options.headers,
      },
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  };
  const service = new BackupTransfers(new Backups(directory, settings), (fn) =>
    fn(),
  );
  await service.init();
  return { root, directory, store, settings, base, request, service };
}

test("transfer progress formats hundredths in English and Czech, handles large totals and excludes paused time", () => {
  assert.equal(formatPercent(1858, 10000, "en-GB"), "18.58%");
  assert.equal(formatPercent(1858, 10000, "cs-CZ"), "18,58%");
  assert.equal(formatPercent(0, 100, "en-GB"), "0.00%");
  assert.equal(formatPercent(100, 100, "cs-CZ"), "100,00%");
  assert.equal(transferPercent(10 * 1024 ** 3, 20 * 1024 ** 3), 50);
  assert.equal(transferPercent(999999, 1000000), 99.99);
  assert.equal(transferPercent(0, null), null);
  let time = 0;
  const meter = new TransferMeter(() => time);
  time = 1000;
  assert.deepEqual(meter.update(2000, 10000), { rate: 2000, eta: 4 });
  time = 900000;
  meter.reset(2000);
  time += 1000;
  assert.deepEqual(meter.update(4000, 10000), { rate: 2000, eta: 3 });
  for (let i = 0; i < 7; i++) {
    time += 1000;
    meter.update(4000, 10000);
  }
  assert.deepEqual(meter.update(4000, 10000), { rate: 0, eta: null });
  assert.equal(formatDuration(3661.2), "01:01:02");
  setLanguage("cs");
  assert.notEqual(
    localizeMessage(
      "The transfer connection was interrupted. Resume to retry.",
    ),
    "The transfer connection was interrupted. Resume to retry.",
  );
  setLanguage("en");
});

test("HTTP upload resumes confirmed chunks and range download round-trips a full verified backup without changing settings", async (t) => {
  const f = await fixture(t);
  const config = await f.settings.read();
  await fs.mkdir(config.documentRoot, { recursive: true });
  const attachment = randomBytes(TRANSFER_CHUNK + 127);
  await fs.writeFile(path.join(config.documentRoot, "fixture.bin"), attachment);
  const before = await fs.readFile(f.settings.file);
  const exported = await f.request("backup-transfers", {
    method: "POST",
    body: JSON.stringify({ direction: "download" }),
  });
  let status;
  for (let i = 0; i < 500; i++) {
    status = await f.request(`backup-transfers/${exported.id}`);
    if (status.state === "ready") break;
    assert.notEqual(status.state, "error");
    await wait();
  }
  assert.equal(status.state, "ready");
  assert.ok(status.total > TRANSFER_CHUNK);
  const bad = await fetch(`${f.base}backup-transfers/${exported.id}/file`, {
    headers: { Range: "bytes=0-9999999999" },
  });
  assert.equal(bad.status, 416);
  const chunks = [];
  for (let start = 0; start < status.total; start += status.chunkSize) {
    const end = Math.min(status.total, start + status.chunkSize) - 1;
    const response = await fetch(
      `${f.base}backup-transfers/${exported.id}/file`,
      { headers: { Range: `bytes=${start}-${end}` } },
    );
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get("content-length"),
      String(end - start + 1),
    );
    assert.equal(
      response.headers.get("content-range"),
      `bytes ${start}-${end}/${status.total}`,
    );
    chunks.push(Buffer.from(await response.arrayBuffer()));
  }
  const archive = Buffer.concat(chunks);
  const upload = await f.request("backup-transfers", {
    method: "POST",
    body: JSON.stringify({ direction: "upload", size: archive.length }),
  });
  const send = (offset, data) =>
    f.request(`backup-transfers/${upload.id}/chunk?offset=${offset}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: data,
    });
  const first = await send(0, archive.subarray(0, TRANSFER_CHUNK));
  assert.equal(first.offset, TRANSFER_CHUNK);
  // Simulate a lost acknowledgement: duplicate input cannot append twice.
  await assert.rejects(send(0, archive.subarray(0, 2)), { status: 409 });
  const resumed = await f.request(`backup-transfers/${upload.id}`);
  assert.equal(resumed.offset, TRANSFER_CHUNK);
  await assert.rejects(
    f.request(`backup-transfers/${upload.id}/complete`, {
      method: "POST",
      body: "{}",
    }),
    { status: 409 },
  );
  await send(resumed.offset, archive.subarray(resumed.offset));
  await f.request(`backup-transfers/${upload.id}/complete`, {
    method: "POST",
    body: "{}",
  });
  for (let i = 0; i < 500; i++) {
    status = await f.request(`backup-transfers/${upload.id}`);
    if (status.state === "ready") break;
    assert.notEqual(status.state, "error");
    await wait();
  }
  assert.equal(status.preview.checksumVerified, true);
  await f.request(`backup-transfers/${upload.id}`, {
    method: "DELETE",
    body: JSON.stringify({ keepPreview: true }),
  });
  const staged = path.join(
    f.service.backups.root,
    status.preview.id,
    "extracted/documents/fixture.bin",
  );
  assert.deepEqual(await fs.readFile(staged), attachment);
  assert.deepEqual(await fs.readFile(f.settings.file), before);
  await f.request(`backups/${status.preview.id}`, {
    method: "DELETE",
    body: "{}",
  });
  await f.request(`backup-transfers/${exported.id}`, {
    method: "DELETE",
    body: "{}",
  });
  assert.deepEqual(await fs.readdir(f.service.root), []);
});

test("interrupted or oversized chunks roll back; cancellation removes only the transfer", async (t) => {
  const f = await fixture(t);
  const { id } = await f.service.create({ direction: "upload", size: 20 });
  const failing = Readable.from(
    (async function* () {
      yield Buffer.from("abc");
      throw new Error("Disconnected fixture");
    })(),
  );
  await assert.rejects(f.service.upload(id, 0, failing), /Disconnected/);
  assert.equal(f.service.get(id).offset, 0);
  assert.equal((await fs.stat(f.service.get(id).file)).size, 0);
  await assert.rejects(
    f.service.upload(id, 0, Readable.from([Buffer.alloc(21)])),
    /limit/,
  );
  assert.equal((await fs.stat(f.service.get(id).file)).size, 0);
  await f.service.upload(id, 0, Readable.from([Buffer.from("valid")]));
  await f.service.remove(id);
  assert.deepEqual(await fs.readdir(f.service.root), []);
  assert.ok(await fs.stat(f.settings.file));
  await assert.rejects(f.service.remove("../library"), /expired/);
  await assert.rejects(
    f.service.create({ direction: "upload", size: 21 * 1024 ** 3 }),
    /20 GiB/,
  );
});

test("cancel stops queued preparation and expired transfer cleanup preserves rollback libraries", async (t) => {
  const f = await fixture(t);
  let unblock;
  const blocked = new Promise((resolve) => {
    unblock = resolve;
  });
  const service = new BackupTransfers(f.service.backups, (fn) =>
    blocked.then(fn),
  );
  await service.init();
  const created = await service.create({ direction: "download" });
  const removing = service.remove(created.id);
  unblock();
  await removing;
  assert.equal(service.sessions.size, 0);
  const expired = await service.create({ direction: "upload", size: 10 });
  service.sessions.get(expired.id).touched = 0;
  const preserved = path.join(
    service.backups.root,
    "preserved-fixture",
    "previous-library",
  );
  await fs.mkdir(preserved, { recursive: true });
  await fs.writeFile(path.join(preserved, "keep.txt"), "keep");
  await service.sweep();
  assert.equal(service.sessions.size, 0);
  assert.equal(
    await fs.readFile(path.join(preserved, "keep.txt"), "utf8"),
    "keep",
  );
});

test("client upload pause, resume after lost acknowledgement and cancel use confirmed offsets", async () => {
  let offset = 0,
    sends = 0,
    deleted = false;
  const request = async (url, options) => {
    if (url === "backup-transfers") return { id: "fixture", chunkSize: 4 };
    if (options?.method === "DELETE") {
      deleted = true;
      return {};
    }
    if (url.endsWith("complete")) return {};
    return {
      offset,
      state: offset === 12 ? "ready" : "transferring",
      preview: { id: "preview" },
    };
  };
  let transfer;
  transfer = new BackupTransfer({
    request,
    wait,
    upload: async (url, data, signal, progress) => {
      sends++;
      progress(data.size);
      offset += data.size;
      if (sends === 1) {
        transfer.pause();
        throw new DOMException("Stopped", "AbortError");
      }
      return { offset };
    },
  });
  const running = transfer.start("upload", new Blob(["abcdefghijkl"]));
  await until(() => transfer.state.phase === "paused");
  assert.equal(transfer.state.loaded, 0);
  assert.equal(sends, 1);
  transfer.resume();
  await running;
  assert.equal(sends, 3);
  assert.equal(transfer.state.phase, "complete");
  assert.equal(transfer.state.preview.id, "preview");
  assert.equal(deleted, true);

  deleted = false;
  offset = 0;
  transfer = new BackupTransfer({
    request,
    wait,
    upload: async () => {
      transfer.pause();
      throw new DOMException("Stopped", "AbortError");
    },
  });
  const cancelled = transfer.start("upload", new Blob(["abcd"]));
  await until(() => transfer.state.phase === "paused");
  transfer.cancel();
  await cancelled;
  assert.equal(transfer.state.phase, "cancelled");
  assert.equal(deleted, true);
  assert.equal(offset, 0);
});

test("client downloads resume ranges, preserve bytes, and cancel the destination writer", async () => {
  const output = [],
    ranges = [];
  let discarded = false,
    deleted = false,
    transfer;
  const request = async (url, options) => {
    if (options?.method === "DELETE") {
      deleted = true;
      return {};
    }
    return { id: "fixture", chunkSize: 4, state: "ready", total: 12 };
  };
  const sink = async () => ({
    async write(chunk) {
      output.push(...chunk);
      if (output.length === 4) transfer.pause();
    },
    async finish() {
      return null;
    },
    async discard() {
      discarded = true;
    },
  });
  const fetcher = async (url, options) => {
    ranges.push(options.headers.Range);
    const [, start, end] = /bytes=(\d+)-(\d+)/
      .exec(options.headers.Range)
      .map(Number);
    return new Response(
      Uint8Array.from({ length: end - start + 1 }, (_, i) => start + i),
      {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/12` },
      },
    );
  };
  transfer = new BackupTransfer({ request, sink, fetcher, wait });
  const running = transfer.start("download");
  await until(() => transfer.state.phase === "paused");
  assert.deepEqual(output, [0, 1, 2, 3]);
  transfer.resume();
  await running;
  assert.deepEqual(
    output,
    Array.from({ length: 12 }, (_, i) => i),
  );
  assert.deepEqual(ranges, ["bytes=0-3", "bytes=4-7", "bytes=8-11"]);
  assert.equal(transfer.state.phase, "complete");
  assert.equal(deleted, true);
  assert.equal(discarded, false);

  output.length = 0;
  transfer = new BackupTransfer({ request, sink, fetcher, wait });
  const cancelled = transfer.start("download");
  await until(() => transfer.state.phase === "paused");
  transfer.cancel();
  await cancelled;
  assert.equal(transfer.state.phase, "cancelled");
  assert.equal(discarded, true);
});
