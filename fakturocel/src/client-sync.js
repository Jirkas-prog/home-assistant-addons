import { clone, validateState, validateDoc, packBackup, base64Bytes } from './model.js';
import { hashBytes } from './crypto.js';
import { LocalClient } from './local-client.js';
export const nativeClient = !!(globalThis.window?.fakturocelClient || globalThis.window?.FakturocelClientAndroid);
let count = 0;
const pending = new Map();
if (globalThis.window) window.clientReply = (id, r) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  r.ok ? p.resolve(r.result) : p.reject(Object.assign(Error(r.error || "Device operation failed."), {
    status: r.status || 0
  }));
};
const desktop = globalThis.window?.fakturocelClient;
export const bridge = desktop ? {
  call: async (name, arg) => {
    const r = await desktop.call(name, arg);
    if (!desktop.enveloped) return r;
    if (!r.ok) throw Object.assign(Error(r.error || "Device operation failed."), {
      status: r.status || 0
    });
    return r.result;
  }
} : {
  call: (name, arg) => new Promise((resolve, reject) => {
    const id = String(++count);
    pending.set(id, {
      resolve,
      reject
    });
    window.FakturocelClientAndroid.invoke(name, JSON.stringify(arg ?? null), id);
  })
};
export function project(cache) {
  const result = clone(cache.snapshot);
  if (!result) return null;
  for (const operation of cache.outbox) {
    for (const op of operation.ops) {
      const list = result.state[op.collection],
        i = list.findIndex(x => x.id === op.id);
      if (op.delete) {
        if (i >= 0) list.splice(i, 1);
      } else {
        const value = clone(op.value);
        if (op.collection === 'documents' && value.status === 'issued') value.status = 'draft';
        if (i < 0) list.push(value);else list[i] = value;
      }
      result.revisions[op.collection + ':' + op.id] = (result.revisions[op.collection + ':' + op.id] || 0) + 1;
      if (op.collection === 'documents' && op.value) {
        const key = op.value.type + ':' + op.value.number;
        if (!result.state.usedNumbers.includes(key)) result.state.usedNumbers.push(key);
      }
    }
  }
  result.revision = cache.viewRevision || result.revision;
  return result;
}
export class SyncClient {
  constructor(io) {
    this.io = io;
    this.cache = null;
    this.online = false;
    this.problem = '';
    this.serial = Promise.resolve();
  }
  run(fn) {
    const p = this.serial.then(() => {
      if (this.closed) throw Error("The device has been disconnected. Open the app again.");
      return fn();
    });
    this.serial = p.catch(() => {});
    return p;
  }
  async load() {
    if (this.cache) return;
    const saved = await this.io.call('load');
    this.cache = saved ? JSON.parse(saved) : {
      format: 'FakturocelClient',
      version: 1,
      snapshot: null,
      outbox: [],
      viewRevision: 0
    };
    if (this.cache.format !== 'FakturocelClient' || this.cache.version !== 1 || !Array.isArray(this.cache.outbox)) throw Error("The offline copy is corrupted. The original file was preserved.");
    if (this.cache.snapshot) validateState(this.cache.snapshot.state);
  }
  async persist(next) {
    await this.io.call('save', JSON.stringify(next));
    this.cache = next;
  }
  status() {
    return {
      online: this.online,
      problem: this.problem,
      errorStatus: this.errorStatus || 0,
      pending: this.cache?.outbox.length || 0,
      lastSync: this.cache?.lastSync,
      paired: !!this.cache?.snapshot
    };
  }
  async accept(snapshot, outbox) {
    if (snapshot.protocol !== 1 || !snapshot.deviceId || !Number.isSafeInteger(snapshot.seq)) throw Error("The server is using unsupported synchronization.");
    validateState(snapshot.state);
    if (this.cache.snapshot && snapshot.deviceId !== this.cache.snapshot.deviceId) throw Error("The connection belongs to another device. The original offline data was preserved.");
    for (const [h, b] of Object.entries(snapshot.blobs || {})) if ((await hashBytes(base64Bytes(b.base64))) !== h) throw Error("The downloaded attachment has an invalid checksum.");
    await this.persist({
      ...this.cache,
      snapshot,
      outbox,
      lastSync: new Date().toISOString(),
      viewRevision: this.cache.viewRevision + 1
    });
  }
  async flush() {
    await this.load();
    try {
      while (this.cache.outbox.length) {
        const first = this.cache.outbox[0],
          snapshot = await this.io.call('request', {
            route: 'commit',
            data: first
          });
        if (snapshot.seq !== first.seq) throw Error("The server did not confirm the change order.");
        await this.accept(snapshot, this.cache.outbox.slice(1));
      }
      const meta = await this.io.call('request', {
        route: 'meta'
      });
      if (!this.cache.snapshot || meta.revision !== this.cache.snapshot.revision) await this.accept(await this.io.call('request', {
        route: 'snapshot'
      }), []);
      this.online = true;
      this.problem = '';
      this.errorStatus = 0;
      return true;
    } catch (e) {
      this.online = false;
      this.problem = e.message;
      this.errorStatus = e.status || 0;
      if (!this.cache.snapshot) throw e;
      return false;
    }
  }
  async state() {
    return this.run(async () => {
      await this.flush();
      return this.read();
    });
  }
  read() {
    const r = project(this.cache);
    if (!r) throw Error("First, connect the app to Home Assistant.");
    return {
      ...r,
      backup: true,
      local: true,
      security: {
        configured: true,
        encrypted: true,
        pinEnabled: false
      },
      backupFolder: "Encrypted offline copy on this device",
      lastBackup: {
        backup: true,
        at: this.cache.lastSync
      },
      sync: this.status()
    };
  }
  async commit(input) {
    return this.run(async () => {
      await this.load();
      const current = this.read(),
        state = clone(current.state),
        onlineOnly = input.ops.some(o => o.delete || o.collection === 'payments' || o.collection === 'documents' && o.value?.status === 'issued');
      if (onlineOnly && !(await this.flush())) throw Error("Posting, payments and deletions require a server connection. You can save the draft offline. " + this.problem);
      if (this.errorStatus === 401 || this.errorStatus === 403) throw Error("Device access has been revoked. Offline data remains available for reading and backup.");
      if (!Array.isArray(input.ops) || !input.ops.length || input.ops.length > 100) throw Error("Invalid change.");
      for (const op of input.ops) {
        if (!['companies', 'activities', 'texts', 'worklogs', 'documents', 'checks', 'payments', 'views'].includes(op.collection)) throw Error("Make this change in the Home Assistant add-on.");
        const key = op.collection + ':' + op.id;
        if ((current.revisions[key] || 0) !== +op.rev) throw Error("The record has since changed. Open it again.");
        const old = state[op.collection].find(x => x.id === op.id);
        if (op.collection === 'documents' && old && old.status !== 'draft') throw Error("Edit the issued invoice via Home Assistant.");
        if (op.collection === 'documents' && op.value) validateDoc(op.value, state, op.value.status === 'issued');
        if (op.delete) state[op.collection] = state[op.collection].filter(x => x.id !== op.id);else {
          if (op.id !== op.value?.id) throw Error("Invalid ID record.");
          const i = state[op.collection].findIndex(x => x.id === op.id);
          if (i < 0) state[op.collection].push(clone(op.value));else state[op.collection][i] = clone(op.value);
        }
      }
      validateState(state);
      const next = clone(this.cache),
        seq = next.snapshot.seq + next.outbox.length + 1;
      next.outbox.push({
        seq,
        ops: clone(input.ops),
        reason: input.reason || ''
      });
      next.viewRevision++;
      await this.persist(next);
      await this.flush();
      return {
        ...this.read(),
        saved: true
      };
    });
  }
  async backup() {
    await this.load();
    const r = this.read();
    return packBackup(r.state, this.cache.snapshot.blobs);
  }
  async clear(revision) {
    return this.run(async () => {
      if (this.cache.viewRevision !== revision) throw Error("Data has changed since the backup. Start again.");
      await this.io.call('clear');
      this.closed = true;
      this.cache = null;
    });
  }
  async discard(revision) {
    return this.run(async () => {
      if (revision !== undefined && this.cache.viewRevision !== revision) throw Error("Data has changed since the backup. Start again.");
      const snapshot = await this.io.call('request', {
        route: 'snapshot'
      });
      await this.accept(snapshot, []);
      this.problem = '';
      this.online = true;
      return this.read();
    });
  }
}
export const client = new LocalClient(bridge);
