import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecureStore } from '../server/secure-store.mjs';
import { Store, hash, finishPendingWipe } from '../server/store.mjs';
import { createContext, encryptText, decryptWithContext, unlockEnvelope, isEncrypted } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';
import { createApp } from '../server/server.mjs';
import officeCrypto from 'officecrypto-tool';
import JSZip from 'jszip';
const password = 'Long test phrase 739! ασφαλές',
  nextPassword = 'Different test phrase 842!',
  actor = {
    id: 'owner',
    name: 'Synthetic owner',
    role: 'owner'
  },
  webRoot = fileURLToPath(new URL('../public', import.meta.url));
async function fixture(Type = SecureStore) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-security-")),
    options = {
      root: path.join(base, 'data'),
      shareRoot: path.join(base, 'share'),
      backupFolder: path.join(base, 'share', 'backups'),
      webRoot
    };
  const store = new Type(options);
  await store.init();
  return {
    store,
    options,
    base
  };
}
async function enable(store) {
  await store.setup({
    enabled: true,
    password
  }, actor.id, actor.name);
}
async function seed(store) {
  await store.commit({
    ops: [{
      collection: 'companies',
      id: 'test-customer',
      rev: 0,
      value: {
        id: 'test-customer',
        name: 'PRIVATE_SECURITY_MARKER',
        street: 'SECRET_TEST_STREET'
      }
    }]
  }, actor);
}
async function files(root) {
  const found = [];
  for (const e of await fs.readdir(root, {
    withFileTypes: true
  })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) found.push(...(await files(p)));else found.push(p);
  }
  return found;
}
test('authenticated encryption uses distinct nonces, detects changes, rejects hostile KDF parameters', async () => {
  const ctx = await createContext(password);
  try {
    const a = encryptText('PRIVATE_SECURITY_MARKER', ctx, 'backup'),
      b = encryptText('PRIVATE_SECURITY_MARKER', ctx, 'backup');
    assert.notEqual(a, b);
    assert(!a.includes('PRIVATE_SECURITY_MARKER'));
    assert.equal(decryptWithContext(a, ctx, 'backup'), 'PRIVATE_SECURITY_MARKER');
    assert.throws(() => decryptWithContext(a, ctx, 'template'));
    const r = await unlockEnvelope(a, password, 'backup');
    assert.equal(r.content, 'PRIVATE_SECURITY_MARKER');
    r.context.key.fill(0);
    await assert.rejects(unlockEnvelope(a, 'Wrong password 123', 'backup'));
    for (const key of ['iv', 'tag', 'data']) {
      const c = JSON.parse(a),
        bytes = Buffer.from(c[key], 'base64');
      bytes[0] ^= 1;
      c[key] = bytes.toString('base64');
      assert.throws(() => decryptWithContext(JSON.stringify(c), ctx, 'backup'));
    }
    const bad = JSON.parse(a);
    bad.wrap.kdf.N = 2 ** 30;
    await assert.rejects(unlockEnvelope(JSON.stringify(bad), password, 'backup'), /parameters/);
  } finally {
    ctx.key.fill(0);
  }
});
test('encrypted storage has no plaintext files, automatically opens after restart and preserves old backups across key change', async () => {
  const f = await fixture();
  let store = f.store;
  try {
    assert.throws(() => store.read(), e => e.status === 423);
    await enable(store);
    await seed(store);
    const original = await store.backupText(),
      state = store.read().state;
    for (const p of await files(f.base)) {
      const bytes = await fs.readFile(p);
      assert(!bytes.includes(Buffer.from('PRIVATE_SECURITY_MARKER')), p);
      assert(!bytes.includes(Buffer.from('SECRET_TEST_STREET')), p);
      assert(!bytes.includes(Buffer.from(password)), p);
      assert(!p.endsWith('.sqlite'), p);
    }
    store.close();
    store = new SecureStore(f.options);
    await store.init();
    assert(!store.status().locked);
    assert(store.status().keyRemembered);
    assert(!store.status().pinEnabled);
    assert.deepEqual(store.read().state, state);
    await store.changeSecurity({
      enabled: true,
      currentPassword: password,
      password: nextPassword
    }, actor);
    const updated = await store.backupText();
    await assert.rejects(unlockEnvelope(updated, password, 'backup'));
    const now = await unlockEnvelope(updated, nextPassword, 'backup');
    assert.equal((await unpackBackup(now.content)).data.companies[0].name, 'PRIVATE_SECURITY_MARKER');
    now.context.key.fill(0);
    const old = await unlockEnvelope(original, password, 'backup');
    assert.equal((await unpackBackup(old.content)).data.companies.length, 1);
    old.context.key.fill(0);
    store.close();
    store = new SecureStore(f.options);
    await store.init();
    assert.equal(store.read().state.companies.length, 1);
  } finally {
    store.close();
  }
});
test('enabling encrypts managed legacy backups, removes plaintext database, resumes interrupted migration', async () => {
  const f = await fixture(Store);
  await seed(f.store);
  f.store.actor(actor.id, actor.name);
  const before = f.store.read().state;
  f.store.close();
  await fs.writeFile(path.join(f.options.root, "fakturocel-vault.json.12345678-1234-1234-1234-123456789abc.tmp"), 'PRIVATE_SECURITY_MARKER');
  let store = new SecureStore(f.options);
  await store.init();
  const safe = store.safeExisting.bind(store);
  let interrupted = true;
  store.safeExisting = async (p, kind) => {
    if (kind === 'backup' && interrupted) {
      interrupted = false;
      throw Error('Synthetic interrupted migration');
    }
    return safe(p, kind);
  };
  try {
    await assert.rejects(enable(store), /interrupted/);
    assert(store.status().migrationPending);
    assert.throws(() => store.read(), e => e.status === 423);
    store.close();
    store = new SecureStore(f.options);
    await store.init();
    assert.deepEqual(store.read().state, before);
    assert(!store.status().migrationPending);
    for (const p of await files(f.base)) {
      assert(!p.endsWith('.sqlite'));
      assert(!(await fs.readFile(p)).includes(Buffer.from('PRIVATE_SECURITY_MARKER')), p);
      if (p.endsWith(".fakturocel")) assert(isEncrypted(await fs.readFile(p, 'utf8')));
    }
  } finally {
    store.close();
  }
});
test('disable requires explicit warning acknowledgement; failed disk writes roll back', async () => {
  const {
    store,
    options
  } = await fixture();
  try {
    await enable(store);
    await seed(store);
    const before = store.read().state,
      originalFile = store.file;
    store.file = options.root;
    await assert.rejects(store.commit({
      ops: [{
        collection: 'companies',
        id: 'failed',
        rev: 0,
        value: {
          id: 'failed',
          name: 'Not saved'
        }
      }]
    }, actor));
    assert.deepEqual(store.read().state, before);
    store.file = originalFile;
    await assert.rejects(store.changeSecurity({
      enabled: false,
      currentPassword: password
    }, actor), /Confirm/);
    assert(store.context);
    await store.changeSecurity({
      enabled: false,
      currentPassword: password,
      confirm: "DISABLE ENCRYPTION"
    }, actor);
    assert(!store.status().encrypted);
    assert((await fs.readFile(store.file, 'utf8')).includes('PRIVATE_SECURITY_MARKER'));
  } finally {
    store.close();
  }
});
test('encrypted wipe still requires exact downloaded backup and returns to empty security setup', async () => {
  const {
    store,
    options
  } = await fixture();
  try {
    await enable(store);
    await seed(store);
    const prepared = await store.wipePrepare(store.revision, actor),
      ticket = store.ticket(prepared.ticket, actor),
      text = ticket.text;
    assert(isEncrypted(text));
    await assert.rejects(store.wipeFinish({
      ticket: prepared.ticket,
      backupText: text,
      confirm: "DELETE DATA"
    }, actor), /download/);
    ticket.downloaded = true;
    await assert.rejects(store.wipeFinish({
      ticket: prepared.ticket,
      backupText: text + ' ',
      confirm: "DELETE DATA"
    }, actor), /downloaded/);
    await assert.rejects(store.wipeFinish({
      ticket: prepared.ticket,
      backupText: text,
      confirm: "DELETE DATA"
    }, actor), /verify/);
    await assert.rejects(store.verifyWipeBackup({
      ticket: prepared.ticket,
      text
    }, actor), /PDF/);
    ticket.recoveryDownloaded = true;
    await store.verifyWipeBackup({
      ticket: prepared.ticket,
      text
    }, actor);
    await store.wipeFinish({
      ticket: prepared.ticket,
      backupText: text,
      confirm: "DELETE DATA"
    }, actor);
    assert(!store.status().configured);
    const remainingFiles = await files(options.root);
    assert.equal(remainingFiles.length, 0, remainingFiles.join(', '));
    const r = await unlockEnvelope(text, password, 'backup');
    assert.equal((await unpackBackup(r.content)).data.companies.length, 1);
    r.context.key.fill(0);
  } finally {
    store.close();
  }
});
test('legacy 3.2 migration remembers the key after one authorized unlock', async () => {
  const f = await fixture();
  let store = f.store;
  await enable(store);
  await seed(store);
  const key = store.recoveryKey();
  store.close();
  await fs.unlink(path.join(f.options.root, "fakturocel-keys.json"));
  store = new SecureStore(f.options);
  try {
    await store.init();
    assert(store.status().locked);
    await assert.rejects(store.unlock(password, 'unknown-user', 'Unknown'), e => e.status === 403);
    assert(store.status().locked);
    await assert.rejects(store.unlock('Wrong password', actor.id, actor.name));
    await store.unlock(password, actor.id, actor.name);
    assert.equal(store.recoveryKey(), key);
    store.close();
    store = new SecureStore(f.options);
    await store.init();
    assert(!store.status().locked);
    assert.equal(store.read().state.companies.length, 1);
  } finally {
    store.close();
  }
});
test('interrupted encrypted wipe removes vault and managed backups on restart', async () => {
  const {
    store,
    options
  } = await fixture();
  await enable(store);
  await seed(store);
  const list = await store.wipeFiles();
  await fs.writeFile(path.join(options.root, 'wipe-pending.json'), JSON.stringify({
    files: list
  }));
  store.close();
  await finishPendingWipe(options);
  const clean = new SecureStore(options);
  try {
    await clean.init();
    assert(!clean.status().configured);
    assert.equal((await files(options.root)).length, 0);
    assert.equal((await files(options.shareRoot)).length, 0);
  } finally {
    clean.close();
  }
});
test('corrupt storage never silently starts with an empty replacement', async () => {
  const {
    store,
    options
  } = await fixture();
  await enable(store);
  await seed(store);
  const file = store.file;
  store.close();
  const broken = (await fs.readFile(file, 'utf8')).slice(0, -5);
  await fs.writeFile(file, broken);
  const next = new SecureStore(options);
  try {
    await assert.rejects(next.init());
    assert.equal(await fs.readFile(file, 'utf8'), broken);
    assert(!next.status().configured);
  } finally {
    next.close();
  }
});
test('HTTP gate, encrypted Excel and template export, restore password and lock keep data protected', async () => {
  const f = await fixture();
  f.store.close();
  const app = await createApp({
    ...f.options,
    allowRequest: () => true
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port,
    headers = {
      'x-remote-user-id': actor.id,
      'Content-Type': 'application/json'
    };
  let csrf;
  const get = async p => fetch(base + '/api/' + p, {
      headers
    }),
    post = async (p, v) => fetch(base + '/api/' + p, {
      method: 'POST',
      headers: {
        ...headers,
        "x-fakturocel-token": csrf
      },
      body: JSON.stringify(v)
    });
  try {
    assert.equal((await get('state')).status, 423);
    csrf = (await (await get('security')).json()).csrf;
    assert.equal((await post('security/setup', {
      enabled: true,
      password
    })).status, 200);
    csrf = (await (await get('security')).json()).csrf;
    await seed(app.store);
    const excel = await post('export/excel', {});
    assert.equal(excel.status, 200);
    const bytes = Buffer.from(await excel.arrayBuffer());
    assert(officeCrypto.isEncrypted(bytes));
    assert(!bytes.includes(Buffer.from('PRIVATE_SECURITY_MARKER')));
    const plain = await officeCrypto.decrypt(bytes, {
        password: app.store.recoveryKey()
      }),
      zip = await JSZip.loadAsync(plain);
    assert(await zip.file('xl/workbook.xml').async('string'));
    const template = {
      format: 'FakturocelTemplate',
      version: 1,
      template: {
        name: 'PRIVATE_SECURITY_MARKER'
      }
    };
    const sealed = await (await post('export/template', {
      bundle: template
    })).json();
    assert(isEncrypted(sealed.text));
    assert(!sealed.text.includes('PRIVATE_SECURITY_MARKER'));
    const imported = await (await post('import/template', {
      text: sealed.text,
      password
    })).json();
    assert.deepEqual(imported.bundle, template);
    const backup = await (await get('backup')).text();
    assert.equal((await post('restore/preview', {
      text: backup,
      password: 'wrong'
    })).status, 400);
    const preview = await (await post('restore/preview', {
      text: backup,
      password
    })).json();
    assert.equal(preview.companies, 1);
    assert.equal((await post('security/pin', {
      enabled: true,
      pin: '739184'
    })).status, 200);
    assert.equal((await get('backup')).status, 423);
    assert.equal((await get('state')).status, 423);
    assert.equal((await get('blob/' + hash('x'))).status, 423);
    const raw = await fs.readFile(app.store.file, 'utf8');
    assert(!raw.includes('PRIVATE_SECURITY_MARKER'));
  } finally {
    await app.close();
  }
});
