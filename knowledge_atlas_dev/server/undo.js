import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { historyDirectory } from "./file-safety.js";
import { fail } from "../shared/schema.js";
import { safePath } from "./documents.js";
import { parseMarkdown } from "./store.js";

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const UUID = /^[a-f0-9-]{36}$/;
const LIMIT = 1000,
  BUDGET = 256 * 1024 ** 2,
  FILE_LIMIT = 32 * 1024 ** 2;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const invalid = () =>
  fail(
    "The undo history is damaged. Restore it from a backup before editing.",
    409,
  );
const conflict = () =>
  fail(
    "The affected data changed outside this history. No changes were overwritten.",
    409,
  );

function changedFields(changes) {
  const fields = new Set();
  for (const { target, before, after } of changes) {
    if (before === null || after === null) continue;
    try {
      if (target.kind === "record" || target.name === "settings.json") {
        const parse = target.kind === "record" ? parseMarkdown : JSON.parse;
        const previous = parse(before),
          next = parse(after);
        for (const key of new Set([
          ...Object.keys(previous),
          ...Object.keys(next),
        ]))
          if (
            !["updated", "revision", "created", "schema", "id"].includes(key) &&
            JSON.stringify(previous[key]) !== JSON.stringify(next[key])
          )
            fields.add(key.slice(0, 64));
      } else fields.add(target.kind);
    } catch {
      fields.add(target.kind);
    }
  }
  return [...fields].slice(0, 32);
}

// The existing mutation queue serializes edits and travel. Only touched text
// files are captured; attachments are never copied with a map move or a rating.
export class UndoHistory {
  constructor(directory, { document, validate, audit } = {}) {
    this.directory = directory;
    this.document = document;
    this.validate = validate;
    this.audit = audit || (async () => {});
    this.context = new AsyncLocalStorage();
  }
  async folder() {
    return historyDirectory(this.directory, ".history", "actions");
  }
  async readFile(file, limit = FILE_LIMIT) {
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
      fail(
        "Undo targets must be regular files within the supported size limit.",
        409,
      );
    return fs.readFile(file, "utf8");
  }
  async rootIdentity() {
    const stat = await fs.stat(this.directory, { bigint: true });
    return hash(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
  }
  empty(root) {
    return { schema: 1, root, revision: randomUUID(), entries: [], cursor: 0 };
  }
  async state() {
    const root = await this.rootIdentity();
    const folder = await this.folder(),
      file = path.join(folder, "index.json");
    const raw = await this.readFile(file, 4_000_000);
    if (this.cached?.raw === raw && this.cached.value.root === root)
      return this.cached.value;
    let state;
    try {
      state = raw === null ? this.empty(root) : JSON.parse(raw);
    } catch {
      invalid();
    }
    if (
      state?.schema !== 1 ||
      typeof state.root !== "string" ||
      !UUID.test(state.revision) ||
      !Array.isArray(state.entries) ||
      state.entries.length > LIMIT ||
      !Number.isInteger(state.cursor) ||
      state.cursor < 0 ||
      state.cursor > state.entries.length ||
      state.entries.some(
        (e) =>
          !UUID.test(e.id) ||
          !Number.isSafeInteger(e.bytes) ||
          e.bytes < 0 ||
          e.bytes > BUDGET ||
          ![
            "record",
            "create",
            "archive",
            "order",
            "map",
            "settings",
            "document",
          ].includes(e.kind) ||
          typeof e.title !== "string" ||
          e.title.length > 240 ||
          (e.at !== undefined &&
            (typeof e.at !== "string" || !Number.isFinite(Date.parse(e.at)))) ||
          (e.fields !== undefined &&
            (!Array.isArray(e.fields) ||
              e.fields.length > 32 ||
              e.fields.some(
                (field) => typeof field !== "string" || field.length > 64,
              ))),
      ) ||
      new Set(state.entries.map((e) => e.id)).size !== state.entries.length
    )
      invalid();
    // A full restore or library replacement starts a new history boundary.
    // Never replay old document roots from another installation.
    const fresh = raw === null || state.root !== root;
    if (state.root !== root) state = this.empty(root);
    this.cached = { raw, value: state, fresh };
    return state;
  }
  describe(state) {
    return {
      revision: state.revision,
      undo: state.cursor,
      redo: state.entries.length - state.cursor,
      limit: LIMIT,
      undoAction: state.entries[state.cursor - 1] || null,
      redoAction: state.entries[state.cursor] || null,
    };
  }
  async status() {
    return {
      ...this.describe(await this.state()),
      ...(this.recoveryError ? { error: this.recoveryError } : {}),
    };
  }
  async history(offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > LIMIT)
      fail("Invalid history page.");
    const state = await this.state(),
      limit = 40;
    offset = Math.min(
      offset,
      Math.max(0, Math.ceil(state.entries.length / limit) - 1) * limit,
    );
    return {
      ...this.describe(state),
      ...(this.recoveryError ? { error: this.recoveryError } : {}),
      offset,
      total: state.entries.length,
      next: offset + limit < state.entries.length ? offset + limit : null,
      previous: offset ? Math.max(0, offset - limit) : null,
      entries: state.entries
        .toReversed()
        .slice(offset, offset + limit)
        .map((entry, i) => {
          const index = state.entries.length - 1 - offset - i;
          const applied = index < state.cursor;
          return {
            ...entry,
            applied,
            direction: applied ? "undo" : "redo",
            steps: applied ? state.cursor - index : index - state.cursor + 1,
          };
        }),
    };
  }
  async atomic(file, body) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, body, { flag: "wx", flush: true });
      await fs.rename(temporary, file);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }
  async saveState(state) {
    await this.atomic(
      path.join(await this.folder(), "index.json"),
      JSON.stringify(state),
    );
    this.cached = null;
  }
  async pruneEntries(entries) {
    const folder = await this.folder();
    const kept = new Set(entries.map((entry) => `${entry.id}.json.gz`));
    for (const name of await fs.readdir(folder))
      if (/^[a-f0-9-]{36}\.json\.gz$/.test(name) && !kept.has(name))
        await fs.unlink(path.join(folder, name)).catch(() => {});
  }
  async packed(name, value) {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > 128 * 1024 ** 2)
      fail("This change is too large for undo history.");
    const bytes = await compress(raw);
    await this.atomic(path.join(await this.folder(), name), bytes);
    return bytes.length;
  }
  async unpack(name) {
    const file = path.join(await this.folder(), name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BUDGET)
      invalid();
    try {
      return JSON.parse(
        await decompress(await fs.readFile(file), {
          maxOutputLength: 128 * 1024 ** 2,
        }),
      );
    } catch {
      invalid();
    }
  }
  async target(spec) {
    if (!spec || typeof spec !== "object") invalid();
    if (spec.kind === "comments" && ID.test(spec.id))
      return safePath(this.directory, `comments/${spec.id}.json`, {
        create: true,
      });
    if (
      spec.kind === "record" &&
      typeof spec.id === "string" &&
      ID.test(spec.id)
    )
      return path.join(this.directory, `${spec.id}.md`);
    if (
      spec.kind === "metadata" &&
      ["settings.json", "list-order.json", "map-positions.json"].includes(
        spec.name,
      )
    )
      return path.join(this.directory, spec.name);
    if (
      spec.kind === "document" &&
      ID.test(spec.id) &&
      ID.test(spec.resourceId) &&
      /^[a-f0-9]{64}$/.test(spec.binding)
    ) {
      const resolved = await this.document(spec);
      if (!resolved.editable || hash(resolved.file) !== spec.binding)
        conflict();
      return resolved.file;
    }
    invalid();
  }
  async watch(spec, label, resolvedFile) {
    const context = this.context.getStore();
    if (!context) return;
    if (resolvedFile) spec = { ...spec, binding: hash(resolvedFile) };
    const key = JSON.stringify(spec);
    if (context.changes.has(key)) return;
    const file = await this.target(spec),
      before = await this.readFile(file);
    if (this.cached?.fresh) await this.saveState(context.state);
    context.changes.set(key, { target: spec, before });
    context.label ||= {
      kind: label.kind,
      title: String(label.title || "").slice(0, 240),
      ...(label.recordId ? { recordId: label.recordId } : {}),
    };
    await this.packed("pending.json.gz", {
      mode: "edit",
      root: context.state.root,
      revision: context.state.revision,
      changes: [...context.changes.values()].map(
        ({ written, ...change }) => change,
      ),
    });
  }
  async confirmWrites() {
    const context = this.context.getStore();
    if (!context) return;
    for (const change of context.changes.values())
      change.written = await this.readFile(await this.target(change.target));
  }
  async changes(value, complete = true) {
    if (!Array.isArray(value) || value.length > 10000) invalid();
    const seen = new Set(),
      result = [];
    for (const change of value) {
      if (
        !change ||
        (change.before !== null && typeof change.before !== "string") ||
        (complete && change.after !== null && typeof change.after !== "string")
      )
        invalid();
      const file = await this.target(change.target);
      if (seen.has(file)) invalid();
      seen.add(file);
      result.push({ ...change, file });
    }
    return result;
  }
  async replace(file, value, expected) {
    if ((await this.readFile(file)) !== expected) conflict();
    if (value === null) await fs.unlink(file);
    else await this.atomic(file, value);
  }
  async recover() {
    try {
      await this.recoverPending();
      this.recoveryError = "";
    } catch (error) {
      this.recoveryError = error.message;
      throw error;
    }
  }
  async recoverPending() {
    const folder = await this.folder(),
      pendingFile = path.join(folder, "pending.json.gz");
    try {
      await fs.lstat(pendingFile);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const pending = await this.unpack("pending.json.gz"),
      state = await this.state();
    if (!UUID.test(pending.revision)) invalid();
    if (!/^[a-f0-9]{64}$/.test(pending.root)) invalid();
    if (pending.root !== state.root) {
      await fs.rename(
        pendingFile,
        path.join(folder, `interrupted-${randomUUID()}.json.gz`),
      );
      return;
    }
    if (pending.mode === "travel") {
      if (!UUID.test(pending.nextRevision)) invalid();
      if (state.revision !== pending.nextRevision) {
        if (state.revision !== pending.revision) invalid();
        const changes = await this.changes(pending.changes);
        // Validate every target before rolling back any partially completed step.
        for (const change of changes) {
          const current = await this.readFile(change.file);
          if (current !== change.before && current !== change.after) conflict();
        }
        for (const change of changes.toReversed())
          if ((await this.readFile(change.file)) !== change.before)
            await this.replace(change.file, change.before, change.after);
      }
    } else if (pending.mode === "edit") {
      if (state.revision === pending.revision) {
        const changes = await this.changes(pending.changes, false);
        let changed = false;
        for (const change of changes)
          changed ||= (await this.readFile(change.file)) !== change.before;
        if (changed) {
          // An interrupted edit has no verified after-image. Preserve its before
          // images for recovery instead of guessing and overwriting external edits.
          await fs.copyFile(
            pendingFile,
            path.join(folder, `interrupted-${randomUUID()}.json.gz`),
          );
          await this.saveState(this.empty(state.root));
        }
      }
    } else invalid();
    if (pending.audit && state.revision === pending.nextRevision)
      await this.audit(pending.changes, pending.audit);
    await fs.unlink(pendingFile);
  }
  async record(fn) {
    await this.recover();
    const state = await this.state();
    const context = { state, changes: new Map(), label: null };
    let completed,
      result,
      completedFn = false;
    try {
      result = await this.context.run(context, fn);
      completedFn = true;
      completed = [];
      for (const change of context.changes.values()) {
        const after = await this.readFile(await this.target(change.target));
        const { written, ...saved } = change;
        if (change.before !== after) completed.push({ ...saved, after });
      }
      if (completed.length) {
        const id = randomUUID(),
          bytes = await this.packed(`${id}.json.gz`, { changes: completed });
        const nextRevision = randomUUID();
        const audit = {
          id,
          at: new Date().toISOString(),
          source: "edit",
          ...(context.label?.recordId
            ? { recordId: context.label.recordId }
            : {}),
        };
        await this.packed("pending.json.gz", {
          mode: "edit",
          root: state.root,
          revision: state.revision,
          nextRevision,
          changes: completed,
          audit,
        });
        const entries = [
          ...state.entries.slice(0, state.cursor),
          {
            id,
            bytes,
            ...context.label,
            at: audit.at,
            fields: changedFields(completed),
          },
        ];
        let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
        while (entries.length > LIMIT || (total > BUDGET && entries.length > 1))
          total -= entries.shift().bytes;
        await this.saveState({
          ...state,
          revision: nextRevision,
          entries,
          cursor: entries.length,
        });
        await this.audit(completed, audit);
        await this.pruneEntries(entries);
      }
      if (context.changes.size)
        await fs.unlink(path.join(await this.folder(), "pending.json.gz"));
      return result;
    } catch (error) {
      if (!completed)
        completed = [...context.changes.values()]
          .filter(
            (change) =>
              change.written !== undefined && change.written !== change.before,
          )
          .map(({ written, ...change }) => ({ ...change, after: written }));
      if (
        completed?.length &&
        (await this.state()).revision === state.revision
      ) {
        // If recording the successful edit fails, restore only our verified writes.
        const changes = await this.changes(completed);
        for (const change of changes.toReversed())
          await this.replace(change.file, change.before, change.after);
      }
      await this.recover();
      if (completedFn && (await this.state()).revision !== state.revision)
        return result;
      throw error;
    }
  }
  async clear() {
    await this.recover();
    const state = await this.state();
    await this.saveState(this.empty(state.root));
    await this.pruneEntries([]);
  }
  async travel(direction, revision, entryId) {
    await this.recover();
    const state = await this.state();
    if (!["undo", "redo"].includes(direction)) fail("Choose undo or redo.");
    if (revision !== state.revision)
      fail("The undo history changed. Refresh and try again.", 409);
    const cursor =
      entryId === undefined
        ? direction === "undo"
          ? state.cursor - 1
          : state.cursor
        : state.entries.findIndex((entry) => entry.id === entryId);
    const entry = state.entries[cursor];
    if (!entry) fail("There are no changes in this direction.", 409);
    if ((direction === "undo") !== cursor < state.cursor)
      fail("The undo history changed. Refresh and try again.", 409);
    const entries =
      direction === "undo"
        ? state.entries.slice(cursor, state.cursor).toReversed()
        : state.entries.slice(state.cursor, cursor + 1);
    // Compose the selected range before touching data. One transaction preserves
    // the existing rollback and crash recovery guarantees for multi-step travel.
    const combined = new Map();
    let combinedBytes = 0;
    for (const selected of entries) {
      const loaded = await this.unpack(`${selected.id}.json.gz`);
      for (const change of await this.changes(loaded.changes)) {
        if (direction === "undo")
          [change.before, change.after] = [change.after, change.before];
        const previous = combined.get(change.file);
        if (previous) {
          if (previous.after !== change.before) conflict();
          combinedBytes -= Buffer.byteLength(previous.after || "");
          previous.after = change.after;
        } else {
          combined.set(change.file, change);
          combinedBytes += Buffer.byteLength(change.before || "");
        }
        combinedBytes += Buffer.byteLength(change.after || "");
        if (combined.size > 10000 || combinedBytes > 128 * 1024 ** 2)
          fail("This change is too large for undo history.");
      }
    }
    for (const change of combined.values())
      if ((await this.readFile(change.file)) !== change.before) conflict();
    const changes = [...combined.values()].filter(
      (change) => change.before !== change.after,
    );
    await this.validate(changes);
    for (const change of changes)
      if ((await this.readFile(change.file)) !== change.before) conflict();
    const next = {
      ...state,
      revision: randomUUID(),
      cursor: direction === "undo" ? cursor : cursor + 1,
    };
    await this.packed("pending.json.gz", {
      mode: "travel",
      root: state.root,
      revision: state.revision,
      nextRevision: next.revision,
      changes: changes.map(({ file, ...change }) => change),
      audit: {
        id: next.revision,
        at: new Date().toISOString(),
        source: direction,
        ...(entry.recordId ? { recordId: entry.recordId } : {}),
        recordIds: [
          ...new Set(entries.map((item) => item.recordId).filter(Boolean)),
        ],
      },
    });
    try {
      for (const change of changes)
        await this.replace(change.file, change.after, change.before);
      await this.saveState(next);
      const pending = await this.unpack("pending.json.gz");
      await this.audit(changes, pending.audit);
    } catch (error) {
      await this.recover();
      throw error;
    }
    await fs.unlink(path.join(await this.folder(), "pending.json.gz"));
    return this.describe(next);
  }
}
