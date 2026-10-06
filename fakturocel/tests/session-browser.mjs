import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createContext, encryptText } from '../server/encryption.mjs';

export async function exerciseSessions({ page, click, fill, choose, closed, acceptMessage, app, root, progress, czech }) {
  const pin = '628194', phrase = 'Synthetic recovery phrase 628194';
  const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'));
  const access = page.locator('#accessOverlay'), recovery = page.locator('#messageOverlay [data-secret-input]');
  const raw = async (route, data) => {
    const address = 'http://127.0.0.1:' + app.server.address().port + '/api/';
    const headers = { 'x-remote-user-id': 'browser-owner', 'Content-Type': 'application/json' };
    const security = await (await fetch(address + 'security', { headers })).json();
    const response = await fetch(address + route, { method: 'POST', headers: { ...headers, 'X-Fakturocel-Token': security.csrf }, body: JSON.stringify(data) });
    assert.equal(response.status, 200, await response.text());
  };
  const unlock = async () => {
    await access.locator('[data-secret-input]').fill(pin);
    await access.locator('[data-message="ok"]').click();
    await access.waitFor({ state: 'detached' });
  };
  const newText = async text => {
    await click('nav:texts');
    await click('editRecord:texts:new');
    await fill('name', text);
  };
  const commits = [];
  const capture = response => {
    if (response.url().endsWith('/api/commit')) commits.push({ status: response.status(), body: response.request().postData() });
  };
  page.on('response', capture);
  for (const language of ['en', 'cs']) {
    await choose('appLanguage', language);
    await page.waitForFunction(value => document.documentElement.lang === value, language);
    await idle();
    const localized = text => language === 'cs' ? czech[text] : text;
    const text = `Session renewal sample ${language}`;
    await newText(text);
    const record = page.locator('#recordForm');
    const node = await record.elementHandle();
    // A security change in another client rotates the global token while this form stays open.
    await raw('security/pin', { enabled: false });
    const before = commits.length;
    await click('formSave');
    await closed();
    await idle();
    assert.deepEqual(commits.slice(before).map(r => r.status), [403, 200]);
    assert.equal(commits[before].body, commits[before + 1].body);
    assert.equal(app.store.read().state.texts.filter(r => r.name === text).length, 1);
    assert.equal(await page.locator('#messageOverlay').count(), 0);
    await node.dispose();

    await newText(`Retained input ${language}`);
    // All other errors must keep the form intact without replaying a write.
    for (const [status, code, count] of [[409, undefined, 1], [403, undefined, 1], [423, undefined, 1], [403, 'STALE_CSRF', 2]]) {
      const start = commits.length;
      const reject = route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic write rejection.', code }) });
      await page.route('**/api/commit', reject);
      await click('formSave');
      await page.locator('#messageOverlay').getByText('Synthetic write rejection.').waitFor();
      await acceptMessage();
      await idle();
      assert.equal(commits.length - start, count);
      assert.equal(await page.locator('#recordForm [name="name"]').inputValue(), `Retained input ${language}`);
      await page.unroute('**/api/commit', reject);
    }
    let attempts = 0;
    const offline = route => { attempts++; return route.abort('connectionfailed'); };
    await page.route('**/api/commit', offline);
    await click('formSave');
    await page.locator('#messageOverlay').waitFor();
    await acceptMessage();
    await idle();
    assert.equal(attempts, 1);
    assert.equal(await page.locator('#recordForm [name="name"]').inputValue(), `Retained input ${language}`);
    await page.unroute('**/api/commit', offline);

    // Actually expire access while saving; no full-page reload or draft reconstruction is allowed.
    await raw('security/pin', { enabled: true, pin });
    app.access.sessions.clear();
    const form = await record.elementHandle();
    await click('formSave');
    await access.getByText(localized('Unlock to continue. Your open form and entered values will be kept.')).waitFor();
    await access.locator('[data-secret-input]').fill('000000');
    await access.locator('[data-message="ok"]').click();
    await access.locator('[data-secret-problem]').getByText(localized('PIN is not correct.')).waitFor();
    assert.equal(await access.locator('[data-secret-input]').inputValue(), '000000');
    await access.locator('[data-message="cancel"]').click();
    await page.locator('#messageOverlay').getByText(localized('Unlocking was cancelled. Your edits remain in the open form. Save again when you are ready.')).waitFor();
    await acceptMessage();
    await idle();
    assert(await form.evaluate(el => el.isConnected));
    assert.equal(await record.locator('[name="name"]').inputValue(), `Retained input ${language}`);
    await click('formSave');
    await unlock();
    await closed();
    await idle();
    assert.equal(app.store.read().state.texts.filter(r => r.name === `Retained input ${language}`).length, 1);
    await form.dispose();

    await click('nav:invoice');
    await click('newDoc:invoice');
    await fill('notes', `Invoice draft retained ${language}`);
    await click('docItem');
    await page.locator('[data-item="name"]').last().fill('Retained sample item');
    const invoiceForm = await page.locator('#docForm').elementHandle();
    app.access.sessions.clear();
    await click('docSave');
    await access.waitFor();
    assert(await invoiceForm.evaluate(el => el.isConnected));
    assert.equal(await page.locator('#docForm [name="notes"]').inputValue(), `Invoice draft retained ${language}`);
    await unlock();
    await closed();
    await idle();
    assert.equal(app.store.read().state.documents.filter(d => d.notes === `Invoice draft retained ${language}`).length, 1);
    await invoiceForm.dispose();

    // A foreign encrypted backup requires its own key. Verification errors must not dismiss the input.
    const context = await createContext(phrase);
    const file = path.join(root, `foreign-${language}.fakturocel`);
    await fs.writeFile(file, encryptText(await app.store.backupText({ encrypt: false }), context, 'backup'));
    context.key.fill(0);
    const chooser = page.waitForEvent('filechooser');
    await click('restore');
    await (await chooser).setFiles(file);
    await recovery.waitFor();
    assert.equal(await page.locator('#messageOverlay input[type=password]').count(), 0);
    assert.equal(await recovery.getAttribute('autocomplete'), 'off');
    await recovery.fill('Wrong synthetic key');
    await recovery.press('Escape');
    await recovery.press('Enter');
    assert.equal(await recovery.inputValue(), 'Wrong synthetic key');
    await page.locator('#messageOverlay [data-secret-toggle]').click();
    assert.equal(await recovery.evaluate(el => el.classList.contains('concealed')), false);
    await page.locator('#messageOverlay [data-secret-toggle]').click();
    const input = await recovery.elementHandle();
    await page.locator('#messageOverlay [data-message="ok"]').click();
    await page.locator('[data-secret-problem]').getByText(localized('The password is incorrect or the encrypted file is corrupted.')).waitFor();
    assert(await input.evaluate(el => el.isConnected));
    assert.equal(await recovery.inputValue(), 'Wrong synthetic key');
    await page.screenshot({ path: path.join(root, `recovery-input-${language}.png`) });
    await recovery.fill(phrase);
    app.access.sessions.clear();
    await page.locator('#messageOverlay [data-message="ok"]').click();
    await access.waitFor();
    assert.equal(await recovery.inputValue(), phrase);
    await unlock();
    await recovery.waitFor({ state: 'detached' });
    await page.locator('#messageOverlay').getByRole('heading', { name: localized('Restore backup'), exact: true }).waitFor();
    await acceptMessage();
    await idle();
    assert.equal(app.store.read().state.texts.filter(r => r.name === text).length, 1);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
    await input.dispose();
    await click('pinSettings');
    await choose('pinEnabled', 'false');
    await fill('currentPin', pin);
    await click('pinSave');
    await closed();
    await idle();
    progress(`PASS ${language}: stale-token save, bounded safe retries, PIN renewal, retained inputs and encrypted-backup recovery`);
  }
  page.off('response', capture);
  await choose('appLanguage', 'en');
  await idle();
}
