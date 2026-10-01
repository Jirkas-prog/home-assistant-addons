import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { unlockEnvelope, isEncrypted } from '../server/encryption.mjs';
import { unpackBackup } from '../src/model.js';
import officeCrypto from 'officecrypto-tool';
export async function exerciseSecurity({
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
  const enterPassword = async value => {
    await page.locator('#messageOverlay input[type=password]').fill(value);
    await page.locator('#messageOverlay [data-message="ok"]').click();
    await page.locator('#messageOverlay input[type=password]').waitFor({
      state: 'detached'
    });
  };
  await click('nav:settings');
  assert.equal(app.store.status().pinEnabled, false);
  await click('securitySettings');
  await choose('enabled', 'true');
  await click('securitySave');
  await closed();
  assert(app.store.status().encrypted);
  const key = app.store.recoveryKey();
  assert(!app.store.status().pinEnabled);
  const recoveryDownload = page.waitForEvent('download');
  await click('recoveryPdf');
  const recoveryFile = path.join(root, 'recovery.pdf');
  await (await recoveryDownload).saveAs(recoveryFile);
  const recoveryBytes = await fs.readFile(recoveryFile);
  const text = await page.evaluate(async bytes => {
    const pdfjs = await import(new URL('pdfjs/pdf.mjs', location.href));
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.mjs', location.href).href;
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false
    }).promise;
    const page = await doc.getPage(1),
      text = (await page.getTextContent()).items.map(x => x.str).join('\n');
    await doc.destroy();
    return text;
  }, [...recoveryBytes]);
  assert(text.includes(key), 'PDF includes exact key');
  assert(text.includes(app.store.keyId()));
  const backupDownload = page.waitForEvent('download');
  await click('downloadBackup');
  const backupFile = path.join(root, "encrypted.fakturocel");
  await (await backupDownload).saveAs(backupFile);
  assert(isEncrypted(await fs.readFile(backupFile, 'utf8')));
  const excelDownload = page.waitForEvent('download');
  await click('excel');
  const excelFile = path.join(root, 'encrypted.xlsx');
  await (await excelDownload).saveAs(excelFile);
  const excel = await fs.readFile(excelFile);
  assert(officeCrypto.isEncrypted(excel));
  assert((await officeCrypto.decrypt(excel, {
    password: key
  })).length > 0);
  await page.reload();
  await click('nav:settings');
  await page.getByRole('heading', {
    name: "Data security",
    exact: true
  }).waitFor();
  assert.equal(await page.locator('[name="unlockPassword"]').count(), 0);
  assert.equal(await page.locator('[name="loginPin"]').count(), 0);
  await click('pinSettings');
  await choose('pinEnabled', 'true');
  await fill('pin', '739184');
  await fill('repeatPin', '739185');
  await click('pinSave');
  await page.locator('#messageOverlay').getByText("The entered PINs do not match.").waitFor();
  await acceptMessage();
  await fill('repeatPin', '739184');
  await click('pinSave');
  await closed();
  assert(app.store.status().pinEnabled);
  await page.screenshot({
    path: path.join(root, 'security-remembered.png'),
    fullPage: true
  });
  await click('securityLock');
  await acceptMessage();
  await page.getByRole('heading', {
    name: "The application is locked"
  }).waitFor();
  assert.equal(await page.locator('#calculator-launcher').count(), 0);
  await fill('loginPin', '000000');
  await click('pinUnlock');
  await page.locator('#messageOverlay').getByText("PIN is not correct.").waitFor();
  await acceptMessage();
  await page.screenshot({
    path: path.join(root, 'security-pin.png')
  });
  await fill('loginPin', '739184');
  await click('pinUnlock');
  await page.getByRole('heading', {
    name: "Data security",
    exact: true
  }).waitFor();
  assert.equal(app.store.recoveryKey(), key);
  await click('pinSettings');
  await choose('pinEnabled', 'false');
  await fill('currentPin', '739184');
  await click('pinSave');
  await closed();
  assert(!app.store.status().pinEnabled);
  // Same-installation restore needs no encryption prompt.
  const restoreChooser = page.waitForEvent('filechooser');
  await click('restore');
  await (await restoreChooser).setFiles(backupFile);
  await acceptMessage();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === "Backup has been restored.");
  assert.equal(app.store.read().state.documents[0].pdfHash, invoice.pdfHash);
  await click('securitySettings');
  await page.locator('[name="rotateKey"]').check();
  await page.locator('#optionalPasswordFields summary').click();
  await fill('password', 'Synthetic recovery phrase 739184');
  await fill('repeatPassword', 'Synthetic recovery phrase 739184');
  const rotationOld = page.waitForEvent('download');
  await click('securitySave');
  await acceptMessage();
  const oldPdf = await rotationOld;
  const rotationNew = page.waitForEvent('download');
  await oldPdf.saveAs(path.join(root, 'key-before-rotation.pdf'));
  await (await rotationNew).saveAs(path.join(root, 'key-after-rotation.pdf'));
  await closed();
  assert.notEqual(app.store.recoveryKey(), key);
  await click('securitySettings');
  await choose('enabled', 'false');
  await page.locator('[name="disableConfirmed"]').check();
  await click('securitySave');
  await page.locator('#messageOverlay').getByText("can be accessed by other users", {
    exact: false
  }).waitFor();
  await page.locator('[data-message="cancel"]').click();
  assert(app.store.status().encrypted);
  const beforeDisable = page.waitForEvent('download');
  await click('securitySave');
  await acceptMessage();
  await (await beforeDisable).saveAs(path.join(root, 'key-before-disable.pdf'));
  await closed();
  assert(!app.store.status().encrypted);
  await page.locator('.security-warning').getByText("Unencrypted storage").waitFor();
  await click('securitySettings');
  await choose('enabled', 'true');
  await click('securitySave');
  await closed();
  const nextKey = app.store.recoveryKey();
  assert.notEqual(nextKey, key);
  await click('wipe');
  const wipeDownload = page.waitForEvent('download');
  await click('wipeDownload');
  const wipeFile = path.join(root, "encrypted-wipe.fakturocel");
  await (await wipeDownload).saveAs(wipeFile);
  assert(await page.locator('#wipeFile').isDisabled());
  const wipeRecovery = page.waitForEvent('download');
  await click('wipeRecovery');
  await (await wipeRecovery).saveAs(path.join(root, 'key-before-wipe.pdf'));
  await page.locator('#wipeFile').setInputFiles(wipeFile);
  await page.getByText("Backup verified. Contains current data.").waitFor();
  await fill('wipeConfirm', "DELETE DATA");
  await click('wipeFinish');
  await page.getByRole('heading', {
    name: "Security of Fakturocel",
    exact: true
  }).waitFor();
  assert(!app.store.status().configured);
  await click('securitySave');
  await page.getByText("Welcome to Fakturocel").waitFor();
  assert(!app.store.status().pinEnabled);
  assert.notEqual(app.store.recoveryKey(), nextKey);
  const chooser = page.waitForEvent('filechooser');
  await click('restore');
  await (await chooser).setFiles(wipeFile);
  await enterPassword(nextKey);
  await acceptMessage();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === "Backup has been restored.");
  assert.equal(app.store.read().state.documents[0].pdfHash, invoice.pdfHash);
  const final = await unlockEnvelope(await app.store.backupText(), app.store.recoveryKey(), 'backup');
  assert.equal((await unpackBackup(final.content)).data.documents.length, 1);
  final.context.key.fill(0);
  progress('PASS automatic key, recovery PDF with full key, independent PIN, encrypted Excel, restore, warning and mandatory PDF+backup before wipe');
}
