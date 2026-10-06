import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { archiveName } from "./backups.js";
import { fail } from "./store.js";

export async function writeBackupArchive(
  output,
  files,
  manifest,
  signal,
  verifyInventory = async () => {},
) {
  const directories = manifest.directories;
  const manifestText = JSON.stringify(manifest, null, 2);
  if (Buffer.byteLength(manifestText) > 8_000_000)
    fail(
      "The backup manifest is too large. Split the library or attachment tree.",
    );
  const archive = new ZipArchive({ zlib: { level: 6 }, forceZip64: true });
  const finished = pipeline(archive, output, { signal });
  // Attach a rejection handler immediately; errors may arrive while entries
  // are still being queued. The same promise is awaited below.
  finished.catch(() => {});
  archive.on("warning", (error) => archive.destroy(error));
  try {
    // Finish directory entries before using per-file entry completion events.
    if (directories.length)
      await new Promise((resolve, reject) => {
        let pending = directories.length;
        const done = () => {
          if (--pending === 0) {
            archive.off("entry", done);
            archive.off("error", reject);
            resolve();
          }
        };
        archive.on("entry", done);
        archive.once("error", reject);
        for (const directory of directories) {
          archiveName(directory);
          archive.append(Buffer.alloc(0), {
            name: directory + "/",
            type: "directory",
          });
        }
      });
    for (const [index, entry] of files.entries()) {
      signal?.throwIfAborted();
      const expected = manifest.files[index];
      const stream = entry.raw
        ? Readable.from([entry.raw])
        : createReadStream(entry.file, { signal });
      const hash = createHash("sha256");
      let size = 0;
      const verified = new Transform({
        transform(chunk, encoding, done) {
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
        flush(done) {
          done(
            size !== expected.bytes || hash.digest("hex") !== expected.sha256
              ? new Error(
                  "A file changed during backup. Retry when external editors are idle.",
                )
              : null,
          );
        },
      });
      stream.on("error", (error) => verified.destroy(error));
      verified.on("error", (error) => archive.destroy(error));
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            archive.off("entry", done);
            archive.off("error", error);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          const error = (e) => {
            cleanup();
            reject(e);
          };
          archive.once("entry", done);
          archive.once("error", error);
          archive.append(stream.pipe(verified), { name: entry.name });
        });
      } finally {
        stream.destroy();
        verified.destroy();
      }
    }
    await verifyInventory();
    archive.append(manifestText, {
      name: "manifest.json",
    });
    await archive.finalize();
    await finished;
  } catch (error) {
    archive.destroy(error);
    await finished.catch(() => {});
    throw error;
  }
}
