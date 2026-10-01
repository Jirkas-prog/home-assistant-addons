import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import YAML from "yaml";
import { historyDirectory } from "./file-safety.js";
import { toolReferences } from "../shared/tools.js";
export {
  TYPES,
  STATUSES,
  fail,
  validateNode,
  validateGraph,
} from "../shared/schema.js";
import {
  fail,
  validateNode,
  validateGraph,
  graphIssues,
} from "../shared/schema.js";
export function parseMarkdown(raw) {
  const match = raw
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail("The YAML header delimited by --- is missing.");
  const metadata = YAML.parse(match[1], {
    maxAliasCount: 0,
  });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    fail("Invalid YAML header.");
  return {
    ...metadata,
    body: match[2].trim(),
  };
}
export function serialize(node) {
  const { body = "", revision, file, ...meta } = node;
  return `---\n${YAML.stringify(meta)}---\n\n${body}\n`;
}
const revisionOf = (raw) => createHash("sha256").update(raw).digest("hex");
export function upgradeNode(node) {
  const occurrences = new Map();
  return {
    ...node,
    schema: 2,
    resources: node.resources.map((resource) => {
      if (resource.id) return resource;
      const target = JSON.stringify([
        node.id,
        resource.locationId || "",
        resource.path || resource.url,
      ]);
      const occurrence = occurrences.get(target) || 0;
      occurrences.set(target, occurrence + 1);
      return {
        ...resource,
        id: "r-" + revisionOf(target + ":" + occurrence).slice(0, 32),
      };
    }),
  };
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.directory, {
      recursive: true,
    });
  }
  async read() {
    const nodes = [],
      errors = [];
    for (const name of (await fs.readdir(this.directory))
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      try {
        const file = path.join(this.directory, name);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          fail("Symlinks are not supported.");
        if (stat.size > 1_100_000) fail("The file is too large.");
        const raw = await fs.readFile(file, "utf8");
        const node = validateNode(parseMarkdown(raw));
        if (name !== `${node.id}.md`)
          fail("The filename must match the record ID.");
        nodes.push({
          ...node,
          resources: upgradeNode(node).resources,
          revision: revisionOf(raw),
          file: name,
        });
      } catch (e) {
        errors.push({
          file: name,
          message: e.message,
        });
      }
    }
    errors.push(...graphIssues(nodes));
    return {
      nodes,
      errors,
      revision: revisionOf(
        JSON.stringify({
          nodes,
          errors,
        }),
      ),
    };
  }
  lock(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async save(input, existingId = null, revision = null) {
    return this.lock(async () => {
      const { nodes, errors } = await this.read();
      const old = nodes.find((n) => n.id === existingId);
      if (existingId && !old) fail("The record does not exist.", 404);
      if (old && revision !== old.revision)
        fail(
          "The record has changed. Refresh the map and load the current text.",
          409,
        );
      const now = new Date().toISOString();
      const node = validateNode(
        upgradeNode({
          ...input,
          id: existingId || input.id || randomUUID(),
          created: old?.created || input.created || now,
          updated: now,
        }),
      );
      if (!existingId && nodes.some((n) => n.id === node.id))
        fail("This ID already exists.", 409);
      const existingIssues = new Set(graphIssues(nodes).map((e) => e.key));
      const addedIssues = graphIssues([
        ...nodes.filter((n) => n.id !== existingId),
        node,
      ]).filter((e) => !existingIssues.has(e.key));
      if (addedIssues.length) fail(addedIssues[0].message);
      const file = path.join(this.directory, `${node.id}.md`);
      if (old) {
        await historyDirectory(this.directory, ".history", node.id);
        await fs.copyFile(
          file,
          path.join(
            this.directory,
            ".history",
            node.id,
            `${Date.now()}-${randomUUID()}.md`,
          ),
        );
      }
      const raw = serialize(node),
        tmp = `${file}.${randomUUID()}.tmp`;
      if (Buffer.byteLength(raw) > 1_100_000)
        fail(
          "The serialized record exceeds the file size limit. Export or split large histories first.",
        );
      await fs.writeFile(tmp, raw, {
        flag: "wx",
      });
      try {
        if (old) {
          if (revisionOf(await fs.readFile(file)) !== revision)
            fail(
              "The record changed during saving. Your draft has been preserved.",
              409,
            );
          await fs.rename(tmp, file);
        } else {
          // Exclusive creation also protects an invalid or externally created file
          // that was absent from the last valid snapshot.
          await fs.copyFile(tmp, file, fs.constants.COPYFILE_EXCL);
          await fs.unlink(tmp);
        }
      } catch (e) {
        await fs.unlink(tmp).catch(() => {});
        if (e.code === "EEXIST")
          fail(
            "This filename already exists. Repair it before creating a record with this ID.",
            409,
          );
        throw e;
      }
      return {
        ...node,
        revision: revisionOf(raw),
        file: `${node.id}.md`,
      };
    });
  }
  async archive(id, revision) {
    return this.lock(async () => {
      const { nodes, errors } = await this.read();
      if (errors.length) fail("Repair the file errors first.", 409);
      const node = nodes.find((n) => n.id === id);
      if (!node) fail("The record does not exist.", 404);
      if (revision !== node.revision) fail("The record has changed.", 409);
      if (nodes.some((n) => n.parent === id))
        fail("Move or archive the child branches first.", 409);
      if (nodes.some((n) => n.related.includes(id)))
        fail("Remove incoming related links first.", 409);
      if (nodes.some((n) => n.projectId === id))
        fail("Move tasks linked to this project first.", 409);
      if (nodes.some((n) => toolReferences(n).some((ref) => ref.id === id)))
        fail(
          "Remove incoming tool references before archiving this record.",
          409,
        );
      await historyDirectory(this.directory, ".trash");
      if (
        revisionOf(await fs.readFile(path.join(this.directory, `${id}.md`))) !==
        revision
      )
        fail("The record has changed.", 409);
      await fs.rename(
        path.join(this.directory, `${id}.md`),
        path.join(this.directory, ".trash", `${id}-${Date.now()}.md`),
      );
    });
  }
}
