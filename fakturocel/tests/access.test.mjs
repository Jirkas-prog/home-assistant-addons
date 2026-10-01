import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/server.mjs';
import { SecureStore } from '../server/secure-store.mjs';
import { unlockEnvelope } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';
import { PDFDocument } from 'pdf-lib';
const webRoot = fileURLToPath(new URL('../public', import.meta.url));
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "Fakturocel-access-")),
    options = {
      root: path.join(base, 'data'),
      shareRoot: path.join(base, 'share'),
      backupFolder: path.join(base, 'share', 'backups'),
      webRoot,
      allowRequest: () => true
    };
  const app = await createApp(options);
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port;
  let csrf = '';
  const cookies = {};
  const request = async (route, data, {
    device = 'a',
    id = 'owner',
    rawCookie
  } = {}) => {
    const res = await fetch(url + '/api/' + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        'x-remote-user-id': id,
        'content-type': 'application/json',
        "x-fakturocel-token": csrf,
        cookie: rawCookie ?? cookies[device] ?? '',
        'x-ingress-path': '/api/hassio_ingress/test'
      },
      body: data ? JSON.stringify(data) : undefined
    });
    const cookie = res.headers.get('set-cookie');
    if (cookie) cookies[device] = cookie.split(';')[0];
    if (route === 'security' && res.ok) csrf = (await res.clone().json()).csrf;
    return res;
  };
  await request('security');
  await request('security/setup', {
    enabled: true
  });
  await request('security');
  return {
    app,
    options,
    base,
    request,
    cookies
  };
}
test('PIN defaults off; grants are per browser and HA user, roles and all data routes remain protected', async () => {
  const f = await fixture(),
    {
      app,
      request: r,
      cookies
    } = f;
  try {
    assert.equal(app.store.status().pinEnabled, false);
    assert.equal((await r('state', null, {
      device: 'b'
    })).status, 200);
    const configured = await r('security/pin', {
      enabled: true,
      pin: '739184'
    });
    assert.equal(configured.status, 200);
    assert.match(configured.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.match(configured.headers.get('set-cookie'), /Path=\/api\/hassio_ingress\/test\//);
    await r('security');
    assert.equal((await r('state')).status, 200);
    for (const route of ['state', 'meta', 'backup', 'blob/' + 'a'.repeat(64), 'security/recovery.pdf']) assert.equal((await r(route, null, {
      device: 'b'
    })).status, 423, route);
    assert.equal((await r('state', null, {
      id: 'other',
      rawCookie: cookies.a
    })).status, 423);
    for (const route of ['commit', 'export/excel', 'restore', 'security/change', 'security/pin', 'wipe/prepare']) assert.equal((await r(route, {}, {
      device: 'b'
    })).status, 423, route);
    assert.equal((await r('security/pin-login', {
      pin: '000000'
    }, {
      device: 'b'
    })).status, 400);
    assert.equal((await r('security/pin-login', {
      pin: '739184'
    }, {
      device: 'b'
    })).status, 200);
    assert.equal((await r('state', null, {
      device: 'b'
    })).status, 200);
    await r('security/lock', {});
    assert.equal((await r('state')).status, 423);
    assert.equal((await r('state', null, {
      device: 'b'
    })).status, 200);
    await r('security/pin-login', {
      pin: '739184'
    });
    await r('security');
    assert.equal((await r('security/pin', {
      enabled: false,
      currentPin: '999999'
    })).status, 400);
    assert.equal((await r('security/pin', {
      enabled: true,
      currentPin: '739184',
      pin: '826491'
    })).status, 200);
    await r('security');
    assert.equal((await r('state', null, {
      device: 'b'
    })).status, 423);
    const actor = app.store.actor('owner', 'Owner');
    app.store.setMeta('roles', {
      owner: {
        name: 'Owner',
        role: 'owner'
      },
      reader: {
        name: 'Reader',
        role: 'reader'
      }
    });
    await r('security/pin-login', {
      pin: '826491'
    }, {
      device: 'reader',
      id: 'reader'
    });
    assert.equal((await r('state', null, {
      device: 'reader',
      id: 'reader'
    })).status, 200);
    assert.equal((await r('security/recovery.pdf', null, {
      device: 'reader',
      id: 'reader'
    })).status, 403);
    assert.equal((await r('security/pin', {
      enabled: false,
      currentPin: '826491'
    }, {
      device: 'reader',
      id: 'reader'
    })).status, 403);
    for (let i = 0; i < 4; i++) assert.equal((await r('security/pin-login', {
      pin: '000000'
    }, {
      device: 'reader2',
      id: 'reader'
    })).status, 400);
    assert.equal((await r('security/pin-login', {
      pin: '826491'
    }, {
      device: 'reader2',
      id: 'reader'
    })).status, 429);
    const readerToken = cookies.reader.split('=')[1];
    app.access.sessions.get(readerToken).until = Date.now() - 1;
    assert.equal((await r('state', null, {
      device: 'reader',
      id: 'reader'
    })).status, 423);
    assert(!JSON.stringify(app.store.read().state).includes('826491'));
    assert(!JSON.stringify(await app.store.backupText()).includes('accessPin'));
    // Queued writes recheck a grant revoked before the operation starts.
    const cookie = cookies.a,
      req = {
        headers: {
          cookie
        }
      },
      queuedActor = {
        ...actor,
        validateAccess: () => app.access.require(req, 'owner')
      };
    let release;
    const pending = app.store.serial(() => new Promise(resolve => release = resolve));
    await new Promise(resolve => setImmediate(resolve));
    const write = app.store.commit({
      ops: [{
        collection: 'companies',
        id: 'late',
        rev: 0,
        value: {
          id: 'late',
          name: 'Late'
        }
      }]
    }, queuedActor);
    app.access.sessions.clear();
    release();
    await pending;
    await assert.rejects(write, e => e.status === 423);
  } finally {
    await app.close();
  }
});
test('recovery PDF is generated, key restores another installation and resets owner PIN', async () => {
  const f = await fixture(),
    {
      app,
      request: r
    } = f;
  try {
    const actor = app.store.actor('owner', 'Owner');
    await app.store.commit({
      ops: [{
        collection: 'companies',
        id: 'sample',
        rev: 0,
        value: {
          id: 'sample',
          name: 'SYNTHETIC_RECOVERY_SAMPLE'
        }
      }]
    }, actor);
    const key = app.store.recoveryKey(),
      keyId = app.store.keyId(),
      backup = await app.store.backupText();
    const response = await r('security/recovery.pdf');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await fs.writeFile(path.join(f.base, 'recovery-sample.pdf'), bytes);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    const restored = await unlockEnvelope(backup, key, 'backup');
    assert.equal((await unpackBackup(restored.content)).data.companies[0].name, 'SYNTHETIC_RECOVERY_SAMPLE');
    restored.context.key.fill(0);
    const target = new SecureStore({
      ...f.options,
      root: path.join(f.base, 'other-data')
    });
    try {
      await target.init();
      await target.setup({
        enabled: true
      }, 'owner', 'Owner');
      assert.notEqual(target.recoveryKey(), key);
      await target.restoreEncrypted(backup, key, target.revision, actor);
      assert.equal(target.read().state.companies.length, 1);
      assert.equal(target.status().pinEnabled, false);
    } finally {
      target.close();
    }
    await r('security/pin', {
      enabled: true,
      pin: '123987'
    });
    await r('security');
    await r('security/lock', {});
    assert.equal((await r('security/pin-recover', {
      key: 'FC3-wrong'
    })).status, 400);
    assert.equal((await r('security/pin-recover', {
      key
    })).status, 200);
    await r('security');
    assert.equal((await r('state')).status, 200);
    assert.equal(app.store.status().pinEnabled, false);
    console.log('Synthetic recovery PDF:', path.join(f.base, 'recovery-sample.pdf'));
  } finally {
    await app.close();
  }
});
test('PIN survives restart with automatically loaded file key; missing or corrupt keys do not replace data', async () => {
  const f = await fixture();
  const {
    app,
    request: r
  } = f;
  await r('security/pin', {
    enabled: true,
    pin: '739184'
  });
  const key = app.store.recoveryKey(),
    vault = app.store.file,
    keyFile = app.store.keyFile;
  await app.close();
  const restarted = await createApp(f.options);
  try {
    assert.equal(restarted.store.recoveryKey(), key);
    assert(restarted.access.enabled());
    assert(!restarted.access.authenticated({
      headers: {}
    }, 'owner'));
    assert(!restarted.store.status().locked);
  } finally {
    await restarted.close();
  }
  const before = await fs.readFile(vault, 'utf8');
  await fs.writeFile(keyFile, 'broken key');
  await assert.rejects(createApp(f.options));
  assert.equal(await fs.readFile(vault, 'utf8'), before);
  await fs.unlink(keyFile);
  const missing = await createApp(f.options);
  try {
    assert(missing.store.status().locked);
    await missing.store.unlock(key, 'owner', 'Owner');
    assert.equal(missing.store.recoveryKey(), key);
    assert(missing.access.enabled());
  } finally {
    await missing.close();
  }
});
test('failed vault update and extra key entries retain the key that matches durable data', async () => {
  const f = await fixture(),
    {
      app
    } = f;
  try {
    const before = app.store.recoveryKey(),
      file = app.store.file;
    app.store.file = f.options.root;
    await assert.rejects(app.store.changeSecurity({
      enabled: false,
      confirm: "DISABLE ENCRYPTION"
    }, app.store.actor('owner', 'Owner')));
    app.store.file = file;
    assert.equal(app.store.recoveryKey(), before);
    const ring = JSON.parse(await fs.readFile(app.store.keyFile, 'utf8'));
    ring.keys.push({
      id: 'unused',
      key: Buffer.alloc(32, 1).toString('base64')
    });
    await fs.writeFile(app.store.keyFile, JSON.stringify(ring));
    await app.close();
    const next = await createApp(f.options);
    try {
      assert.equal(next.store.recoveryKey(), before);
      assert.equal(JSON.parse(await fs.readFile(next.store.keyFile, 'utf8')).keys.length, 1);
    } finally {
      await next.close();
    }
  } catch (e) {
    try {
      await app.close();
    } catch {}
    throw e;
  }
});
test('PIN login permits the owner to resume an interrupted migration without exposing data', async () => {
  const f = await fixture();
  try {
    await f.request('security/pin', {
      enabled: true,
      pin: '739184'
    });
    await f.request('security');
    f.app.store.setMeta('encryptionMigration', {
      backups: [],
      remove: []
    });
    f.app.access.clear();
    assert.equal((await f.request('security/pin-login', {
      pin: '739184'
    })).status, 200);
    assert.equal((await f.request('state')).status, 423);
    assert.equal((await f.request('security/retry', {})).status, 200);
    await f.request('security');
    assert.equal((await f.request('state')).status, 200);
  } finally {
    await f.app.close();
  }
});
test('owner rotates an automatically remembered key and can set a separate backup recovery password', async () => {
  const f = await fixture();
  try {
    const store = f.app.store,
      actor = store.actor('owner', 'Owner'),
      oldKey = store.recoveryKey(),
      oldBackup = await store.backupText();
    await store.changeSecurity({
      enabled: true,
      rotate: true,
      password: 'Synthetic recovery phrase 739184'
    }, actor);
    assert.notEqual(store.recoveryKey(), oldKey);
    const content = await store.backupText();
    const restored = await unlockEnvelope(content, 'Synthetic recovery phrase 739184', 'backup');
    assert.equal(restored.content, await store.decryptExport(content));
    restored.context.key.fill(0);
    await assert.rejects(unlockEnvelope(content, oldKey, 'backup'));
    const older = await unlockEnvelope(oldBackup, oldKey, 'backup');
    older.context.key.fill(0);
    assert(!store.status().pinEnabled);
  } finally {
    await f.app.close();
  }
});
