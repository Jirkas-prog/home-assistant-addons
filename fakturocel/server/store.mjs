import { prepareCommit } from '../src/operations.js';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { emptyState, validateState, validateDoc, unpackBackup, packBackup, collections, clone, now, total, uid, checksFor, bytesBase64, validDate } from '../src/model.js';
import { validateTemplate, renderDocument } from '../src/renderer.js';
import { PDFDocument } from 'pdf-lib';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = (code, message) => Object.assign(Error(message), {
  status: code
});
export async function atomic(file, bytes) {
  await fs.mkdir(path.dirname(file), {
    recursive: true
  });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    const h = await fs.open(tmp, 'wx', 0o600);
    try {
      await h.writeFile(bytes);
      await h.sync();
    } finally {
      await h.close();
    }
    await fs.rename(tmp, file);
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(file), 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}
async function optional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
export async function finishPendingWipe({
  root,
  shareRoot
}) {
  const marker = path.join(root, 'wipe-pending.json'),
    pending = await optional(marker);
  if (!pending) return;
  const {
    files
  } = JSON.parse(pending);
  if (!Array.isArray(files)) throw Error("Invalid record of incomplete deletion.");
  for (const file of files) {
    const p = path.resolve(file),
      inData = path.dirname(p) === path.resolve(root) && /^(fakturocel-(?:vault|keys|tls)\.json|data\.fakturocel|predchozi\.fakturocel|pred-obnovou-.+\.fakturocel|fakturocel-v3\.sqlite(?:-journal|-wal|-shm)?|config\.json)(?:\.[a-f0-9-]{36}\.tmp)?$/.test(path.basename(p)),
      inShare = p.startsWith(path.resolve(shareRoot) + path.sep) && /^(Fakturocel|Before-restore|Before-transfer|Before-sync-rollback|After-sync-rollback|Pred-obnovou|Pred-prenosem)-.+\.fakturocel(?:\.[a-f0-9-]{36}\.tmp)?$/.test(path.basename(p));
    if (!inData && !inShare) throw Error("An incomplete deletion contains an invalid path.");
    try {
      const stat = await fs.lstat(p);
      if (!stat.isFile() || stat.isSymbolicLink() || (await fs.realpath(p)) !== p) throw Error("Pending deletion contains a link.");
      await fs.unlink(p);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  await fs.unlink(marker);
}
export class Store {
  constructor({
    root,
    backupFolder,
    shareRoot,
    webRoot,
    memory = false
  }) {
    this.root = path.resolve(root);
    this.initialFolder = backupFolder;
    this.shareRoot = path.resolve(shareRoot);
    this.webRoot = webRoot;
    this.memory = memory;
    this.queue = Promise.resolve();
    this.generation = 0;
    this.tickets = new Map();
    mkdirSync(root, {
      recursive: true
    });
    this.open();
  }
  open() {
    this.db = new DatabaseSync(this.memory ? ':memory:' : path.join(this.root, "fakturocel-v3.sqlite"));
    this.db.exec('PRAGMA temp_store=MEMORY; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,rev INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY,mime TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL);');
  }
  close() {
    this.db.close();
  }
  serial(fn) {
    const generation = this.generation;
    const p = this.queue.then(() => {
      if (generation !== this.generation) throw fail(409, "The data has been deleted. Refresh the page.");
      return fn();
    });
    this.queue = p.catch(() => {});
    return p;
  }
  meta(k, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(k);
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(k, v) {
    this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
  }
  get revision() {
    return this.meta('revision', 0);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const x = fn();
      this.db.exec('COMMIT');
      return x;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  read() {
    if (this.blocked) throw fail(503, "Deletion was not completed. Restart the add-on; it completes safely on startup.");
    const s = this.meta('config', null) || emptyState(),
      revs = {};
    for (const k of collections) s[k] = [];
    s.audit = [];
    for (const row of this.db.prepare('SELECT * FROM records').all()) {
      (s[row.collection] ||= []).push(JSON.parse(row.value));
      revs[row.collection + ':' + row.id] = row.rev;
    }
    return {
      state: s,
      revisions: revs,
      revision: this.revision,
      configRevision: this.meta('configRevision', 0)
    };
  }
  writeAll(s, blobs = {}) {
    this.db.prepare('DELETE FROM records').run();
    const conf = clone(s);
    for (const k of [...collections, 'audit']) {
      delete conf[k];
      for (const v of s[k] || []) this.db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(k, v.id || uid(), 1, JSON.stringify(v));
    }
    this.setMeta('config', conf);
    this.setMeta('configRevision', this.meta('configRevision', 0) + 1);
    this.setMeta('revision', this.revision + 1);
    for (const [h, b] of Object.entries(blobs)) this.putBlob(Buffer.from(b.base64, 'base64'), b.mime, b.name, h);
  }
  async init() {
    if (await optional(path.join(this.root, 'wipe-pending.json'))) throw Error("The previous deletion was not completed. Restore the wipe installation run or use the mandatory downloaded backup. The data is not made available.");
    if (this.meta('config')) return;
    const legacy = await optional(path.join(this.root, "data.fakturocel"));
    const source = legacy ? await unpackBackup(legacy) : {
      data: emptyState(),
      blobs: {}
    };
    this.transaction(() => this.writeAll(source.data, source.blobs));
    this.setMeta('backupFolder', this.initialFolder);
    if (legacy) {
      const b = await this.backup();
      if (!b.backup) throw Error("The data transfer is saved, but the first backup failed: " + b.error);
    }
  }
  actor(id, name) {
    if (this.blocked) throw fail(503, "Restart the add-on to complete the deletion.");
    if (!id) throw fail(401, "Home Assistant did not pass on the identity of the logged-in user.");
    let roles = this.meta('roles', {});
    if (!Object.keys(roles).length) {
      roles[id] = {
        name: name || id,
        role: 'owner'
      };
      this.setMeta('roles', roles);
    }
    const r = roles[id];
    if (!r) throw fail(403, "Access is not allowed. The owner can add your Home Assistant ID: " + id);
    return {
      id,
      name: name || r.name,
      role: r.role
    };
  }
  role(actor, level = 'edit') {
    const roles = this.meta('roles', {});
    if (Object.keys(roles).length) {
      if (!roles[actor.id]) throw fail(403, "Access has been revoked.");
      actor = {
        ...actor,
        role: roles[actor.id].role
      };
    }
    if (level === 'owner' && actor.role !== 'owner' || level === 'edit' && actor.role === 'reader') throw fail(403, "You are not authorized to perform this operation.");
  }
  blob(h) {
    const b = this.db.prepare('SELECT * FROM blobs WHERE hash=?').get(h);
    if (!b) throw fail(404, "Attachment does not exist.");
    return b;
  }
  putBlob(bytes, mime, name, expected) {
    const h = hash(bytes);
    if (expected && h !== expected) throw Error("The media checksum does not match.");
    this.db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?,?,?)').run(h, mime || 'application/octet-stream', name || "File", bytes);
    return h;
  }
  allBlobs() {
    return Object.fromEntries(this.db.prepare('SELECT * FROM blobs').all().map(b => [b.hash, {
      mime: b.mime,
      name: b.name,
      base64: Buffer.from(b.data).toString('base64')
    }]));
  }
  async decodeBackup(text) {
    return unpackBackup(text);
  }
  async backupText() {
    return packBackup(this.read().state, this.allBlobs());
  }
  async backup(prefix = "Fakturocel") {
    try {
      const folder = await this.safeFolder(this.meta('backupFolder', this.initialFolder)),
        text = await this.backupText(),
        name = `${prefix}-${now().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.fakturocel`,
        file = path.join(folder, name);
      await atomic(file, text);
      let files = this.meta('backupFiles', []);
      files.push(file);
      this.setMeta('backupFiles', files);
      const result = {
        backup: true,
        at: now(),
        path: file
      };
      this.setMeta('lastBackup', result);
      const retention = +this.read().state.settings.retention || 0;
      if (retention > 0) {
        const owned = files.filter(f => path.dirname(f) === folder);
        for (const old of owned.slice(0, -Math.max(2, retention))) {
          await fs.unlink(old).catch(() => {});
          files = files.filter(f => f !== old);
        }
        this.setMeta('backupFiles', files);
      }
      return result;
    } catch (e) {
      const result = {
        backup: false,
        error: e.message
      };
      this.setMeta('lastBackup', result);
      return result;
    }
  }
  async safeFolder(folder) {
    const absolute = path.resolve(folder);
    if (!absolute.startsWith(this.shareRoot + path.sep)) throw fail(400, "Backups must be in the /share subfolder of the shared storage.");
    let current = this.shareRoot;
    await fs.mkdir(current, {
      recursive: true
    });
    for (const part of path.relative(this.shareRoot, absolute).split(path.sep)) {
      current = path.join(current, part);
      try {
        const st = await fs.lstat(current);
        if (st.isSymbolicLink() || !st.isDirectory()) throw Error("The destination path contains a link or a file.");
      } catch (e) {
        if (e.code === 'ENOENT') await fs.mkdir(current);else throw e;
      }
    }
    return absolute;
  }
  event(actor, action, collection, recordId, before, after, reason = '') {
    const v = {
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
    };
    this.db.prepare('INSERT INTO records VALUES (?,?,?,?)').run('audit', v.id, 1, JSON.stringify(v));
  }
  async commit(input, actor) {
    return this.serial(async () => {
      this.role(actor);
      if (input.remote) {
        const r = input.remote,
          d = this.meta('devices', {})[actor.deviceId];
        if (!d || r.deviceId !== actor.deviceId) throw fail(403, "Invalid device.");
        if (r.seq === d.seq && r.digest === d.digest) return {
          saved: true,
          replayed: true,
          ...this.read()
        };
        if (r.seq !== d.seq + 1) throw fail(409, "The sync order does not match. Reconnect the device.");
      }
      if (input.special) throw fail(400, "Invalid repair method.");
      const current = this.read();
      const {
        state: s,
        ops,
        pending
      } = await prepareCommit(current, input, actor, {
        blob: h => this.blob(h),
        blobs: this.allBlobs(),
        loadAsset: name => fs.readFile(path.join(this.webRoot, name)),
        role: (a, l) => this.role(a, l)
      });
      this.transaction(() => {
        for (const b of pending) this.putBlob(b.bytes, b.mime, b.name, b.h);
        for (const op of ops) {
          if (op.collection === 'config') {
            this.setMeta('configRevision', current.configRevision + 1);
            this.event(actor, 'settings', 'config', 'config', {
              supplier: current.state.supplier,
              settings: current.state.settings
            }, op.value);
            continue;
          }
          const old = current.state[op.collection].find(x => x.id === op.id);
          if (op.delete) this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(op.collection, op.id);else this.db.prepare('INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET rev=excluded.rev,value=excluded.value').run(op.collection, op.id, (current.revisions[op.collection + ':' + op.id] || 0) + 1, JSON.stringify(op.value));
          this.event(actor, op.delete ? 'delete' : 'save', op.collection, op.id, old || null, op.delete ? null : op.value, input.reason);
        }
        const config = clone(s);
        for (const k of [...collections, 'audit']) delete config[k];
        this.setMeta('config', config);
        this.setMeta('revision', this.revision + 1);
        if (input.remote) {
          const devices = this.meta('devices', {}),
            d = devices[actor.deviceId];
          d.seq = input.remote.seq;
          d.digest = input.remote.digest;
          devices[actor.deviceId] = d;
          this.setMeta('devices', devices);
        }
      });
      return {
        saved: true,
        ...(await this.backup()),
        ...this.read()
      };
    });
  }
  async restore(text, rev, actor) {
    return this.serial(async () => {
      this.role(actor, 'owner');
      if (rev !== this.revision) throw fail(409, "Dates have changed. First, load the current state.");
      const incoming = await this.decodeBackup(text);
      for (const t of incoming.data.templates) validateTemplate(t, incoming.data);
      await packBackup(incoming.data, incoming.blobs);
      const before = await this.backup('Before-restore');
      if (!before.backup) throw fail(400, "Failed to backup current data before restore. " + before.error);
      this.transaction(() => {
        this.db.exec('DELETE FROM blobs');
        this.writeAll(incoming.data, incoming.blobs);
        this.event(actor, 'restore', 'all', 'all', null, null, "Restoring the entire backup");
      });
      return {
        saved: true,
        ...(await this.backup()),
        ...this.read()
      };
    });
  }
  async upload(bytes, mime, name, actor) {
    this.role(actor, mime === 'application/pdf' ? 'edit' : 'owner');
    if (bytes.length > 25 * 1024 * 1024) throw fail(400, "A file can have a maximum of 25 MB.");
    if (!['image/png', 'image/jpeg', 'font/ttf', 'font/otf', 'application/pdf'].includes(mime)) throw fail(400, "PNG, JPEG, TTF, OTF and PDF are supported.");
    if (mime === 'application/pdf') {
      if (Buffer.from(bytes).subarray(0, 5).toString() !== '%PDF-') throw fail(400, "The file is not PDF.");
      const pdf = await PDFDocument.load(bytes);
      if (!pdf.getPageCount()) throw fail(400, "PDF has no pages.");
    } else if (mime === 'image/png' || mime === 'image/jpeg') {
      const p = await PDFDocument.create();
      if (mime === 'image/png') await p.embedPng(bytes);else await p.embedJpg(bytes);
    } else if (!['00010000', '4f54544f', '74727565'].includes(Buffer.from(bytes).subarray(0, 4).toString('hex'))) throw fail(400, "Invalid font.");
    const h = hash(bytes),
      existed = this.db.prepare('SELECT 1 FROM blobs WHERE hash=?').get(h);
    this.putBlob(bytes, mime, name);
    try {
      await this.backupText();
    } catch (e) {
      if (!existed) this.db.prepare('DELETE FROM blobs WHERE hash=?').run(h);
      throw e;
    }
    return {
      hash: h,
      mime,
      name
    };
  }
  async fix(input, actor) {
    return this.serial(async () => {
      this.role(actor);
      const cur = this.read(),
        old = cur.state.documents.find(d => d.id === input.id);
      if (!old || input.rev !== cur.revisions['documents:' + input.id]) throw fail(409, "The document has changed.");
      if (!input.reason?.trim()) throw fail(400, "State the reason for the correction.");
      const d = clone(old);
      if (input.kind === 'cancel') {
        d.status = 'cancelled';
        d.cancelReason = input.reason;
      } else if (input.kind === 'attach') {
        const b = this.blob(input.hash);
        if (b.mime !== 'application/pdf') throw fail(400, 'Vyber PDF.');
        d.archiveVariants ||= [];
        if (d.pdfHash) d.archiveVariants.push({
          hash: d.pdfHash,
          name: "Before changing the attachment"
        });
        d.pdfHash = input.hash;
      } else if (input.kind === 'evidence') {
        if (!d.imported) throw fail(400, "Correction of records is intended for historical import. Create a follow-up correction document.");
        for (const key of ['number', 'date', 'due', 'notes', 'importedTotal']) if (key in input.values) d[key] = input.values[key];
        validateDoc(d, {
          ...cur.state,
          documents: cur.state.documents.filter(x => x.id !== d.id)
        });
      } else throw fail(400, "Invalid repair.");
      this.transaction(() => {
        this.db.prepare('UPDATE records SET value=?,rev=rev+1 WHERE collection=? AND id=?').run(JSON.stringify(d), 'documents', d.id);
        this.event(actor, input.kind, 'documents', d.id, old, d, input.reason);
        this.setMeta('revision', this.revision + 1);
        if (input.kind === 'evidence') {
          const conf = this.meta('config'),
            key = d.type + ':' + d.number;
          if (!conf.usedNumbers.includes(key)) conf.usedNumbers.push(key);
          this.setMeta('config', conf);
        }
        if (input.kind === 'attach') {
          for (const c of cur.state.checks.filter(c => c.documentId === d.id && c.code === 'missing-pdf')) {
            c.status = 'resolved';
            c.reason = input.reason;
            this.db.prepare('UPDATE records SET value=?,rev=rev+1 WHERE collection=? AND id=?').run(JSON.stringify(c), 'checks', c.id);
          }
        }
      });
      return {
        saved: true,
        ...(await this.backup()),
        ...this.read()
      };
    });
  }
  async wipePrepare(rev, actor) {
    return this.serial(async () => {
      this.role(actor, 'owner');
      if (rev !== this.revision) throw fail(409, "Dates have changed.");
      const text = await this.backupText(),
        ticket = randomBytes(32).toString('hex');
      const files = await this.wipeFiles();
      for (const [key, value] of this.tickets) if (value.expires < Date.now() || value.actor === actor.id) this.tickets.delete(key);
      this.tickets.set(ticket, {
        actor: actor.id,
        revision: rev,
        text,
        hash: hash(text),
        downloaded: false,
        expires: Date.now() + 15 * 60000,
        files
      });
      return {
        ticket,
        sha256: hash(text),
        files: files.map(x => x),
        bytes: Buffer.byteLength(text)
      };
    });
  }
  ticket(id, actor) {
    const t = this.tickets.get(id);
    if (!t || t.actor !== actor.id || t.expires < Date.now()) throw fail(400, "Preparation for deletion timed out. Start again.");
    return t;
  }
  async wipeFiles() {
    const paths = new Set(this.meta('backupFiles', []));
    const folder = await this.safeFolder(this.meta('backupFolder', this.initialFolder));
    for (const name of await fs.readdir(folder)) if (/^(Fakturocel|Before-restore|Before-transfer|Before-sync-rollback|After-sync-rollback|Pred-obnovou|Pred-prenosem)-.+\.fakturocel(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name)) paths.add(path.join(folder, name));
    for (const name of await fs.readdir(this.root)) if (/^(data\.fakturocel|predchozi\.fakturocel|pred-obnovou-.+\.fakturocel|fakturocel-v3\.sqlite(?:-journal|-wal|-shm)?|config\.json)(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name)) paths.add(path.join(this.root, name));
    const valid = [];
    for (const p of paths) {
      const absolute = path.resolve(p);
      if (!absolute.startsWith(this.root + path.sep) && !absolute.startsWith(this.shareRoot + path.sep)) throw fail(400, "Delete includes a path outside of the app store.");
      try {
        const st = await fs.lstat(absolute);
        if (st.isSymbolicLink() || !st.isFile()) throw fail(400, "Cannot safely delete a link or directory.");
        const real = await fs.realpath(absolute);
        if (real !== absolute) throw fail(400, 'The path contains a symbolic link.');
        valid.push(absolute);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    return valid;
  }
  async wipeFinish(input, actor) {
    return this.serial(async () => {
      this.role(actor, 'owner');
      const t = this.ticket(input.ticket, actor);
      if (!t.downloaded) throw fail(400, "First download the backup.");
      if (input.confirm !== "DELETE DATA" || hash(input.backupText || '') !== t.hash) throw fail(400, "Select the backup file you just downloaded and type DELETE DATA.");
      await this.decodeBackup(input.backupText);
      if (this.revision !== t.revision) throw fail(409, "The data has changed since the backup was downloaded. Download a new backup.");
      const paths = await this.wipeFiles();
      if (JSON.stringify(paths.sort()) !== JSON.stringify([...t.files].sort())) throw fail(409, "The list of data to delete has changed. Start again.");
      const marker = path.join(this.root, 'wipe-pending.json');
      await atomic(marker, JSON.stringify({
        files: paths
      }));
      this.generation++;
      this.db.close();
      try {
        for (const p of paths) await fs.unlink(p).catch(e => {
          if (e.code !== 'ENOENT') throw e;
        });
        await fs.unlink(marker);
        this.open();
        this.transaction(() => this.writeAll(emptyState()));
        this.setMeta('backupFolder', this.initialFolder);
        this.tickets.clear();
        return {
          wiped: true
        };
      } catch (e) {
        this.open();
        this.blocked = true;
        throw fail(500, "Deletion was not completed. The backup is saved in your downloaded file. " + e.message);
      }
    });
  }
}
