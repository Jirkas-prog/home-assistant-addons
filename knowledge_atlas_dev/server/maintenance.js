import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Store,
  parseMarkdown,
  serialize,
  upgradeNode,
  validateNode,
  validateGraph,
  fail,
} from "./store.js";
import { digest, Settings, locationId } from "./settings.js";
import { operationRoot, fingerprint } from "./backups.js";
import { graphIssues } from "../shared/schema.js";
import { historyDirectory } from "./file-safety.js";

export class Maintenance {
  constructor(store, settings, backups) {
    Object.assign(this, { store, settings, backups });
  }
  async migrationPreview() {
    const snapshot = await this.store.read();
    const config = await this.settings.read();
    return {
      from: 1,
      to: 2,
      revision: digest(snapshot.revision + config.revision),
      errors: snapshot.errors,
      files: snapshot.nodes
        .filter((n) => n.schema === 1)
        .map((n) => ({
          file: n.file,
          id: n.id,
          attachments: n.resources.length,
        })),
    };
  }
  async migrate(revision) {
    const plan = await this.migrationPreview();
    if (revision !== plan.revision)
      fail("The library changed after migration preview.", 409);
    if (plan.errors.length) fail("Repair invalid files before migrating.", 409);
    if (!plan.files.length) return { ok: true, changed: 0 };
    return this.transaction(async (candidate) => {
      const stagedStore = new Store(candidate);
      for (const node of (await stagedStore.read()).nodes)
        if (node.schema === 1)
          await fs.writeFile(
            path.join(candidate, node.file),
            serialize(upgradeNode(node)),
          );
      return plan.files.length;
    });
  }
  async transaction(change) {
    const id = randomUUID(),
      root = operationRoot(this.store.directory),
      stage = path.join(root, id),
      candidate = path.join(stage, "migrated-library"),
      rollback = path.join(stage, "previous-library");
    await fs.mkdir(stage, { recursive: true });
    const config = await this.settings.read();
    const before = await fingerprint(this.store.directory, config);
    // Complete, independently restorable backup precedes any migration write.
    await this.backups.export(
      createWriteStream(path.join(stage, "before-migration.zip"), {
        flags: "wx",
      }),
    );
    await fs.cp(this.store.directory, candidate, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const changed = await change(candidate);
    const verify = await new Store(candidate).read();
    if (verify.errors.length)
      fail("The migrated library did not pass validation.", 409);
    await new Settings(candidate, false).read();
    if (before !== (await fingerprint(this.store.directory, config)))
      fail(
        "The library changed during migration. No files were replaced.",
        409,
      );
    const journal = path.join(root, "restore-journal.json");
    await fs.writeFile(journal, JSON.stringify({ id }), { flag: "wx" });
    try {
      await fs.rename(this.store.directory, rollback);
      try {
        await fs.rename(candidate, this.store.directory);
      } catch (error) {
        await fs.rename(rollback, this.store.directory);
        throw error;
      }
    } finally {
      if (await fs.stat(this.store.directory).catch(() => null))
        await fs.unlink(journal);
    }
    return {
      ok: true,
      changed,
      backup: path.join(stage, "before-migration.zip"),
      rollbackDirectory: rollback,
    };
  }
  async replaceLocation(id, target, revision) {
    const config = await this.settings.read();
    if (revision !== config.revision)
      fail("The settings have changed. Close and reopen settings.", 409);
    const source = config.locations.find((l) => l.id === id),
      destination = config.locations.find((l) => l.id === target);
    if (
      !source ||
      !destination ||
      source.id === target ||
      source.kind !== "physical" ||
      destination.kind !== "physical"
    )
      fail("Choose two different physical places.");
    if ((await this.store.read()).errors.length)
      fail("Repair the file errors first.", 409);
    const replacement = {
      ...config,
      locations: config.locations
        .filter((l) => l.id !== id)
        .map((l) => (l.parentId === id ? { ...l, parentId: target } : l)),
    };
    this.settings.validate(replacement);
    return this.transaction(async (candidate) => {
      const staged = new Store(candidate);
      let changed = 0;
      for (const n of (await staged.read()).nodes) {
        const updated = {
          ...n,
          resources: n.resources.map((r) =>
            locationId(r) === id ? { ...r, locationId: target } : r,
          ),
          ...(n.stock
            ? {
                stock: {
                  ...n.stock,
                  placements: n.stock.placements.map((p) =>
                    p.locationId === id ? { ...p, locationId: target } : p,
                  ),
                },
              }
            : {}),
        };
        if (JSON.stringify(updated) !== JSON.stringify(n)) {
          await fs.writeFile(path.join(candidate, n.file), serialize(updated));
          changed++;
        }
      }
      const { revision: ignored, ...saved } = replacement;
      await fs.writeFile(
        path.join(candidate, "settings.json"),
        JSON.stringify(saved, null, 2) + "\n",
      );
      return changed;
    });
  }
  filePath(name) {
    if (
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,180}$/.test(name) ||
      (name !== "settings.json" && !name.endsWith(".md"))
    )
      fail("Choose a record file or settings.json.");
    return path.join(this.store.directory, name);
  }
  async raw(name) {
    const file = this.filePath(name),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000)
      fail("This file cannot be repaired in the editor.");
    const body = await fs.readFile(file, "utf8");
    return { file: name, body, revision: digest(body) };
  }
  async repair(name, body, revision) {
    if (typeof body !== "string" || Buffer.byteLength(body) > 2_000_000)
      fail("The repair text is too large.");
    const current = await this.raw(name);
    if (revision !== current.revision)
      fail("The file changed. Reload the repair editor.", 409);
    if (name === "settings.json") {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        fail("Settings must contain valid JSON.");
      }
      this.settings.validate(parsed);
      const ids = new Set(parsed.locations.map((l) => l.id));
      for (const n of (await this.store.read()).nodes)
        for (const r of [...n.resources, ...(n.stock?.placements || [])])
          if (r.locationId && !ids.has(r.locationId))
            fail("The repair would remove a location in use.");
    } else {
      const node = validateNode(parseMarkdown(body));
      const config = await this.settings.read();
      for (const p of node.stock?.placements || [])
        if (
          !config.locations.some(
            (l) => l.id === p.locationId && l.kind === "physical",
          )
        )
          fail("Inventory placements require an existing physical place.");
      if (name !== `${node.id}.md`)
        fail("The filename must match the record ID.");
      const { nodes } = await this.store.read();
      const existing = new Set(graphIssues(nodes).map((e) => e.key));
      const added = graphIssues([
        ...nodes.filter((n) => n.file !== name),
        node,
      ]).filter((e) => !existing.has(e.key));
      if (added.length) fail(added[0].message);
    }
    const file = this.filePath(name),
      history = path.join(this.store.directory, ".history", "repairs"),
      tmp = file + "." + randomUUID() + ".tmp";
    await historyDirectory(this.store.directory, ".history", "repairs");
    await fs.writeFile(
      path.join(history, `${Date.now()}-${randomUUID()}-${name}`),
      current.body,
      { flag: "wx" },
    );
    await fs.writeFile(tmp, body, { flag: "wx" });
    try {
      if ((await this.raw(name)).revision !== revision)
        fail("The file changed during repair.", 409);
      await fs.rename(tmp, file);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
    return this.raw(name);
  }
  async diagnostics() {
    const snapshot = await this.store.read();
    let config;
    try {
      config = await this.settings.read();
    } catch (error) {
      snapshot.errors.push({ file: "settings.json", message: error.message });
    }
    const storage = await fs.statfs(this.store.directory).catch(() => null);
    return {
      checkedAt: new Date().toISOString(),
      records: snapshot.nodes.length,
      schemaVersions: [...new Set(snapshot.nodes.map((n) => n.schema))],
      errors: snapshot.errors,
      freeBytes: storage ? storage.bavail * storage.bsize : null,
      dataDirectory: this.store.directory,
      documentRoot: config?.documentRoot || null,
      operationsDirectory: operationRoot(this.store.directory),
    };
  }
}
