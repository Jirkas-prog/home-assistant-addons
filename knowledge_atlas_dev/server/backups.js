import fs from "node:fs/promises";
import { MapPositions } from "./map-positions.js";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { ZipArchive } from "archiver";
import yauzl from "yauzl";
import { Store, fail } from "./store.js";
import { Settings } from "./settings.js";
import { resourceLocation } from "../src/atlas-model.js";
import { transferExpired } from "../shared/transfer-policy.js";

const MAX_BYTES = 20 * 1024 ** 3;
const MAX_ENTRIES = 50_000;
const ID = /^[0-9a-f-]{36}$/;
const inside = (base, value) => {
  const relative = path.relative(base, value);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};
const exists = (file) =>
  fs.lstat(file).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
export const operationRoot = (directory) =>
  path.join(
    path.dirname(path.resolve(directory)),
    `.${path.basename(directory)}-operations`,
  );

export function byteLimit(limit = MAX_BYTES) {
  let size = 0;
  return new Transform({
    transform(chunk, encoding, done) {
      size += chunk.length;
      done(
        size > limit
          ? Object.assign(new Error("The upload exceeds the storage limit."), {
              status: 413,
            })
          : null,
        chunk,
      );
    },
  });
}
export async function hashFile(file, signal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal }))
    hash.update(chunk);
  return hash.digest("hex");
}
async function filesIn(root, { history = true, exclude = [] } = {}) {
  const files = [];
  const directories = [];
  if (!(await exists(root))) return { files, directories };
  async function visit(folder) {
    const stat = await fs.lstat(folder);
    if (stat.isSymbolicLink()) fail("Backups do not follow symbolic links.");
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (
        exclude.some((p) => inside(p, file)) ||
        [".index", ".cache"].includes(entry.name) ||
        (!history && entry.name === ".history")
      )
        continue;
      if (entry.isSymbolicLink()) fail("Backups do not follow symbolic links.");
      if (entry.isDirectory()) {
        if (files.length + directories.length >= MAX_ENTRIES)
          fail("The backup contains too many files.");
        directories.push(path.relative(root, file).replaceAll("\\", "/"));
        await visit(file);
      } else if (entry.isFile()) {
        if (files.length >= MAX_ENTRIES)
          fail("The backup contains too many files.");
        files.push({
          file,
          name: path.relative(root, file).replaceAll("\\", "/"),
          stat: await fs.stat(file),
        });
      } else fail("Backups only support regular files and directories.");
    }
  }
  await visit(root);
  return {
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
    directories: directories.sort(),
  };
}
async function inventory(directory, config, history = true) {
  const documentRoot = path.resolve(config.documentRoot);
  if (inside(documentRoot, path.resolve(directory)))
    fail("The document root must not contain the record directory.");
  const library = await filesIn(directory, {
    history,
    exclude: [documentRoot],
  });
  const documents = await filesIn(documentRoot, { history });
  return {
    files: [
      ...library.files.map((f) => ({ ...f, name: `library/${f.name}` })),
      ...documents.files.map((f) => ({ ...f, name: `documents/${f.name}` })),
    ],
    directories: [
      "library",
      "documents",
      ...library.directories.map((d) => `library/${d}`),
      ...documents.directories.map((d) => `documents/${d}`),
    ].sort(),
  };
}
function inventoryDigest(files, directories) {
  const hash = createHash("sha256");
  for (const name of directories) hash.update(`directory:${name}\n`);
  for (const file of files) hash.update(file.path + ":" + file.sha256 + "\n");
  return hash.digest("hex");
}
export async function fingerprint(directory, config, history = true, signal) {
  const { files, directories } = await inventory(directory, config, history);
  const hashes = [];
  for (const file of files)
    hashes.push({ path: file.name, sha256: await hashFile(file.file, signal) });
  return inventoryDigest(hashes, directories);
}
export function archiveName(name) {
  if (
    typeof name !== "string" ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":")
  )
    fail("Unsafe backup filename.");
  const parts = name.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
    )
  )
    fail("Unsafe backup filename.");
  if (name !== "manifest.json" && !["library", "documents"].includes(parts[0]))
    fail("Unexpected backup entry.");
  if (parts[0] === "library" && parts[1] === ".restored-documents")
    fail("Reserved backup directory.");
  return name;
}

// A directory swap can be interrupted between its two renames. Recover the
// preserved library before initialization is allowed to create a fresh one.
export async function recoverRestore(directory) {
  const root = operationRoot(directory),
    journalFile = path.join(root, "restore-journal.json");
  if (!(await exists(journalFile))) return;
  const journal = JSON.parse(await fs.readFile(journalFile, "utf8"));
  if (!ID.test(journal.id)) fail("Invalid restore recovery journal.", 500);
  const rollback = path.join(root, journal.id, "previous-library");
  if (!(await exists(directory))) {
    if (!(await exists(rollback)))
      fail("Restore recovery requires the preserved library.", 500);
    await fs.rename(rollback, directory);
  }
  await fs.unlink(journalFile);
}

export class Backups {
  constructor(directory, settings) {
    this.directory = path.resolve(directory);
    this.settings = settings;
    this.root = operationRoot(directory);
  }
  async summary() {
    const config = await this.settings.read();
    const { files, directories } = await inventory(this.directory, config);
    const snapshot = await new Store(this.directory).read();
    let externalReferences = 0;
    for (const node of snapshot.nodes)
      for (const resource of node.resources)
        if (
          config.locations.find((l) => l.id === resourceLocation(resource))
            ?.kind !== "addon"
        )
          externalReferences++;
    return {
      records: snapshot.nodes.length,
      files: files.length,
      directories: directories.length,
      bytes: files.reduce((sum, file) => sum + file.stat.size, 0),
      documents: files.filter((f) => f.name.startsWith("documents/")).length,
      history: files.filter((f) => f.name.split("/").includes(".history"))
        .length,
      trash: files.filter((f) => f.name.startsWith("library/.trash/")).length,
      externalReferences,
      errors: snapshot.errors,
    };
  }
  async export(output, { history = true, signal } = {}) {
    signal?.throwIfAborted();
    const config = await this.settings.read();
    const { files, directories } = await inventory(
      this.directory,
      config,
      history,
    );
    if (files.length + directories.length >= MAX_ENTRIES)
      fail("The backup contains too many files.");
    const manifest = {
      format: "knowledge-atlas-backup",
      version: 2,
      created: new Date().toISOString(),
      history,
      documentRoot: config.documentRoot,
      files: [],
      directories,
    };
    let total = 0;
    for (const entry of files) {
      total += entry.stat.size;
      if (total > MAX_BYTES) fail("The backup exceeds the storage limit.");
      archiveName(entry.name);
      manifest.files.push({
        path: entry.name,
        bytes: entry.stat.size,
        sha256: await hashFile(entry.file, signal),
      });
    }
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
        const stream = createReadStream(entry.file, { signal });
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
      if (
        inventoryDigest(manifest.files, directories) !==
        (await fingerprint(
          this.directory,
          await this.settings.read(),
          history,
          signal,
        ))
      )
        fail(
          "The library changed during backup. Retry when external editors are idle.",
          409,
        );
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
  async prepare(input, { signal, id: requestedId, purpose = "restore" } = {}) {
    signal?.throwIfAborted();
    await fs.mkdir(this.root, { recursive: true });
    if ((await fs.lstat(this.root)).isSymbolicLink())
      fail("The operations directory must not be a symlink.");
    if (requestedId != null && !ID.test(requestedId))
      fail("Invalid restore ID.");
    const id = requestedId || randomUUID(),
      stage = path.join(this.root, id),
      zipPath = path.join(stage, "upload.zip"),
      extracted = path.join(stage, "extracted");
    await fs.mkdir(stage);
    await fs.mkdir(extracted);
    try {
      await pipeline(
        input,
        byteLimit(),
        createWriteStream(zipPath, { flags: "wx" }),
        { signal },
      );
      const zip = await new Promise((resolve, reject) =>
        yauzl.open(
          zipPath,
          { lazyEntries: true, strictFileNames: true },
          (e, z) => (e ? reject(e) : resolve(z)),
        ),
      );
      const entries = new Map();
      const directories = new Map();
      let expanded = 0;
      await new Promise((resolve, reject) => {
        const stop = (e) => {
          zip.close();
          reject(e);
        };
        zip.on("error", stop);
        zip.on("end", resolve);
        zip.on("entry", (entry) => {
          (async () => {
            signal?.throwIfAborted();
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              fail("Backup links and special files are not supported.");
            if (entry.fileName.endsWith("/")) {
              const name = archiveName(entry.fileName.slice(0, -1)),
                key = name.toLowerCase();
              if (
                entries.has(key) ||
                directories.has(key) ||
                entries.size + directories.size >= MAX_ENTRIES
              )
                fail("Duplicate entry or too many backup files.");
              directories.set(key, name);
              await fs.mkdir(path.join(extracted, ...name.split("/")), {
                recursive: true,
              });
              zip.readEntry();
              return;
            }
            const name = archiveName(entry.fileName),
              key = name.toLowerCase();
            if (
              entries.has(key) ||
              directories.has(key) ||
              entries.size + directories.size >= MAX_ENTRIES
            )
              fail("Duplicate entry or too many backup files.");
            expanded += entry.uncompressedSize;
            if (
              expanded > MAX_BYTES ||
              (name === "manifest.json" && entry.uncompressedSize > 8_000_000)
            )
              fail("The extracted backup exceeds the storage limit.");
            const target = path.join(extracted, ...name.split("/"));
            await fs.mkdir(path.dirname(target), { recursive: true });
            const input = await new Promise((r, j) =>
              zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s))),
            );
            const hash = createHash("sha256");
            let bytes = 0;
            const verify = new Transform({
              transform(chunk, encoding, done) {
                hash.update(chunk);
                bytes += chunk.length;
                done(null, chunk);
              },
            });
            await pipeline(
              input,
              byteLimit(entry.uncompressedSize),
              verify,
              createWriteStream(target, { flags: "wx" }),
              { signal },
            );
            entries.set(key, { path: name, bytes, sha256: hash.digest("hex") });
            zip.readEntry();
          })().catch(stop);
        });
        zip.readEntry();
      });
      signal?.throwIfAborted();
      const manifest = JSON.parse(
        await fs.readFile(path.join(extracted, "manifest.json"), "utf8"),
      );
      if (
        (purpose === "merge"
          ? manifest.format !== "knowledge-atlas-package" ||
            manifest.version !== 1
          : manifest.format !== "knowledge-atlas-backup" ||
            ![1, 2].includes(manifest.version)) ||
        !Array.isArray(manifest.files) ||
        manifest.files.length !== entries.size - 1
      )
        fail("Invalid backup manifest.");
      if (manifest.version === 2 || purpose === "merge") {
        if (
          !Array.isArray(manifest.directories) ||
          manifest.directories.length !== directories.size ||
          new Set(manifest.directories).size !== directories.size
        )
          fail("Invalid backup manifest.");
        for (const name of manifest.directories) {
          archiveName(name);
          if (directories.get(name.toLowerCase()) !== name)
            fail("Invalid backup manifest.");
        }
      }
      const listed = new Set();
      for (const entry of manifest.files) {
        archiveName(entry.path);
        const actual = entries.get(entry.path.toLowerCase());
        if (
          listed.has(entry.path.toLowerCase()) ||
          !actual ||
          actual.path !== entry.path ||
          entry.bytes !== actual.bytes ||
          entry.sha256 !== actual.sha256
        )
          fail("Backup checksum verification failed.");
        listed.add(entry.path.toLowerCase());
      }
      if (purpose === "merge") {
        const { previewPackage } = await import("./packages.js");
        const plan = await previewPackage(this, id, manifest, signal);
        await fs.writeFile(path.join(stage, "plan.tmp"), JSON.stringify(plan), {
          flag: "wx",
          flush: true,
        });
        await fs.rename(
          path.join(stage, "plan.tmp"),
          path.join(stage, "plan.json"),
        );
        await fs.unlink(zipPath);
        return plan;
      }
      const candidate = path.join(extracted, "library");
      const config = new Settings(candidate, false).validate({
        ...JSON.parse(
          await fs.readFile(path.join(candidate, "settings.json"), "utf8"),
        ),
        documentRoot: path.join(this.directory, ".restored-documents"),
      });
      const snapshot = await new Store(candidate).read();
      await new MapPositions(candidate).read();
      if (snapshot.errors.length)
        fail(
          "The backup contains invalid records. Repair them before restoring.",
        );
      const knownLocations = new Set(config.locations.map((l) => l.id));
      for (const node of snapshot.nodes)
        for (const p of node.stock?.placements || [])
          if (
            !config.locations.some(
              (l) => l.id === p.locationId && l.kind === "physical",
            )
          )
            fail("Inventory placements require an existing physical place.");
      for (const node of snapshot.nodes)
        for (const resource of [
          ...node.resources,
          ...(node.stock?.placements || []),
        ])
          if (resource.locationId && !knownLocations.has(resource.locationId))
            fail("The backup references a missing location.");
      const current = await this.settings.read();
      const currentNodes = (await new Store(this.directory).read()).nodes;
      const plan = {
        id,
        created: new Date().toISOString(),
        revision: await fingerprint(this.directory, current, true, signal),
        records: snapshot.nodes.length,
        files: manifest.files.length,
        bytes: manifest.files.reduce((sum, f) => sum + f.bytes, 0),
        checksumVerified: true,
        backupCreated: manifest.created,
        includesHistory: manifest.history !== false,
        directories: directories.size,
        collisions: snapshot.nodes
          .filter((n) => currentNodes.some((old) => old.id === n.id))
          .map((n) => n.id),
        externalLocations: config.locations
          .filter((l) => l.kind !== "addon")
          .map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
        documentRoot: path.join(this.directory, ".restored-documents"),
        rollbackDirectory: path.join(stage, "previous-library"),
      };
      signal?.throwIfAborted();
      await fs.writeFile(path.join(stage, "plan.tmp"), JSON.stringify(plan), {
        flag: "wx",
        flush: true,
      });
      await fs.rename(
        path.join(stage, "plan.tmp"),
        path.join(stage, "plan.json"),
      );
      await fs.unlink(zipPath);
      return plan;
    } catch (error) {
      // Staging is generated beneath the verified operations root only.
      if (inside(this.root, stage) && ID.test(path.basename(stage)))
        await fs.rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
  async restore(id, revision) {
    if (!ID.test(id)) fail("Invalid restore ID.");
    const stage = path.join(this.root, id),
      plan = JSON.parse(
        await fs.readFile(path.join(stage, "plan.json"), "utf8"),
      );
    if (plan.kind === "merge")
      fail("Use package import to merge this preview.");
    if (transferExpired(Date.parse(plan.created)))
      fail("The restore preview has expired. Upload the backup again.", 409);
    if (
      revision !== plan.revision ||
      revision !==
        (await fingerprint(this.directory, await this.settings.read()))
    )
      fail("The library changed after preview. Upload the backup again.", 409);
    const extracted = path.join(stage, "extracted"),
      candidate = path.join(extracted, "library"),
      configFile = path.join(candidate, "settings.json");
    const manifest = JSON.parse(
      await fs.readFile(path.join(extracted, "manifest.json"), "utf8"),
    );
    for (const entry of manifest.files) {
      archiveName(entry.path);
      if (
        (await hashFile(path.join(extracted, ...entry.path.split("/")))) !==
        entry.sha256
      )
        fail(
          "Staged backup changed after preview. Upload the backup again.",
          409,
        );
    }
    const config = JSON.parse(await fs.readFile(configFile, "utf8"));
    config.documentRoot = path.join(this.directory, ".restored-documents");
    await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n");
    const docs = path.join(extracted, "documents");
    if (await exists(docs))
      await fs.rename(docs, path.join(candidate, ".restored-documents"));
    else await fs.mkdir(path.join(candidate, ".restored-documents"));
    const rollback = path.join(stage, "previous-library"),
      journal = path.join(this.root, "restore-journal.json");
    await fs.writeFile(journal, JSON.stringify({ id }), { flag: "wx" });
    try {
      await fs.rename(this.directory, rollback);
      try {
        await fs.rename(candidate, this.directory);
      } catch (error) {
        await fs.rename(rollback, this.directory);
        throw error;
      }
    } finally {
      if (await exists(this.directory)) await fs.unlink(journal);
    }
    await fs.rename(
      path.join(stage, "plan.json"),
      path.join(stage, "completed.json"),
    );
    return {
      ok: true,
      rollbackDirectory: rollback,
      documentRoot: config.documentRoot,
    };
  }
  async discard(id) {
    if (!ID.test(id)) fail("Invalid restore ID.");
    const stage = path.join(this.root, id);
    if (await exists(path.join(stage, "merge-active.json")))
      fail("The package import is still running.", 409);
    if (await exists(path.join(stage, "previous-library")))
      fail(
        "Preserved libraries cannot be deleted through preview cleanup.",
        409,
      );
    if (inside(this.root, stage))
      await fs.rm(stage, { recursive: true, force: true });
    return { ok: true };
  }
}
