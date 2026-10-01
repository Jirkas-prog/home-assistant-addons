import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZipArchive } from "archiver";
import { hashFile, archiveName } from "../server/backups.js";
import { Store } from "../server/store.js";

export async function createPackage(input, output, title = "Data package") {
  const root = path.resolve(input),
    destination = path.resolve(output);
  const relativeOutput = path.relative(root, destination);
  if (
    relativeOutput === "" ||
    (!relativeOutput.startsWith(".." + path.sep) &&
      relativeOutput !== ".." &&
      !path.isAbsolute(relativeOutput))
  )
    throw new Error("Choose an output path outside the package input.");
  const files = [],
    directories = [];
  let bytes = 0;
  async function visit(name) {
    archiveName(name);
    if (name.split("/").some((part) => part.startsWith(".")))
      throw new Error("Package paths must not contain hidden directories.");
    const file = path.join(root, ...name.split("/"));
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink())
      throw new Error("Packages do not follow symbolic links.");
    if (stat.isDirectory()) {
      directories.push(name);
      for (const entry of (await fs.readdir(file)).sort())
        await visit(name + "/" + entry);
    } else if (stat.isFile()) {
      if (file === destination)
        throw new Error("Choose an output path outside the package input.");
      if (
        name.startsWith("library/") &&
        !/^library\/[a-z0-9][a-z0-9_-]{0,119}\.md$/.test(name)
      )
        throw new Error(
          "The library folder may contain only record Markdown files.",
        );
      bytes += stat.size;
      if (bytes > 20 * 1024 ** 3)
        throw new Error("The package exceeds 20 GiB.");
      files.push({
        path: name,
        bytes: stat.size,
        sha256: await hashFile(file),
      });
    } else throw new Error("Packages require regular files.");
    if (files.length + directories.length >= 50000)
      throw new Error("The package contains too many entries.");
  }
  for (const name of ["library", "documents"]) {
    if (await fs.lstat(path.join(root, name)).catch(() => null))
      await visit(name);
    else directories.push(name);
  }
  const nodes = await new Store(path.join(root, "library")).read();
  if (!nodes.nodes.length || nodes.errors.some((e) => !e.key))
    throw new Error("The package contains invalid or missing records.");
  const manifest = {
    format: "knowledge-atlas-package",
    version: 1,
    title,
    created: new Date().toISOString(),
    directories,
    files,
  };
  // Exclusive output protects an existing archive. Files are streamed, not buffered.
  const handle = await fs.open(destination, "wx");
  const outputStream = handle.createWriteStream();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const completed = new Promise((resolve, reject) => {
    outputStream.on("close", resolve);
    outputStream.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", reject);
  });
  completed.catch(() => {});
  archive.pipe(outputStream);
  try {
    for (const name of directories)
      archive.append("", { name: name + "/", type: "directory" });
    for (const file of files)
      archive.file(path.join(root, ...file.path.split("/")), {
        name: file.path,
      });
    archive.append(JSON.stringify(manifest, null, 2) + "\n", {
      name: "manifest.json",
    });
    await archive.finalize();
    await completed;
    // The importer verifies every streamed byte against the manifest as well.
    for (const file of files)
      if (
        (await hashFile(path.join(root, ...file.path.split("/")))) !==
        file.sha256
      )
        throw new Error("Package input changed during export.");
  } catch (error) {
    archive.abort();
    outputStream.destroy();
    await completed.catch(() => {});
    await fs.rm(destination, { force: true });
    throw error;
  }
  return {
    records: nodes.nodes.length,
    documents: files.filter((f) => f.path.startsWith("documents/")).length,
    bytes,
    output: destination,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, title] = process.argv.slice(2);
  if (!input || !output) {
    console.error(
      "Usage: node scripts/create-package.js <input-folder> <output.zip> [title]",
    );
    process.exitCode = 1;
  } else
    createPackage(input, output, title)
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
