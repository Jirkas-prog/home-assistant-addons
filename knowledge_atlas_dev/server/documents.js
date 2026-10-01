import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fail } from "./store.js";
import { digest, locationId } from "./settings.js";
import { historyDirectory } from "./file-safety.js";
import { documentType } from "../shared/document-types.js";
const contained = (root, target) => {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
};
export async function safePath(
  base,
  relative,
  { create = false, absolute = false } = {},
) {
  if (
    typeof relative !== "string" ||
    !relative.trim() ||
    relative.includes("\0")
  )
    fail("Enter a file path.");
  const normalized = relative.replaceAll("\\", "/");
  if (
    normalized.split("/").some((p) => p === ".." || p.startsWith(".")) ||
    (!absolute && (/^[a-z]:/i.test(normalized) || normalized.startsWith("/")))
  )
    fail("Use a relative path without .. or hidden directories.");
  const root = path.resolve(base),
    target = path.resolve(root, normalized);
  if (!contained(root, target) || target === root)
    fail("The path must point inside the document root.");
  if (create)
    await fs.mkdir(root, {
      recursive: true,
    });
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    fail("The document root is not available on the server.", 404);
  }
  // Check each existing ancestor before creating anything below it.
  const parts = path.relative(root, target).split(path.sep);
  let cursor = root;
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    let st;
    try {
      st = await fs.lstat(cursor);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (st) {
      const real = await fs.realpath(cursor);
      if (st.isSymbolicLink() || !contained(realRoot, real))
        fail(
          "Links outside the storage root and symlinks are not supported.",
          403,
        );
      if (i < parts.length - 1 && !st.isDirectory())
        fail("A path component is not a directory.");
    } else if (create && i < parts.length - 1) await fs.mkdir(cursor);
  }
  return target;
}
export async function resolveResource(resource, settings, ingress) {
  const id = locationId(resource),
    location = settings.locations.find((l) => l.id === id);
  if (!location) fail("The link location no longer exists.", 404);
  const value = resource.path || resource.url || "";
  if (location.kind === "web") {
    if (!/^https?:\/\//i.test(value))
      fail("Web links must start with http:// or https://.");
    return {
      url: value,
      ...documentType(value, true),
      editable: false,
      title: resource.label,
      location: location.name,
    };
  }
  if (location.kind === "physical")
    return {
      kind: "place",
      editable: false,
      title: resource.label,
      location: location.name,
      resolvedPath: value,
    };
  let file,
    editable = false;
  if (location.kind === "device") {
    if (ingress || id !== "pc" || !path.isAbsolute(value))
      return {
        kind: "place",
        editable: false,
        title: resource.label,
        location: location.name,
        resolvedPath: value,
      };
    file = value;
  } else {
    if (location.kind === "server" && !path.isAbsolute(location.basePath))
      fail(
        "This server root belongs to another operating system. Update its location settings.",
        404,
      );
    file = await safePath(
      location.kind === "addon" ? settings.documentRoot : location.basePath,
      value,
      {
        absolute: location.kind === "server",
      },
    );
    editable = !!location.writable;
  }
  const stat = await fs.stat(file).catch(() => null);
  if (!stat)
    fail(
      "The file is not available on this server. Check its location and path.",
      404,
    );
  const type = stat.isDirectory() ? { kind: "folder" } : documentType(file);
  const { kind } = type;
  return {
    file,
    ...type,
    editable: editable && kind === "text",
    title: resource.label,
    location: location.name,
    resolvedPath: file,
    size: stat.size,
  };
}
export async function readText(resource) {
  if (resource.kind !== "text") fail("This file is not a text file.");
  if (resource.size > 2_000_000)
    fail("The text editor supports files up to 2 MB.");
  const bytes = await fs.readFile(resource.file);
  if (bytes.includes(0))
    fail(
      "This file is not UTF-8 text. Download it and use its original application.",
    );
  let body;
  try {
    body = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    fail("The text editor requires UTF-8 encoding.");
  }
  return {
    body,
    revision: digest(bytes),
  };
}
export async function writeText(resource, body, revision) {
  if (!resource.editable)
    fail("This location does not allow file editing.", 403);
  if (typeof body !== "string" || Buffer.byteLength(body) > 2_000_000)
    fail("Text must not exceed 2 MB.");
  const current = await readText(resource);
  if (current.revision !== revision)
    fail(
      "The file has changed. Your text remains in the editor; copy it and reopen the current version.",
      409,
    );
  const history = await historyDirectory(
    path.dirname(resource.file),
    ".history",
  );
  await fs.copyFile(
    resource.file,
    path.join(history, path.basename(resource.file) + "." + randomUUID()),
  );
  const tmp = resource.file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, body, {
    flag: "wx",
  });
  try {
    if ((await readText(resource)).revision !== revision)
      fail(
        "The file changed during saving. Your draft has been preserved.",
        409,
      );
    await fs.rename(tmp, resource.file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
  return {
    body,
    revision: digest(body),
  };
}
