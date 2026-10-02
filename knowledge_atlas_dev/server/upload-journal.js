import fs from "node:fs/promises";
import path from "node:path";
import { fail } from "./store.js";

const ID = /^[0-9a-f-]{36}$/;
const HASH = /^[0-9a-f]{64}$/;
export function validateSource(source) {
  if (source == null) return null;
  if (
    typeof source.name !== "string" ||
    source.name.length > 255 ||
    !HASH.test(source.fingerprint) ||
    !Number.isSafeInteger(source.lastModified) ||
    source.lastModified < 0
  )
    fail("Invalid upload file identity.");
  return {
    name: source.name,
    lastModified: source.lastModified,
    fingerprint: source.fingerprint,
  };
}
export async function syncFile(file) {
  const handle = await fs.open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function saveUpload(session) {
  if (session.direction !== "upload") return;
  const {
    id,
    state,
    total,
    offset,
    source,
    chunks,
    touched,
    verificationId,
    purpose,
  } = session;
  const temp = path.join(session.folder, "session.tmp");
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(
      JSON.stringify({
        version: 1,
        id,
        state,
        total,
        offset,
        source,
        chunks,
        touched,
        verificationId,
        purpose,
      }),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, path.join(session.folder, "session.json"));
}
const regular = async (file) => {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Upload recovery requires regular files.");
  return stat;
};
export async function recoverUpload(folder, backups, chunkLimit) {
  const journal = path.join(folder, "session.json");
  try {
    if ((await regular(journal)).size > 8 * 1024 ** 2)
      throw new Error("Upload journal is too large.");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const saved = JSON.parse(await fs.readFile(journal, "utf8"));
  if (
    saved.version !== 1 ||
    (saved.purpose != null && !["restore", "merge"].includes(saved.purpose)) ||
    !ID.test(saved.id) ||
    saved.id !== path.basename(folder) ||
    !Number.isSafeInteger(saved.total) ||
    saved.total <= 0 ||
    saved.total > 20 * 1024 ** 3 ||
    !Number.isSafeInteger(saved.offset) ||
    saved.offset < 0 ||
    saved.offset > saved.total ||
    !Number.isFinite(saved.touched) ||
    !Array.isArray(saved.chunks) ||
    saved.chunks.length > 50000 ||
    !["transferring", "verifying", "ready", "error", "cancelling"].includes(
      saved.state,
    ) ||
    (saved.verificationId != null && !ID.test(saved.verificationId)) ||
    (["verifying", "ready"].includes(saved.state) &&
      saved.offset !== saved.total)
  )
    throw new Error("Invalid upload recovery journal.");
  let offset = 0;
  for (const chunk of saved.chunks) {
    if (
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes <= 0 ||
      chunk.bytes > chunkLimit ||
      !HASH.test(chunk.sha256)
    )
      throw new Error("Invalid upload recovery journal.");
    offset += chunk.bytes;
  }
  if (offset !== saved.offset)
    throw new Error("Invalid upload recovery journal.");
  const session = {
    id: saved.id,
    state: saved.state,
    total: saved.total,
    offset: saved.offset,
    chunks: saved.chunks,
    touched: saved.touched,
    verificationId: saved.verificationId,
    purpose: saved.purpose || "restore",
    source: validateSource(saved.source),
    direction: "upload",
    folder,
    file: path.join(folder, "archive.zip"),
    filename: saved.source?.name || "backup.zip",
    controller: new AbortController(),
  };
  if (saved.state === "cancelling") {
    if (saved.verificationId) await backups.discard(saved.verificationId);
    await fs.rm(folder, { recursive: true, force: true });
    return null;
  }
  if (saved.verificationId) {
    const stage = path.join(backups.root, saved.verificationId);
    const stageStat = await fs.lstat(stage).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stageStat && (!stageStat.isDirectory() || stageStat.isSymbolicLink()))
      throw new Error("Upload recovery requires a regular staging directory.");
    const completed = await fs
      .lstat(path.join(stage, "completed.json"))
      .catch(() => null);
    if (completed) {
      await fs.rm(folder, { recursive: true, force: true });
      return null;
    }
    try {
      await regular(path.join(stage, "plan.json"));
      const plan = JSON.parse(
        await fs.readFile(path.join(stage, "plan.json"), "utf8"),
      );
      if (plan.id !== saved.verificationId)
        throw new Error("Invalid upload recovery preview.");
      session.preview = plan;
      session.state = "ready";
      await saveUpload(session);
      return session;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Losing a temporary preview must not erase the complete original upload.
    // Rebuild the preview from the retained archive after returning.
    // Only the staging ID allocated by this transfer may be discarded.
    await backups.discard(saved.verificationId);
    session.verificationId = null;
  }
  const archive = await regular(session.file);
  if (archive.size < saved.offset)
    throw new Error("The saved upload is shorter than its confirmed offset.");
  // Data written before a crash but not acknowledged by the durable journal.
  if (archive.size > saved.offset) {
    await fs.truncate(session.file, saved.offset);
    await syncFile(session.file);
  }
  await fs.rm(path.join(folder, "chunk.tmp"), { force: true });
  session.state = "transferring";
  await saveUpload(session);
  return session;
}
