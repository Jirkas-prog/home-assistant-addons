import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import officeCrypto from 'officecrypto-tool';
import { clientRecoveryKey } from '../src/client-backup.js';
import { _electron } from 'playwright';
import { createApp } from '../server/server.mjs';
import { tlsIdentity } from '../server/devices.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-windows-native-")),
  app = await createApp({
    root: path.join(root, 'ha'),
    shareRoot: path.join(root, 'share'),
    backupFolder: path.join(root, 'share', 'backups'),
    webRoot: path.resolve('build/clients/web'),
    allowRequest: () => true
  });
await app.store.setup({
  enabled: true
}, 'owner', 'Synthetic Owner');
const actor = app.store.actor('owner', 'Synthetic Owner');
await app.store.commit({
  ops: [{
    collection: 'companies',
    id: 'native-test',
    rev: 0,
    value: {
      id: 'native-test',
      name: 'Windows encrypted fixture'
    }
  }]
}, actor);
const addr = await app.devices.start(await tlsIdentity(path.join(root, 'ha')), 0, '127.0.0.1'),
  pair = await app.devices.pair({
    name: 'Windows native test',
    url: 'https://127.0.0.1:' + addr.port
  }, actor),
  pairFile = path.join(root, 'pairing.json');
await fs.writeFile(pairFile, JSON.stringify(pair));
const packagedExecutable = process.env.FAKTUROCEL_ELECTRON;
const electron = await _electron.launch({
  executablePath: packagedExecutable || path.resolve('../node_modules/electron/dist/electron.exe'),
  args: packagedExecutable ? [] : [path.resolve('build/clients')],
  env: {
    ...process.env,
    FAKTUROCEL_HEADLESS_TEST: '1',
    FAKTUROCEL_TEST_DATA: path.join(root, 'windows')
  },
  timeout: 30000
});
try {
  const page = await electron.firstWindow();
  const click = async a => {
    await page.waitForFunction(() => !document.body.classList.contains('busy'));
    await page.locator('[data-action="' + a + '"]').first().click();
  };
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error') console.log('Renderer:', m.text());
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.getByText("Welcome to Fakturocel").waitFor();
  await click("localDefaultFolder");
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
  await click("nav:settings");
  assert(await electron.evaluate(({
    BrowserWindow
  }) => BrowserWindow.getAllWindows().every(w => !w.isVisible())), 'No visible desktop windows');
  await electron.evaluate(({
    dialog
  }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file]
    });
  }, pairFile);
  await click("clientPair");
  await page.getByRole('heading', {
    name: "Home Assistant · optional connection",
    exact: true
  }).waitFor();
  await click("clientPull");
  await click("clientApply");
  await page.waitForFunction(() => !document.querySelector('#modal').innerHTML);
  await click("nav:companies");
  await page.getByText('Windows encrypted fixture', {
    exact: true
  }).waitFor();
  const cache = path.join(root, 'windows', 'connected-v3', 'client-v3.cache');
  assert(!(await fs.readFile(cache, 'utf8')).includes('Windows encrypted fixture'));
  assert((await fs.readFile(path.join(root, 'windows', 'connected-v3', 'client-key.bin'))).length > 32);
  assert(await electron.evaluate(({
    safeStorage
  }) => safeStorage.isEncryptionAvailable()));
  await electron.evaluate(({
    dialog
  }, folder) => {
    dialog.showSaveDialog = async options => ({
      canceled: false,
      filePath: folder + '/native.xlsx'
    });
  }, root);
  await click("excel");
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
  const cacheValue = await page.evaluate(async () => {
    const r = await window.fakturocelClient.call('load');
    return JSON.parse(r.result);
  });
  const excel = await fs.readFile(path.join(root, 'native.xlsx'));
  assert(officeCrypto.isEncrypted(excel));
  assert((await officeCrypto.decrypt(excel, {
    password: clientRecoveryKey(cacheValue.exportContext)
  })).length > 0);
  await app.devices.close();
  await page.reload();
  await page.getByRole('heading', {
    name: "Overview",
    exact: true
  }).waitFor();
  await click("nav:companies");
  await page.getByText('Windows encrypted fixture', {
    exact: true
  }).waitFor();
  await click("editRecord:companies:new");
  await page.locator('[name="name"]').fill('Native offline change');
  await click("formSave");
  await page.waitForFunction(() => !document.querySelector('#modal').innerHTML);
  assert(!(await fs.readFile(cache, 'utf8')).includes('Native offline change'));
  await page.reload();
  await page.getByRole('heading', {
    name: "Overview",
    exact: true
  }).waitFor();
  await click("nav:companies");
  await page.getByText('Native offline change', {
    exact: true
  }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS hidden standalone Windows Electron: fresh empty app, optional TLS sync, native IPC, DPAPI/AES cache, encrypted file-worker Excel, offline edit and reload.');
  console.log('Artifacts:', root);
} catch (e) {
  for (const page of electron.windows()) console.log('Window body:', await page.locator('body').innerText().catch(() => '<unavailable>'));
  throw e;
} finally {
  await electron.close();
  await app.close();
}
