import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import officeCrypto from 'officecrypto-tool';
import { SecureStore } from '../server/secure-store.mjs';
import { backupFiles, backupDownload, readBackupFile } from '../server/backup-formats.mjs';
import { BackupRestore } from '../server/backup-restore.mjs';
import { unpackBackup } from '../src/model.js';

const actor = { id: 'owner', name: 'Synthetic owner', role: 'owner' };
async function fixture(t, encrypted = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fakturocel-formats-'));
  const store = new SecureStore({ root: path.join(root, 'data'), shareRoot: path.join(root, 'share'), backupFolder: path.join(root, 'share', 'backups') });
  await store.init();
  await store.setup({ enabled: encrypted, confirm: 'DISABLE ENCRYPTION' }, actor.id, actor.name);
  await store.commit({ ops: [{ collection: 'companies', id: 'complete', rev: 0, value: { id: 'complete', name: 'COMPLETE_BACKUP_MARKER _x0041_ & <text>' } }] }, actor);
  t.after(() => store.close());
  return store;
}

test('ZIP, Excel, and combined downloads reproduce one complete snapshot and preserve binary attachments', async t => {
  const store = await fixture(t);
  store.putBlob(Buffer.from('SYNTHETIC_ATTACHMENT_BYTES'), 'application/pdf', 'synthetic.pdf');
  const files = await backupFiles(store, 'both', true);
  assert.deepEqual(files.map(f => f.extension), ['zip', 'xlsx']);
  const recovered = [];
  for (const f of files) {
    assert(!f.bytes.includes(Buffer.from('COMPLETE_BACKUP_MARKER')));
    const text = await readBackupFile(store, f.bytes, 'data.' + f.extension);
    const backup = await unpackBackup(text);
    assert.deepEqual(backup.data, store.read().state);
    assert.deepEqual(backup.blobs, store.allBlobs());
    recovered.push(text);
  }
  assert.equal(recovered[0], recovered[1]);
  const combined = await backupDownload(store, 'both');
  assert.equal(combined.extension, 'zip');
  assert.deepEqual((await unpackBackup(await readBackupFile(store, combined.bytes, 'combined.zip'))).data, store.read().state);
});

test('Excel saved with shared strings remains restorable; missing, duplicated, and corrupted backup data is rejected', async t => {
  const store = await fixture(t, false);
  const [f] = await backupFiles(store, 'excel');
  const zip = await JSZip.loadAsync(f.bytes);
  const backupPath = 'xl/worksheets/sheet16.xml';
  assert(zip.file(backupPath), 'Application backup sheet exists');
  const original = await zip.file(backupPath).async('string');
  const strings = [];
  const worksheet = original.replace(/<c r="(B\d+)" t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c>/g, (_, ref, content) => {
    const index = strings.push(content) - 1;
    return `<c r="${ref}" t="s"><v>${index}</v></c>`;
  });
  zip.file(backupPath, worksheet);
  zip.file('xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`);
  const result = await unpackBackup(await readBackupFile(store, await zip.generateAsync({ type: 'nodebuffer' }), 'resaved.xlsx'));
  assert.equal(result.data.companies[0].name, store.read().state.companies[0].name);
  zip.file(backupPath, original.replace('<v>1</v>', '<v>2</v>'));
  await assert.rejects(readBackupFile(store, await zip.generateAsync({ type: 'nodebuffer' }), 'missing.xlsx'), /missing or duplicate/);
  zip.file(backupPath, original.replace('COMPLETE_BACKUP_MARKER', 'ALTERED_BACKUP_MARKER'));
  const corrupt = await readBackupFile(store, await zip.generateAsync({ type: 'nodebuffer' }), 'corrupt.xlsx');
  await assert.rejects(unpackBackup(corrupt), /checksum/);
  zip.remove(backupPath);
  await assert.rejects(readBackupFile(store, await zip.generateAsync({ type: 'nodebuffer' }), 'missing.xlsx'), /incomplete/);
});

test('foreign encrypted Excel requires the recovery key and hostile archive or XML content fails before data replacement', async t => {
  const store = await fixture(t);
  const key = store.recoveryKey();
  const [excel] = await backupFiles(store, 'excel', true);
  const [archive] = await backupFiles(store, 'zip', true);
  await store.changeSecurity({ enabled: true, rotate: true }, actor);
  await assert.rejects(readBackupFile(store, excel.bytes, 'foreign.xlsx'), e => e.status === 422);
  const restored = await unpackBackup(await readBackupFile(store, excel.bytes, 'foreign.xlsx', key));
  assert.equal(restored.data.companies.length, 1);
  await assert.rejects(readBackupFile(store, excel.bytes, 'foreign.xlsx', 'incorrect recovery key'), e => e.status === 400);
  const zip = await JSZip.loadAsync(archive.bytes);
  zip.file('data.fakturocel', 'modified data');
  await assert.rejects(readBackupFile(store, await zip.generateAsync({ type: 'nodebuffer' }), 'modified.zip'), /checksum/);
  const workbook = await JSZip.loadAsync(await officeCrypto.decrypt(excel.bytes, { password: key }));
  workbook.file('xl/workbook.xml', '<!DOCTYPE workbook [<!ENTITY x "unsafe">]><workbook/>');
  await assert.rejects(readBackupFile(store, await workbook.generateAsync({ type: 'nodebuffer' }), 'hostile.xlsx'), /external entities/);
  assert.equal(store.read().state.companies.length, 1);
});

test('restore previews require the same owner and revision, create a prior backup, and cannot be reused', async t => {
  const store = await fixture(t), restore = new BackupRestore(store);
  const [zip] = await backupFiles(store, 'zip');
  const preview = await restore.preview(zip.bytes, 'snapshot.zip', null, actor);
  assert.equal(preview.companies, 1);
  assert.equal(preview.attachments, 0);
  await store.commit({ ops: [{ collection: 'companies', id: 'later', rev: 0, value: { id: 'later', name: 'Later record' } }] }, actor);
  await assert.rejects(restore.restore({ ticket: preview.ticket, revision: preview.revision }, actor), e => e.status === 409);
  assert.equal(store.read().state.companies.length, 2);
  const current = await restore.preview(zip.bytes, 'snapshot.zip', null, actor);
  const result = await restore.restore({ ticket: current.ticket, revision: current.revision }, actor);
  assert.equal(result.state.companies.length, 1);
  assert(store.meta('backupFiles').some(name => path.basename(name).startsWith('Before-restore-')));
  await assert.rejects(restore.restore({ ticket: current.ticket, revision: current.revision }, actor), /preview expired/);
});

test('share encryption protects local files while exports stay readable; enabling protection converts existing managed files', async t => {
  const store = await fixture(t);
  await store.changeBackupEncryption({ local: false, download: true, cloud: true, confirm: 'ALLOW UNENCRYPTED BACKUPS' }, actor);
  const local = await store.backup();
  assert.equal(JSON.parse(await fs.readFile(local.path, 'utf8')).format, 'FakturocelBackup');
  assert.equal(JSON.parse(await store.backupText()).format, 'FakturocelEncrypted');
  await store.changeBackupEncryption({ local: true, download: false, cloud: true, confirm: 'ALLOW UNENCRYPTED BACKUPS' }, actor);
  assert.equal(JSON.parse(await fs.readFile(local.path, 'utf8')).format, 'FakturocelEncrypted');
  const [excel] = await backupFiles(store, 'excel');
  assert(excel.bytes.subarray(0,2).equals(Buffer.from('PK')));
  const archive = await backupDownload(store, 'fakturocel');
  assert.equal(JSON.parse(archive.bytes).format, 'FakturocelBackup');
  assert.equal((await unpackBackup(await readBackupFile(store, excel.bytes, 'plaintext.xlsx'))).data.companies.length, 1);
});
