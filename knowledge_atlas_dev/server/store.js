import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import YAML from "yaml";
import { release } from "../shared/release.js";
import { historyDirectory } from "./file-safety.js";
import { toolReferences } from "../shared/tools.js";
import {
  reconcileOrder,
  moveInOrder,
  orderEntries,
} from "../shared/record-list.js";
import { readOrder, writeOrder, orderRevision } from "./record-order.js";
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
  const { body = "", revision, file, position, positionFixed, ...meta } = node;
  return `---\n${YAML.stringify(meta)}---\n\n${body}\n`;
}
const revisionOf = (raw) => createHash("sha256").update(raw).digest("hex");
const stampOf = (stat) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const rootOf = (stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
const INDEX_LIMIT = 128 * 1024 * 1024;
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
  constructor(directory, { persistentIndex = false } = {}) {
    this.directory = directory;
    this.queue = Promise.resolve();
    this.persistentIndex = persistentIndex;
    this.entries = new Map();
    this.snapshot = null;
    this.reading = null;
    this.rootIdentity = null;
    this.progress = { phase: "waiting", processed: 0, total: 0 };
    this.background = false;
  }
  async init() {
    await fs.mkdir(this.directory, {
      recursive: true,
    });
  }
  async read() {
    return structuredClone(await this.refresh());
  }
  async readNode(id) {
    const snapshot = await this.refresh();
    return structuredClone(snapshot.nodes.find((node) => node.id === id));
  }
  async refresh() {
    // Concurrent readers share one scan. Public record reads clone only their result.
    if (!this.reading)
      this.reading = this.scan()
        .catch((error) => {
          this.progress = { ...this.progress, phase: "error" };
          throw error;
        })
        .finally(() => {
          this.reading = null;
        });
    return await this.reading;
  }
  startBackground() {
    if (this.background) return;
    this.background = true;
    this.refreshBackground();
  }
  refreshBackground(delay = 0) {
    if (!this.background) return;
    clearTimeout(this.backgroundTimer);
    this.backgroundTimer = setTimeout(async () => {
      try {
        await this.refresh();
      } catch {
        /* Keep the last successful snapshot and retry on the next scan. */
      } finally {
        this.refreshBackground(3000);
      }
    }, delay);
    this.backgroundTimer.unref();
  }
  stopBackground() {
    this.background = false;
    clearTimeout(this.backgroundTimer);
  }
  async loadIndex() {
    if (!this.persistentIndex) return;
    try {
      const folder = path.join(this.directory, ".cache");
      const folderStat = await fs.lstat(folder);
      if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) return;
      const file = path.join(folder, "atlas-index.json");
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > INDEX_LIMIT)
        return;
      const index = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        index.version !== release.version ||
        index.root !== this.rootIdentity ||
        !Array.isArray(index.entries) ||
        index.digest !== revisionOf(JSON.stringify(index.entries))
      )
        return;
      const entries = new Map();
      for (const [name, entry] of index.entries) {
        const node = validateNode(entry.node);
        if (
          name !== `${node.id}.md` ||
          node.file !== name ||
          typeof entry.stamp !== "string" ||
          !/^[a-f0-9]{64}$/.test(node.revision)
        )
          return;
        entries.set(name, entry);
      }
      this.entries = entries;
    } catch {
      // A derived index is disposable; missing or damaged caches rebuild from Markdown.
    }
  }
  async saveIndex(rootIdentity) {
    if (!this.persistentIndex) return;
    let temporary;
    try {
      if (
        rootOf(await fs.lstat(this.directory, { bigint: true })) !==
        rootIdentity
      )
        return;
      const entries = [...this.entries].filter(
        ([, entry]) => entry.node && entry.stamp,
      );
      const data = JSON.stringify({
        version: release.version,
        root: rootIdentity,
        entries,
        digest: revisionOf(JSON.stringify(entries)),
      });
      if (Buffer.byteLength(data) > INDEX_LIMIT) return;
      const folder = await historyDirectory(this.directory, ".cache");
      temporary = path.join(folder, `atlas-index-${randomUUID()}.tmp`);
      await fs.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, path.join(folder, "atlas-index.json"));
    } catch {
      // Read-only storage or a full disk must not prevent reading the original records.
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
    }
  }
  async scan() {
    const previousProgress = this.progress;
    const progress = (this.progress = {
      phase: this.snapshot ? "checking" : "building",
      processed: 0,
      total: 0,
      startedAt: Date.now(),
      finishedAt: null,
    });
    const rootIdentity = rootOf(
      await fs.lstat(this.directory, { bigint: true }),
    );
    if (rootIdentity !== this.rootIdentity) {
      this.rootIdentity = rootIdentity;
      this.entries = new Map();
      this.snapshot = null;
      await this.loadIndex();
    }
    const names = (await fs.readdir(this.directory))
      .filter((f) => f.endsWith(".md"))
      .sort();
    progress.total = names.length;
    const entries = new Array(names.length);
    let cursor = 0;
    const readFile = async (name) => {
      try {
        const file = path.join(this.directory, name);
        const stat = await fs.lstat(file, { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink())
          fail("Symlinks are not supported.");
        if (stat.size > 1_100_000) fail("The file is too large.");
        const stamp = stampOf(stat);
        const cached = this.entries.get(name);
        if (cached?.stamp === stamp) return cached;
        progress.phase = "building";
        const raw = await fs.readFile(file, "utf8");
        // Do not cache a file that an external editor changed while it was being read.
        const stable =
          stamp === stampOf(await fs.lstat(file, { bigint: true }));
        try {
          const node = validateNode(parseMarkdown(raw));
          if (name !== `${node.id}.md`)
            fail("The filename must match the record ID.");
          return {
            stamp: stable ? stamp : null,
            node: {
              ...node,
              resources: upgradeNode(node).resources,
              revision: revisionOf(raw),
              file: name,
            },
          };
        } catch (error) {
          return {
            stamp: stable ? stamp : null,
            error: { file: name, message: error.message },
          };
        }
      } catch (e) {
        progress.phase = "building";
        return { error: { file: name, message: e.message } };
      }
    };
    // Bounded I/O avoids both serial disk latency and thousands of open handles.
    await Promise.all(
      Array.from({ length: Math.min(16, names.length) }, async () => {
        while (cursor < names.length) {
          const i = cursor++;
          entries[i] = await readFile(names[i]);
          progress.processed++;
        }
      }),
    );
    if (
      rootOf(await fs.lstat(this.directory, { bigint: true })) !== rootIdentity
    )
      return this.scan();
    let savedOrder = { ids: [], fixed: {} },
      orderError;
    try {
      savedOrder = await readOrder(this.directory);
    } catch (error) {
      orderError = { file: "list-order.json", message: error.message };
    }
    const savedRevision = orderRevision(savedOrder);
    if (
      !orderError &&
      this.orderFileRevision === savedRevision &&
      this.snapshot &&
      names.length === this.entries.size &&
      entries.every((entry, i) => entry === this.entries.get(names[i]))
    ) {
      this.progress =
        previousProgress.phase === "ready"
          ? previousProgress
          : { ...progress, phase: "ready", finishedAt: Date.now() };
      return this.snapshot;
    }
    progress.phase = "building";
    this.entries = new Map(names.map((name, i) => [name, entries[i]]));
    const nodes = [],
      errors = [];
    for (const entry of entries) {
      if (entry.node) nodes.push(entry.node);
      else errors.push(entry.error);
    }
    errors.push(...graphIssues(nodes));
    const order = reconcileOrder(
      nodes,
      savedOrder,
      names.map((name) => name.slice(0, -3)),
    );
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ordered = orderEntries(order)
      .filter(({ id }) => byId.has(id))
      .map((entry) => ({ ...byId.get(entry.id), ...entry }));
    this.orderFileRevision = orderError ? null : savedRevision;
    if (orderError) errors.push(orderError);
    else if (this.persistentIndex && orderRevision(order) !== savedRevision) {
      try {
        await writeOrder(this.directory, order);
        this.orderFileRevision = orderRevision(order);
      } catch (error) {
        this.orderFileRevision = null;
        errors.push({ file: "list-order.json", message: error.message });
      }
    }
    this.snapshot = {
      nodes: ordered,
      errors,
      orderRevision: orderRevision(order),
      revision: revisionOf(
        JSON.stringify({
          nodes: ordered,
          errors,
          orderRevision: orderRevision(order),
        }),
      ),
    };
    await this.saveIndex(rootIdentity);
    progress.phase = "ready";
    progress.finishedAt = Date.now();
    return this.snapshot;
  }
  lock(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {});
    return task;
  }
  async save(input, existingId = null, revision = null) {
    return this.lock(async () => {
      const { position, positionFixed, ...metadata } = input;
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
          ...metadata,
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
      // Remember existing records before adding a new one, including legacy and
      // manually created Markdown. New IDs are inserted ahead of this sequence.
      let newPosition = 1;
      if (!existingId) {
        const saved = await readOrder(this.directory);
        const order = reconcileOrder(
          nodes,
          saved,
          [...this.entries.keys()].map((name) => name.slice(0, -3)),
        );
        if (orderRevision(order) !== orderRevision(saved))
          await writeOrder(this.directory, order);
        const reserved = new Set(Object.values(order.fixed));
        while (reserved.has(newPosition)) newPosition++;
      }
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
        position: old?.position || newPosition,
        positionFixed: old?.positionFixed || false,
        revision: revisionOf(raw),
        file: `${node.id}.md`,
      };
    });
  }
  async move(id, position, revision, positionFixed) {
    return this.lock(async () => {
      if (!Number.isSafeInteger(position) || position < 1)
        fail("List position must be a positive integer.");
      if (positionFixed !== undefined && typeof positionFixed !== "boolean")
        fail("Fixed position must be a boolean.");
      const snapshot = await this.read();
      if (snapshot.errors.some((error) => error.file === "list-order.json"))
        fail("Invalid list order. Restore or repair list-order.json.", 409);
      if (revision !== snapshot.orderRevision)
        fail("The list order has changed. Refresh and try again.", 409);
      if (!snapshot.nodes.some((node) => node.id === id))
        fail("The record does not exist.", 404);
      // Retain temporarily invalid Markdown IDs so repairing a file does not
      // discard the saved position of unrelated records.
      const saved = await readOrder(this.directory);
      if (orderRevision(saved) !== this.orderFileRevision)
        fail("The list order has changed. Refresh and try again.", 409);
      const current = reconcileOrder(
        snapshot.nodes,
        saved,
        [...this.entries.keys()].map((name) => name.slice(0, -3)),
      );
      await writeOrder(
        this.directory,
        moveInOrder(current, id, position, positionFixed),
      );
      return this.read();
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
