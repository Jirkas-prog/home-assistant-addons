const {test,expect}=require('@playwright/test');
const card=page=>page.locator('workflow-timers-card');
async function open(page){
  await page.goto('/preview/');await expect(card(page).locator('.row')).toHaveCount(6);
  await page.evaluate(()=>{
    const c=document.querySelector('workflow-timers-card');window.writes=[];
    for(const method of ['callApi','callService','callWS']){
      const original=c._hass[method];c._hass[method]=function(...args){
        if(method!=='callWS'||!['scheduler','scheduler/item','scheduler/workflow_info','config/entity_registry/list'].includes(args[0].type))window.writes.push({method,args});
        return original.apply(this,args);
      };
    }
  });
}
async function editor(page){await card(page).locator('#edit-mode').click();await card(page).locator('#new').click();}

test('changes labels, preserves exact user names and filters, and sends no commands',async({page})=>{
  await open(page);
  const before=await page.evaluate(()=>{
    const c=document.querySelector('workflow-timers-card');c.schedules[0].name='Časovače';c.schedules[0].tags.push('workflow-group:Nová skupina');c._hass.states['light.aquarium'].attributes.friendly_name='Zrušit';c.render();return JSON.stringify(c.schedules);
  });
  await card(page).locator('#search').fill('Časovače');
  await card(page).locator('#language').selectOption('cs');
  await expect(card(page).locator('#title')).toHaveText('Časovače');
  await expect(card(page).locator('.device-title')).toHaveText('Časovače');
  await expect(card(page).locator('.group-head h2')).toHaveText('Nová skupina');
  await expect(card(page).locator('.entity-state')).toContainText('Zrušit');
  await card(page).locator('#language').selectOption('en');
  await expect(card(page).locator('#title')).toHaveText('Timers');
  await expect(card(page).locator('#search')).toHaveValue('Časovače');
  await expect(card(page).locator('.device-title')).toHaveText('Časovače');
  await expect(card(page).locator('.day')).toHaveText('Every day');
  expect(await page.evaluate(()=>JSON.stringify(document.querySelector('workflow-timers-card').schedules))).toBe(before);
  expect(await page.evaluate(()=>window.writes)).toEqual([]);
  await card(page).locator('#language').selectOption('cs');await page.reload();
  await expect(card(page).locator('#language')).toHaveValue('cs');
  await expect(card(page).locator('#title')).toHaveText('Časovače');
});

test('a Home Assistant language change preserves the active editor until it closes',async({page})=>{
  await open(page);await editor(page);
  await card(page).locator('[name=name]').fill('Časovače <draft>');
  await card(page).locator('[name=group]').selectOption('new');
  await card(page).locator('[name=new-group]').fill('Zrušit');
  await card(page).locator('[data-target="light.aquarium"]').check();
  await card(page).locator('#parameters details').locator('summary').click();
  await card(page).locator('[data-param=on]').fill('{"note":"Zrušit"}');
  await page.evaluate(()=>{const c=document.querySelector('workflow-timers-card');c.hass={...c._hass,language:'cs'};});
  await expect(card(page).locator('dialog')).toBeVisible();
  await expect(card(page).locator('[name=name]')).toHaveValue('Časovače <draft>');
  await expect(card(page).locator('[name=new-group]')).toHaveValue('Zrušit');
  await expect(card(page).locator('[data-param=on]')).toHaveValue('{"note":"Zrušit"}');
  await expect(card(page).locator('[data-target="light.aquarium"]')).toBeChecked();
  await expect(card(page).locator('#dialog-title')).toHaveText('New timer');
  await card(page).locator('dialog .form-actions [data-action=close]').click();
  await expect(card(page).locator('#title')).toHaveText('Časovače');
  expect(await page.evaluate(()=>window.writes)).toEqual([]);
});

test('both editors translate weekdays and model validation, without saving invalid plans',async({page})=>{
  await open(page);await editor(page);
  await expect(card(page).locator('[data-day=mon]')).toHaveText('Mon');
  await card(page).locator('[name=name]').fill('A plan');await card(page).locator('[type=submit]').click();
  await expect(card(page).locator('.form-error')).toHaveText('Select at least one device.');
  await card(page).locator('dialog .form-actions [data-action=close]').click();
  await card(page).locator('#language').selectOption('cs');await card(page).locator('#new').click();
  await expect(card(page).locator('[data-day=mon]')).toHaveText('Po');
  await card(page).locator('[name=name]').fill('A plan');await card(page).locator('[type=submit]').click();
  await expect(card(page).locator('.form-error')).toHaveText('Vyberte alespoň jedno zařízení.');
  expect(await page.evaluate(()=>window.writes)).toEqual([]);
});

test('language switching preserves disconnected state and disabled actions',async({page})=>{
  await open(page);
  await page.evaluate(async()=>{const c=document.querySelector('workflow-timers-card');c._hass.callWS=async()=>{throw new Error('Offline test');};await c.refresh();});
  await expect(card(page).locator('#connection')).toHaveText('Disconnected');
  await card(page).locator('#language').selectOption('cs');
  await expect(card(page).locator('#connection')).toHaveText('Nepřipojeno');
  await expect(card(page).locator('#error')).toContainText('Časovače nelze načíst.');
  await expect(card(page).locator('#edit-mode')).toBeDisabled();
  await expect(card(page).locator('.skip').first()).toBeDisabled();
  expect(await page.evaluate(()=>window.writes)).toEqual([]);
});

test('works with blocked storage and a Czech Home Assistant profile',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.getItem=Storage.prototype.setItem=function(){throw new Error('Storage disabled');};});
  await open(page);
  await page.evaluate(()=>{const c=document.querySelector('workflow-timers-card');c.hass={...c._hass,language:'cs-CZ'};});
  await expect(card(page).locator('#title')).toHaveText('Časovače');
  await card(page).locator('#language').selectOption('en');
  await expect(card(page).locator('#title')).toHaveText('Timers');
  await expect(page.locator('#demo-notice')).toContainText('INTERACTIVE DEMO');
  expect(await page.evaluate(()=>window.writes)).toEqual([]);
});

test('the selector stays visible on a narrow screen and custom titles are unchanged',async({page})=>{
  await page.setViewportSize({width:360,height:800});await open(page);
  await page.evaluate(()=>document.querySelector('workflow-timers-card').setConfig({title:'Časovače – my own title'}));
  for(const lang of ['cs','en']){
    await card(page).locator('#language').selectOption(lang);
    await expect(card(page).locator('#title')).toHaveText('Časovače – my own title');
    const box=await card(page).locator('#language').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(360);
  }
});
