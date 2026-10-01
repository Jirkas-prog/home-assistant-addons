import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LocalClient } from '../src/local-client.js';
import { emptyState, newDocument, clone, packBackup, unpackBackup } from '../src/model.js';
import { mergeData } from '../src/data-merge.js';
import { clientRecoveryKey, decryptClientBackup } from '../src/client-backup.js';
import { unlockEnvelope } from '../server/encryption.mjs';
import { createApp } from '../server/server.mjs';
import { tlsIdentity } from '../server/devices.mjs';
const require = createRequire(import.meta.url),
  {
    ClientStore,
    request
  } = require('../clients/windows/bridge.cjs');
function memory() {
  let saved = null,
    calls = [];
  return {
    calls,
    call: async (name, arg) => {
      calls.push(name);
      if (name === 'load') return saved;
      if (name === 'save') {
        saved = arg;
        return true;
      }
      if (name === 'backup') return {
        path: 'Synthetic backup'
      };
      if (name === 'clear') {
        saved = null;
        return true;
      }
      throw Error('Unexpected native call: ' + name);
    }
  };
}
const asset = name => fs.readFile(path.resolve('public', name));
async function issue(c) {
  let r = await c.state();
  r.state.supplier.name = 'Standalone Supplier';
  await c.commit({
    ops: [{
      collection: 'config',
      rev: r.configRevision,
      value: {
        supplier: r.state.supplier,
        settings: r.state.settings
      }
    }]
  });
  r = await c.state();
  const d = newDocument(r.state, 'invoice');
  d.customer = {
    id: 'standalone',
    name: 'Standalone Customer'
  };
  d.items = [{
    name: 'Local work',
    qty: 2,
    unit: 'hours',
    price: 250
  }];
  d.status = 'issued';
  return c.commit({
    ops: [{
      collection: 'documents',
      id: d.id,
      rev: 0,
      value: d
    }]
  });
}
test('fresh standalone works without any server: issue immutable PDF, pay, edit settings, restart, encrypted restore and PIN', async () => {
  const io = memory(),
    c = new LocalClient(io, asset),
    first = await c.state();
  assert.equal(first.state.documents.length, 0);
  assert.equal(first.actor.role, 'owner');
  assert.equal(first.security.pinEnabled, false);
  assert.equal(c.status().paired, false);
  const issued = await issue(c),
    d = issued.state.documents[0];
  assert(d.pdfHash);
  assert.equal(new TextDecoder().decode(Buffer.from(c.cache.snapshot.blobs[d.pdfHash].base64, 'base64').subarray(0, 5)), '%PDF-');
  await assert.rejects(c.commit({
    ops: [{
      collection: 'documents',
      id: d.id,
      rev: 1,
      value: {
        ...d,
        notes: 'illegal'
      }
    }]
  }), /issued/i);
  await c.commit({
    ops: [{
      collection: 'payments',
      id: 'payment',
      rev: 0,
      value: {
        id: 'payment',
        documentId: d.id,
        amount: 500,
        date: '2026-09-16'
      }
    }]
  });
  const restart = new LocalClient(io, asset);
  assert.equal((await restart.state()).state.payments.length, 1);
  assert.equal(restart.read().state.documents[0].pdfHash, d.pdfHash);
  assert(!io.calls.includes('request'));
  assert(!io.calls.includes('pair'));
  const key = clientRecoveryKey(c.cache.exportContext),
    backup = await c.backupText();
  assert(!backup.includes('Standalone Supplier'));
  const decrypted = await unlockEnvelope(backup, key, 'backup');
  assert.equal((await unpackBackup(decrypted.content)).data.documents.length, 1);
  const other = new LocalClient(memory(), asset);
  await other.load();
  await assert.rejects(other.route('restore/preview', {
    text: backup
  }), e => e.status === 422);
  await other.route('restore', {
    text: backup,
    password: key,
    revision: other.cache.viewRevision
  });
  assert.equal(other.read().state.documents[0].pdfHash, d.pdfHash);
  await other.route('security/pin', {
    enabled: true,
    pin: '123456'
  });
  await other.route('security/lock', {});
  await assert.rejects(other.state(), e => e.status === 423);
  await assert.rejects(other.route('security/pin-login', {
    pin: '654321'
  }), /do not match/);
  await other.route('security/pin-login', {
    pin: '123456'
  });
  assert.equal(other.read().state.documents.length, 1);
  await other.route('security/change', {
    enabled: false,
    confirm: "DISABLE ENCRYPTION"
  });
  assert.equal(JSON.parse(await other.backupText()).format, 'FakturocelBackup');
});
test('cache v1 migration preserves unsent drafts/catalogues and has no network dependency', async () => {
  const s = emptyState(),
    io = memory();
  await io.call('save', JSON.stringify({
    format: 'FakturocelClient',
    version: 1,
    snapshot: {
      state: s,
      blobs: {},
      revisions: {},
      revision: 7,
      configRevision: 3,
      deviceId: 'old-device',
      seq: 0
    },
    viewRevision: 8,
    outbox: [{
      seq: 1,
      ops: [{
        collection: 'companies',
        id: 'offline',
        value: {
          id: 'offline',
          name: 'Unsent'
        }
      }]
    }]
  }));
  const c = new LocalClient(io, asset);
  assert.equal((await c.state()).state.companies[0].name, 'Unsent');
  assert.equal(c.cache.version, 2);
  assert.equal(c.cache.remote.deviceId, 'old-device');
  assert(!io.calls.includes('request'));
});
test('three-way merge preserves independent edits and rejects conflicting invoice numbers', () => {
  const b = emptyState(),
    l = clone(b),
    r = clone(b);
  l.companies.push({
    id: 'a',
    name: 'Local'
  });
  r.activities.push({
    id: 'b',
    name: 'Remote',
    price: 10
  });
  const m = mergeData(b, l, r);
  assert.equal(m.conflicts.length, 0);
  assert.equal(m.state.companies.length, 1);
  assert.equal(m.state.activities.length, 1);
  b.companies.push({
    id: 'same',
    name: 'Before'
  });
  l.companies.push({
    id: 'same',
    name: 'Local edit'
  });
  r.companies.push({
    id: 'same',
    name: 'Server edit'
  });
  assert.equal(mergeData(b, l, r).conflicts[0].key, 'companies:same');
  assert.equal(mergeData(b, l, r, {
    'companies:same': 'local'
  }).state.companies.find(c => c.id === 'same').name, 'Local edit');
  const x = emptyState(),
    a = clone(x),
    z = clone(x),
    d = newDocument(x, 'invoice');
  a.documents.push(d);
  z.documents.push({
    ...d,
    id: 'other'
  });
  assert.throws(() => mergeData(x, a, z), /number/);
});
test('optional pinned TLS exchange uploads locally issued PDF, is idempotent after lost ACK, protects conflicts and disconnect retains data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Fakturocel-standalone-")),
    app = await createApp({
      root: path.join(root, 'ha'),
      shareRoot: path.join(root, 'share'),
      backupFolder: path.join(root, 'share', 'backups'),
      webRoot: path.resolve('public'),
      allowRequest: () => true
    });
  await app.store.setup({
    enabled: true
  }, 'owner', 'Owner');
  const owner = app.store.actor('owner', 'Owner'),
    addr = await app.devices.start(await tlsIdentity(path.join(root, 'ha')), 0, '127.0.0.1'),
    pair = await app.devices.pair({
      name: 'Standalone',
      url: 'https://127.0.0.1:' + addr.port
    }, owner);
  const native = new ClientStore(path.join(root, 'local'), {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from(s),
    decryptString: b => b.toString()
  });
  let lose = false;
  const io = {
      call: async (n, a) => {
        const result = await native.call(n, a);
        if (lose && n === 'request' && a.route === 'exchange') {
          lose = false;
          throw Error('Lost ACK');
        }
        return result;
      }
    },
    c = new LocalClient(io, asset);
  try {
    await app.store.commit({
      ops: [{
        collection: 'activities',
        id: 'ha-only',
        rev: 0,
        value: {
          id: 'ha-only',
          name: 'Already in HA',
          price: 10
        }
      }]
    }, owner);
    const local = await issue(c);
    await c.connect(JSON.stringify(pair));
    assert.equal(app.store.read().state.documents.length, 0);
    let p = await c.previewSync('push');
    assert.equal(p.conflicts.length, 0);
    lose = true;
    await assert.rejects(c.applySync(p.token), /Lost ACK/);
    assert(c.cache.pendingExchange);
    assert.equal(app.store.read().state.documents.length, 1);
    const rev = app.store.revision;
    p = await c.previewSync('push');
    assert.equal(app.store.revision, rev);
    assert(!c.cache.pendingExchange);
    assert.equal(c.read().state.documents[0].pdfHash, local.state.documents[0].pdfHash);
    assert.equal(c.read().state.activities[0].name, 'Already in HA');
    assert.equal(app.store.read().state.activities.length, 1);
    await app.store.commit({
      ops: [{
        collection: 'texts',
        id: 'automatic',
        rev: 0,
        value: {
          id: 'automatic',
          name: 'Automatic server update'
        }
      }]
    }, owner);
    await c.route('meta');
    assert.equal(c.read().state.texts[0].name, 'Automatic server update');
    await c.persist({
      ...c.cache,
      remote: {
        ...c.cache.remote,
        autoPull: false
      }
    });
    await app.store.commit({
      ops: [{
        collection: 'texts',
        id: 'disabled',
        rev: 0,
        value: {
          id: 'disabled',
          name: 'Wait for manual pull'
        }
      }]
    }, owner);
    await c.route('meta');
    assert.equal(c.read().state.texts.length, 1);
    await c.persist({
      ...c.cache,
      remote: {
        ...c.cache.remote,
        autoPull: true
      }
    });
    c.canAutoApply = () => false;
    await c.route('meta');
    assert.equal(c.read().state.texts.length, 1);
    c.canAutoApply = () => true;
    await c.route('meta');
    assert.equal(c.read().state.texts.length, 2);
    await app.store.commit({
      ops: [{
        collection: 'companies',
        id: 'remote',
        rev: 0,
        value: {
          id: 'remote',
          name: 'From HA'
        }
      }]
    }, owner);
    p = await c.previewSync('pull');
    await c.applySync(p.token);
    assert.equal(c.read().state.companies[0].name, 'From HA');
    const current = c.read();
    await c.commit({
      ops: [{
        collection: 'companies',
        id: 'remote',
        rev: current.revisions['companies:remote'],
        value: {
          id: 'remote',
          name: 'Local edit'
        }
      }]
    });
    await app.store.commit({
      ops: [{
        collection: 'companies',
        id: 'remote',
        rev: app.store.read().revisions['companies:remote'],
        value: {
          id: 'remote',
          name: 'HA edit'
        }
      }]
    }, owner);
    p = await c.previewSync('push');
    assert.equal(p.conflicts.length, 1);
    await assert.rejects(c.applySync(p.token), /conflicts/);
    assert.equal(app.store.read().state.companies[0].name, 'HA edit');
    p = await c.previewSync('push', {
      'companies:remote': 'local'
    });
    await c.applySync(p.token);
    assert.equal(app.store.read().state.companies[0].name, 'Local edit');
    const serverState = app.store.read(),
      tampered = clone(serverState.state);
    tampered.documents[0].items[0].price = 1;
    await assert.rejects(request(pair, {
      route: 'exchange',
      data: {
        requestId: crypto.randomUUID(),
        revision: serverState.revision,
        text: await packBackup(tampered, app.store.allBlobs())
      }
    }), e => e.status === 400);
    const validText = await packBackup(serverState.state, app.store.allBlobs());
    await assert.rejects(request(pair, {
      route: 'exchange',
      data: {
        requestId: crypto.randomUUID(),
        revision: serverState.revision - 1,
        text: validText
      }
    }), e => e.status === 409);
    const devices = app.store.meta('devices');
    devices[pair.id].syncProtocol = 1;
    app.store.setMeta('devices', devices);
    await assert.rejects(request(pair, {
      route: 'exchange',
      data: {
        requestId: crypto.randomUUID(),
        revision: serverState.revision,
        text: validText
      }
    }), e => e.status === 403);
    devices[pair.id].syncProtocol = 2;
    app.store.setMeta('devices', devices);
    assert.equal(app.store.read().state.documents[0].items[0].price, 250);
    await c.disconnect();
    assert.equal(c.read().state.documents.length, 1);
    assert.equal(c.status().paired, false);
    await app.devices.close();
    await issue(c);
    assert.equal(c.read().state.documents.length, 2);
    const files = JSON.parse(await native.read('client-v3.backups'));
    assert(files.length > 0);
    await c.clear(c.cache.viewRevision);
    assert.equal(await native.call('load'), null);
    for (const f of files) await assert.rejects(fs.stat(f), e => e.code === 'ENOENT');
    assert.equal(app.store.read().state.documents.length, 1);
  } finally {
    await app.close();
  }
});
