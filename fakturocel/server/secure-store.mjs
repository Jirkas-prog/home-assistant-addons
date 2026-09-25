import fs from 'node:fs/promises';
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { Store, atomic, hash, fail } from './store.mjs';
import { emptyState, unpackBackup, validateState } from '../src/model.js';
import { createContext, encryptText, decryptWithContext, unlockEnvelope, isEncrypted, parseEnvelope, verifyPassword, recoveryKey } from './encryption.mjs';
const legacyName = /^(data\.fakturocel|predchozi\.fakturocel|pred-obnovou-.+\.fakturocel|fakturocel-v3\.sqlite(?:-journal|-wal|-shm)?|config\.json)(?:\.[a-f0-9-]{36}\.tmp)?$/;
const backupName = /^(Fakturocel|Before-restore|Before-transfer|Before-sync-rollback|After-sync-rollback|Pred-obnovou|Pred-prenosem)-.+\.fakturocel(?:\.[a-f0-9-]{36}\.tmp)?$/;
const temporaryVaultName = /^fakturocel-(?:vault|keys)\.json\.[a-f0-9-]{36}\.tmp$/;
async function optional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function atomicSync(file, text) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  let fd,
    replaced = false;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, file);
    replaced = true;
    if (process.platform !== 'win32') {
      fd = openSync(path.dirname(file), 'r');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
    }
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {}
    e.replaced = replaced;
    throw e;
  }
}

// SQLite runs only in RAM. The single durable snapshot contains all records,
// metadata, history and binary attachments, encrypted before it reaches disk.
export class SecureStore extends Store {
  constructor(options) {
    super({
      ...options,
      memory: true
    });
    this.file = path.join(this.root, "fakturocel-vault.json");
    this.keyFile = path.join(this.root, "fakturocel-keys.json");
    this.configured = false;
    this.locked = false;
    this.ready = false;
    this.depth = 0;
    this.context = null;
    this.transitioning = false;
    this.attempts = new Map();
  }
  async init() {
    const saved = await optional(this.file);
    this.hasLegacy = (await fs.readdir(this.root)).some(n => legacyName.test(n));
    if (saved === null) return;
    if (isEncrypted(saved)) {
      const envelope = parseEnvelope(saved, 'storage');
      this.configured = true;
      this.locked = true;
      const ring = await this.readKeys();
      if (ring === null) return;
      if (ring.format !== 'FakturocelLocalKeys' || ring.version !== 1 || !Array.isArray(ring.keys)) throw Error("The stored key is corrupted. Restore the key file from a full Home Assistant backup.");
      const entry = ring.keys.find(k => k.id === hash(JSON.stringify(envelope.wrap)));
      if (!entry || !/^([A-Za-z0-9+/]{43})=$/.test(entry.key)) throw Error("Corresponding key is missing for stored data. The original data has not been changed.");
      const context = {
        key: Buffer.from(entry.key, 'base64'),
        wrap: envelope.wrap
      };
      try {
        this.loadSnapshot(decryptWithContext(saved, context, 'storage'));
        this.context = context;
        this.locked = false;
        this.ready = true;
        await this.finishMigration();
        await this.rememberKey(context, true);
      } catch (e) {
        context.key.fill(0);
        throw e;
      }
      return;
    }
    this.loadSnapshot(saved);
    this.configured = true;
    this.ready = true;
    await this.forgetKeys();
  }
  async readKeys() {
    let st;
    try {
      st = await fs.lstat(this.keyFile);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    if (!st.isFile() || st.isSymbolicLink() || (await fs.realpath(this.keyFile)) !== this.keyFile) throw fail(400, "The key file contains an illegal link.");
    try {
      return JSON.parse(await fs.readFile(this.keyFile, 'utf8'));
    } catch {
      throw fail(400, "The stored key file is corrupted. Restore it from a full Home Assistant backup.");
    }
  }
  async rememberKey(context, prune = false) {
    const entry = {
      id: hash(JSON.stringify(context.wrap)),
      key: context.key.toString('base64')
    };
    let keys = [];
    if (!prune) {
      const ring = await this.readKeys();
      if (ring) {
        if (ring.format !== 'FakturocelLocalKeys' || !Array.isArray(ring.keys)) throw fail(400, "The stored key is corrupted.");
        keys = ring.keys.filter(k => k.id !== entry.id);
      }
    }
    await atomic(this.keyFile, JSON.stringify({
      format: 'FakturocelLocalKeys',
      version: 1,
      keys: [...keys, entry]
    }));
    await fs.chmod(this.keyFile, 0o600);
  }
  async forgetKeys() {
    await fs.unlink(this.keyFile).catch(e => {
      if (e.code !== 'ENOENT') throw e;
    });
    for (const name of await fs.readdir(this.root)) if (/^fakturocel-keys\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) {
      const file = await this.safeExisting(path.join(this.root, name), 'legacy');
      await fs.unlink(file);
    }
  }
  recoveryKey() {
    if (!this.context) throw fail(400, "Encryption is disabled.");
    return recoveryKey(this.context);
  }
  keyId() {
    return this.context ? hash(this.context.key).slice(0, 16).toUpperCase() : null;
  }
  status() {
    return {
      blocked: !!this.blocked,
      configured: this.configured,
      locked: this.locked,
      encrypted: this.locked || !!this.context,
      legacy: this.hasLegacy,
      migrationPending: !!this.pendingMigration(),
      transitioning: this.transitioning,
      keyRemembered: !!this.context,
      keyId: this.keyId(),
      pinEnabled: !!this.meta('accessPin')
    };
  }
  pendingMigration() {
    return this.ready ? super.meta('encryptionMigration') : null;
  }
  available() {
    if (this.blocked) throw fail(503, "The save was not completed. Restart the addon and unlock it again.");
    if (!this.configured || this.locked || this.transitioning || this.pendingMigration()) throw fail(423, "First, set up or unlock secure storage.");
  }
  read() {
    this.available();
    return super.read();
  }
  snapshot() {
    return JSON.stringify({
      format: 'FakturocelStorage',
      version: 1,
      records: this.db.prepare('SELECT * FROM records').all(),
      meta: this.db.prepare('SELECT * FROM meta').all(),
      blobs: this.db.prepare('SELECT * FROM blobs').all().map(b => ({
        ...b,
        data: Buffer.from(b.data).toString('base64')
      }))
    });
  }
  loadSnapshot(text) {
    const s = JSON.parse(text);
    if (s.format !== 'FakturocelStorage' || s.version !== 1 || !Array.isArray(s.records) || !Array.isArray(s.meta) || !Array.isArray(s.blobs)) throw fail(400, "The saved data has an invalid format.");
    this.depth++;
    try {
      super.transaction(() => {
        this.db.exec('DELETE FROM records; DELETE FROM meta; DELETE FROM blobs;');
        for (const r of s.records) this.db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(r.collection, r.id, r.rev, r.value);
        for (const r of s.meta) this.db.prepare('INSERT INTO meta VALUES (?,?)').run(r.key, r.value);
        for (const r of s.blobs) this.db.prepare('INSERT INTO blobs VALUES (?,?,?,?)').run(r.hash, r.mime, r.name, Buffer.from(r.data, 'base64'));
      });
      validateState(super.read().state);
    } finally {
      this.depth--;
    }
  }
  flush() {
    if (this.blocked) throw fail(503, "The entry could not be reliably confirmed. Restart the add-on.");
    if (!this.ready || this.depth) return;
    const text = this.snapshot();
    if (text.length > 300 * 1024 * 1024) throw fail(400, "Storage exceeds supported size.");
    try {
      atomicSync(this.file, this.context ? encryptText(text, this.context, 'storage') : text);
    } catch (e) {
      if (e.replaced) {
        this.blocked = true;
        throw fail(503, "The entry could not be reliably confirmed. Restart the add-on before making further modifications.");
      }
      throw e;
    }
  }
  transaction(fn) {
    this.depth++;
    try {
      return super.transaction(() => {
        const result = fn();
        this.depth--;
        try {
          this.flush();
        } finally {
          this.depth++;
        }
        return result;
      });
    } finally {
      this.depth--;
    }
  }
  setMeta(key, value) {
    if (this.depth || !this.ready) return super.setMeta(key, value);
    return this.transaction(() => super.setMeta(key, value));
  }
  role(actor, level = 'edit') {
    actor.validateAccess?.();
    return super.role(actor, level);
  }
  actor(id, name) {
    this.available();
    return super.actor(id, name);
  }
  securityActor(id, name) {
    if (this.blocked) throw fail(503, "Restart the plugin to complete the write.");
    if (!this.configured || !this.ready || this.locked) throw fail(423, "First load the encryption key.");
    return super.actor(id, name);
  }
  async loadLegacy() {
    this.db.close();
    this.open();
    const dbFile = path.join(this.root, "fakturocel-v3.sqlite");
    let db;
    try {
      await this.safeExisting(dbFile, 'legacy');
      db = new DatabaseSync(dbFile, {
        readOnly: true
      });
      this.loadSnapshot(JSON.stringify({
        format: 'FakturocelStorage',
        version: 1,
        records: db.prepare('SELECT * FROM records').all(),
        meta: db.prepare('SELECT * FROM meta').all(),
        blobs: db.prepare('SELECT * FROM blobs').all().map(b => ({
          ...b,
          data: Buffer.from(b.data).toString('base64')
        }))
      }));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const file = path.join(this.root, "data.fakturocel"),
        legacy = await optional(file),
        source = legacy ? await unpackBackup(legacy) : {
          data: emptyState(),
          blobs: {}
        };
      this.transaction(() => this.writeAll(source.data, source.blobs));
      super.setMeta('backupFolder', this.initialFolder);
    } finally {
      db?.close();
    }
  }
  async safeExisting(file, kind) {
    const p = path.resolve(file),
      inData = path.dirname(p) === this.root && (legacyName.test(path.basename(p)) || temporaryVaultName.test(path.basename(p))),
      inShare = p.startsWith(this.shareRoot + path.sep) && backupName.test(path.basename(p));
    if (kind === 'legacy' ? !inData : !inShare) throw fail(400, "The file is not in managed storage.");
    const st = await fs.lstat(p);
    if (!st.isFile() || st.isSymbolicLink() || (await fs.realpath(p)) !== p) throw fail(400, "The repository contains an unauthorized link.");
    return p;
  }
  async migrationPlan() {
    const all = await this.wipeFiles();
    return {
      backups: all.filter(p => p.startsWith(this.shareRoot + path.sep)),
      remove: all.filter(p => path.dirname(p) === this.root && (legacyName.test(path.basename(p)) || temporaryVaultName.test(path.basename(p))))
    };
  }
  async finishMigration() {
    const plan = this.pendingMigration();
    if (!plan) return;
    this.transitioning = true;
    try {
      if (!this.context) throw fail(400, "The encryption key is missing to complete the conversion.");
      for (const p of plan.backups) {
        try {
          await this.safeExisting(p, 'backup');
          const text = await fs.readFile(p, 'utf8');
          if (!isEncrypted(text)) await atomic(p, encryptText(text, this.context, 'backup'));
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      for (const p of plan.remove) {
        try {
          await this.safeExisting(p, 'legacy');
          await fs.unlink(p);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
      this.setMeta('encryptionMigration', null);
      this.hasLegacy = false;
    } finally {
      this.transitioning = false;
    }
  }
  async setup(input, id, name) {
    return this.serial(async () => {
      if (this.blocked) throw fail(503, "Restart the plugin to complete the write.");
      if (this.configured) throw fail(409, "Security has already been set up. Refresh the page.");
      if (input.enabled !== true && input.enabled !== false) throw fail(400, "Choose a security method.");
      if (!input.enabled && input.confirm !== "DISABLE ENCRYPTION") throw fail(400, "Confirm notification of other users' access.");
      await this.loadLegacy();
      const actor = super.actor(id, name);
      super.role(actor, 'owner');
      let context;
      try {
        if (input.enabled) {
          context = await createContext(input.password || randomBytes(32).toString('base64url'));
          await this.rememberKey(context);
          super.setMeta('encryptionMigration', await this.migrationPlan());
        }
        this.context = context || null;
        this.ready = true;
        this.flush();
        this.configured = true;
        this.locked = false;
        await this.finishMigration();
        if (context) await this.rememberKey(context, true);else await this.forgetKeys();
        return this.status();
      } catch (e) {
        if (!this.configured) {
          this.ready = false;
          context?.key.fill(0);
          this.context = null;
        }
        throw e;
      }
    });
  }
  async checkPassword(password) {
    if (!this.context) throw fail(400, "Encryption is not enabled.");
    await verifyPassword(this.context, password);
  }
  async unlock(password, id, name) {
    return this.serial(async () => {
      if (this.blocked) throw fail(503, "Restart the plugin to complete the write.");
      if (!this.configured || !this.locked) throw fail(409, "Storage is not locked. Refresh the page.");
      const a = this.attempts.get(id) || {
        count: 0,
        until: 0
      };
      if (a.until > Date.now()) throw fail(429, "Too many attempts. Wait a moment and try again.");
      let result;
      try {
        result = await unlockEnvelope(await fs.readFile(this.file, 'utf8'), password, 'storage');
        this.loadSnapshot(result.content);
        const actor = super.actor(id, name);
        super.role(actor);
        await this.rememberKey(result.context);
        this.context = result.context;
        this.locked = false;
        this.ready = true;
        await this.finishMigration();
        this.flush();
        await this.rememberKey(this.context, true);
        this.attempts.delete(id);
        return this.status();
      } catch (e) {
        if (this.locked) {
          result?.context.key.fill(0);
          this.db.close();
          this.open();
          a.count++;
          a.until = Date.now() + Math.min(60000, Math.max(0, a.count - 3) * 5000);
          this.attempts.set(id, a);
        }
        throw e;
      }
    });
  }
  async changeSecurity(input, actor) {
    return this.serial(async () => {
      this.available();
      this.role(actor, 'owner');
      if (input.enabled !== true && input.enabled !== false) throw fail(400, "Choose a security method.");
      if (this.context && input.password && !input.rotate) await this.checkPassword(input.currentPassword);
      if (!input.enabled && input.confirm !== "DISABLE ENCRYPTION") throw fail(400, "Confirm notification of other users' access.");
      const old = this.context,
        before = this.snapshot(),
        next = input.enabled ? old && !input.password && !input.rotate ? old : await createContext(input.password || randomBytes(32).toString('base64url')) : null;
      if (next) await this.rememberKey(next);
      this.depth++;
      try {
        if (next && !old) super.setMeta('encryptionMigration', await this.migrationPlan());
        this.event(actor, input.enabled ? 'encryption-enabled' : 'encryption-disabled', 'security', 'security', null, null, "Change storage security");
        super.setMeta('revision', this.revision + 1);
      } finally {
        this.depth--;
      }
      this.context = next;
      try {
        this.flush();
      } catch (e) {
        this.context = old;
        if (next !== old) next?.key.fill(0);
        this.loadSnapshot(before);
        throw e;
      }
      if (old !== next) old?.key.fill(0);
      this.tickets.clear();
      await this.finishMigration();
      if (next) await this.rememberKey(next, true);else await this.forgetKeys();
      return this.status();
    });
  }
  async retryMigration(actorId, name) {
    return this.serial(async () => {
      if (!this.ready || this.locked) throw fail(423, "Unlock storage first.");
      const actor = super.actor(actorId, name);
      super.role(actor, 'owner');
      await this.finishMigration();
      return this.status();
    });
  }
  async backupText() {
    const text = await super.backupText();
    return this.context ? encryptText(text, this.context, 'backup') : text;
  }
  async decryptExport(text, password, purpose = 'backup') {
    if (!isEncrypted(text)) return text;
    if (password) {
      const r = await unlockEnvelope(text, password, purpose);
      try {
        return r.content;
      } finally {
        r.context.key.fill(0);
      }
    }
    if (this.context) {
      try {
        return decryptWithContext(text, this.context, purpose);
      } catch {}
    }
    throw fail(422, "Enter the recovery key from PDF or the original password of this backup.");
  }
  async decodeBackup(text) {
    return unpackBackup(await this.decryptExport(text));
  }
  async restoreEncrypted(text, password, rev, actor) {
    this.role(actor, 'owner');
    const plain = await this.decryptExport(text, password);
    return super.restore(plain, rev, actor);
  }
  async upload(bytes, mime, name, actor) {
    const before = this.snapshot();
    try {
      const result = await super.upload(bytes, mime, name, actor);
      this.flush();
      return result;
    } catch (e) {
      this.loadSnapshot(before);
      throw e;
    }
  }
  async wipeFiles() {
    const files = await super.wipeFiles();
    for (const name of await fs.readdir(this.root)) if (/^fakturocel-(?:vault|keys|tls)\.json(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name)) {
      const p = path.join(this.root, name),
        st = await fs.lstat(p);
      if (!st.isFile() || st.isSymbolicLink() || (await fs.realpath(p)) !== p) throw fail(400, "The repository contains an unauthorized link.");
      files.push(p);
    }
    return [...new Set(files)];
  }
  async verifyWipeBackup(input, actor) {
    this.role(actor, 'owner');
    const t = this.ticket(input.ticket, actor);
    if (!t.downloaded || input.text !== t.text) throw fail(400, "Select the backup you just downloaded.");
    if (this.context && !t.recoveryDownloaded) throw fail(400, "Also download PDF with recovery key before deleting.");
    await this.decodeBackup(input.text);
    t.verified = true;
    return {
      verified: true
    };
  }
  async wipeFinish(input, actor) {
    return this.serial(async () => {
      this.available();
      this.role(actor, 'owner');
      const t = this.ticket(input.ticket, actor);
      if (!t.downloaded) throw fail(400, "First download the backup.");
      if (input.confirm !== "DELETE DATA" || hash(input.backupText || '') !== t.hash) throw fail(400, "Select the backup file you just downloaded and type DELETE DATA.");
      await this.decodeBackup(input.backupText);
      if (this.revision !== t.revision) throw fail(409, "The data has changed since the backup was downloaded. Download a new backup.");
      const files = await this.wipeFiles();
      if (JSON.stringify(files.sort()) !== JSON.stringify([...t.files].sort())) throw fail(409, "The list of data to delete has changed. Start again.");
      if (this.context && !t.verified) throw fail(400, "Before deleting, download the recovery key and verify the downloaded backup.");
      const marker = path.join(this.root, 'wipe-pending.json');
      await atomic(marker, JSON.stringify({
        files
      }));
      this.generation++;
      this.ready = false;
      this.db.close();
      try {
        for (const p of files) await fs.unlink(p).catch(e => {
          if (e.code !== 'ENOENT') throw e;
        });
        await fs.unlink(marker);
        this.open();
        this.context?.key.fill(0);
        this.context = null;
        this.configured = false;
        this.locked = false;
        this.hasLegacy = false;
        this.tickets.clear();
        return {
          wiped: true
        };
      } catch (e) {
        this.open();
        this.blocked = true;
        throw fail(500, "Deletion was not completed. Restart the add-on. The withdrawn backup remains with you.");
      }
    });
  }
  close() {
    this.context?.key.fill(0);
    this.context = null;
    super.close();
  }
}
