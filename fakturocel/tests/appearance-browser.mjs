import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function exerciseAppearance({
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
}) {
  await click('openDoc:' + invoice.id);
  await page.locator('.document-status.partial').waitFor();
  assert.equal(await page.locator('.payment-progress').getAttribute('aria-valuenow'), '41');
  await page.screenshot({
    path: path.join(root, 'fakturocel-partial.png')
  });
  await click('addPayment:' + invoice.id);
  await fill('amount', '734.5');
  await click('formSave');
  await closed();
  await click('openDoc:' + invoice.id);
  await page.locator('.document-status.paid').waitFor();
  assert.equal(await page.locator('.payment-progress').getAttribute('aria-valuenow'), '100');
  await page.screenshot({
    path: path.join(root, 'fakturocel-paid.png')
  });
  await click('closeModal');
  await closed();
  await click('nav:settings');
  await click('appearance');
  await fill('fontSize', 30);
  await click('appearanceSave');
  await page.locator('#messageOverlay').getByText("The largest allowed value is 22.", {
    exact: false
  }).waitFor();
  assert.equal(await page.locator('[name="fontSize"]').getAttribute('aria-invalid'), 'true');
  await acceptMessage();
  await fill('fontSize', 18);
  await fill('smallTextSize', 14);
  await choose('scale', '120');
  await choose('theme', 'dark');
  await fill('brandName', 'Test brand');
  await page.screenshot({
    path: path.join(root, 'appearance-before-logo.png'),
    fullPage: true
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('appearanceLogo')]);
  await chooser.setFiles(fileURLToPath(new URL('../icon.png', import.meta.url)));
  await page.waitForFunction(() => document.querySelector('[name="logoId"]')?.value !== '');
  await click('appearanceSave');
  await closed();
  const saved = app.store.read().state.settings.appearance;
  assert.equal(saved.scale, 120);
  assert.equal(saved.theme, 'dark');
  assert(saved.logoId);
  assert.equal(await page.locator('.aside-bottom').count(), 0);
  assert(await page.locator('.brand-logo').evaluate(el => el.complete && el.naturalWidth > 0));
  await page.reload();
  await page.getByRole('heading', {
    name: "Overview",
    exact: true
  }).waitFor();
  assert.equal(await page.evaluate(() => document.body.style.zoom), '1.2');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await click('nav:settings');
  await page.screenshot({
    path: path.join(root, 'settings-dark.png'),
    fullPage: true
  });
  await click('appearance');
  await choose('theme', 'system');
  await page.emulateMedia({
    colorScheme: 'light'
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({
    colorScheme: 'dark'
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await click('closeModal');
  await page.locator('[data-message="cancel"]').click();
  await page.locator('#appearanceForm').waitFor();
  await click('closeModal');
  await acceptMessage();
  await closed();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  // The most demanding supported text/scale combination must remain usable on a phone.
  await page.setViewportSize({
    width: 412,
    height: 915
  });
  await click('appearance');
  await fill('fontSize', 22);
  await fill('smallTextSize', 18);
  await choose('scale', '150');
  await choose('theme', 'light');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile appearance must not overflow horizontally');
  assert(await page.locator('.dialog').evaluate(el => el.getBoundingClientRect().right <= innerWidth + 1), 'Settings fit scaled phone viewport');
  await page.locator('[name="fontSize"]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(root, 'appearance-mobile-large.png')
  });
  await page.locator('[name="brandName"]').scrollIntoViewIfNeeded();
  assert(await page.locator('[name="brandName"]').isVisible());
  await click('closeModal');
  await acceptMessage();
  await closed();
  assert.equal(await page.evaluate(() => document.body.style.zoom), '1.2');
  await page.setViewportSize({
    width: 1500,
    height: 1050
  });
  await click('appearance');
  await choose('theme', 'light');
  await fill('color_accent', '#1f5da8');
  await fill('color_background', '#eef3fb');
  assert.equal(await page.locator('[name="theme"]').inputValue(), 'custom');
  await click('appearanceSave');
  await closed();
  assert.equal(app.store.read().state.settings.appearance.colors.background, '#eef3fb');
  assert.equal(app.store.read().state.documents[0].pdfHash, invoice.pdfHash, 'Appearance does not alter an issued PDF');
  // Pointer distances in the template editor account for the interface's 120% scale.
  await click('nav:templates');
  await click('editTemplate:builtin-clean');
  await page.locator('.paper').first().waitFor();
  const previousPaper = await page.locator('.paper').first().elementHandle();
  await click('edSelect:Title');
  await previousPaper.waitForElementState('hidden');
  const beforeX = Number(await page.locator('[name="x"]').inputValue()),
    hit = page.locator('.node-hit.chosen').first();
  await hit.scrollIntoViewIfNeeded();
  const box = await (await page.waitForFunction(() => {
    const r = document.querySelector('.node-hit.chosen')?.getBoundingClientRect();
    return r?.width && r.toJSON();
  })).jsonValue();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + 31.2, box.y + box.height / 2, {
    steps: 5
  });
  await page.mouse.up();
  await page.waitForFunction(x => Math.abs(Number(document.querySelector('[name="x"]').value) - x - 10) < .6, beforeX);
  await click('closeModal');
  await page.locator('#messageOverlay [data-message="ok"]').click();
  await page.waitForTimeout(250);
  if (await page.locator('#messageOverlay').count()) throw Error('Second dialog after editor close: ' + (await page.locator('#messageOverlay').textContent()));
  await closed();
  await click('nav:settings');
  // Restore parsing errors use the application dialog and do not modify the database.
  const bad = page.waitForEvent('filechooser');
  await click('restore');
  await (await bad).setFiles({
    name: "broken.fakturocel",
    mimeType: 'application/json',
    buffer: Buffer.from('{bad json')
  });
  await page.locator('#messageOverlay').getByText("The file is invalid or corrupted.", {
    exact: false
  }).waitFor();
  await page.screenshot({
    path: path.join(root, 'custom-error.png')
  });
  await acceptMessage();
  assert.equal(app.store.read().state.documents[0].pdfHash, invoice.pdfHash);
  // An interrupted write must leave the editable form intact, with no native browser message.
  await click('nav:companies');
  const company = app.store.read().state.companies[0];
  await click('editRecord:companies:' + company.id);
  await fill('name', 'Unsent company');
  await page.route('**/api/commit', r => r.abort(), {
    times: 1
  });
  await click('formSave');
  await page.locator('#messageOverlay').getByText("The server is not available.", {
    exact: false
  }).waitFor();
  await acceptMessage();
  assert.equal(await page.locator('[name="name"]').inputValue(), 'Unsent company');
  assert.equal(app.store.read().state.companies[0].name, company.name);
  await fill('name', company.name);
  await click('formSave');
  await closed();
  progress('Colored statuses, appearance persistence, custom logo, mobile scaling, own error/confirmation dialogs');
}
