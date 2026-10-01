import assert from 'node:assert/strict';
import path from 'node:path';
export async function exerciseCalculatorDraft({
  page,
  root,
  progress
}) {
  const calc = action => page.locator(`[data-calc="${action}"]`).first().click(),
    type = value => page.locator('#calcExpression').fill(value),
    choose = id => page.locator('#calcSelect').selectOption(id),
    value = () => page.locator('#calcResults input').first().inputValue();
  await page.locator('#docForm [name="notes"]').fill('Calculator draft marker');
  await page.locator('#calculator-launcher').click();
  await page.locator('#calculator-panel').waitFor();
  assert.equal(await page.locator('#modal .dialog').getAttribute('aria-modal'), 'false');
  await type('2+3');
  await calc('evaluate');
  assert.equal(await value(), '5');
  await page.locator('[data-calc="key"][data-value="*"]').click();
  await page.locator('[data-calc="key"][data-value="2"]').click();
  await calc('evaluate');
  assert.equal(await value(), '10');
  await calc('mplus');
  assert((await page.locator('#calcMemoryLabel').textContent()).includes('10'));
  await calc('hide');
  assert.equal(await page.locator('#docForm [name="notes"]').inputValue(), 'Calculator draft marker');
  assert.equal(await page.locator('#modal .dialog').getAttribute('aria-modal'), 'true');
  await page.keyboard.press('Alt+c');
  assert.equal(await value(), '10');
  await choose('calc-scientific');
  await type('SIN(30)');
  await calc('evaluate');
  assert.equal(await value(), '0.5');
  await page.locator('#calcAngle').selectOption('rad');
  await type('SIN(PI()/2)');
  await calc('evaluate');
  assert.equal(await value(), '1');
  await choose('calc-print3d');
  for (const [ref, n] of Object.entries({
    A1: 100,
    A2: 500,
    A3: 2,
    A4: 200,
    A5: 6,
    A6: 10,
    A7: 30,
    A8: 300,
    A9: 20,
    A10: 10,
    A11: 20,
    A12: 2
  })) await page.locator(`#calculator-panel [data-ref="${ref}"]`).fill(String(n));
  assert.equal(await page.locator('#calcResults input').first().inputValue(), '296.88');
  await page.screenshot({
    path: path.join(root, 'calculator-invoice.png')
  });
  await calc('hide');
  await page.locator('#calculator-launcher').click();
  assert.equal(await page.locator('#calculator-panel [data-ref="A12"]').inputValue(), '2');
  await choose('calc-basic');
  assert.equal(await value(), '10');
  await type('1/0');
  await calc('evaluate');
  await page.locator('#calcResults').getByText("Cannot be divided by zero.").waitFor();
  assert.equal(await page.locator('#calcResults input').count(), 0);
  await type('M+5');
  await page.locator('#calcExpression').press('Enter');
  assert.equal(await value(), '15');
  await page.setViewportSize({
    width: 412,
    height: 915
  });
  await page.screenshot({
    path: path.join(root, 'calculator-mobile.png')
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const box = await page.locator('#calculator-panel').boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 412 && box.y >= 0);
  await page.locator('#calcExpression').press('Escape');
  assert.equal(await page.locator('#calculator-panel').count(), 0);
  assert.equal(await page.locator('#docForm').count(), 1);
  assert.equal(await page.locator('#docForm [name="notes"]').inputValue(), 'Calculator draft marker');
  await page.setViewportSize({
    width: 1500,
    height: 1050
  });
  progress('Calculator above invoice, memory, chained operations, scientific modes, 3D costs, error handling and mobile');
}
export async function exerciseCalculatorSettings({
  page,
  click,
  fill,
  closed,
  acceptMessage,
  app,
  root,
  progress
}) {
  await click('nav:settings');
  await click('calculatorSettings');
  await click('calcNew');
  await fill('calc_name', 'Test custom calculation');
  await fill('calc_description', 'Work plus additional costs');
  await fill('field_0_label', 'Hours');
  await fill('field_0_default', '2');
  await fill('field_1_label', 'Rate');
  await fill('field_1_default', '150');
  await click('calcAddField');
  await fill('field_2_label', 'Extras');
  await fill('field_2_default', '50');
  await fill('result_0_label', 'Total');
  await fill('result_0_unit', "CZK");
  await fill('result_0_formula', '=fetch(1)');
  await click('calcSettingsSave');
  await page.locator('#messageOverlay #messageText').getByText("The operation could not be completed.", {
    exact: false
  }).waitFor();
  assert.match(await page.locator('#messageOverlay details pre').textContent(), /Unsupported feature:/);
  await acceptMessage();
  assert(!app.store.read().state.settings.calculators.some(c => c.name === 'Test custom calculation'));
  await fill('result_0_formula', '=ROUND(A1*A2+A3;2)');
  await page.locator('#calculatorPreview').getByText("350.00 CZK", {
    exact: false
  }).waitFor();
  const selected = page.locator('#calculatorList .selected'),
    id = (await selected.getAttribute('data-action')).split(':')[1];
  for (let i = 0; i < 6; i++) await click('calcMoveUp:' + id);
  await page.screenshot({
    path: path.join(root, 'calculator-settings.png'),
    fullPage: true
  });
  await click('calcSettingsSave');
  await closed();
  assert.equal(app.store.read().state.settings.calculators[0].id, id);
  await page.locator('#calculator-launcher').click();
  assert.equal(await page.locator('#calcSelect option').first().getAttribute('value'), id);
  await page.locator('#calcSelect').selectOption(id);
  assert.equal(await page.locator('#calcResults input').first().inputValue(), '350.00');
  await page.locator('#calculator-panel [data-ref="A1"]').fill('3');
  assert.equal(await page.locator('#calcResults input').first().inputValue(), '500.00');
  await page.locator('[data-calc="hide"]').click();
  await click('nav:companies');
  await page.locator('#calculator-launcher').click();
  assert.equal(await page.locator('#calcResults input').first().inputValue(), '500.00');
  await page.locator('[data-calc="hide"]').click();
  await page.reload();
  await click('nav:settings');
  await page.locator('#calculator-launcher').click();
  assert.equal(await page.locator('#calcSelect').inputValue(), id);
  assert.equal(await page.locator('#calcResults input').first().inputValue(), '350.00');
  await page.locator('[data-calc="hide"]').click();
  await click('calculatorSettings');
  await fill('calc_name', 'Discard this edit');
  await click('closeModal');
  await acceptMessage();
  await closed();
  assert.equal(app.store.read().state.settings.calculators[0].name, 'Test custom calculation');
  progress('Custom calculator fields, invalid formula protection, preview, saved order, navigation memory, reload and discard');
}
