import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SecureStore } from '../server/secure-store.mjs';
import { GoogleDrive } from '../server/google-drive.mjs';
import { createApp } from '../server/server.mjs';
import { decryptWithContext, isEncrypted } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';
import { readBackupFile } from '../server/backup-formats.mjs';
import { FakeGoogle, credentials } from './google-drive-fixture.mjs';

const actor = { id: 'owner', name: 'Synthetic owner', role: 'owner' };
async function fixture(t, encrypted = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fakturocel-drive-'));
  const options = { root: path.join(root, 'data'), shareRoot: path.join(root, 'share'), backupFolder: path.join(root, 'share', 'backups') };
  let store = new SecureStore(options);
  await store.init();
  await store.setup({ enabled: encrypted, confirm: 'DISABLE ENCRYPTION' }, actor.id, actor.name);
  const google = new FakeGoogle();
  let time = Date.now();
  let drive = new GoogleDrive(store, { googleFetch: google.fetch, googleNow: () => time, googleTimer: false });
  const f = { google, options, get store() { return store; }, get drive() { return drive; }, advance(ms) { time += ms; },
    async restart() { await drive.close(); store.close(); store = new SecureStore(options); await store.init(); drive = new GoogleDrive(store, { googleFetch: google.fetch, googleNow: () => time, googleTimer: false }); }
  };
  t.after(async () => { await drive.close(); store.close(); });
  return f;
}
async function connect(f) {
  await f.drive.begin(credentials, actor);
  f.advance(5000);
  await f.drive.poll(actor);
  assert.equal(f.drive.status(actor).connected, true);
}

test('Google authorization respects polling, slow-down, expiration, and encryption requirements', async t => {
  const f = await fixture(t);
  f.google.authorized = false;
  const initial = await f.drive.begin(credentials, actor);
  assert.equal(initial.authorization.userCode, 'WWWWWWWWWWWWWWW');
  await f.drive.poll(actor);
  assert.equal(f.google.calls.length, 1);
  f.advance(5000);
  await f.drive.poll(actor);
  assert.equal(f.drive.status(actor).connected, false);
  f.google.pollError = 'slow_down';
  f.advance(5000);
  await f.drive.poll(actor);
  const count = f.google.calls.length;
  f.advance(5000);
  await f.drive.poll(actor);
  assert.equal(f.google.calls.length, count);
  f.advance(1800000);
  await assert.rejects(f.drive.poll(actor), /code expired/);
  assert.equal(f.drive.status(actor).authorization, null);
  const plain = await fixture(t, false);
  await assert.rejects(plain.drive.begin(credentials, actor), /Enable data encryption/);
  assert.equal(plain.google.calls.length, 0);
});

test('encrypted scheduled backups survive restart, restore all data, omit credentials, and retain only owned copies', async t => {
  const f = await fixture(t);
  await f.store.commit({ ops: [{ collection: 'companies', id: 'sample', rev: 0, value: { id: 'sample', name: 'PRIVATE_CLOUD_TEST_MARKER' } }] }, actor);
  await connect(f);
  await f.drive.configure({ enabled: true, intervalHours: 24, keepCount: 2 }, actor);
  const properties = { fakturocel: 'backup', installation: f.store.meta('googleDrive').installationId };
  f.google.files.push(
    { id: 'own-oldest', createdTime: '2020-01-01', parents: ['synthetic-folder'], appProperties: properties },
    { id: 'own-newer', createdTime: '2021-01-01', parents: ['synthetic-folder'], appProperties: properties },
    { id: 'unrelated', createdTime: '2019-01-01', parents: ['synthetic-folder'], appProperties: {} },
    { id: 'other-installation', createdTime: '2018-01-01', parents: ['synthetic-folder'], appProperties: { ...properties, installation: 'other' } },
    { id: 'other-folder', createdTime: '2017-01-01', parents: ['different-folder'], appProperties: properties });
  await f.restart();
  assert.equal(f.drive.status(actor).enabled, true);
  await f.drive.tick();
  assert.equal(f.google.uploads.length, 1);
  assert.deepEqual(f.google.deleted, ['own-oldest']);
  const bytes = f.google.uploads[0];
  assert(!bytes.includes(Buffer.from('PRIVATE_CLOUD_TEST_MARKER')));
  const plaintext = await readBackupFile(f.store, bytes, 'backup.zip');
  assert.equal((await unpackBackup(plaintext)).data.companies[0].name, 'PRIVATE_CLOUD_TEST_MARKER');
  for (const secret of [credentials.clientSecret, 'synthetic-refresh-token', 'synthetic-access-token']) {
    assert(!plaintext.includes(secret));
    assert(!JSON.stringify(f.drive.status(actor)).includes(secret));
    assert(!(await fs.readFile(f.store.file, 'utf8')).includes(secret));
  }
  await f.drive.tick();
  assert.equal(f.google.uploads.length, 1);
  f.advance(24 * 3600000);
  await f.drive.tick();
  assert.equal(f.google.uploads.length, 2);
  await f.drive.configure({ enabled: false, intervalHours: 24, keepCount: 2 }, actor);
  f.advance(48 * 3600000);
  await f.drive.tick();
  assert.equal(f.google.uploads.length, 2);
});

test('failed verification and connection errors keep previous copies and schedule retries', async t => {
  const f = await fixture(t);
  await connect(f);
  await f.drive.configure({ enabled: true, intervalHours: 24, keepCount: 2 }, actor);
  f.google.badChecksum = true;
  await assert.rejects(f.drive.tick(), /could not be verified/);
  assert.deepEqual(f.google.deleted, []);
  assert.equal(f.drive.status(actor).lastSuccess, null);
  assert(f.drive.status(actor).nextAttempt);
  const count = f.google.calls.length;
  await f.drive.tick();
  assert.equal(f.google.calls.length, count);
  f.advance(60000);
  f.google.badChecksum = false;
  f.google.tokenError = 'invalid_grant';
  await assert.rejects(f.drive.tick(), /authorization expired/);
  assert.deepEqual(f.google.deleted, []);
  f.advance(120000);
  f.google.tokenError = null;
  await f.drive.tick();
  assert(f.drive.status(actor).lastSuccess);
  assert.equal(f.drive.status(actor).lastError, null);
});

test('a failed second format keeps complete backup sets; a later verified pair cleans up the incomplete set', async t => {
  const f = await fixture(t);
  await connect(f);
  await f.drive.configure({ enabled: true, intervalHours: 24, keepCount: 2, format: 'both' }, actor);
  await f.drive.run(actor);
  const original = f.google.files.map(file => file.id);
  f.google.badChecksumAt = 4;
  await assert.rejects(f.drive.run(actor), /could not be verified/);
  assert.deepEqual(f.google.deleted, []);
  assert(original.every(id => f.google.files.some(file => file.id === id)));
  f.google.badChecksumAt = null;
  await f.drive.run(actor);
  assert.deepEqual(f.google.deleted.sort(), ['uploaded-2', 'uploaded-3']);
  assert(original.every(id => f.google.files.some(file => file.id === id)));
  const files = await f.drive.list(actor);
  assert.equal(files.files.length, 4);
  const downloaded = await f.drive.download(original[0], actor);
  assert.equal((await unpackBackup(await readBackupFile(f.store, downloaded.bytes, downloaded.name))).data.companies.length, 0);
});

test('restoration can select an earlier installation folder and rejects unrelated folders and files', async t => {
  const f = await fixture(t);
  await connect(f);
  await f.drive.run(actor);
  const file = f.google.files[0], oldInstallation = '11111111-1111-4111-8111-111111111111';
  file.parents = ['previous-folder'];
  file.appProperties.installation = oldInstallation;
  f.google.folders.push({ id: 'previous-folder', name: 'Earlier Fakturocel backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { fakturocel: 'folder', installation: oldInstallation } });
  assert.equal((await f.drive.folders(actor)).folders.length, 2);
  assert.equal((await f.drive.list(actor, 'previous-folder')).files.length, 1);
  await f.drive.download(file.id, actor, 'previous-folder');
  await assert.rejects(f.drive.download(file.id, actor), e => e.status === 403);
  await assert.rejects(f.drive.list(actor, 'unrelated-folder'), e => e.status === 403);
  assert.equal(f.drive.config().folderId, 'synthetic-folder');
});

test('cloud backups can be plaintext while share backups and Google credentials remain encrypted', async t => {
  const f = await fixture(t);
  await f.store.commit({ ops: [{ collection: 'companies', id: 'plain-cloud', rev: 0, value: { id: 'plain-cloud', name: 'PER_DESTINATION_TEST_MARKER' } }] }, actor);
  await connect(f);
  await assert.rejects(f.store.changeBackupEncryption({ local: true, download: true, cloud: false }, actor), /Confirm/);
  await f.store.changeBackupEncryption({ local: true, download: true, cloud: false, confirm: 'ALLOW UNENCRYPTED BACKUPS' }, actor);
  await f.drive.configure({ enabled: true, intervalHours: 24, keepCount: 2, format: 'both' }, actor);
  await f.drive.run(actor);
  const archive = await (await import('jszip')).default.loadAsync(f.google.uploads[0]);
  const data = await archive.file('data.fakturocel').async('string');
  assert(!isEncrypted(data));
  assert.equal((await unpackBackup(data)).data.companies[0].name, 'PER_DESTINATION_TEST_MARKER');
  assert(f.google.uploads[1].subarray(0,2).equals(Buffer.from('PK')));
  const local = await f.store.backup();
  assert(isEncrypted(await fs.readFile(local.path, 'utf8')));
  for (const marker of ['PER_DESTINATION_TEST_MARKER', credentials.clientSecret, 'synthetic-refresh-token']) assert(!(await fs.readFile(f.store.file, 'utf8')).includes(marker));
  assert(!data.includes('synthetic-refresh-token'));
  await f.restart();
  assert.deepEqual(f.store.backupEncryption(), { working: true, local: true, download: true, cloud: false });
  assert.equal(f.drive.status(actor).encryptBackups, false);
});

test('untrusted upload URLs never receive tokens and disconnect aborts in-flight work without blocking record saves', async t => {
  const f = await fixture(t);
  await connect(f);
  f.google.location = 'https://untrusted.example/upload/drive/v3/files';
  await assert.rejects(f.drive.run(actor), /invalid upload address/);
  assert(f.google.calls.every(c => !c.url.includes('untrusted.example')));
  f.google.location = null;
  let started;
  const uploading = new Promise(resolve => { started = resolve; });
  f.google.uploadWait = signal => new Promise((resolve, reject) => {
    started();
    signal.addEventListener('abort', () => reject(Error('Aborted upload')), { once: true });
  });
  const backup = f.drive.run(actor);
  const rejected = assert.rejects(backup, /settings changed/);
  await uploading;
  await f.store.commit({ ops: [{ collection: 'companies', id: 'during-upload', rev: 0, value: { id: 'during-upload', name: 'Saved during upload' } }] }, actor);
  assert.equal(f.store.read().state.companies.length, 1);
  await f.drive.disconnect(actor);
  await rejected;
  assert.equal(f.store.meta('googleDrive'), null);
  assert.equal(f.google.uploads.length, 0);
  assert.equal(f.drive.status(actor).connected, false);
});

test('cloud endpoints enforce owner role, CSRF, PIN, and protection against plaintext credentials', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fakturocel-drive-api-'));
  const google = new FakeGoogle();
  const app = await createApp({ root: path.join(root, 'data'), shareRoot: path.join(root, 'share'), backupFolder: path.join(root, 'share', 'backups'),
    webRoot: path.resolve('public'), allowRequest: () => true, googleFetch: google.fetch, googleTimer: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  await app.store.setup({ enabled: true }, actor.id, actor.name);
  const url = 'http://127.0.0.1:' + app.server.address().port + '/api/';
  const csrf = (await (await fetch(url + 'security', { headers: { 'x-remote-user-id': actor.id } })).json()).csrf;
  const request = (route, data, user = actor.id, token = csrf) => fetch(url + route, { method: data ? 'POST' : 'GET',
    headers: { 'x-remote-user-id': user, 'x-fakturocel-token': token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  assert.equal((await request('google-drive')).status, 200);
  assert.equal((await request('google-drive', null, 'reader')).status, 403);
  assert.equal((await request('google-drive/connect', credentials, actor.id, '')).status, 403);
  assert.equal((await request('google-drive/connect', credentials, 'reader')).status, 403);
  app.store.setMeta('googleDrive', { refreshToken: 'synthetic-refresh-token', enabled: false });
  const disabled = await request('security/change', { enabled: false, confirm: 'DISABLE ENCRYPTION' });
  assert.equal(disabled.status, 400);
  assert.match((await disabled.json()).error, /Disconnect Google Drive/);
  assert(app.store.context);
  await app.access.change({ enabled: true, pin: '739184' }, actor, { headers: { 'x-ingress-path': '/' }, socket: {} }, { setHeader() {} });
  assert.equal((await request('google-drive')).status, 423);
  assert.equal((await request('google-drive/backup', {})).status, 423);
  assert.equal(google.calls.length, 0);
});
