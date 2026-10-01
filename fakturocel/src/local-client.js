import { clone, emptyState, collections, validateState, validateDoc, packBackup, unpackBackup, base64Bytes, bytesBase64, uid, now } from './model.js';
import { prepareCommit, fail } from './operations.js';
import { validateTemplate } from './renderer.js';
import { hashBytes } from './crypto.js';
import { clientContext, clientRecoveryKey, encryptClientBackup, decryptClientBackup } from './client-backup.js';
import { mergeData, same } from './data-merge.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { PDFDocument } from 'pdf-lib';
const actor = {
  id: 'local-owner',
  name: "Device owner",
  role: 'owner'
};
const utf8 = s => new TextEncoder().encode(s);
const snapshot = state => ({
  state,
  revisions: Object.fromEntries(collections.flatMap(k => state[k].map(v => [k + ':' + v.id, 1]))),
  revision: 1,
  configRevision: 1,
  blobs: {}
});
function migrate(saved) {
  if (saved.version === 2) return saved;
  if (saved.version !== 1 || !Array.isArray(saved.outbox)) throw Error("Local data not supported. The original file was preserved.");
  const source = clone(saved.snapshot) || snapshot(emptyState()),
    base = clone(saved.snapshot?.state || null);
  for (const transaction of saved.outbox) for (const op of transaction.ops) {
    const list = source.state[op.collection];
    if (!list) throw Error("Invalid pending change.");
    const at = list.findIndex(v => v.id === op.id);
    if (op.delete) {
      if (at >= 0) list.splice(at, 1);
    } else {
      const v = clone(op.value);
      if (op.collection === 'documents' && v.status === 'issued') v.status = 'draft';
      if (at < 0) list.push(v);else list[at] = v;
      if (op.collection === 'documents') {
        const key = v.type + ':' + v.number;
        if (!source.state.usedNumbers.includes(key)) source.state.usedNumbers.push(key);
      }
    }
    source.revisions[op.collection + ':' + op.id] = (source.revisions[op.collection + ':' + op.id] || 0) + 1;
  }
  return {
    format: 'FakturocelClient',
    version: 2,
    snapshot: source,
    viewRevision: Math.max(saved.viewRevision || 0, source.revision) + 1,
    exportContext: saved.exportContext,
    encrypted: true,
    remote: base ? {
      deviceId: saved.snapshot.deviceId,
      base,
      lastSync: saved.lastSync
    } : null,
    migratedFrom: 1,
    legacyOutbox: saved.outbox
  };
}
export class LocalClient {
  constructor(io, loadAsset) {
    this.io = io;
    this.loadAsset = loadAsset || (async name => {
      const r = await fetch(new URL(name, location.href));
      if (!r.ok) throw Error("Missing local resource: " + name);
      return new Uint8Array(await r.arrayBuffer());
    });
    this.cache = null;
    this.serial = Promise.resolve();
    this.online = false;
    this.problem = '';
    this.unlockedUntil = 0;
  }
  run(fn) {
    const p = this.serial.then(async () => {
      if (this.closed) throw Error("The data has been deleted. Open the app again.");
      await this.load();
      return fn();
    });
    this.serial = p.catch(() => {});
    return p;
  }
  async load() {
    if (this.cache) return;
    const text = await this.io.call('load');
    let c = text ? JSON.parse(text) : {
      format: 'FakturocelClient',
      version: 2,
      snapshot: snapshot(emptyState()),
      viewRevision: 1,
      encrypted: true,
      remote: null
    };
    if (c.format !== 'FakturocelClient') throw Error("Local data is not valid.");
    c = migrate(c);
    validateState(c.snapshot.state);
    await packBackup(c.snapshot.state, c.snapshot.blobs);
    if (!c.exportContext) c.exportContext = await clientContext();
    if (!text || JSON.parse(text).version !== 2) await this.persist(c);else this.cache = c;
  }
  async persist(next) {
    await this.io.call('save', JSON.stringify(next));
    this.cache = next;
  }
  security() {
    return {
      configured: true,
      encrypted: this.cache.encrypted !== false,
      pinEnabled: !!this.cache.pin,
      pinRequired: !!this.cache.pin && this.unlockedUntil < Date.now(),
      keyRemembered: true,
      keyId: clientRecoveryKey(this.cache.exportContext).slice(4, 21).replaceAll('-', '')
    };
  }
  require() {
    if (this.security().pinRequired) throw fail(423, "The application is locked. Unlock it with a PIN.");
  }
  status() {
    return {
      paired: !!this.cache?.remote,
      online: this.online,
      problem: this.problem,
      pending: this.cache?.remote && !same(this.cache.remote.base, this.cache.snapshot.state) ? 1 : 0,
      lastSync: this.cache?.remote?.lastSync,
      undo: this.cache?.lastMergeUndo ? {
        createdAt: this.cache.lastMergeUndo.createdAt,
        direction: this.cache.lastMergeUndo.direction
      } : null
    };
  }
  read() {
    this.require();
    return {
      ...clone(this.cache.snapshot),
      revision: this.cache.viewRevision,
      actor,
      security: this.security(),
      local: true,
      sync: this.status(),
      backupFolder: this.cache.backupFolder || "Private app/backup folder",
      lastBackup: this.cache.lastBackup,
      backup: this.cache.lastBackup?.backup !== false,
      roles: {}
    };
  }
  async state() {
    return this.run(() => this.read());
  }
  async backup() {
    await this.load();
    this.require();
    return packBackup(this.cache.snapshot.state, this.cache.snapshot.blobs);
  }
  async backupText() {
    const text = await this.backup();
    return this.cache.encrypted === false ? text : encryptClientBackup(text, this.cache.exportContext);
  }
  async automatic(prefix = "Fakturocel") {
    let result;
    try {
      const name = prefix + '-' + now().replace(/[:.]/g, '-') + '-' + uid().slice(0, 8) + ".fakturocel";
      const info = await this.io.call('backup', {
        name,
        text: await this.backupText(),
        retention: this.cache.snapshot.state.settings.retention || 0
      });
      if (info !== true && !info?.path) throw Error("The storage did not confirm the backup write.");
      result = {
        backup: true,
        at: now(),
        path: info.path
      };
    } catch (e) {
      result = {
        backup: false,
        error: e.message
      };
    }
    await this.persist({
      ...this.cache,
      lastBackup: result
    });
    return result;
  }
  async saveSnapshot(next, {
    backup = true
  } = {}) {
    validateState(next.state);
    await packBackup(next.state, next.blobs);
    await this.persist({
      ...this.cache,
      snapshot: next,
      viewRevision: this.cache.viewRevision + 1
    });
    const result = backup ? await this.automatic() : {
      backup: true
    };
    return {
      ...this.read(),
      ...result,
      saved: true
    };
  }
  async commit(input) {
    return this.run(async () => {
      this.require();
      if (input.remote || input.special) throw Error("Invalid change.");
      const current = this.cache.snapshot,
        prepared = await prepareCommit(current, input, actor, {
          blobs: current.blobs,
          blob: h => {
            const b = current.blobs[h];
            if (!b) throw Error("Attachment does not exist.");
            return {
              ...b,
              data: base64Bytes(b.base64)
            };
          },
          loadAsset: this.loadAsset
        });
      const next = clone(current);
      next.state = prepared.state;
      next.state.audit = prepared.audit;
      for (const b of prepared.pending) next.blobs[b.h] = {
        base64: bytesBase64(b.bytes),
        mime: b.mime,
        name: b.name
      };
      for (const op of prepared.ops) {
        if (op.collection === 'config') next.configRevision++;else next.revisions[op.collection + ':' + op.id] = (next.revisions[op.collection + ':' + op.id] || 0) + 1;
      }
      next.revision++;
      return this.saveSnapshot(next);
    });
  }
  async upload(input) {
    const bytes = base64Bytes(input.base64 || ''),
      mime = input.mime,
      name = String(input.name || "File").slice(0, 200);
    if (bytes.length > 25 * 1024 * 1024) throw Error("A file can have a maximum of 25 MB.");
    if (mime === 'application/pdf') {
      const p = await PDFDocument.load(bytes);
      if (!p.getPageCount()) throw Error("PDF has no pages.");
    } else if (['image/png', 'image/jpeg'].includes(mime)) {
      const p = await PDFDocument.create();
      if (mime === 'image/png') await p.embedPng(bytes);else await p.embedJpg(bytes);
    } else if (['font/ttf', 'font/otf'].includes(mime)) {
      const header = [...bytes.slice(0, 4)].map(x => x.toString(16).padStart(2, '0')).join('');
      if (!['00010000', '4f54544f', '74727565'].includes(header)) throw Error("Invalid font.");
    } else throw Error("PNG, JPEG, PDF, TTF and OTF are supported.");
    const hash = await hashBytes(bytes),
      next = clone(this.cache.snapshot);
    next.blobs[hash] = {
      name,
      mime,
      base64: bytesBase64(bytes)
    };
    await this.saveSnapshot(next, {
      backup: false
    });
    return {
      hash,
      mime,
      name
    };
  }
  async fix(input) {
    const cur = this.cache.snapshot,
      old = cur.state.documents.find(d => d.id === input.id);
    if (!old || input.rev !== cur.revisions['documents:' + input.id]) throw fail(409, "The document has changed.");
    if (!input.reason?.trim()) throw Error("State the reason for the correction.");
    const d = clone(old),
      next = clone(cur);
    if (input.kind === 'cancel') {
      d.status = 'cancelled';
      d.cancelReason = input.reason;
    } else if (input.kind === 'attach') {
      if (cur.blobs[input.hash]?.mime !== 'application/pdf') throw Error('Vyber PDF.');
      d.archiveVariants ||= [];
      if (d.pdfHash) d.archiveVariants.push({
        hash: d.pdfHash,
        name: "Before changing the attachment"
      });
      d.pdfHash = input.hash;
      for (const c of next.state.checks.filter(c => c.documentId === d.id && c.code === 'missing-pdf')) {
        c.status = 'resolved';
        c.reason = input.reason;
        next.revisions['checks:' + c.id]++;
      }
    } else if (input.kind === 'evidence') {
      if (!d.imported) throw Error("Correction of records is intended for historical import.");
      for (const key of ['number', 'date', 'due', 'notes', 'importedTotal']) if (key in input.values) d[key] = input.values[key];
      validateDoc(d, {
        ...cur.state,
        documents: cur.state.documents.filter(x => x.id !== d.id)
      });
      const key = d.type + ':' + d.number;
      if (!next.state.usedNumbers.includes(key)) next.state.usedNumbers.push(key);
    } else throw Error("Invalid repair.");
    next.state.documents[next.state.documents.findIndex(x => x.id === d.id)] = d;
    next.revisions['documents:' + d.id]++;
    this.event(next.state, input.kind, 'documents', d.id, old, d, input.reason);
    return this.saveSnapshot(next);
  }
  event(state, action, collection, recordId, before, after, reason = '') {
    state.audit.push({
      id: uid(),
      at: now(),
      actor: actor.name,
      actorId: actor.id,
      action,
      collection,
      recordId,
      before,
      after,
      reason
    });
  }
  async decode(text, password, purpose = 'backup') {
    return decryptClientBackup(text, this.cache.exportContext, password, purpose);
  }
  async restore(input) {
    if (input.revision !== this.cache.viewRevision) throw fail(409, "Dates have changed. I'm preparing to resume again.");
    const incoming = await unpackBackup(await this.decode(input.text, input.password));
    for (const t of incoming.data.templates) validateTemplate(t, incoming.data);
    const before = await this.automatic('Before-restore');
    if (!before.backup) throw Error("Failed to save backup before restore. " + before.error);
    const next = snapshot(incoming.data);
    next.blobs = incoming.blobs;
    this.event(next.state, 'restore', 'all', 'all', null, null, "Restoring the backup on the device");
    return this.saveSnapshot(next);
  }
  async pinHash(pin, salt) {
    return bytesBase64(await scryptAsync(String(pin), base64Bytes(salt), {
      N: 32768,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 64 * 1024 * 1024
    }));
  }
  async verifyPin(value) {
    const p = this.cache.pin;
    if (!p) return;
    if ((p.blockUntil || 0) > Date.now()) throw Error("Too many attempts. Try PIN later.");
    if ((await this.pinHash(value, p.salt)) !== p.hash) {
      const next = clone(this.cache);
      next.pin.attempts = (p.attempts || 0) + 1;
      next.pin.blockUntil = Date.now() + Math.min(15 * 60000, Math.max(0, next.pin.attempts - 3) * 30000);
      await this.persist(next);
      throw Error("The PINs do not match.");
    }
    await this.persist({
      ...this.cache,
      pin: {
        ...p,
        attempts: 0,
        blockUntil: 0
      }
    });
  }
  async pollRemote() {
    await this.load();
    this.require();
    const c = this.cache,
      revision = c.viewRevision,
      remote = c.remote;
    if (!remote?.base || remote.autoPull === false || c.pendingExchange || !same(remote.base, c.snapshot.state) || this.polling) return this.read();
    this.polling = true;
    try {
      const meta = await this.io.call('request', {
        route: 'meta'
      });
      this.online = true;
      this.problem = '';
      if (meta.revision === remote.serverRevision) return this.read();
      const incoming = await this.io.call('request', {
        route: 'snapshot'
      });
      if (incoming.deviceId !== remote.deviceId) throw Error("The connection belongs to another device.");
      await unpackBackup(await packBackup(incoming.state, incoming.blobs));
      return await this.run(async () => {
        this.require();
        if (this.cache.viewRevision !== revision || this.cache.remote?.deviceId !== remote.deviceId || this.cache.remote?.autoPull === false || this.canAutoApply && !this.canAutoApply()) return this.read();
        const merged = mergeData(remote.base, this.cache.snapshot.state, incoming.state);
        if (merged.conflicts.length) throw Error("New data requires manual conflict resolution in Settings.");
        const before = await this.automatic('Before-transfer');
        if (!before.backup) throw Error("The download is waiting for a successful local backup. " + before.error);
        if (this.canAutoApply && !this.canAutoApply()) return this.read();
        return this.acceptRemote(incoming, merged.state);
      });
    } catch (e) {
      this.problem = e.message;
      this.online = false;
      return this.read();
    } finally {
      this.polling = false;
    }
  }
  async route(route, input = {}) {
    if (route === 'commit') return this.commit(input);
    if (route === 'meta') return this.pollRemote();
    return this.run(async () => {
      if (route === 'security') return {
        security: this.security()
      };
      if (route === 'security/pin-login') {
        await this.verifyPin(input.pin);
        this.unlockedUntil = Date.now() + 12 * 3600000;
        return {
          security: this.security()
        };
      }
      if (route === 'security/pin-recover') {
        if (this.cache.encrypted === false || input.key !== clientRecoveryKey(this.cache.exportContext)) throw Error("The recovery key does not agree.");
        await this.persist({
          ...this.cache,
          pin: null
        });
        return {
          security: this.security()
        };
      }
      this.require();
      if (route === 'state' || route === 'meta') return this.read();
      if (route === 'security/lock') {
        this.unlockedUntil = 0;
        return {
          security: this.security()
        };
      }
      if (route === 'security/pin') {
        await this.verifyPin(input.currentPin);
        let pin = null;
        if (input.enabled) {
          if (!/^\d{6,12}$/.test(input.pin)) throw Error("PIN must be 6 to 12 digits long.");
          const salt = bytesBase64(crypto.getRandomValues(new Uint8Array(16)));
          pin = {
            salt,
            hash: await this.pinHash(input.pin, salt)
          };
        }
        await this.persist({
          ...this.cache,
          pin
        });
        this.unlockedUntil = Date.now() + 12 * 3600000;
        return {
          security: this.security()
        };
      }
      if (route === 'security/change') {
        if (input.enabled !== true && input.enabled !== false) throw Error("Invalid setting.");
        if (!input.enabled && input.confirm !== "DISABLE ENCRYPTION") throw Error("Confirm disabling encryption.");
        const context = input.enabled && (input.rotate || this.cache.encrypted === false) ? await clientContext(input.password) : this.cache.exportContext;
        await this.persist({
          ...this.cache,
          exportContext: context,
          encrypted: input.enabled
        });
        await this.automatic();
        return {
          security: this.security()
        };
      }
      if (route === 'backup') return this.automatic();
      if (route === 'folder') {
        const info = await this.io.call('chooseBackupFolder');
        if (info) {
          await this.persist({
            ...this.cache,
            backupFolder: info.path || String(info),
            backupFolderChosen: true
          });
          return this.automatic();
        }
        return this.read();
      }
      if (route === 'upload') return this.upload(input);
      if (route === 'fix') return this.fix(input);
      if (route === 'restore/preview') {
        const {
          data
        } = await unpackBackup(await this.decode(input.text, input.password));
        return {
          documents: data.documents.length,
          companies: data.companies.length,
          templates: data.templates.length
        };
      }
      if (route === 'restore') return this.restore(input);
      if (route === 'export/template') {
        if (input.bundle?.format !== 'FakturocelTemplate') throw Error("Invalid template.");
        const text = JSON.stringify(input.bundle);
        return {
          text: this.cache.encrypted === false ? text : await encryptClientBackup(text, this.cache.exportContext, 'template')
        };
      }
      if (route === 'import/template') return {
        bundle: JSON.parse(await this.decode(input.text, input.password, 'template'))
      };
      throw Error("Unknown application operation.");
    });
  }
  async connect(text) {
    return this.run(async () => {
      this.require();
      if (this.cache.pendingExchange) throw Error("Complete the unconfirmed transfer first.");
      const p = JSON.parse(text);
      await this.io.call('pair', text);
      await this.persist({
        ...this.cache,
        remote: {
          deviceId: p.id,
          base: null,
          lastSync: null
        }
      });
      this.problem = '';
      this.online = true;
      return this.read();
    });
  }
  async disconnect() {
    return this.run(async () => {
      this.require();
      if (this.cache.pendingExchange) throw Error("First verify the completion of the last transfer.");
      await this.io.call('disconnect');
      await this.persist({
        ...this.cache,
        remote: null
      });
      this.online = false;
      this.problem = '';
      return this.read();
    });
  }
  async remoteSnapshot() {
    try {
      const r = await this.io.call('request', {
        route: 'snapshot'
      });
      if (r.deviceId !== this.cache.remote?.deviceId) throw Error("The connection belongs to another device. Pair them again.");
      validateState(r.state);
      await unpackBackup(await packBackup(r.state, r.blobs));
      this.online = true;
      this.problem = '';
      return r;
    } catch (e) {
      this.online = false;
      this.problem = e.message;
      throw e;
    }
  }
  async acceptRemote(remote, state) {
    const next = snapshot(state);
    next.blobs = {
      ...this.cache.snapshot.blobs,
      ...remote.blobs
    };
    next.configRevision = this.cache.snapshot.configRevision + 1;
    for (const k of collections) for (const v of state[k]) next.revisions[k + ':' + v.id] = (this.cache.snapshot.revisions[k + ':' + v.id] || 0) + 1;
    await packBackup(state, next.blobs);
    await this.persist({
      ...this.cache,
      snapshot: next,
      viewRevision: this.cache.viewRevision + 1,
      remote: {
        ...this.cache.remote,
        base: clone(remote.state),
        lastSync: now(),
        serverRevision: remote.revision
      },
      pendingExchange: null
    });
    await this.automatic();
    return this.read();
  }
  async finishPending() {
    const p = this.cache.pendingExchange;
    if (!p) return;
    const remote = await this.io.call('request', {
        route: 'exchange',
        data: p.input
      }),
      merged = mergeData(p.localBefore || p.state, this.cache.snapshot.state, remote.state);
    if (merged.conflicts.length) throw Error("The transmission was accepted, but a conflict arose in the meantime. The data remains preserved.");
    await this.acceptRemote(remote, merged.state);
  }
  async previewSync(direction, choices = {}) {
    return this.run(async () => {
      this.require();
      if (!this.cache.remote) throw Error("First connect Home Assistant in settings.");
      await this.finishPending();
      const remote = await this.remoteSnapshot();
      if (direction === 'push' && remote.syncProtocol !== 2) throw Error("To transfer all data, update the add-on to version 3.6 and create a new pairing file.");
      const merged = mergeData(this.cache.remote.base, this.cache.snapshot.state, remote.state, choices);
      const preview = {
        ...merged,
        direction,
        localRevision: this.cache.viewRevision,
        serverRevision: remote.revision,
        remote,
        token: uid(),
        created: Date.now()
      };
      this.preview = preview;
      return clone(preview);
    });
  }
  async applySync(token) {
    return this.run(async () => {
      this.require();
      const p = this.preview;
      if (!p || p.token !== token || Date.now() - p.created > 15 * 60000 || p.localRevision !== this.cache.viewRevision) throw fail(409, "Dates have changed. Transmission prepares again.");
      if (p.conflicts.length) throw Error("Resolve conflicts first.");
      const before = await this.automatic('Before-transfer');
      if (!before.backup) throw Error("Failed to save backup before transfer. " + before.error);
      await this.persist({
        ...this.cache,
        lastMergeUndo: {
          snapshot: clone(this.cache.snapshot),
          createdAt: now(),
          direction: p.direction
        }
      });
      if (p.direction === 'pull') {
        const meta = await this.io.call('request', {
          route: 'meta'
        });
        if (meta.revision !== p.serverRevision) throw fail(409, "The data in the Home Assistant has changed. Transmission prepares again.");
        this.preview = null;
        return this.acceptRemote(p.remote, p.state);
      }
      const blobs = {
          ...p.remote.blobs,
          ...this.cache.snapshot.blobs
        },
        text = await packBackup(p.state, blobs),
        pending = {
          state: p.state,
          localBefore: clone(this.cache.snapshot.state),
          input: {
            requestId: uid(),
            revision: p.serverRevision,
            text
          }
        };
      await this.persist({
        ...this.cache,
        pendingExchange: pending
      });
      this.preview = null;
      await this.finishPending();
      return this.read();
    });
  }
  async undoLastSync() {
    return this.run(async () => {
      this.require();
      const undo = this.cache.lastMergeUndo;
      if (!undo) throw Error("There is no rollback merge available.");
      if (this.cache.pendingExchange) throw Error("First, complete the transfer in progress.");
      validateState(undo.snapshot.state);
      const before = await this.automatic('Before-sync-rollback');
      if (!before.backup) throw Error("Failed to save current data before returning. " + before.error);
      const restored = clone(undo.snapshot);
      this.event(restored.state, 'sync-undo', 'all', 'all', null, null, "Roll back local data before the last merge");
      await this.persist({
        ...this.cache,
        snapshot: restored,
        viewRevision: this.cache.viewRevision + 1,
        lastMergeUndo: null
      });
      await this.automatic('After-sync-rollback');
      return this.read();
    });
  }
  async clear(revision) {
    return this.run(async () => {
      this.require();
      if (this.cache.viewRevision !== revision) throw fail(409, "Data has changed since the backup. Start again.");
      await this.io.call('clear');
      this.closed = true;
      this.cache = null;
    });
  }
}
