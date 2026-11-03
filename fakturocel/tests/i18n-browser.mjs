import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const routes = new Map(await Promise.all(['i18n.js', 'ui.js', 'escape.js', 'calculator-labels.js', 'calculators-model.js', 'formula.js', 'locales/cs.json'].map(async name => [
  '/src/' + name, await fs.readFile(new URL('../src/' + name, import.meta.url))
])));
const czech=JSON.parse(routes.get('/src/locales/cs.json')).translations;
const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><body><main id="fixture"></main><div id="modal"></div><div id="toast"></div><script type="module">import * as i18n from "/src/i18n.js";import * as ui from "/src/ui.js";window.fixture={i18n,ui};</script></body></html>');
  } else if (routes.has(request.url)) {
    response.setHeader('content-type', request.url.endsWith('.json') ? 'application/json' : 'text/javascript; charset=utf-8');
    response.end(routes.get(request.url));
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.fixture);
  await page.evaluate(() => {
    fixture.i18n.setLanguage('cs');
    document.querySelector('#fixture').innerHTML = '<button id="owned">Cancel</button><section data-no-translate><p id="record">Save</p><span id="later"></span></section><textarea id="draft">Cancel</textarea><div contenteditable="true"><b id="rich">Save</b></div><pre id="raw">Save</pre>';
  });
  await settle();
  assert.equal(await page.locator('#owned').innerText(), czech.Cancel);
  assert.equal(await page.locator('#record').innerText(), 'Save');
  await page.evaluate(() => {
    document.querySelector('#later').append(document.createTextNode('Cancel'));
    document.querySelector('#draft').textContent = 'Save';
    document.querySelector('#rich').textContent = 'Cancel';
  });
  await settle();
  assert.equal(await page.locator('#later').innerText(), 'Cancel', 'new text nodes must respect a protected ancestor');
  assert.equal(await page.locator('#draft').inputValue(), 'Save');
  assert.equal(await page.locator('#rich').innerText(), 'Cancel');
  assert.equal(await page.locator('#raw').innerText(), 'Save');
  await page.evaluate(() => {
    const {ui}=fixture;
    document.querySelector('#fixture').innerHTML = ui.select('Template','template', [['ui','Cancel'],['record','Cancel',true]],'record')
      +ui.select('Save','customChoice',['Cancel','Save'],'Save',{literalLabel:true,literalOptions:true})
      +ui.field('Cancel','customField','Save','text','',true)
      +ui.area('Save','customNote','Cancel','',true)
      +'<div id="escaped">'+ui.userText('<img src=x onerror=alert(1)>')+'</div>';
  });
  await settle();
  assert.equal(await page.locator('[name="template"] option[value="ui"]').innerText(),czech.Cancel);
  assert.equal(await page.locator('[name="template"] option[value="record"]').innerText(),'Cancel');
  assert.equal(await page.locator('[name="template"]').inputValue(),'record');
  assert.equal(await page.locator('[name="customChoice"]').inputValue(),'Save');
  assert.deepEqual(await page.locator('[name="customChoice"] option').allTextContents(),['Cancel','Save']);
  assert.equal(await page.locator('[name="customField"]').inputValue(),'Save');
  assert.equal(await page.locator('[name="customNote"]').inputValue(),'Cancel');
  assert.equal(await page.locator('#escaped').innerText(),'<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#escaped img').count(),0);
  const labels = await page.evaluate(async () => {
    const {calculatorLabel}=await import('/src/calculator-labels.js');
    const {defaultCalculators}=await import('/src/calculators-model.js');
    const standard=defaultCalculators()[0], formula=defaultCalculators().find(c=>c.kind==='formula');
    const original=JSON.stringify([standard,formula]);
    const translated=[calculatorLabel(standard,'name'),calculatorLabel(formula,'label','fields',0)];
    const unchanged=original===JSON.stringify([standard,formula]);
    standard.name='Cancel';formula.fields[0].label='Save';formula.results[0].label='Cancel';
    const literal=[calculatorLabel(standard,'name'),calculatorLabel(formula,'label','fields',0),calculatorLabel(formula,'label','results',0)];
    return {translated,unchanged,literal};
  });
  assert.deepEqual(labels.translated,[czech['Standard calculator'],czech['Total material']]);
  assert.deepEqual(labels.literal,['Cancel','Save','Cancel']);
  assert.equal(labels.unchanged,true);
  await page.evaluate(() => {
    window.picked = null;
    fixture.ui.picker('Select company', [{ id: 'test-record', label: 'Save', detail: 'Cancel' }, {id:'all',label:'Cancel',detail:'',literal:false}], row => { window.picked = row; });
  });
  await settle();
  assert.equal(await page.locator('.picker-row strong').first().innerText(), 'Save');
  assert.equal(await page.locator('.picker-row small').first().innerText(), 'Cancel');
  assert.equal(await page.locator('.picker-row strong').nth(1).innerText(), czech.Cancel);
  await page.locator('#pickerSearch').fill('Save');
  await settle();
  await page.locator('[data-pick="0"]').click();
  await page.waitForFunction(() => window.picked);
  assert.deepEqual(await page.evaluate(() => window.picked), { id: 'test-record', label: 'Save', detail: 'Cancel' });
  assert.deepEqual(errors, []);
  console.log('Language data boundaries, late text nodes, editing drafts and picker values passed.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
