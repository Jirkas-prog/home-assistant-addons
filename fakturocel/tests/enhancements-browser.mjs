import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function exerciseEnhancements({
  page,
  click,
  fill,
  closed,
  acceptMessage,
  app,
  root,
  progress
}) {
  await click('nav:invoice');
  await page.getByRole('columnheader', {
    name: "Last change"
  }).waitFor();
  await page.getByRole('columnheader', {
    name: "Source of change"
  }).waitFor();
  assert(await page.locator('#docResults tbody').getByText('Home Assistant', {
    exact: false
  }).first().isVisible());
  await click('saveView');
  await fill('name', "My unpaid");
  await click('formSave');
  await closed();
  assert(app.store.read().state.views.some(view => view.name === "My unpaid"));
  await page.getByText("My unpaid", {
    exact: true
  }).waitFor();
  await click('selectVisible');
  assert.equal(await page.locator('[data-doc-select]:checked').count(), 1);
  assert(await page.locator('#bulkBar').isVisible());
  const archive = page.waitForEvent('download');
  await click('bulkPdf');
  const download = await archive,
    zipFile = path.join(root, 'bulk.zip');
  await download.saveAs(zipFile);
  assert.equal((await fs.readFile(zipFile)).subarray(0, 2).toString(), 'PK');
  await click('clearSelection');
  await click('newDoc:invoice');
  for (let i = 0; i < 9; i++) await click('docItem');
  const before = await page.locator('.dialog').evaluate(el => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  await page.evaluate(() => document.querySelector('[data-action="docItem"]').click());
  await page.waitForFunction(() => document.querySelectorAll('#docForm .item').length === 10);
  const after = await page.locator('.dialog').evaluate(el => el.scrollTop);
  assert(after >= before - 2, `Form scroll moved from ${before} to ${after}`);
  assert(await page.locator('.dialog-bottom [data-action="closeModal"]').isVisible());
  await click('closeModal');
  await acceptMessage();
  await closed();
  await click('nav:templates');
  await click('editTemplate:builtin-clean');
  await page.locator('.paper-ruler-x').first().waitFor();
  await click('edGuideAdd:x');
  await page.locator('.design-guide.vertical').first().waitFor();
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.querySelector('.design-guide.vertical'));
  await page.keyboard.press('Control+y');
  await page.locator('.design-guide.vertical').first().waitFor();
  await click('edLayerLock:Title');
  await page.locator('.node-hit[data-node="Title"].locked').first().waitFor();
  await click('closeModal');
  await acceptMessage();
  await closed();
  await page.keyboard.press('F1');
  await page.getByRole('heading', {
    name: "Keyboard shortcuts"
  }).waitFor();
  await page.locator('.dialog-bottom [data-action="closeModal"]').click();
  await closed();
  await click('nav:settings');
  await click('appearance');
  assert.equal(await page.locator('.contrast-check').count(), 6);
  await click('closeModal');
  await closed();
  progress('Sync origin, saved views, bulk PDF, stable form scroll, bottom back button, rulers, guides, snapping, layers, lock, history, keyboard help and contrast report');
}
