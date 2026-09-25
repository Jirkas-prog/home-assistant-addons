import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, newDocument, packBackup, unpackBackup, total, uid, textRules, fieldValue } from '../src/model.js';
import { renderDocument } from '../src/renderer.js';
import { Store, hash } from '../server/store.mjs';
import { createApp } from '../server/server.mjs';
const webRoot = fileURLToPath(new URL('../public', import.meta.url));
const actor = {
  id: 'test-owner',
  name: 'Test Owner',
  role: 'owner'
};
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-v3-test-")),
    data = path.join(root, 'data'),
    share = path.join(root, 'share');
  const store = new Store({
    root: data,
    shareRoot: share,
    backupFolder: path.join(share, "Fakturocel", 'backups'),
    webRoot
  });
  await store.init();
  return {
    root,
    data,
    share,
    store
  };
}
function doc(s, n = 3) {
  const d = newDocument(s);
  d.supplier = {
    ...s.supplier,
    name: 'Test Supplier'
  };
  d.customer = {
    name: 'Test Customer'
  };
  d.items = Array.from({
    length: n
  }, (_, i) => ({
    name: "Item " + (i + 1),
    qty: 2,
    price: 100,
    unit: 'pcs'
  }));
  return d;
}
const loader = name => fs.readFile(path.join(webRoot, name));
test('fresh installation is empty and backup roundtrip contains no private seed', async () => {
  const f = await fixture();
  try {
    const r = f.store.read();
    assert.equal(r.state.documents.length, 0);
    assert.equal(r.state.companies.length, 0);
    assert.equal(r.state.supplier.name, '');
    assert.equal(r.state.templates.length, 2);
    const text = await f.store.backupText(),
      p = await unpackBackup(text);
    assert.deepEqual(p.data, r.state);
    assert.equal(Object.keys(p.blobs).length, 0);
  } finally {
    f.store.close();
  }
});
test('record revisions prevent conflicting writes and immutable issued documents', async () => {
  const {
    store
  } = await fixture();
  try {
    const c = {
      id: uid(),
      name: 'Test'
    };
    const r = await store.commit({
      ops: [{
        collection: 'companies',
        id: c.id,
        rev: 0,
        value: c
      }]
    }, actor);
    assert(r.saved && r.backup);
    await assert.rejects(store.commit({
      ops: [{
        collection: 'companies',
        id: c.id,
        rev: 0,
        value: {
          ...c,
          name: 'stale'
        }
      }]
    }, actor), e => e.status === 409);
    const d = doc(r.state);
    d.status = 'issued';
    const saved = await store.commit({
      ops: [{
        collection: 'documents',
        id: d.id,
        rev: 0,
        value: d
      }]
    }, actor);
    const issued = saved.state.documents[0];
    assert(issued.pdfHash);
    assert.equal(Buffer.from(store.blob(issued.pdfHash).data).subarray(0, 5).toString(), '%PDF-');
    await assert.rejects(store.commit({
      ops: [{
        collection: 'documents',
        id: d.id,
        rev: 1,
        value: {
          ...issued,
          notes: 'changed'
        }
      }]
    }, actor), /issued/i);
  } finally {
    store.close();
  }
});
test('hundred rows paginate and rich fields keep styles and values', async () => {
  const s = emptyState(),
    d = doc(s, 100),
    t = s.templates[0];
  const r = await renderDocument(d, s, t, loader);
  assert(r.pages.length > 1);
  for (let i = 1; i <= 100; i++) assert(r.pages.flat().some(o => o.kind === 'text' && o.text === String(i) || o.text === "Item " + i));
  assert.equal(total(d), 20000);
  assert(r.pages.flat().some(o => o.font === 'bold' && o.text.includes('Test')));
  assert.equal(fieldValue({
    field: 'totals.total'
  }, d, s).replace(/\s/g, ' '), "CZK 20,000.00");
});
test('very long fixed text stops generation instead of truncation', async () => {
  const s = emptyState(),
    d = doc(s);
  s.templates[0].nodes.find(n => n.id === "Footer").runs = [{
    text: "text too long ".repeat(200)
  }];
  await assert.rejects(renderDocument(d, s, s.templates[0], loader), /fit/);
});
test('custom data and text rules preserve zero and manual override', () => {
  const s = emptyState(),
    d = doc(s);
  s.fields.push({
    id: 'order',
    name: 'Order',
    scope: 'document'
  });
  d.custom = {
    order: 0
  };
  assert.equal(fieldValue({
    field: 'custom.order',
    fallback: 'missing'
  }, d, s), '0');
  s.rules = [{
    id: 'r',
    name: 'Rule',
    enabled: true,
    kind: 'text',
    target: 'notes',
    runs: [{
      text: 'Order '
    }, {
      field: 'custom.order'
    }]
  }];
  assert.equal(textRules(d, s).notes, 'Order 0');
  d.manualTexts = {
    notes: true
  };
  d.notes = 'Manual';
  assert.equal(textRules(d, s).notes, 'Manual');
});
test('wipe requires download, verified exact backup, current revision and confirmation', async () => {
  const f = await fixture(),
    {
      store
    } = f;
  try {
    await store.commit({
      ops: [{
        collection: 'companies',
        id: 'private',
        rev: 0,
        value: {
          id: 'private',
          name: 'PRIVATE_MARKER'
        }
      }]
    }, actor);
    const t = await store.wipePrepare(store.revision, actor),
      internal = store.ticket(t.ticket, actor),
      text = internal.text;
    await assert.rejects(store.wipeFinish({
      ticket: t.ticket,
      backupText: text,
      confirm: "DELETE DATA"
    }, actor), /download/);
    internal.downloaded = true;
    await assert.rejects(store.wipeFinish({
      ticket: t.ticket,
      backupText: 'bad',
      confirm: "DELETE DATA"
    }, actor), /just/);
    await assert.rejects(store.wipeFinish({
      ticket: t.ticket,
      backupText: text,
      confirm: 'yes'
    }, actor), /DELETE/);
    const result = await store.wipeFinish({
      ticket: t.ticket,
      backupText: text,
      confirm: "DELETE DATA"
    }, actor);
    assert(result.wiped);
    assert.equal(store.read().state.companies.length, 0);
    assert.equal(store.read().state.documents.length, 0);
    assert(!(await fs.readFile(path.join(f.data, "fakturocel-v3.sqlite"))).includes(Buffer.from('PRIVATE_MARKER')));
    assert.equal((await fs.readdir(path.join(f.share, "Fakturocel", 'backups'))).length, 0);
    assert.equal((await unpackBackup(text)).data.companies[0].name, 'PRIVATE_MARKER');
  } finally {
    store.close();
  }
});
test('new writes invalidate prepared wipe; unrelated files survive', async () => {
  const f = await fixture(),
    {
      store
    } = f;
  try {
    await fs.mkdir(f.share, {
      recursive: true
    });
    const untouched = path.join(f.share, 'unrelated.txt');
    await fs.writeFile(untouched, 'safe');
    const t = await store.wipePrepare(store.revision, actor),
      internal = store.ticket(t.ticket, actor);
    internal.downloaded = true;
    await store.commit({
      ops: [{
        collection: 'texts',
        id: 'text',
        rev: 0,
        value: {
          id: 'text',
          name: 'new'
        }
      }]
    }, actor);
    await assert.rejects(store.wipeFinish({
      ticket: t.ticket,
      backupText: internal.text,
      confirm: "DELETE DATA"
    }, actor), e => e.status === 409);
    assert.equal(await fs.readFile(untouched, 'utf8'), 'safe');
  } finally {
    store.close();
  }
});
test('server refuses direct requests, trusts only Ingress identity, readers cannot write', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-v3-http-"));
  const app = await createApp({
    root: path.join(root, 'data'),
    shareRoot: path.join(root, 'share'),
    backupFolder: path.join(root, 'share', 'backup'),
    webRoot,
    allowRequest: r => r.headers['x-test-ingress'] === 'yes'
  });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base + '/api/state', {
      headers: {
        'x-test-ingress': 'yes'
      }
    })).status, 401);
    const headers = {
      'x-test-ingress': 'yes',
      'x-remote-user-id': 'owner'
    };
    const gate = await (await fetch(base + '/api/security', {
      headers
    })).json();
    await fetch(base + '/api/security/setup', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        "x-fakturocel-token": gate.csrf
      },
      body: JSON.stringify({
        enabled: false,
        confirm: "DISABLE ENCRYPTION"
      })
    });
    const r = await (await fetch(base + '/api/state', {
      headers
    })).json();
    assert.equal(r.actor.role, 'owner');
    app.store.setMeta('roles', {
      owner: {
        role: 'owner'
      },
      reader: {
        role: 'reader'
      }
    });
    const blocked = await fetch(base + '/api/commit', {
      method: 'POST',
      headers: {
        ...headers,
        'x-remote-user-id': 'reader',
        'Content-Type': 'application/json',
        "x-fakturocel-token": r.csrf
      },
      body: JSON.stringify({
        ops: []
      })
    });
    assert.equal(blocked.status, 403);
  } finally {
    await app.close();
  }
});
