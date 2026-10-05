import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { unpackBackup } from '../src/model.js';
import { readBackupFile } from '../server/backup-formats.mjs';

export async function exerciseExports({ page, click, choose, closed, acceptMessage, app, root, progress, czech }) {
  await click('nav:settings');
  const before = app.store.read(), downloads = [];
  const recordDownload = download => downloads.push(download);
  page.on('download', recordDownload);
  // Keep a real status response visible long enough to exercise keyboard and cancel controls.
  const holdStatus = async route => {
    const address = new URL(route.request().url());
    address.hostname = '127.0.0.1';
    const response = await route.fetch({ url: address.href });
    await new Promise(resolve => setTimeout(resolve, 700));
    try { await route.fulfill({ response }); } catch { /* The cancelled browser request no longer needs a response. */ }
  };
  await page.route('**/api/export/status?*', holdStatus);
  for (const language of ['en', 'cs']) {
    await choose('appLanguage', language);
    await page.waitForFunction(value => document.documentElement.lang === value, language);
    for (const format of ['zip', 'excel']) {
      if (format === 'zip') { await click('downloadBackup'); await choose('format', 'zip'); await click('backupExportSave'); }
      else await click('excel');
      const overlay = page.locator('#operationOverlay');
      await overlay.waitFor();
      const title = format === 'excel' ? 'Generating unencrypted Excel' : 'Creating application backup';
      await overlay.getByRole('heading', { name: language === 'cs' ? czech[title] : title, exact: true }).waitFor();
      const value = await overlay.locator('progress').getAttribute('value');
      assert(+value >= 0 && +value <= 100);
      assert.match(await overlay.locator('strong').textContent(), /^\d+%$/);
      assert.equal(await overlay.locator('button').getAttribute('id'), 'operationCancel');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'operationCancel');
      if (format === 'zip') await overlay.locator('button').click();
      else await page.keyboard.press('Escape');
      await overlay.waitFor({ state: 'detached' });
      const message = 'Export cancelled. No file was downloaded; application data is unchanged.';
      await page.locator('#toast').getByText(language === 'cs' ? czech[message] : message, { exact: true }).waitFor();
      assert.equal(app.exports.jobs.size, 0);
      assert.equal(downloads.length, 0);
      assert.deepEqual(app.store.read().state.documents, before.state.documents);
      assert.deepEqual(app.store.read().state.companies, before.state.companies);
      assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
      if (format === 'zip') { await click('closeModal'); await closed(); }
    }
  }
  await page.unroute('**/api/export/status?*', holdStatus);
  await choose('appLanguage', 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  // A failed transfer uses the application's dialog, sends no download, and permits a retry.
  const failResult = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test export transfer interrupted.' }) });
  await page.route('**/api/export/result?*', failResult);
  await click('excel');
  await page.locator('#messageOverlay').getByText('Test export transfer interrupted.', { exact: true }).waitFor();
  await acceptMessage();
  assert.equal(downloads.length, 0);
  assert.equal(app.exports.jobs.size, 0);
  await page.unroute('**/api/export/result?*', failResult);
  const download = page.waitForEvent('download');
  await click('excel');
  const file = path.join(root, 'readable-progress-export.xlsx');
  await (await download).saveAs(file);
  const bytes = await fs.readFile(file);
  await JSZip.loadAsync(bytes);
  const restored = await unpackBackup(await readBackupFile({ decryptExport: async text => text }, bytes, 'readable-progress-export.xlsx'));
  assert.deepEqual(restored.data, app.store.read().state);
  assert.equal(downloads.length, 1);
  assert.equal(app.exports.jobs.size, 0);
  await page.locator('#toast').getByText('Unencrypted Excel sent for download. It includes complete application data for restoration.', { exact: true }).waitFor();
  await click('nav:templates');
  const template = app.store.read().state.templates[0], templateDownload = page.waitForEvent('download');
  await click('exportTemplate:' + template.id);
  await click('confirmTemplateExport');
  const templateFile = path.join(root, 'readable-template.fakturocel-template');
  await (await templateDownload).saveAs(templateFile);
  assert.equal(JSON.parse(await fs.readFile(templateFile, 'utf8')).format, 'FakturocelTemplate');
  page.off('download', recordDownload);
  await click('nav:settings');
  progress('PASS English/Czech export percentages, keyboard and real cancellation, failed download/retry, readable Excel restoration and plaintext template export');
}
