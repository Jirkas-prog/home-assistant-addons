import { exerciseCalculatorDraft, exerciseCalculatorSettings } from './calculators-browser.mjs';
import { exerciseSecurity } from './security-browser.mjs';
import { exerciseAppearance } from './appearance-browser.mjs';
import { exerciseEnhancements } from './enhancements-browser.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const czech = JSON.parse(await fs.readFile(new URL('../src/locales/cs.json', import.meta.url), 'utf8')).translations;
const addon = process.env.FAKTUROCEL_ADDON_DIR || fileURLToPath(new URL("../build/fakturocel", import.meta.url));
const {
  createApp
} = await import((await import('node:url')).pathToFileURL(path.join(addon, 'server.mjs')).href);
import { unpackBackup } from '../src/model.js';
const require = createRequire(import.meta.url),
  {
    chromium
  } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = await fs.mkdtemp(path.join(os.tmpdir(), "fakturocel-v3-browser-")),
  app = await createApp({
    root: path.join(root, 'data'),
    shareRoot: path.join(root, 'share'),
    backupFolder: path.join(root, 'share', 'backups'),
    webRoot: path.join(addon, 'web'),
    allowRequest: r => r.socket.remoteAddress === '127.0.0.1'
  });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const prefix = '/api/hassio_ingress/test-v3/',
  proxy = http.createServer((req, res) => {
    if (!req.url.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const forward = http.request({
      host: '127.0.0.1',
      port: app.server.address().port,
      path: '/' + req.url.slice(prefix.length),
      method: req.method,
      headers: {
        ...req.headers,
        'x-remote-user-id': 'browser-owner',
        'x-remote-user-name': 'Test Owner',
        'x-ingress-path': prefix
      }
    }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    forward.on('error', () => res.destroy());
    req.pipe(forward);
  });
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--host-resolver-rules=MAP fakturocel.test 127.0.0.1", '--no-proxy-server']
  }),
  context = await browser.newContext({
    viewport: {
      width: 1500,
      height: 1050
    },
    acceptDownloads: true
  }),
  page = await context.newPage(),
  errors = [];
page.on('pageerror', e => {
  errors.push(e.message);
  console.log('PAGE ERROR', e.message);
});
const nativeDialogs = [];
page.on('dialog', d => {
  nativeDialogs.push(d.type() + ': ' + d.message());
  void d.dismiss();
});
page.setDefaultTimeout(20000);
const url = `http://fakturocel.test:${proxy.address().port}${prefix}`,
  click = a => page.locator(`[data-action="${a}"]`).first().click(),
  fill = (name, v) => page.locator(`[name="${name}"]`).fill(String(v)),
  choose = (name, v) => page.locator(`[name="${name}"]`).selectOption(v),
  closed = () => page.waitForFunction(() => !document.querySelector('#modal').innerHTML),
  progress = m => console.log(new Date().toISOString() + ' ' + m);
const acceptMessage = async () => {
  await page.locator('#messageOverlay [data-message="ok"]').click();
  await page.locator('#messageOverlay').waitFor({
    state: 'detached'
  });
};
const setupUnencrypted = async () => {
  await page.getByRole('heading', {
    name: "Security of Fakturocel",
    exact: true
  }).waitFor();
  await choose('enabled', 'false');
  await page.locator('[name="disableConfirmed"]').check();
  await click('securitySave');
  await acceptMessage();
  await page.getByText("Welcome to Fakturocel").waitFor();
};
try {
  await page.goto(url);
  await setupUnencrypted();
  await page.getByText("Welcome to Fakturocel").waitFor();
  assert.equal(app.store.read().state.documents.length, 0);
  assert.equal(await page.evaluate(() => !!crypto.subtle), false);
  progress('Empty installation over HTTP');
  await click('nav:settings');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  const englishActions = await page.locator('[data-action]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.action))].sort());
  await choose('appLanguage', 'cs');
  await page.waitForFunction(() => document.documentElement.lang === 'cs');
  await page.getByRole('heading', { name: czech['Settings and data'], exact: true }).waitFor();
  assert.equal(app.store.read().state.settings.language, 'cs');
  const czechActions = await page.locator('[data-action]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.action))].sort());
  assert.deepEqual(czechActions, englishActions);
  await page.reload();
  await page.getByRole('heading', { name: czech.Overview, exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'cs');
  await click('nav:settings');
  await choose('appLanguage', 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.getByRole('heading', { name: 'Settings and data', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(app.store.read().state.settings.language, 'en');
  progress('English and Czech interface with persistent language setting');
  await click('nav:settings');
  await click('editSettings');
  await fill('supplier_name', 'Test Supplier');
  await fill('supplier_ico', '12345678');
  await fill('supplier_footer', 'Test Footer');
  await click('formSave');
  await closed();
  assert.equal(app.store.read().state.supplier.name, 'Test Supplier');
  await click('nav:companies');
  await click('editRecord:companies:new');
  await fill('name', 'Test Customer');
  await fill('street', 'Test Street');
  await fill('city', 'Test City');
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
  progress('Settings, catalogs and custom field');
  await click('nav:templates');
  await click('editTemplate:builtin-clean');
  await page.locator('.paper').first().waitFor();
  await click('edSelect:Title');
  await fill('color', '#225588');
  await page.locator('[name="color"]').dispatchEvent('change');
  await fill('templateName', 'My custom template');
  await page.locator('[name="templateName"]').dispatchEvent('change');
  await click('edAdd:text');
  await fill('y', '230');
  await page.locator('[name="y"]').dispatchEvent('change');
  await page.locator('#richText').fill('Extra text');
  await click('edField');
  await page.locator('#properties > select').selectOption('doc.number');
  await page.locator('#richText [data-field]').click();
  await click('edBold');
  await fill('color', '#168047');
  await page.locator('[name="color"]').dispatchEvent('change');
  await page.screenshot({
    path: path.join(root, 'editor.png')
  });
  await click('edPublish');
  await closed();
  const template = app.store.read().state.templates.find(t => t.name === 'My custom template');
  assert(template?.status === 'active');
  const styled = template.nodes.flatMap(n => n.runs || []).find(r => r.field === 'doc.number' && r.color === '#168047');
  assert(styled?.bold, 'Variable keeps selected bold and color');
  await click('defaultTemplate:' + template.id);
  progress('Template editing and publication');
  await click('nav:invoice');
  await click('newDoc:invoice');
  await exerciseCalculatorDraft({
    page,
    root,
    progress
  });
  await click('docCustomer');
  await click('closeModal');
  await page.locator('#docForm').waitFor();
  await click('docCustomer');
  await page.locator('#pickerSearch').fill('Test Customer');
  await page.locator('#pickerSearch').press('Enter');
  await click('docCatalog');
  await page.locator('#pickerSearch').fill('Test Work');
  await page.locator('#pickerSearch').press('Enter');
  await click('docIssue');
  await page.locator('#messageOverlay [data-message="cancel"]').click();
  assert.equal(app.store.read().state.documents.length, 0);
  await click('docIssue');
  await acceptMessage();
  await closed();
  const invoice = app.store.read().state.documents[0];
  assert(invoice?.pdfHash);
  assert.equal(invoice.status, 'issued');
  progress('Invoice issued by packaged server');
  const pdfDownload = page.waitForEvent('download');
  await click('pdf:' + invoice.id);
  const pdf = await pdfDownload;
  await pdf.saveAs(path.join(root, 'invoice.pdf'));
  assert((await fs.readFile(path.join(root, 'invoice.pdf'))).subarray(0, 5).toString() === '%PDF-');
  await click('print:' + invoice.id);
  await page.frameLocator('.print-overlay iframe').locator('canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.print-overlay iframe')?.contentWindow.printReady === true);
  await page.screenshot({
    path: path.join(root, 'print.png')
  });
  await page.locator('#printClose').click();
  await click('openDoc:' + invoice.id);
  await click('addPayment:' + invoice.id);
  await fill('amount', '500');
  await click('formSave');
  await closed();
  assert.equal(app.store.read().state.payments[0].amount, 500);
  progress('PDF, print and payment');
  await exerciseAppearance({
    page,
    click,
    fill,
    choose,
    closed,
    acceptMessage,
    app,
    root,
    invoice,
    progress
  });
  await exerciseEnhancements({
    page,
    click,
    fill,
    closed,
    acceptMessage,
    app,
    root,
    progress
  });
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
  await click('nav:checks');
  await click('editCheck:new');
  await fill('title', 'Verify order');
  await choose('documentId', invoice.id);
  await click('formSave');
  await closed();
  const check = app.store.read().state.checks[0];
  await click('editCheck:' + check.id);
  await choose('status', 'resolved');
  await fill('reason', 'Verified by owner');
  await click('formSave');
  await closed();
  assert.equal(app.store.read().state.checks[0].status, 'resolved');
  await click('nav:settings');
  const download = page.waitForEvent('download');
  await click('downloadBackup');
  const backup = await download,
    backupFile = path.join(root, "backup.fakturocel");
  await backup.saveAs(backupFile);
  const packed = await unpackBackup(await fs.readFile(backupFile, 'utf8'));
  assert.equal(packed.data.documents.length, 1);
  assert.equal(packed.data.templates.length, 3);
  const excelDownload = page.waitForEvent('download');
  await click('excel');
  await (await excelDownload).saveAs(path.join(root, 'export.xlsx'));
  progress('Checks and complete exports');
  await click('nav:templates');
  const templateDownload = page.waitForEvent('download');
  await click('exportTemplate:' + template.id);
  await click('confirmTemplateExport');
  const templateFile = path.join(root, "template.fakturocel-template");
  await (await templateDownload).saveAs(templateFile);
  const chooseTemplate = page.waitForEvent('filechooser');
  await click('importTemplate');
  await (await chooseTemplate).setFiles(templateFile);
  await acceptMessage();
  await page.waitForFunction(() => document.querySelectorAll('#content tbody tr').length === 4);
  assert.equal(app.store.read().state.templates.length, 4);
  await click('nav:invoice');
  await fill('filter_min', '200');
  await fill('filter_max', '100');
  await page.getByText('Fix filter range:', {
    exact: false
  }).waitFor();
  await click('clearFilters');
  await click('filterCustomer');
  await page.locator('#pickerSearch').fill('Test Customer');
  await page.locator('#pickerSearch').press('Enter');
  assert.equal(await page.locator('#docResults tbody tr').count(), 1);
  await click('nav:invoice');
  await page.setViewportSize({
    width: 412,
    height: 915
  });
  await page.screenshot({
    path: path.join(root, 'mobile.png'),
    fullPage: true
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({
    width: 1500,
    height: 1050
  });
  await click('nav:settings');
  await click('wipe');
  assert(await page.locator('#wipeFinish').isDisabled());
  assert(await page.locator('#wipeFile').isDisabled());
  const wipeDownload = page.waitForEvent('download');
  await click('wipeDownload');
  const wipe = await wipeDownload,
    wipeFile = path.join(root, "wipe.fakturocel");
  await wipe.saveAs(wipeFile);
  await page.locator('#wipeFile').setInputFiles(wipeFile);
  await page.getByText("Backup verified. Contains current data.").waitFor();
  await fill('wipeConfirm', "DELETE DATA");
  assert(await page.locator('#wipeFinish').isEnabled());
  await click('wipeFinish');
  await setupUnencrypted();
  await page.getByText("Welcome to Fakturocel").waitFor();
  assert.equal(app.store.read().state.documents.length, 0);
  assert.equal(app.store.read().state.supplier.name, '');
  progress('Mandatory backup and wipe');
  const chooser = page.waitForEvent('filechooser');
  await click('restore');
  await (await chooser).setFiles(backupFile);
  await acceptMessage();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === "Backup has been restored.");
  assert.equal(app.store.read().state.documents[0].pdfHash, invoice.pdfHash);
  await exerciseSecurity({
    page,
    click,
    fill,
    choose,
    closed,
    acceptMessage,
    app,
    root,
    invoice,
    progress
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeDialogs, []);
  assert.equal(app.store.read().state.settings.appearance.theme, 'custom');
  assert(app.store.read().state.settings.appearance.logoId);
  progress('PASS complete browser workflow; artifacts ' + root);
} catch (e) {
  console.error('FAIL', e);
  await page.screenshot({
    path: path.join(root, 'failure.png'),
    fullPage: true
  }).catch(() => {});
  console.error('Artifacts: ' + root);
  throw e;
} finally {
  await browser.close();
  proxy.closeAllConnections();
  await new Promise(r => proxy.close(r));
  await app.close();
}
