import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Store,
  serialize,
  validateNode,
  validateGraph,
  fail,
} from "./store.js";
import { Settings, digest, locationId } from "./settings.js";
import { safePath } from "./documents.js";
import { historyDirectory } from "./file-safety.js";
import { operationRoot, hashFile, archiveName } from "./backups.js";
import { taskDataPath } from "./task-data.js";
import { readPackageMetadata, metadataEntries } from "./package-metadata.js";

const UUID = /^[0-9a-f-]{36}$/;
const RECORD = /^[a-z0-9][a-z0-9_-]{0,119}\.md$/;
const exists = (file) =>
  fs.lstat(file).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
async function writeJSON(file, value) {
  await fs.writeFile(file + ".tmp", JSON.stringify(value), { flush: true });
  await fs.rename(file + ".tmp", file);
}
function packagePath(name) {
  archiveName(name);
  if (
    name.split("/").some((part) => part.startsWith(".")) ||
    !(
      name.startsWith("documents/") ||
      name === "library/selection.json" ||
      (name.startsWith("library/") && taskDataPath(name.slice(8))) ||
      (name.startsWith("library/") && RECORD.test(name.slice(8)))
    )
  )
    fail("Packages may contain only Markdown records and managed documents.");
  return name;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const content = ({
  revision,
  file,
  position,
  positionFixed,
  created,
  updated,
  ...node
}) => JSON.stringify(canonical(node));
const detail = (node) =>
  node
    ? {
        title: node.title,
        summary: node.summary,
        body: serialize(node).slice(0, 12000),
        truncated: serialize(node).length > 12000,
        attachments: node.resources.length,
        type: node.type,
      }
    : null;
const commentPreview = (value) => ({
  total: value?.entries?.length || 0,
  entries: (value?.entries || []).slice(-10).map((c) => ({
    id: c.id,
    body: c.body.slice(0, 1000),
    deleted: c.deleted,
  })),
});
async function fileHash(file) {
  const stat = await exists(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink())
    fail("Package targets must be regular files.");
  return hashFile(file);
}
async function target(directory, config, entry, create = false) {
  if (
    entry.kind === "metadata" &&
    (taskDataPath(entry.name) ||
      ["settings.json", "map-positions.json", "list-order.json"].includes(
        entry.name,
      ))
  )
    return safePath(directory, entry.name, { create });
  if (entry.kind === "record") {
    if (!RECORD.test(entry.name)) fail("Invalid package recovery journal.");
    return path.join(directory, entry.name);
  }
  if (
    entry.kind !== "document" ||
    !/^imports\/[0-9a-f]{64}\/.+/.test(entry.name)
  )
    fail("Invalid package recovery journal.");
  packagePath("documents/" + entry.name);
  const root = path.resolve(config.documentRoot);
  const stat = await exists(root);
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory()))
    fail("Package targets must be regular files.");
  if (!stat && !create) return path.join(root, ...entry.name.split("/"));
  return safePath(root, entry.name, { create });
}
async function readIncoming(backups, id, manifest, config) {
  const stage = path.join(backups.root, id, "extracted");
  const metadata = await readPackageMetadata(
    backups.directory,
    stage,
    manifest,
    config,
  );
  config = metadata.config;
  const source = await new Store(path.join(stage, "library")).read();
  if (source.errors.some((e) => !e.key) || !source.nodes.length)
    fail("The package contains invalid or missing records.");
  const addon = config.locations.find((l) => l.kind === "addon");
  if (!addon)
    fail("The library needs an Add-on location before importing a package.");
  const packageHash = digest(
    JSON.stringify(
      manifest.files
        .map((f) => [f.path, f.bytes, f.sha256])
        .sort((a, b) => a[0].localeCompare(b[0], "en")),
    ),
  );
  const documents = manifest.files.filter((f) =>
    f.path.startsWith("documents/"),
  );
  const names = new Set(documents.map((f) => f.path.slice(10)));
  const nodes = source.nodes.map((node) => ({
    ...node,
    resources: node.resources.map((resource) => {
      if (locationId(resource) !== "addon") return resource;
      const relative = resource.path?.replaceAll("\\", "/");
      if (!relative || !names.has(relative))
        fail("Every packaged Add-on attachment must be included in documents.");
      packagePath("documents/" + relative);
      return {
        ...resource,
        locationId: addon.id,
        path: `imports/${packageHash}/${relative}`,
      };
    }),
  }));
  for (const node of nodes) {
    validateNode(node);
    for (const resource of node.resources)
      if (!config.locations.some((l) => l.id === locationId(resource)))
        fail(
          "Create the referenced location in Settings before importing: {0}".replace(
            "{0}",
            locationId(resource),
          ),
        );
    for (const placement of node.stock?.placements || [])
      if (
        !config.locations.some(
          (l) => l.id === placement.locationId && l.kind === "physical",
        )
      )
        fail("Inventory placements require an existing physical place.");
  }
  if (metadata.sidecars.some((s) => !nodes.some((n) => n.id === s.recordId)))
    fail("Discussion data references a missing packaged record.");
  return { nodes, documents, packageHash, metadata };
}
async function select(
  backups,
  id,
  manifest,
  { decisions = {}, parent = null } = {},
) {
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions))
    fail("Invalid package conflict choices.");
  const current = await new Store(backups.directory).read();
  let config = await backups.settings.read();
  if (current.errors.length) fail("Repair the file errors first.", 409);
  if (parent != null && !current.nodes.some((n) => n.id === parent))
    fail("The selected parent branch does not exist.");
  const incoming = await readIncoming(backups, id, manifest, config);
  config = incoming.metadata.config;
  const byId = new Map(current.nodes.map((n) => [n.id, n]));
  const rows = [],
    selected = [];
  for (const node of incoming.nodes) {
    const old = byId.get(node.id);
    const next = {
      ...node,
      parent: !old && node.parent === null ? parent : node.parent,
    };
    const discussionChanged = incoming.metadata.sidecars.some(
      (s) =>
        s.recordId === node.id &&
        JSON.stringify(s.value) !== JSON.stringify(s.previous),
    );
    const context = incoming.metadata.selection?.contexts.includes(node.id);
    const status = !old
      ? "added"
      : context || (content(old) === content(next) && !discussionChanged)
        ? "identical"
        : "conflict";
    const decision = Object.hasOwn(decisions, node.id)
      ? decisions[node.id]
      : "keep";
    if (!["keep", "replace"].includes(decision))
      fail("Invalid package conflict choices.");
    rows.push({
      id: node.id,
      title: next.title,
      status,
      current: old
        ? {
            ...detail(old),
            comments: commentPreview(
              incoming.metadata.sidecars.find(
                (s) => s.name === `comments/${node.id}.json`,
              )?.previous,
            ),
          }
        : null,
      incoming: {
        ...detail(next),
        comments: commentPreview(
          incoming.metadata.sidecars.find(
            (s) => s.name === `comments/${node.id}.json`,
          )?.value,
        ),
      },
    });
    if (!old || (status !== "identical" && decision === "replace")) {
      const now = new Date().toISOString();
      selected.push({
        next: {
          ...next,
          created: old?.created || next.created || now,
          updated: next.updated || now,
        },
        old,
      });
    }
  }
  for (const key of Object.keys(decisions))
    if (!rows.some((r) => r.id === key))
      fail("Invalid package conflict choices.");
  const merged = new Map(byId);
  for (const { next } of selected) merged.set(next.id, next);
  let issue = null;
  try {
    validateGraph([...merged.values()]);
  } catch (error) {
    issue = error.message;
  }
  const revision = digest(
    current.revision +
      config.revision +
      incoming.packageHash +
      incoming.metadata.revision,
  );
  return { ...incoming, current, config, rows, selected, issue, revision };
}
export async function previewPackage(backups, id, manifest, signal) {
  if (!Array.isArray(manifest.files) || manifest.files.length > 50000)
    fail("Invalid data package manifest.");
  for (const entry of manifest.files) packagePath(entry.path);
  for (const name of manifest.directories) {
    if (
      ["library/comments", "library/activity"].includes(name) ||
      /^library\/activity\/[a-z0-9][a-z0-9_-]{0,119}$/.test(name)
    )
      continue;
    if (!["library", "documents"].includes(name))
      packagePath(name + "/placeholder");
  }
  const selection = await select(backups, id, manifest);
  let reused = 0;
  for (const file of selection.documents) {
    signal?.throwIfAborted();
    const destination = await target(backups.directory, selection.config, {
      kind: "document",
      name: `imports/${selection.packageHash}/${file.path.slice(10)}`,
    });
    const existingHash = await fileHash(destination);
    if (existingHash && existingHash !== file.sha256)
      fail(
        "A previously imported document has changed. Create a new package before importing it again.",
        409,
      );
    if (existingHash) reused++;
  }
  return {
    kind: "merge",
    id,
    created: new Date().toISOString(),
    checksumVerified: true,
    revision: selection.revision,
    packageHash: selection.packageHash,
    title:
      typeof manifest.title === "string" ? manifest.title.slice(0, 180) : "",
    sections: selection.metadata.selection?.parts || [],
    contexts: selection.metadata.selection?.contexts.length || 0,
    records: selection.rows,
    documents: selection.documents.length,
    reused,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    issue: selection.issue,
  };
}

async function rollback(directory, config, transaction, entries) {
  for (const [index, entry] of [...entries.entries()].reverse()) {
    const file = await target(directory, config, entry);
    await fs.rm(
      file + `.${path.basename(path.dirname(transaction))}.package-tmp`,
      { force: true },
    );
    const actual = await fileHash(file);
    if (actual === entry.before) continue;
    if (actual !== entry.after)
      fail(
        "Package recovery found an externally changed file. Keep the operations directory for manual recovery.",
        409,
      );
    if (entry.before == null) await fs.unlink(file);
    else {
      const previous = path.join(transaction, `before-${index}`);
      if ((await hashFile(previous)) !== entry.before)
        fail("Invalid package recovery journal.");
      const temp = file + ".package-recovery.tmp";
      await fs.copyFile(previous, temp);
      await fs.rename(temp, file);
    }
  }
}
export async function recoverPackage(directory) {
  const root = operationRoot(directory),
    marker = path.join(root, "package-journal.json");
  const rootStat = await exists(root);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()))
    fail("Invalid package recovery journal.");
  if (!(await exists(marker))) {
    // A crash during validation happened before any library writes.
    if (await exists(root))
      for (const entry of await fs.readdir(root, { withFileTypes: true }))
        if (UUID.test(entry.name) && entry.isDirectory())
          await fs.rm(path.join(root, entry.name, "merge-active.json"), {
            force: true,
          });
    return;
  }
  const { id, transactionId } = JSON.parse(await fs.readFile(marker, "utf8"));
  if (!UUID.test(id) || !UUID.test(transactionId))
    fail("Invalid package recovery journal.");
  const stage = path.join(root, id),
    transaction = path.join(stage, transactionId);
  for (const folder of [stage, transaction]) {
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail("Invalid package recovery journal.");
  }
  if (!(await exists(path.join(stage, "completed.json")))) {
    const journal = JSON.parse(
      await fs.readFile(path.join(transaction, "journal.json"), "utf8"),
    );
    if (!Array.isArray(journal.entries) || journal.entries.length > 50000)
      fail("Invalid package recovery journal.");
    for (const entry of journal.entries)
      if (
        !entry ||
        !/^[a-f0-9]{64}$/.test(entry.after) ||
        (entry.before !== null && !/^[a-f0-9]{64}$/.test(entry.before))
      )
        fail("Invalid package recovery journal.");
    const config = await new Settings(directory, false).read();
    if (config.documentRoot !== journal.documentRoot)
      fail("Invalid package recovery journal.");
    for (const entry of journal.entries) await target(directory, config, entry);
    await rollback(directory, config, transaction, journal.entries);
    await writeJSON(path.join(stage, "merge-result.json"), {
      phase: "error",
      error:
        "The interrupted package import was rolled back. Preview and import it again.",
    });
  } else {
    const result = JSON.parse(
      await fs.readFile(path.join(stage, "completed.json"), "utf8"),
    );
    if (result.phase !== "complete") fail("Invalid package recovery journal.");
    await writeJSON(path.join(stage, "merge-result.json"), result);
  }
  await fs.rm(path.join(stage, "merge-active.json"), { force: true });
  await fs.unlink(marker);
}

export class PackageImports {
  constructor(backups, mutate, transfers) {
    Object.assign(this, { backups, mutate, transfers });
    this.jobs = new Map();
    this.pending = Promise.resolve();
  }
  async plan(id) {
    if (!UUID.test(id)) fail("Invalid restore ID.");
    const plan = JSON.parse(
      await fs.readFile(path.join(this.backups.root, id, "plan.json"), "utf8"),
    );
    if (plan.kind !== "merge" || plan.id !== id)
      fail("Use a data package for this import.");
    return plan;
  }
  async status(id) {
    if (!UUID.test(id)) fail("Invalid restore ID.");
    const job = this.jobs.get(id);
    if (job) return job.status;
    const result = path.join(this.backups.root, id, "merge-result.json");
    return (await exists(result))
      ? JSON.parse(await fs.readFile(result, "utf8"))
      : { phase: "idle" };
  }
  async start(id, input) {
    const previous = await this.status(id);
    if (["applying", "complete"].includes(previous.phase)) return previous;
    await this.plan(id);
    // Another request may have reserved this operation while the plan was read.
    const reserved = this.jobs.get(id);
    if (reserved && ["applying", "complete"].includes(reserved.status.phase))
      return reserved.status;
    const job = { status: { phase: "applying", completed: 0, total: null } };
    this.jobs.set(id, job);
    job.promise = this.mutate(() => this.apply(id, input, job)).catch(
      async (error) => {
        job.status = {
          phase: "error",
          error: error.status
            ? error.message
            : "The package could not be imported. Check storage space and try again.",
        };
        console.error(error.message);
        await writeJSON(
          path.join(this.backups.root, id, "merge-result.json"),
          job.status,
        ).catch(() => {});
      },
    );
    this.pending = Promise.allSettled(
      [...this.jobs.values()].map((j) => j.promise),
    );
    return job.status;
  }
  wait() {
    return this.pending;
  }
  async apply(id, input, job) {
    const b = this.backups,
      stage = path.join(b.root, id),
      plan = await this.plan(id);
    const active = path.join(stage, "merge-active.json");
    await writeJSON(active, { id });
    const marker = path.join(b.root, "package-journal.json");
    let journalWritten = false,
      committed = false,
      rolledBack = false;
    const transactionId = randomUUID(),
      transaction = path.join(stage, transactionId);
    let selected,
      entries = [];
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(stage, "extracted/manifest.json"), "utf8"),
      );
      selected = await select(b, id, manifest, input);
      if (
        plan.revision !== input.revision ||
        selected.revision !== plan.revision
      )
        fail(
          "The library changed after the package preview. Refresh the preview before importing.",
          409,
        );
      if (selected.issue) fail(selected.issue);
      await fs.mkdir(transaction);
      for (const file of manifest.files) {
        packagePath(file.path);
        if (
          (await hashFile(
            await safePath(path.join(stage, "extracted"), file.path),
          )) !== file.sha256
        )
          fail("Staged package files changed after preview.", 409);
      }
      for (const file of selected.documents) {
        const entry = {
          kind: "document",
          name: `imports/${selected.packageHash}/${file.path.slice(10)}`,
          before: null,
          after: file.sha256,
          source: path.join(stage, "extracted", ...file.path.split("/")),
        };
        const existing = await fileHash(
          await target(b.directory, selected.config, entry),
        );
        if (existing === file.sha256) continue;
        if (existing)
          fail(
            "A previously imported document has changed. Create a new package before importing it again.",
            409,
          );
        entries.push(entry);
      }
      for (const { next, old } of selected.selected) {
        const raw = serialize(next);
        if (Buffer.byteLength(raw) > 1100000) fail("The file is too large.");
        entries.push({
          kind: "record",
          name: `${next.id}.md`,
          before: old?.revision || null,
          after: digest(raw),
          raw,
        });
      }
      entries.push(...(await metadataEntries(b.directory, selected)));
      for (const [index, entry] of entries.entries()) {
        if (entry.before) {
          const original = await target(b.directory, selected.config, entry);
          await fs.copyFile(
            original,
            path.join(transaction, `before-${index}`),
          );
          if (
            (await hashFile(path.join(transaction, `before-${index}`))) !==
            entry.before
          )
            fail(
              "The library changed after the package preview. Refresh the preview before importing.",
              409,
            );
        }
        if (entry.raw != null)
          await fs.writeFile(
            path.join(transaction, `after-${index}`),
            entry.raw,
            { flush: true },
          );
      }
      const latest = await select(b, id, manifest, input);
      if (latest.revision !== selected.revision)
        fail(
          "The library changed after the package preview. Refresh the preview before importing.",
          409,
        );
      const journalEntries = entries.map(({ source, raw, ...entry }) => entry);
      await writeJSON(path.join(transaction, "journal.json"), {
        documentRoot: selected.config.documentRoot,
        entries: journalEntries,
      });
      if (await exists(marker))
        fail("The package import is still running.", 409);
      await writeJSON(marker, { id, transactionId });
      journalWritten = true;
      job.status.total = entries.length;
      for (const [index, entry] of entries.entries()) {
        const destination = await target(
          b.directory,
          selected.config,
          entry,
          true,
        );
        if ((await fileHash(destination)) !== entry.before)
          fail(
            "The library changed after the package preview. Refresh the preview before importing.",
            409,
          );
        if (entry.before && entry.kind === "record") {
          const history = await historyDirectory(
            b.directory,
            ".history",
            entry.name.slice(0, -3),
          );
          await fs.copyFile(
            path.join(transaction, `before-${index}`),
            path.join(history, `${Date.now()}-${id}.md`),
            fs.constants.COPYFILE_EXCL,
          );
        }
        const temp = destination + `.${id}.package-tmp`;
        try {
          await fs.copyFile(
            entry.source || path.join(transaction, `after-${index}`),
            temp,
            fs.constants.COPYFILE_EXCL,
          );
          if ((await hashFile(temp)) !== entry.after)
            fail("Staged package files changed after preview.", 409);
          if ((await fileHash(destination)) !== entry.before)
            fail(
              "The library changed after the package preview. Refresh the preview before importing.",
              409,
            );
          if (entry.before) await fs.rename(temp, destination);
          else await fs.link(temp, destination);
        } finally {
          await fs.rm(temp, { force: true });
        }
        job.status.completed++;
      }
      const result = {
        phase: "complete",
        added: selected.selected.filter((n) => !n.old).length,
        replaced: selected.selected.filter((n) => n.old).length,
        kept: selected.rows.length - selected.selected.length,
        documents: entries.filter((e) => e.kind === "document").length,
      };
      await writeJSON(path.join(stage, "completed.json"), result);
      committed = true;
      await writeJSON(path.join(stage, "merge-result.json"), result);
    } catch (error) {
      if (journalWritten && !committed) {
        try {
          await rollback(b.directory, selected.config, transaction, entries);
          rolledBack = true;
        } catch (recoveryError) {
          this.recoveryRequired = true;
          throw recoveryError;
        }
      }
      if (committed) console.error(error.message);
      else throw error;
    } finally {
      // Keep the recovery marker if rollback itself failed.
      if (committed || !journalWritten || rolledBack) {
        if (journalWritten) await fs.rm(marker, { force: true });
        await fs.rm(active, { force: true });
      }
    }
    try {
      for (const session of this.transfers.sessions.values())
        if (session.preview?.id === id)
          await this.transfers.remove(session.id, { keepPreview: true });
      await fs.rm(path.join(stage, "extracted"), {
        recursive: true,
        force: true,
      });
      await fs.rm(transaction, { recursive: true, force: true });
    } catch (error) {
      console.error(error.message);
    }
    job.status = JSON.parse(
      await fs.readFile(path.join(stage, "completed.json"), "utf8"),
    );
  }
}
