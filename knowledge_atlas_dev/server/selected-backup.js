import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeBackupArchive } from "./backup-archive.js";
import { Store, serialize, fail } from "./store.js";
import { digest, locationId } from "./settings.js";
import { safePath } from "./documents.js";
import { hashFile } from "./backups.js";
import { taskDataPath, validateTaskData } from "./task-data.js";
import { backupPart, validateSelection } from "../shared/backup-selection.js";
import { toolReferences } from "../shared/tools.js";
import { MapPositions } from "./map-positions.js";

export async function exportSelected(backups, output, parts, signal) {
  validateSelection(parts, fail);
  const config = await backups.settings.read();
  const snapshot = await new Store(backups.directory).read();
  if (snapshot.errors.length) fail("Repair the file errors first.", 409);
  const selected = snapshot.nodes.filter((n) => parts.includes(backupPart(n)));
  if (!selected.length) fail("The selected sections contain no records.");
  const included = new Map(selected.map((n) => [n.id, n]));
  const contexts = new Set();
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  for (const n of included.values()) {
    for (const id of [
      n.parent,
      n.projectId,
      ...n.related,
      ...toolReferences(n).map((r) => r.id),
    ]) {
      if (!id || included.has(id)) continue;
      const source = byId.get(id);
      if (!source) fail("A selected record references a missing record.");
      // Context records preserve identities and hierarchy, never unrelated bodies or attachments.
      const stub = {
        schema: 2,
        id,
        parent: source.parent,
        title: source.title,
        type: source.type,
        status: source.status,
        color: source.color,
        body: "",
        summary: "",
        tags: [],
        related: [],
        resources: [],
        ...(source.board ? { board: source.board } : {}),
      };
      included.set(id, stub);
      contexts.add(id);
    }
  }
  const entries = [],
    locations = new Set(),
    documents = new Set();
  const addText = (name, value) => {
    const raw = Buffer.from(value);
    entries.push({ name, raw, bytes: raw.length, sha256: digest(raw) });
  };
  for (const n of included.values()) {
    const resources = n.resources.map((r) => {
      const location = config.locations.find((l) => l.id === locationId(r));
      if (!location) fail("The backup references a missing location.");
      if (location.kind !== "addon") {
        locations.add(location.id);
        return r;
      }
      documents.add(r.path.replaceAll("\\", "/"));
      return { ...r, locationId: "addon" };
    });
    for (const p of n.stock?.placements || []) locations.add(p.locationId);
    addText(`library/${n.id}.md`, serialize({ ...n, resources }));
    if (contexts.has(n.id)) continue;
    for (const folder of ["comments", `activity/${n.id}`]) {
      const names =
        folder === "comments"
          ? [`${n.id}.json`]
          : await fs
              .readdir(await safePath(backups.directory, folder))
              .catch((e) => {
                if (e.code === "ENOENT") return [];
                throw e;
              });
      for (const name of names) {
        const relative = `${folder}/${name}`;
        if (!taskDataPath(relative)) continue;
        const file = await safePath(backups.directory, relative);
        const raw = await fs.readFile(file, "utf8").catch((e) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (raw !== null) {
          validateTaskData(relative, JSON.parse(raw));
          addText(`library/${relative}`, raw);
        }
      }
    }
  }
  for (const id of locations) {
    const loc = config.locations.find((l) => l.id === id);
    if (loc?.parentId) locations.add(loc.parentId);
  }
  for (const name of documents) {
    signal?.throwIfAborted();
    const file = await safePath(config.documentRoot, name),
      stat = await fs.stat(file);
    if (!stat.isFile()) fail("Selected backup attachments must be files.");
    entries.push({
      name: `documents/${name}`,
      file,
      bytes: stat.size,
      sha256: await hashFile(file, signal),
    });
  }
  const metadata = {
    schema: 1,
    contexts: [...contexts],
    parts,
    locations: config.locations.filter((l) => locations.has(l.id)),
    order: snapshot.nodes
      .filter((n) => included.has(n.id) && !contexts.has(n.id))
      .map((n) => ({
        id: n.id,
        position: n.position,
        fixed: !!n.positionFixed,
      })),
  };
  if (parts.includes("map")) {
    const positions = await new MapPositions(backups.directory).read();
    metadata.map = Object.fromEntries(
      Object.entries(positions.views).map(([view, points]) => [
        view,
        points.filter((p) => included.has(p.id)),
      ]),
    );
  }
  addText("library/selection.json", JSON.stringify(metadata));
  if (
    entries.length > 49990 ||
    entries.reduce((sum, e) => sum + e.bytes, 0) > 20 * 1024 ** 3
  )
    fail("The backup exceeds the storage limit.");
  const directories = new Set(["library", "documents"]);
  for (const e of entries) {
    const segments = e.name.split("/");
    segments.pop();
    while (segments.length) {
      directories.add(segments.join("/"));
      segments.pop();
    }
  }
  if (entries.length + directories.size + 1 >= 50000)
    fail("The backup exceeds the storage limit.");
  const manifest = {
    format: "knowledge-atlas-package",
    version: 2,
    id: randomUUID(),
    created: new Date().toISOString(),
    title: "Selected library sections",
    directories: [...directories].sort(),
    files: entries.map((e) => ({
      path: e.name,
      bytes: e.bytes,
      sha256: e.sha256,
    })),
  };
  await writeBackupArchive(output, entries, manifest, signal);
}
