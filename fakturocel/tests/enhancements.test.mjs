import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldDiff, recordChange } from '../src/sync-details.js';
import { contrastReport } from '../src/appearance-model.js';
import { LocalClient } from '../src/local-client.js';
import { clone, emptyState } from '../src/model.js';
test('sync conflicts are described field by field and record origin follows the latest audit event', () => {
  const diff = fieldDiff({
    number: '20260001',
    customer: {
      name: "Company A"
    },
    items: [{
      name: "Work",
      qty: 1
    }]
  }, {
    number: '20260001',
    customer: {
      name: "Company B"
    },
    items: [{
      name: "Work",
      qty: 2
    }]
  });
  assert.deepEqual(diff.map(row => row.label), ["Customer › Name", "Items › Item 1 › Quantity"]);
  const state = {
    audit: [{
      id: '1',
      at: '2026-01-01T10:00:00.000Z',
      actor: 'Phone',
      actorId: 'local-owner',
      collection: 'documents',
      recordId: 'd1'
    }, {
      id: '2',
      at: '2026-01-02T10:00:00.000Z',
      actor: 'Jirka',
      actorId: 'ha-owner',
      collection: 'documents',
      recordId: 'd1'
    }]
  };
  assert.deepEqual(recordChange(state, 'documents', 'd1'), {
    source: 'Home Assistant',
    at: '2026-01-02T10:00:00.000Z',
    actor: 'Jirka',
    action: ''
  });
});
test('custom appearance reports every required contrast pair', () => {
  const checks = contrastReport({
    background: '#ffffff',
    surface: '#ffffff',
    text: '#111111',
    muted: '#555555',
    accent: '#117c6d',
    sidebar: '#102d35',
    sidebarText: '#ffffff'
  });
  assert.equal(checks.length, 6);
  assert(checks.every(check => check.ratio >= check.minimum));
  assert(contrastReport({
    background: '#ffffff',
    surface: '#ffffff',
    text: '#eeeeee',
    muted: '#eeeeee',
    accent: '#777777',
    sidebar: '#ffffff',
    sidebarText: '#eeeeee'
  }).some(check => check.ratio < check.minimum));
});
test('last sync can be undone locally after a fresh safety backup', async () => {
  const before = emptyState(),
    after = clone(before);
  before.supplier.name = "Before the merger";
  after.supplier.name = "After the merger";
  const client = new LocalClient({
    call: async () => null
  });
  client.cache = {
    format: 'FakturocelClient',
    version: 2,
    snapshot: {
      state: after,
      revisions: {},
      revision: 5,
      configRevision: 2,
      blobs: {}
    },
    viewRevision: 8,
    exportContext: {
      key: Buffer.alloc(32).toString('base64'),
      wrap: {}
    },
    remote: {
      base: clone(after)
    },
    lastMergeUndo: {
      snapshot: {
        state: before,
        revisions: {},
        revision: 4,
        configRevision: 2,
        blobs: {}
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      direction: 'pull'
    }
  };
  let backups = 0;
  client.automatic = async () => {
    backups++;
    return {
      backup: true
    };
  };
  client.persist = async next => {
    client.cache = next;
  };
  const result = await client.undoLastSync();
  assert.equal(result.state.supplier.name, "Before the merger");
  assert.equal(result.state.audit.at(-1).action, 'sync-undo');
  assert.equal(client.cache.lastMergeUndo, null);
  assert.equal(backups, 2);
});
