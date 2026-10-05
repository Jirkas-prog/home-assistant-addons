import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { createApp } from '../server/server.mjs';
import { readBackupFile } from '../server/backup-formats.mjs';
import { isEncrypted } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';

const owner = { id: 'export-owner', name: 'Synthetic export owner', role: 'owner' };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fakturocel-export-'));
  const app = await createApp({ root: path.join(root, 'data'), shareRoot: path.join(root, 'share'),
    backupFolder: path.join(root, 'share', 'backups'), webRoot: path.resolve('public'), allowRequest: () => true, googleTimer: false });
  await app.store.setup({ enabled: true }, owner.id, owner.name);
  await app.store.commit({ ops: [{ collection: 'companies', id: 'sample', rev: 0, value: { id: 'sample', name: 'Readable export customer' } }] }, owner);
  t.after(() => app.close());
  return app;
}
async function ready(exports, id) {
  for (let n = 0; n < 1000; n++) {
    const status = exports.status(id, owner);
    if (status.error) throw Error(status.error);
    if (status.ready) return;
    await delay(10);
  }
  throw Error('The export worker did not finish within ten seconds.');
}

test('worker exports report real worksheet/compression progress and restore without keys while share backups stay encrypted', async t => {
  const app = await fixture(t);
  app.store.putBlob(randomBytes(256 * 1024), 'application/pdf', 'synthetic.pdf');
  assert.deepEqual(app.store.backupEncryption(), { working: true, local: false, download: false, cloud: false });
  await app.store.changeBackupEncryption({ local: true, download: false, cloud: false }, owner);
  assert.deepEqual(app.store.backupEncryption(), { working: true, local: true, download: false, cloud: false });
  for (const format of ['zip', 'excel', 'both']) {
    const { id } = await app.exports.start(format, owner), progress = [];
    app.exports.jobs.get(id).worker.on('message', m => { if (m.percent !== undefined) progress.push(m); });
    assert.equal(app.exports.status(id, owner).percent, 0);
    await ready(app.exports, id);
    assert(progress.length > 2);
    assert(progress.every((p, i) => p.percent >= 0 && p.percent <= 100 && (!i || p.percent >= progress[i - 1].percent)));
    if (format !== 'zip') assert(progress.some(p => p.stage === 'Writing Excel worksheets…'));
    assert(progress.some(p => /Compressing/.test(p.stage)));
    const file = app.exports.take(id, owner);
    const recovered = await unpackBackup(await readBackupFile({ decryptExport: async text => text }, file.bytes, 'export.' + file.extension));
    assert.deepEqual(recovered.data, app.store.read().state);
    assert.deepEqual(recovered.blobs, app.store.allBlobs());
    if (format === 'both') {
      const set = await JSZip.loadAsync(file.bytes);
      const archive = await JSZip.loadAsync(await set.file('application.zip').async('nodebuffer'));
      assert(!isEncrypted(await archive.file('data.fakturocel').async('string')));
      assert((await set.file('application.xlsx').async('nodebuffer')).subarray(0, 2).equals(Buffer.from('PK')));
    }
    assert.throws(() => app.exports.take(id, owner), e => e.status === 410);
  }
  const local = await app.store.backup();
  assert(isEncrypted(await fs.readFile(local.path, 'utf8')));
  await app.store.changeBackupEncryption({ local: true, download: true, cloud: true }, owner);
  const { id } = await app.exports.start('both', owner);
  await ready(app.exports, id);
  const set = await JSZip.loadAsync(app.exports.take(id, owner).bytes);
  const archive = await JSZip.loadAsync(await set.file('application.zip').async('nodebuffer'));
  assert(isEncrypted(await archive.file('data.fakturocel').async('string')));
  const excel = await set.file('application.xlsx').async('nodebuffer');
  const restored = await unpackBackup(await readBackupFile({ decryptExport: async text => text }, excel, 'always-readable.xlsx'));
  assert.deepEqual(restored.data, app.store.read().state);
});

test('cancellation terminates the actual worker, releases all temporary files, and keeps concurrent edits intact', async t => {
  const app = await fixture(t);
  app.store.putBlob(randomBytes(2 * 1024 * 1024), 'application/pdf', 'synthetic-large.pdf');
  const { id } = await app.exports.start('both', owner), job = app.exports.jobs.get(id), worker = job.worker;
  await app.store.commit({ ops: [{ collection: 'companies', id: 'later', rev: 0, value: { id: 'later', name: 'Saved during export' } }] }, owner);
  await app.exports.cancel(id, owner);
  assert.equal(worker.threadId, -1);
  assert.equal(app.exports.jobs.size, 0);
  assert.equal(job.file, null);
  assert.throws(() => app.exports.take(id, owner), e => e.status === 410);
  assert.equal(app.store.read().state.companies.length, 2);
  assert.equal(app.store.read().state.companies[1].name, 'Saved during export');
});

test('export API binds jobs to the logged-in user, requires CSRF for creation/cancellation, limits work, and invalidates reset snapshots', async t => {
  const app = await fixture(t);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + app.server.address().port + '/api/';
  const csrf = (await (await fetch(url + 'security', { headers: { 'x-remote-user-id': owner.id } })).json()).csrf;
  const request = (route, data, user = owner.id, token = csrf) => fetch(url + route, { method: data ? 'POST' : 'GET',
    headers: { 'x-remote-user-id': user, 'x-fakturocel-token': token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  app.store.setMeta('roles', { ...app.store.meta('roles'), other: { name: 'Other reader', role: 'reader' } });
  assert.equal((await request('export/start', { format: 'zip' }, owner.id, '')).status, 403);
  const first = await (await request('export/start', { format: 'zip' })).json();
  assert.equal((await request('export/status?id=' + first.id, null, 'other')).status, 403);
  assert.equal((await request('export/result?id=' + first.id, null, 'other')).status, 403);
  assert.equal((await request('export/cancel', { id: first.id }, 'other')).status, 403);
  assert.equal((await request('export/cancel', { id: first.id }, owner.id, '')).status, 403);
  const second = await (await request('export/start', { format: 'excel' })).json();
  assert.equal((await request('export/start', { format: 'both' })).status, 429);
  assert.equal((await request('export/cancel', { id: first.id })).status, 200);
  assert.equal((await request('export/result?id=' + first.id)).status, 410);
  app.store.generation++;
  assert.equal((await request('export/status?id=' + second.id)).status, 409);
  assert.equal(app.exports.jobs.size, 0);
});
