import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fail, parseMarkdown } from "./store.js";
import { digest } from "./settings.js";
import { safePath } from "./documents.js";

const ID = /^[a-z0-9][a-z0-9_-]{0,119}$/;
export const taskDataPath = (name) =>
  /^comments\/[a-z0-9][a-z0-9_-]{0,119}\.json$/.test(name) ||
  /^activity\/[a-z0-9][a-z0-9_-]{0,119}\/[a-f0-9-]{36}\.json$/.test(name);
export function validateTaskData(name, data) {
  if (!taskDataPath(name) || data?.schema !== 1)
    fail("Invalid task discussion data.");
  if (name.startsWith("comments/")) {
    if (!Array.isArray(data.entries) || data.entries.length > 10000)
      fail("Invalid task comments.");
    const ids = new Set();
    for (const c of data.entries) {
      if (
        !ID.test(c.id || "") ||
        ids.has(c.id) ||
        typeof c.body !== "string" ||
        c.body.length > 20000 ||
        !Number.isFinite(Date.parse(c.created)) ||
        !Number.isFinite(Date.parse(c.updated)) ||
        typeof c.deleted !== "boolean"
      )
        fail("Invalid task comment.");
      ids.add(c.id);
    }
  } else if (
    !ID.test(data.id || "") ||
    !name.endsWith(`/${data.id}.json`) ||
    !["edit", "undo", "redo", "detected"].includes(data.source) ||
    !Number.isFinite(Date.parse(data.at)) ||
    !Array.isArray(data.fields) ||
    data.fields.some((s) => typeof s !== "string" || s.length > 120)
  )
    fail("Invalid task activity.");
  return data;
}
export class TaskData {
  constructor(directory) {
    this.directory = directory;
    this.cache = new Map();
    this.observed = new Map();
    this.observing = Promise.resolve();
  }
  async read(name, fallback) {
    try {
      const file = await safePath(this.directory, name);
      const stat = await fs.stat(file);
      if (stat.size > 32 * 1024 ** 2)
        fail("Task discussion data exceeds the supported file size.");
      const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (this.cache.get(name)?.stamp === stamp)
        return this.cache.get(name).value;
      const value = validateTaskData(
        name,
        JSON.parse(await fs.readFile(file, "utf8")),
      );
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(name, { stamp, value });
      return value;
    } catch (e) {
      if (e.code === "ENOENT" || e.status === 404) return fallback;
      throw e;
    }
  }
  async write(name, value) {
    validateTaskData(name, value);
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > 32 * 1024 ** 2)
      fail("Task discussion data exceeds the supported file size.");
    const file = await safePath(this.directory, name, { create: true });
    const tmp = file + `.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, raw, { flag: "wx", flush: true });
      await fs.rename(tmp, file);
      this.cache.delete(name);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }
  async comments(id) {
    if (!ID.test(id)) fail("Invalid record ID.");
    const value = await this.read(`comments/${id}.json`, {
      schema: 1,
      entries: [],
    });
    return { ...value, revision: digest(JSON.stringify(value)) };
  }
  async comment(id, input) {
    const current = await this.comments(id);
    if (input.revision !== current.revision)
      fail(
        "Comments changed. Reload them before saving; your draft is preserved.",
        409,
      );
    const now = new Date().toISOString();
    let found = false;
    const entries = current.entries.map((c) => {
      if (c.id !== input.id) return c;
      found = true;
      return {
        ...c,
        body: input.body ?? c.body,
        deleted: input.deleted ?? c.deleted,
        updated: now,
      };
    });
    if (input.id && !found) fail("The comment does not exist.", 404);
    if (!input.id)
      entries.push({
        id: randomUUID(),
        body: input.body,
        created: now,
        updated: now,
        deleted: false,
      });
    if (
      (!found || input.body !== undefined) &&
      (typeof input.body !== "string" || !input.body.trim())
    )
      fail("Enter a comment.");
    await this.write(`comments/${id}.json`, { schema: 1, entries });
    return this.comments(id);
  }
  // Durable events are independent of the bounded undo stack. The undo journal
  // replays this idempotent outbox after a crash between commit and event writes.
  async audit(changes, event) {
    const records = new Map();
    for (const change of changes) {
      if (
        change.target.kind === "metadata" &&
        change.target.name === "list-order.json"
      )
        for (const id of event.recordIds ||
          (event.recordId ? [event.recordId] : []))
          records.set(id, [...(records.get(id) || []), "order"]);
      const id = change.target.id;
      if (!id) continue;
      let fields;
      if (change.target.kind === "record") {
        const before = change.before ? parseMarkdown(change.before) : {};
        const after = change.after ? parseMarkdown(change.after) : {};
        if (before.type !== "task" && after.type !== "task") continue;
        this.observed.set(
          id,
          change.after === null ? null : digest(change.after),
        );
        fields = [
          ...new Set([...Object.keys(before), ...Object.keys(after)]),
        ].filter(
          (k) =>
            !["updated", "revision"].includes(k) &&
            JSON.stringify(before[k]) !== JSON.stringify(after[k]),
        );
      } else fields = [change.target.kind];
      if (fields.length)
        records.set(id, [...new Set([...(records.get(id) || []), ...fields])]);
    }
    for (const [id, fields] of records) {
      const name = `activity/${id}/${event.id}.json`;
      if (!(await this.read(name, null)))
        await this.write(name, { schema: 1, ...event, fields });
    }
  }
  observe(nodes) {
    const work = this.observing.then(async () => {
      for (const node of nodes) {
        if (node.type !== "task") continue;
        const previous = this.observed.get(node.id);
        if (previous !== undefined && previous !== node.revision) {
          const id = randomUUID();
          await this.write(`activity/${node.id}/${id}.json`, {
            schema: 1,
            id,
            at: new Date().toISOString(),
            source: "detected",
            fields: ["record"],
          });
        }
        this.observed.set(node.id, node.revision);
      }
    });
    this.observing = work.catch(() => {});
    return work;
  }
  async activity(id, before = "") {
    if (!ID.test(id)) fail("Invalid record ID.");
    let names;
    try {
      names = await fs.readdir(
        await safePath(this.directory, `activity/${id}`),
      );
    } catch (e) {
      if (e.code === "ENOENT" || e.status === 404)
        return { entries: [], next: null };
      throw e;
    }
    const events = [];
    for (const name of names)
      if (taskDataPath(`activity/${id}/${name}`))
        events.push(await this.read(`activity/${id}/${name}`));
    events.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const matching = events.filter(
      (e) => !before || `${e.at}|${e.id}` < before,
    );
    const entries = matching.slice(0, 50),
      last = entries.at(-1);
    return {
      entries,
      next: matching.length > 50 ? `${last.at}|${last.id}` : null,
    };
  }
}
