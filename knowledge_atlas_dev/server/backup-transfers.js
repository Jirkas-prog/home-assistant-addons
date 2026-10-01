import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { byteLimit } from "./backups.js";
import { fail } from "./store.js";

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
    await this.sweep();
  }
  async sweep() {
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!ID.test(entry.name) || !entry.isDirectory()) continue;
      const session = this.sessions.get(entry.name);
      const folder = path.join(this.root, entry.name);
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
    const { id, direction, state, total, offset, filename, preview, error } =
      session;
    return {
      id,
      direction,
      state,
      total,
      offset,
      filename,
      preview,
      error,
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
      .finally(() => {
        session.job = null;
        session.touched = Date.now();
      });
  }
  async create({ direction, size }) {
    if (!["upload", "download"].includes(direction))
      fail("Invalid transfer direction.");
    if (
      direction === "upload" &&
      (!Number.isSafeInteger(size) || size <= 0 || size > MAX_BYTES)
    )
      fail("Choose a non-empty ZIP no larger than 20 GiB.");
    await this.sweep();
    if (this.sessions.size >= 4)
      fail("Cancel an existing backup transfer before starting another.", 409);
    const id = randomUUID();
    const folder = path.join(this.root, id);
    const session = {
      id,
      direction,
      folder,
      file: path.join(folder, "archive.zip"),
      state: direction === "download" ? "preparing" : "transferring",
      total: direction === "upload" ? size : null,
      offset: 0,
      touched: Date.now(),
      controller: new AbortController(),
      filename: `knowledge-atlas-backup-${new Date().toISOString().replaceAll(":", "-")}.zip`,
    };
    // Reserve the slot before asynchronous filesystem work.
    this.sessions.set(id, session);
    try {
      await fs.mkdir(folder);
      await fs.writeFile(session.file, "", { flag: "wx" });
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
    // An interrupted request never advances the committed offset.
    session.job = (async () => {
      try {
        await pipeline(input, byteLimit(remaining), createWriteStream(chunk), {
          signal: session.controller.signal,
        });
        const size = (await fs.stat(chunk)).size;
        if (!size) fail("The transfer chunk is empty.");
        await pipeline(
          createReadStream(chunk),
          createWriteStream(session.file, { flags: "a" }),
          { signal: session.controller.signal },
        );
        session.offset += size;
      } catch (error) {
        await fs.truncate(session.file, session.offset);
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
    if (["verifying", "ready", "error"].includes(session.state))
      return this.describe(session);
    if (session.job || session.offset !== session.total)
      fail("The upload is not complete.", 409);
    session.state = "verifying";
    this.launch(session, () =>
      this.mutate(async () => {
        session.controller.signal.throwIfAborted();
        session.preview = await this.backups.prepare(
          createReadStream(session.file),
          { signal: session.controller.signal },
        );
        session.controller.signal.throwIfAborted();
        session.state = "ready";
        await fs.rm(session.file, { force: true });
      }),
    );
    return this.describe(session);
  }
  async remove(id, { keepPreview = false } = {}) {
    const session = this.get(id);
    session.state = "cancelling";
    session.controller.abort();
    await session.job?.catch(() => {});
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
    res
      .status(206)
      .set({
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
