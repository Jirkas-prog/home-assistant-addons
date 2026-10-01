import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { byteLimit } from "./backups.js";
import { fail } from "./store.js";
import {
  recoverUpload,
  saveUpload,
  syncFile,
  validateSource,
} from "./upload-journal.js";

export const TRANSFER_CHUNK = 2 * 1024 ** 2;
const MAX_BYTES = 20 * 1024 ** 3;
const TTL = 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f-]{36}$/;

// Transfers own only this separate temporary tree, never restore rollback data.
export class BackupTransfers {
  constructor(backups, mutate) {
    this.backups = backups;
    this.mutate = mutate;
    this.root = path.join(backups.root, "transfers");
    this.sessions = new Map();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    for (const folder of [this.backups.root, this.root])
      if ((await fs.lstat(folder)).isSymbolicLink())
        fail("The operations directory must not be a symlink.");
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!ID.test(entry.name) || !entry.isDirectory()) continue;
      try {
        const session = await recoverUpload(
          path.join(this.root, entry.name),
          this.backups,
          TRANSFER_CHUNK,
        );
        if (session) this.sessions.set(session.id, session);
      } catch (error) {
        console.error(`Upload recovery: ${error.message}`);
      }
    }
    await this.sweep();
  }
  async sweep() {
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!ID.test(entry.name) || !entry.isDirectory()) continue;
      const session = this.sessions.get(entry.name);
      const folder = path.join(this.root, entry.name);
      // Uploads are deliberately retained until the owner finishes or cancels.
      if (
        session?.direction === "upload" ||
        (await fs.lstat(path.join(folder, "session.json")).catch(() => null))
      )
        continue;
      const touched = session?.touched ?? (await fs.stat(folder)).mtimeMs;
      if (Date.now() - touched <= TTL || session?.job) continue;
      if (session) await this.remove(session.id);
      else await fs.rm(folder, { recursive: true, force: true });
    }
  }
  get(id) {
    const session = ID.test(id) && this.sessions.get(id);
    if (!session) fail("The transfer has expired. Start it again.", 404);
    session.touched = Date.now();
    return session;
  }
  describe(session) {
    const {
      id,
      direction,
      state,
      total,
      offset,
      filename,
      preview,
      error,
      source,
      touched,
      purpose,
    } = session;
    return {
      id,
      direction,
      state,
      total,
      offset,
      filename,
      preview,
      error,
      source,
      touched,
      purpose,
      chunkSize: TRANSFER_CHUNK,
    };
  }
  launch(session, action) {
    session.job = Promise.resolve()
      .then(action)
      .catch((error) => {
        if (!session.controller.signal.aborted) {
          session.state = "error";
          session.error = error.status
            ? error.message
            : "The transfer could not be completed. Check free disk space and try again.";
          console.error(error.message);
        }
      })
      .finally(async () => {
        session.touched = Date.now();
        await saveUpload(session).catch((error) =>
          console.error(error.message),
        );
        session.job = null;
      });
  }
  async create({ direction, size, source, purpose = "restore" }) {
    if (
      !["restore", "merge"].includes(purpose) ||
      (direction === "download" && purpose !== "restore")
    )
      fail("Invalid transfer purpose.");
    if (!["upload", "download"].includes(direction))
      fail("Invalid transfer direction.");
    if (
      direction === "upload" &&
      (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES)
    )
      fail("Choose a non-empty ZIP no larger than 20 GiB.");
    source = direction === "upload" ? validateSource(source) : null;
    await this.sweep();
    if (this.sessions.size >= 4)
      fail("Cancel an existing backup transfer before starting another.", 409);
    const id = randomUUID();
    const folder = path.join(this.root, id);
    const session = {
      id,
      direction,
      purpose,
      folder,
      file: path.join(folder, "archive.zip"),
      state: direction === "download" ? "preparing" : "transferring",
      total: direction === "upload" ? size : null,
      offset: 0,
      source,
      chunks: [],
      touched: Date.now(),
      controller: new AbortController(),
      filename: `knowledge-atlas-backup-${new Date().toISOString().replaceAll(":", "-")}.zip`,
    };
    // Reserve the slot before asynchronous filesystem work.
    this.sessions.set(id, session);
    try {
      await fs.mkdir(folder);
      await fs.writeFile(session.file, "", { flag: "wx" });
      await saveUpload(session);
    } catch (error) {
      this.sessions.delete(id);
      await fs.rm(folder, { recursive: true, force: true });
      throw error;
    }
    if (direction === "download")
      this.launch(session, () =>
        this.mutate(async () => {
          session.controller.signal.throwIfAborted();
          const output = createWriteStream(session.file);
          try {
            await this.backups.export(output, {
              signal: session.controller.signal,
            });
            session.total = (await fs.stat(session.file)).size;
            session.state = "ready";
          } finally {
            output.destroy();
          }
        }),
      );
    return this.describe(session);
  }
  async upload(id, offset, input) {
    const session = this.get(id);
    if (
      session.direction !== "upload" ||
      session.state !== "transferring" ||
      session.job
    )
      fail("The transfer is busy. Try again.", 409);
    if (!Number.isSafeInteger(offset) || offset !== session.offset)
      fail("The transfer offset changed. Resume to synchronize it.", 409);
    const remaining = Math.min(TRANSFER_CHUNK, session.total - session.offset);
    if (remaining <= 0)
      fail("All upload bytes have already been received.", 409);
    const chunk = path.join(session.folder, "chunk.tmp");
    const originalOffset = session.offset;
    // An interrupted request never advances the committed offset.
    session.job = (async () => {
      try {
        await pipeline(input, byteLimit(remaining), createWriteStream(chunk), {
          signal: session.controller.signal,
        });
        const size = (await fs.stat(chunk)).size;
        if (!size) fail("The transfer chunk is empty.");
        if (session.chunks.length >= 50000)
          fail("The upload contains too many chunks.");
        const hash = createHash("sha256");
        for await (const bytes of createReadStream(chunk)) hash.update(bytes);
        await pipeline(
          createReadStream(chunk),
          createWriteStream(session.file, { flags: "a" }),
          { signal: session.controller.signal },
        );
        const committed = {
          ...session,
          offset: originalOffset + size,
          chunks: [
            ...session.chunks,
            { bytes: size, sha256: hash.digest("hex") },
          ],
          touched: Date.now(),
        };
        await syncFile(session.file);
        await saveUpload(committed);
        // Status and recovery proof expose only durable, acknowledged bytes.
        session.offset = committed.offset;
        session.chunks = committed.chunks;
        session.touched = committed.touched;
      } catch (error) {
        await fs.truncate(session.file, originalOffset);
        throw error;
      } finally {
        await fs.rm(chunk, { force: true });
      }
    })();
    try {
      await session.job;
    } finally {
      session.job = null;
      session.touched = Date.now();
    }
    return this.describe(session);
  }
  complete(id) {
    const session = this.get(id);
    if (session.direction !== "upload") fail("Invalid transfer direction.");
    if (session.state === "verifying") return this.describe(session);
    if (session.job || session.offset !== session.total)
      fail("The upload is not complete.", 409);
    session.state = "verifying";
    session.error = null;
    this.launch(session, () =>
      this.mutate(async () => {
        session.controller.signal.throwIfAborted();
        // Persist the retry intent before replacing a previously ready preview.
        await saveUpload(session);
        if (session.verificationId)
          await this.backups.discard(session.verificationId);
        session.verificationId = randomUUID();
        await saveUpload(session);
        session.preview = await this.backups.prepare(
          createReadStream(session.file),
          {
            signal: session.controller.signal,
            id: session.verificationId,
            purpose: session.purpose,
          },
        );
        session.controller.signal.throwIfAborted();
        session.state = "ready";
        await saveUpload(session);
        // Retain the source until restore/discard so a returning user can
        // refresh an expired preview without uploading the archive again.
      }),
    );
    return this.describe(session);
  }
  async remove(id, { keepPreview = false } = {}) {
    const session = this.get(id);
    if (
      session.preview &&
      (await fs
        .lstat(
          path.join(this.backups.root, session.preview.id, "merge-active.json"),
        )
        .catch(() => null))
    )
      fail("The package import is still running.", 409);
    session.state = "cancelling";
    session.controller.abort();
    await session.job?.catch(() => {});
    session.state = "cancelling";
    // Acknowledged completion keeps the preview; cancellation removes it.
    if (keepPreview) session.verificationId = null;
    await saveUpload(session);
    if (session.preview && !keepPreview)
      await this.mutate(() => this.backups.discard(session.preview.id));
    await fs.rm(session.folder, { recursive: true, force: true });
    this.sessions.delete(id);
    return { ok: true };
  }
}

export async function registerBackupTransfers(app, backups, mutate) {
  const transfers = new BackupTransfers(backups, mutate);
  await transfers.init();
  const route = "/api/backup-transfers";
  app.post(route, async (req, res) =>
    res.status(201).json(await transfers.create(req.body)),
  );
  app.get(route, (req, res) =>
    res.set("Cache-Control", "no-store").json({
      uploads: [...transfers.sessions.values()]
        .filter((session) => session.direction === "upload")
        .map((session) => transfers.describe(session)),
    }),
  );
  app.get(`${route}/:id/proof`, (req, res) => {
    const session = transfers.get(req.params.id);
    if (session.direction !== "upload") fail("Invalid transfer direction.");
    res
      .set("Cache-Control", "no-store")
      .json({ ...transfers.describe(session), chunks: session.chunks });
  });
  app.get(`${route}/:id`, (req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json(transfers.describe(transfers.get(req.params.id))),
  );
  app.put(`${route}/:id/chunk`, async (req, res) => {
    if (!req.is("application/octet-stream"))
      fail("Invalid transfer content type.");
    res.json(
      await transfers.upload(req.params.id, Number(req.query.offset), req),
    );
  });
  app.post(`${route}/:id/complete`, (req, res) =>
    res.status(202).json(transfers.complete(req.params.id)),
  );
  app.delete(`${route}/:id`, async (req, res) =>
    res.json(
      await transfers.remove(req.params.id, {
        keepPreview: req.body?.keepPreview === true,
      }),
    ),
  );
  app.get(`${route}/:id/file`, async (req, res) => {
    const session = transfers.get(req.params.id);
    if (session.direction !== "download" || session.state !== "ready")
      fail("The backup is not ready to download.", 409);
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.get("Range") || "");
    const start = Number(range?.[1]),
      end = Number(range?.[2]);
    if (
      !range ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end >= session.total ||
      end - start + 1 > TRANSFER_CHUNK
    )
      return res
        .status(416)
        .set("Content-Range", `bytes */${session.total}`)
        .end();
    res.status(206).set({
      "Content-Type": "application/zip",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${session.total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store, no-transform",
    });
    await pipeline(
      createReadStream(session.file, {
        start,
        end,
        signal: session.controller.signal,
      }),
      res,
    );
  });
  return transfers;
}
