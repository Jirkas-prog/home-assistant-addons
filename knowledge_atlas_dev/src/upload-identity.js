import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export async function fileIdentity(file) {
  const hash = sha256.create();
  hash.update(new TextEncoder().encode(String(file.size)));
  const sample = 64 * 1024;
  for (const start of [
    0,
    Math.max(0, Math.floor(file.size / 2) - sample / 2),
    Math.max(0, file.size - sample),
  ])
    hash.update(
      new Uint8Array(await file.slice(start, start + sample).arrayBuffer()),
    );
  return {
    name: file.name || "backup.zip",
    lastModified: file.lastModified || 0,
    fingerprint: bytesToHex(hash.digest()),
  };
}

export async function verifyUploadFile(
  file,
  proof,
  onProgress = () => {},
  signal,
) {
  signal?.throwIfAborted();
  if (!file || file.size !== proof.total)
    throw new Error(
      "Choose the same ZIP that started this upload. The saved upload has been kept.",
    );
  const source = await fileIdentity(file);
  if (proof.source && source.fingerprint !== proof.source.fingerprint)
    throw new Error(
      "Choose the same ZIP that started this upload. The saved upload has been kept.",
    );
  let offset = 0;
  for (const chunk of proof.chunks) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(
      await file.slice(offset, offset + chunk.bytes).arrayBuffer(),
    );
    if (bytesToHex(sha256(bytes)) !== chunk.sha256)
      throw new Error(
        "The selected ZIP differs from the uploaded parts. The saved upload has been kept.",
      );
    offset += chunk.bytes;
    onProgress(offset, proof.offset);
  }
  if (offset !== proof.offset)
    throw new Error("Invalid upload recovery journal.");
  return source;
}
