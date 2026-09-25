import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server/server.mjs';
import { tlsIdentity, deviceUrl } from '../server/devices.mjs';
import { SyncClient } from '../src/client-sync.js';
import { clientContext, encryptClientBackup, clientRecoveryKey } from '../src/client-backup.js';
import { unlockEnvelope } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';
const require = createRequire(import.meta.url),
  {
    request,
    ClientStore,
    validatePair
  } = require('../clients/windows/bridge.cjs');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-devices-")),
    app = await createApp({
      root,
      shareRoot: path.join(root, 'share'),
      backupFolder: path.join(root, 'share', 'backups'),
      webRoot: path.resolve('public'),
      allowRequest: () => true
    });
  await app.store.setup({
    enabled: true
  }, 'owner', 'Owner');
  const actor = app.store.actor('owner', 'Owner'),
    tls = await tlsIdentity(root),
    addr = await app.devices.start(tls, 0, '127.0.0.1'),
    pair = await app.devices.pair({
      name: 'Test PC',
      url: 'https://127.0.0.1:' + addr.port
    }, actor);
  return {
    root,
    app,
    actor,
    pair
  };
}
test('TLS listener rejects unauthenticated clients, wrong pins, restricted operations and revoked devices', async () => {
  const f = await fixture();
  try {
    assert.throws(() => deviceUrl('http://localhost:8443'));
    assert.throws(() => validatePair({
      ...f.pair,
      url: 'https://x/path'
    }));
    assert.equal((await request(f.pair, {
      route: 'snapshot'
    })).actor.role, 'editor');
    await assert.rejects(request({
      ...f.pair,
      fingerprint: '0'.repeat(64)
    }, {
      route: 'meta'
    }), /certificate/i);
    await assert.rejects(request({
      ...f.pair,
      token: 'a'.repeat(43)
    }, {
      route: 'meta'
    }), e => e.status === 401);
    await assert.rejects(request(f.pair, {
      route: 'commit',
      data: {
        seq: 1,
        ops: [{
          collection: 'config',
          rev: 0,
          value: {}
        }]
      }
    }), e => e.status === 400);
    await f.app.devices.revoke(f.pair.id, f.actor);
    await assert.rejects(request(f.pair, {
      route: 'snapshot'
    }), e => e.status === 401);
  } finally {
    await f.app.close();
  }
});
test('remote commit is durable and idempotent, detects replay changes and concurrent edits', async () => {
  const f = await fixture();
  try {
    const input = {
      seq: 1,
      ops: [{
        collection: 'companies',
        id: 'company-a',
        rev: 0,
        value: {
          id: 'company-a',
          name: 'Synthetic Company'
        }
      }]
    };
    const a = await request(f.pair, {
        route: 'commit',
        data: input
      }),
      b = await request(f.pair, {
        route: 'commit',
        data: input
      });
    assert.equal(a.revision, b.revision);
    assert.equal(b.state.companies.length, 1);
    assert.equal(b.seq, 1);
    await assert.rejects(request(f.pair, {
      route: 'commit',
      data: {
        ...input,
        reason: 'changed'
      }
    }), e => e.status === 409);
    await assert.rejects(request(f.pair, {
      route: 'commit',
      data: {
        ...input,
        seq: 2
      }
    }), e => e.status === 409);
    assert(!String(await fs.readFile(f.app.store.file)).includes('Synthetic Company'));
    const snap = JSON.parse(f.app.store.snapshot()),
      meta = snap.meta.find(m => m.key === 'devices');
    assert.equal(JSON.parse(meta.value)[f.pair.id].seq, 1);
  } finally {
    await f.app.close();
  }
});
test('offline queue survives restart and lost acknowledgement, preserves conflicts and assets', async () => {
  const f = await fixture();
  let saved = null,
    offline = false,
    loseAck = false;
  const io = {
    call: async (name, arg) => {
      if (name === 'load') return saved;
      if (name === 'save') {
        saved = arg;
        return true;
      }
      if (name === 'request') {
        if (offline) throw Error('Offline');
        const r = await request(f.pair, arg);
        if (loseAck && arg.route === 'commit') {
          loseAck = false;
          throw Error('Lost acknowledgement');
        }
        return r;
      }
    }
  };
  try {
    const c = new SyncClient(io);
    await c.state();
    offline = true;
    await c.commit({
      ops: [{
        collection: 'companies',
        id: 'local-a',
        rev: 0,
        value: {
          id: 'local-a',
          name: 'Offline company'
        }
      }]
    });
    assert.equal(c.cache.outbox.length, 1);
    assert.equal(c.read().state.companies[0].name, 'Offline company');
    const restart = new SyncClient(io);
    await restart.state();
    assert.equal(restart.read().state.companies.length, 1);
    offline = false;
    loseAck = true;
    await restart.state();
    assert.equal(restart.cache.outbox.length, 1);
    await restart.state();
    assert.equal(restart.cache.outbox.length, 0);
    assert.equal(f.app.store.read().state.companies.length, 1);
    offline = true;
    await restart.commit({
      ops: [{
        collection: 'companies',
        id: 'local-a',
        rev: 1,
        value: {
          id: 'local-a',
          name: 'Local edit'
        }
      }]
    });
    await f.app.store.commit({
      ops: [{
        collection: 'companies',
        id: 'local-a',
        rev: 1,
        value: {
          id: 'local-a',
          name: 'Server edit'
        }
      }]
    }, f.actor);
    offline = false;
    await restart.state();
    assert.equal(restart.cache.outbox.length, 1);
    assert.equal(restart.read().state.companies[0].name, 'Local edit');
    assert.equal(f.app.store.read().state.companies[0].name, 'Server edit');
    assert.equal(restart.errorStatus, 409);
    const context = await clientContext(),
      text = await encryptClientBackup(await restart.backup(), context),
      opened = await unlockEnvelope(text, clientRecoveryKey(context), 'backup');
    assert.equal((await unpackBackup(opened.content)).data.companies[0].name, 'Local edit');
  } finally {
    await f.app.close();
  }
});
test('native cache writes encrypted bytes and fails closed on tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-cell-native-")),
    safe = {
      isEncryptionAvailable: () => true,
      encryptString: s => Buffer.from('OS:' + s),
      decryptString: b => b.toString().slice(3)
    },
    s = new ClientStore(root, safe),
    text = JSON.stringify({
      format: 'FakturocelClient',
      version: 1,
      snapshot: {
        secret: 'Sensitive business data'
      },
      outbox: []
    });
  await s.call('save', text);
  assert.equal(await s.call('load'), text);
  const file = path.join(root, 'client-v3.cache'),
    bytes = await fs.readFile(file, 'utf8');
  assert(!bytes.includes('Sensitive business data'));
  const v = JSON.parse(bytes);
  v.tag = 'AAAAAAAAAAAAAAAAAAAAAA==';
  await fs.writeFile(file, JSON.stringify(v));
  await assert.rejects(s.call('load'), /corrupt/);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).tag, v.tag);
});
test('mismatched TLS peer never receives the bearer token; full wipe removes pairing and TLS identity', async () => {
  const f = await fixture();
  try {
    let requests = 0;
    f.app.devices.server.on('request', () => requests++);
    await assert.rejects(request({
      ...f.pair,
      fingerprint: 'f'.repeat(64)
    }, {
      route: 'snapshot'
    }));
    await new Promise(r => setTimeout(r, 50));
    assert.equal(requests, 0);
    const prepared = await f.app.store.wipePrepare(f.app.store.revision, f.actor),
      ticket = f.app.store.ticket(prepared.ticket, f.actor);
    ticket.downloaded = true;
    ticket.recoveryDownloaded = true;
    await f.app.store.verifyWipeBackup({
      ticket: prepared.ticket,
      text: ticket.text
    }, f.actor);
    await f.app.store.wipeFinish({
      ticket: prepared.ticket,
      backupText: ticket.text,
      confirm: "DELETE DATA"
    }, f.actor);
    await assert.rejects(fs.stat(path.join(f.root, "fakturocel-tls.json")), e => e.code === 'ENOENT');
    await assert.rejects(request(f.pair, {
      route: 'snapshot'
    }), e => e.status === 423);
  } finally {
    await f.app.close();
  }
});
