import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import officeCrypto from 'officecrypto-tool';
import JSZip from 'jszip';
import { clientRecoveryKey } from '../src/client-backup.js';
import { unpackBackup } from '../src/model.js';
import { unlockEnvelope } from '../server/encryption.mjs';
import { createApp } from '../server/server.mjs';
import { tlsIdentity } from '../server/devices.mjs';
import { exerciseCalculatorDraft, exerciseCalculatorSettings } from './calculators-browser.mjs';
const require = createRequire(import.meta.url),
  {
    ClientStore
  } = require('../clients/windows/bridge.cjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), "Fakturocel-standalone-browser-")),
  webRoot = path.resolve('build/clients/web'),
  ha = await createApp({
    root: path.join(root, 'ha'),
    shareRoot: path.join(root, 'share'),
    backupFolder: path.join(root, 'share', 'backups'),
    webRoot,
    allowRequest: () => true
  });
await ha.store.setup({
  enabled: true
}, 'owner', 'Owner');
const owner = ha.store.actor('owner', 'Owner');
await ha.store.commit({
  ops: [{
    collection: 'companies',
    id: 'from-ha',
    rev: 0,
    value: {
      id: 'from-ha',
      name: 'Company from HA'
    }
  }]
}, owner);
const addr = await ha.devices.start(await tlsIdentity(path.join(root, 'ha')), 0, '127.0.0.1'),
  pair = await ha.devices.pair({
    name: 'Standalone browser',
    url: 'https://127.0.0.1:' + addr.port
  }, owner);
const native = new ClientStore(path.join(root, 'device'), {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from(s),
    decryptString: b => b.toString()
  }),
  exports = [],
  errors = [];
let cache,
  requests = 0,
  offline = true,
  printed = false,
  failSave = false;
const app = {
    store: {
      read: () => cache.snapshot
    }
  },
  server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost'),
        file = path.resolve(webRoot, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
      if (!file.startsWith(webRoot + path.sep)) throw Error();
      res.setHeader('Content-Type', {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.ttf': 'font/ttf'
      }[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH
  }),
  page = await browser.newPage({
    viewport: {
      width: 1500,
      height: 1050
    }
  });
page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', async d => {
  errors.push('Native ' + d.type());
  await d.dismiss();
});
await page.exposeFunction('testNative', async (name, arg) => {
  try {
    let result;
    if (name === 'request') {
      requests++;
      if (offline) throw Error("Test: without network");
    }
    if (name === 'import') result = JSON.stringify(pair);else if (name === 'chooseBackupFolder') result = await native.call('backupFolder', path.join(root, 'chosen-backups'));else if (name === 'export') {
      const file = path.join(root, arg.name);
      await fs.writeFile(file, Buffer.from(arg.base64, 'base64'));
      exports.push(file);
      result = true;
    } else if (name === 'print') {
      printed = true;
      result = true;
    } else {
      if (name === 'save' && failSave) {
        failSave = false;
        throw Error("Test: full disk");
      }
      result = await native.call(name, arg);
      if (name === 'save') cache = JSON.parse(arg);
    }
    return {
      ok: true,
      result
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      status: e.status || 0
    };
  }
});
await page.addInitScript(() => window.fakturocelClient = {
  enveloped: true,
  call: (n, a) => window.testNative(n, a)
});
const click = async a => {
    await idle();
    await page.locator('[data-action="' + a + '"]').first().click();
  },
  fill = (n, v) => page.locator('[name="' + n + '"]').fill(String(v)),
  choose = (n, v) => page.locator('[name="' + n + '"]').selectOption(v),
  closed = () => page.waitForFunction(() => !document.querySelector('#modal').innerHTML),
  idle = () => page.waitForFunction(() => !document.body.classList.contains('busy')),
  acceptMessage = async () => {
    await page.locator('#messageOverlay [data-message="ok"]').click();
    await page.locator('#messageOverlay').waitFor({
      state: 'detached'
    });
  },
  progress = m => console.log(m);
try {
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.getByText("Welcome to Fakturocel").waitFor();
  assert.equal(requests, 0);
  await click('backupFolder');
  await idle();
  assert(cache.backupFolderChosen);
  await click('nav:settings');
  await click('editSettings');
  await fill('supplier_name', 'Test Supplier');
  await fill('supplier_footer', 'Test footer');
  await click('formSave');
  await closed();
  await click('nav:companies');
  await click('editRecord:companies:new');
  await fill('name', 'Test Customer');
  await fill('city', 'Praha');
  await click('formSave');
  await closed();
  await click('nav:activities');
  await click('editRecord:activities:new');
  await fill('name', 'Test Work');
  await fill('price', '1234.5');
  await click('formSave');
  await closed();
  await click('nav:fields');
  await click('editField:new');
  await fill('name', 'Order number');
  await choose('scope', 'document');
  await click('formSave');
  await closed();
  await click('nav:templates');
  await click('editTemplate:builtin-clean');
  await page.locator('.paper').first().waitFor();
  await fill('templateName', 'Standalone template');
  await page.locator('[name="templateName"]').dispatchEvent('change');
  await click('edPublish');
  await closed();
  const template = cache.snapshot.state.templates.find(t => t.name === 'Standalone template');
  assert(template);
  await click('defaultTemplate:' + template.id);
  await click('nav:invoice');
  await click('newDoc:invoice');
  await exerciseCalculatorDraft({
    page,
    root,
    progress
  });
  await click('docCustomer');
  await page.locator('#pickerSearch').fill('Test Customer');
  await page.locator('#pickerSearch').press('Enter');
  await click('docCatalog');
  await page.locator('#pickerSearch').fill('Test Work');
  await page.locator('#pickerSearch').press('Enter');
  await click('docIssue');
  await acceptMessage();
  await closed();
  const invoice = cache.snapshot.state.documents[0];
  assert(invoice.pdfHash);
  assert.equal(invoice.status, 'issued');
  assert.equal(requests, 0);
  assert.equal(ha.store.read().state.documents.length, 0);
  await click('pdf:' + invoice.id);
  await idle();
  assert(exports.some(f => f.endsWith('.pdf')));
  await click('print:' + invoice.id);
  await idle();
  assert(printed);
  await click('openDoc:' + invoice.id);
  await click('addPayment:' + invoice.id);
  await fill('amount', '500');
  await click('formSave');
  await closed();
  await click('openDoc:' + invoice.id);
  await page.locator('.document-status.partial').waitFor();
  await page.screenshot({
    path: path.join(root, 'standalone-invoice.png')
  });
  await click('closeModal');
  await click('nav:settings');
  await click('appearance');
  await fill('fontSize', '18');
  await choose('scale', '120');
  await choose('theme', 'dark');
  const image = page.waitForEvent('filechooser');
  await click('appearanceLogo');
  await (await image).setFiles(path.resolve('icon.png'));
  await page.waitForFunction(() => document.querySelector('[name="logoId"]').value !== '');
  await click('appearanceSave');
  await closed();
  assert(await page.locator('.brand-logo').evaluate(el => el.complete && el.naturalWidth > 0));
  await page.reload();
  await page.getByRole('heading', {
    name: "Overview",
    exact: true
  }).waitFor();
  assert.equal(await page.evaluate(() => document.body.style.zoom), '1.2');
  assert.equal(cache.snapshot.state.documents[0].pdfHash, invoice.pdfHash);
  await exerciseCalculatorSettings({
    page,
    click,
    fill,
    closed,
    acceptMessage,
    app,
    root,
    progress
  });
  await click('nav:settings');
  await click('downloadBackup');
  await idle();
  const backup = exports.findLast(f => f.endsWith(".fakturocel")),
    key = clientRecoveryKey(cache.exportContext);
  assert.equal((await unpackBackup((await unlockEnvelope(await fs.readFile(backup, 'utf8'), key, 'backup')).content)).data.documents.length, 1);
  await click('recoveryPdf');
  await idle();
  assert(exports.some(f => f.endsWith('recovery-key.pdf')));
  await click('excel');
  await idle();
  const excel = await fs.readFile(exports.findLast(f => f.endsWith('.xlsx')));
  assert(officeCrypto.isEncrypted(excel));
  const zip = await JSZip.loadAsync(await officeCrypto.decrypt(excel, {
    password: key
  }));
  assert((await zip.file('xl/workbook.xml').async('string')).includes("Application backup"));
  progress('Offline issuance, PDF, payment, templates, logo, encrypted backup/key PDF and encrypted Excel pass');
  await click('nav:templates');
  await click('exportTemplate:' + template.id);
  await click('confirmTemplateExport');
  await idle();
  const tpl = exports.findLast(f => f.endsWith(".fakturocel-template"));
  assert(tpl);
  const tc = page.waitForEvent('filechooser');
  await click('importTemplate');
  await (await tc).setFiles(tpl);
  await acceptMessage();
  await idle();
  assert.equal(cache.snapshot.state.templates.length, 4);
  await click('nav:companies');
  const company = cache.snapshot.state.companies[0];
  await click('editRecord:companies:' + company.id);
  await fill('name', 'Disk failure edit');
  failSave = true;
  await click('formSave');
  await page.locator('#messageOverlay').getByText("Test: full disk", {
    exact: false
  }).waitFor();
  await acceptMessage();
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Disk failure edit');
  assert.equal(cache.snapshot.state.companies[0].name, 'Test Customer');
  await fill('name', 'Test Customer');
  await click('formSave');
  await closed();
  await click('nav:settings');
  await click('pinSettings');
  await choose('pinEnabled', 'true');
  await fill('pin', '739184');
  await fill('repeatPin', '739184');
  await click('pinSave');
  await closed();
  await page.reload();
  await page.getByRole('heading', {
    name: "The application is locked"
  }).waitFor();
  assert.equal(await page.locator('#calculator-launcher').count(), 0);
  await fill('loginPin', '739184');
  await click('pinUnlock');
  await page.getByRole('heading', {
    name: "Overview",
    exact: true
  }).waitFor();
  assert.equal(requests, 0);
  offline = false;
  await click('nav:settings');
  await click('clientPair');
  await idle();
  assert.equal(ha.store.read().state.documents.length, 0);
  await click('clientPush');
  await click('clientApply');
  await closed();
  assert.equal(ha.store.read().state.documents[0].pdfHash, invoice.pdfHash);
  assert.equal(cache.snapshot.state.companies.length, 2);
  assert.equal(ha.store.read().state.settings.calculators[0].name, 'Test custom calculation');
  assert(!ha.store.meta('accessPin'));
  await click('clientDisconnect');
  await acceptMessage();
  await idle();
  assert.equal(cache.remote, null);
  offline = true;
  await page.reload();
  await page.getByRole('heading', {
    name: "The application is locked"
  }).waitFor();
  await fill('loginPin', '739184');
  await click('pinUnlock');
  await click('nav:invoice');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.screenshot({
    path: path.join(root, 'after-disconnect.png')
  });
  await click('nav:settings');
  await page.setViewportSize({
    width: 412,
    height: 915
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({
    path: path.join(root, 'standalone-mobile.png')
  });
  await page.setViewportSize({
    width: 1500,
    height: 1050
  });
  await click('clientClear');
  await page.locator('[data-action="clientVerify"]').waitFor();
  const verify = page.waitForEvent('filechooser');
  await click('clientVerify');
  await (await verify).setFiles(path.join(root, "Fakturocel-before-deletion.fakturocel"));
  await acceptMessage();
  await page.getByText("Welcome to Fakturocel").waitFor();
  assert.equal(cache.snapshot.state.documents.length, 0);
  assert.equal(ha.store.read().state.documents.length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS standalone UI, no HA required, local failure rollback, optional sync/disconnect and verified wipe. Artifacts:', root);
} catch (e) {
  await page.screenshot({
    path: path.join(root, 'failure.png'),
    fullPage: true
  });
  console.log('Failure body:', await page.locator('body').innerText());
  console.log('Artifacts:', root);
  throw e;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await ha.close();
}
