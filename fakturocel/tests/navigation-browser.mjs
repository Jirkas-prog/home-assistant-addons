import assert from 'node:assert/strict';
import path from 'node:path';

export async function exerciseNavigation({ page, click, choose, fill, closed, acceptMessage, app, root, progress, czech }) {
  await click('nav:settings');
  assert.equal(await page.locator('#mainNavigation [data-section]').count(), 6);
  assert.equal(await page.locator('#mainNavigation [data-section="settings"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('[data-action="wipe"]').count(), 0, 'Destructive actions are isolated under Restore and reset');
  assert.equal(await page.locator('[data-action="pinSettings"]').count(), 0, 'General settings do not mix in unrelated controls');
  const before = app.store.read();
  await click('editSettings:defaults');
  assert.equal(await page.locator('[name="supplier_name"]').count(), 0);
  await fill('dueDays', 45);
  await click('formSave');
  await closed();
  assert.equal(app.store.read().state.settings.dueDays, 45);
  assert.deepEqual(app.store.read().state.supplier, before.state.supplier, 'Changing invoice defaults preserves supplier fields');
  await click('editSettings');
  assert.equal(await page.locator('[name="dueDays"]').count(), 0);
  await click('formSave');
  await closed();
  assert.equal(app.store.read().state.settings.dueDays, 45, 'Saving business details preserves invoice defaults');

  for (const language of ['en', 'cs']) {
    await choose('appLanguage', language);
    await page.waitForFunction(value => document.documentElement.lang === value, language);
    await page.waitForFunction(() => !document.body.classList.contains('busy'));
    assert.equal(await page.locator('#calculator-launcher span').textContent(), language === 'cs' ? czech.Calculator : 'Calculator');
    await page.locator('#settingsSearch').fill(language === 'cs' ? czech['Backup encryption'].normalize('NFD').replace(/[\u0300-\u036f]/g, '') : 'encryption');
    const title = language === 'cs' ? czech['Backup encryption'] : 'Backup encryption';
    await page.locator('#settingsSearchResults').getByRole('button').filter({ has: page.getByText(title, { exact: true }) }).click();
    await page.locator('#backupEncryptionPanel[aria-busy="false"] [role="switch"]').first().waitFor();
    assert.equal(await page.locator('#backupEncryptionPanel [role="switch"]').count(), 3);
    if (language === 'cs') {
      assert((await page.locator('.workspace-status').textContent()).includes(czech['Backup saved']));
      assert.equal(await page.locator('[data-action="downloadBackup"]').textContent(), czech['Download backup to this device']);
    }
    assert.equal(await page.locator('.section-tabs [data-action="settingsTab:backups"]').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#backupEncryptionPanel [data-encryption="local"]').getAttribute('aria-checked'), 'true');
    await page.locator('[data-encryption="local"]').click();
    await page.locator('#messageOverlay [data-message="cancel"]').click();
    assert.equal(app.store.backupEncryption().local, true);
    await page.locator('[data-encryption="local"]').click();
    await acceptMessage();
    await page.locator('[data-encryption="local"][aria-checked="false"]').waitFor();
    assert.equal(app.store.backupEncryption().local, false);
    await click('settingsTab:general');
    await click('settingsTab:backups');
    await page.locator('[data-encryption="local"][aria-checked="false"]').waitFor();
    await page.locator('[data-encryption="local"]').click();
    await page.locator('[data-encryption="local"][aria-checked="true"]').waitFor();
    assert.equal(app.store.backupEncryption().local, true);
  }

  await choose('appLanguage', 'en');
  await page.waitForFunction(() => document.documentElement.lang === 'en' && !document.body.classList.contains('busy'));
  const general = page.locator('.section-tabs [data-action="settingsTab:general"]');
  await general.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'settingsTab:appearance');
  await page.keyboard.press('Enter');
  await page.locator('.section-tabs [data-action="settingsTab:appearance"][aria-current="page"]').waitFor();
  await click('section:documents');
  assert.equal(await page.locator('.section-tabs button').count(), 4);
  await click('nav:quote');
  await click('nav:companies');
  await click('section:documents');
  assert.equal(await page.locator('.section-tabs [aria-current="page"]').getAttribute('data-action'), 'nav:quote', 'Returning to a section remembers its last subsection');

  await click('nav:settings');
  await choose('appLanguage', 'cs');
  await page.waitForFunction(() => document.documentElement.lang === 'cs' && !document.body.classList.contains('busy'));
  await click('appearance');
  const original = structuredClone(app.store.read().state.settings.appearance);
  await choose('theme', 'dark');
  await choose('scale', '100');
  await fill('fontSize', 16);
  await fill('smallTextSize', 13);
  await fill('brandName', 'Fakturocel');
  await fill('tagline', '');
  await choose('logoId', '');
  await click('appearanceSave');
  await closed();
  await click('settingsTab:backups');
  await page.locator('#backupEncryptionPanel[aria-busy="false"]').waitFor();
  await page.locator('#toast.show').waitFor({ state: 'hidden', timeout: 12000 });
  await page.screenshot({ path: path.join(root, 'workspace-backups-dark-cs.png'), fullPage: true });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.locator('#navigationToggle').waitFor();
  await page.locator('#navigationToggle').click();
  assert.equal(await page.locator('#navigationToggle').getAttribute('aria-expanded'), 'true');
  await page.locator('#mainNavigation [data-section="documents"]').click();
  assert.equal(await page.locator('#navigationToggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#mainNavigation').isVisible(), false);
  await click('nav:settings');
  await click('settingsTab:backups');
  await page.locator('#backupEncryptionPanel[aria-busy="false"]').waitFor();
  assert(await page.locator('#backupEncryptionPanel').evaluate(el => el.getBoundingClientRect().top < document.querySelector('.backup-settings-grid>div').getBoundingClientRect().top), 'Encryption switches come first on a narrow screen');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The mobile workspace has no horizontal page overflow');
  await page.screenshot({ path: path.join(root, 'workspace-backups-mobile-cs.png'), fullPage: true });
  await page.setViewportSize({ width: 1500, height: 1050 });
  // Return the synthetic fixture to its earlier appearance after visual checks.
  const current = app.store.read();
  await app.store.commit({ ops: [{ collection: 'config', rev: current.configRevision, value: { supplier: current.state.supplier, settings: { ...current.state.settings, appearance: original, language: 'en' } } }] }, { id: 'browser-owner', name: 'Test Owner', role: 'owner' });
  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await click('nav:settings');
  await click('settingsTab:backups');
  await page.locator('[data-encryption="local"][aria-checked="true"]').waitFor();
  progress('PASS grouped navigation, separate settings, English/Czech search, direct persistent encryption controls, keyboard tabs, mobile menu, and unchanged invoice data');
  assert.deepEqual(app.store.read().state.documents, before.state.documents);
}
