import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { defaultAppearance, validateAppearance, palettes } from '../src/appearance-model.js';
import { emptyState, newDocument, packBackup, unpackBackup } from '../src/model.js';
import { statusView, statusPanel } from '../src/status.js';
test('appearance validates sizes, readable colors and existing logo references', () => {
  const a = defaultAppearance();
  validateAppearance(a);
  validateAppearance(undefined);
  for (const theme of ['light', 'dark', 'system', 'custom']) validateAppearance({
    ...a,
    theme
  });
  validateAppearance({
    ...a,
    theme: 'custom',
    colors: palettes.dark
  });
  for (const v of [{
    scale: 151
  }, {
    fontSize: 11
  }, {
    smallTextSize: 20
  }, {
    theme: 'unknown'
  }, {
    logoId: 'missing'
  }, {
    brandName: ''
  }, {
    colors: {
      ...a.colors,
      text: a.colors.surface
    },
    theme: 'custom'
  }]) assert.throws(() => validateAppearance({
    ...a,
    ...v
  }));
  validateAppearance({
    ...a,
    logoId: 'logo'
  }, [{
    id: 'logo',
    mime: 'image/png'
  }]);
  assert.throws(() => validateAppearance({
    ...a,
    logoId: 'logo'
  }, [{
    id: 'logo',
    mime: 'application/pdf'
  }]));
});
test('complete backup preserves appearance; older v3 backups still load', async () => {
  const s = emptyState();
  s.settings.appearance = {
    ...defaultAppearance(),
    theme: 'dark',
    scale: 120,
    fontSize: 18,
    smallTextSize: 15,
    brandName: 'Test brand'
  };
  assert.deepEqual((await unpackBackup(await packBackup(s, {}))).data.settings.appearance, s.settings.appearance);
  delete s.settings.appearance;
  assert.equal((await unpackBackup(await packBackup(s, {}))).data.settings.appearance, undefined);
});
test('document status distinguishes all payment and document states', () => {
  const s = emptyState(),
    d = newDocument(s);
  d.items = [{
    name: 'Test',
    qty: 1,
    price: 1000
  }];
  d.due = '2099-01-01';
  assert.equal(statusView(d, s).className, 'draft');
  d.status = 'issued';
  assert.equal(statusView(d, s).className, 'issued');
  d.due = '2000-01-01';
  assert.equal(statusView(d, s).className, 'overdue');
  s.payments.push({
    documentId: d.id,
    amount: 400
  });
  assert.equal(statusView(d, s).className, 'partial');
  assert.equal(statusView(d, s).overdue, true);
  assert(statusPanel(d, s).includes('aria-valuenow="40"'));
  s.payments.push({
    documentId: d.id,
    amount: 600
  });
  assert.equal(statusView(d, s).className, 'paid');
  s.payments.push({
    documentId: d.id,
    amount: 100
  });
  assert.match(statusView(d, s).detail, /Overpayment/);
  s.payments[2].voided = true;
  assert.match(statusView(d, s).detail, /fully/);
  d.status = 'cancelled';
  assert.equal(statusView(d, s).className, 'cancelled');
  d.status = 'issued';
  d.type = 'quote';
  assert.equal(statusView(d, s).label, "Issued quote");
  assert(!statusPanel(d, s).includes('payment-summary'));
});
test('application code does not invoke native web message or validation dialogs', async () => {
  for (const dir of ['src', 'public']) for (const file of await fs.readdir(new URL('../' + dir + '/', import.meta.url))) {
    if (!/\.js$/.test(file)) continue;
    const text = await fs.readFile(new URL('../' + dir + '/' + file, import.meta.url), 'utf8');
    assert(!/\b(?:alert|confirm|prompt|reportValidity)\s*\(/.test(text), file + ' invokes a native browser dialog');
    assert(!text.includes('beforeunload'), file + ' invokes a native unload dialog');
  }
});
