import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { newDocument, defaultTemplate } from '../src/model.js';
import { navigationClick } from './navigation-helpers.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const addon=process.env.FAKTUROCEL_ADDON_DIR || fileURLToPath(new URL('../build/fakturocel',import.meta.url));
const {createApp}=await import(pathToFileURL(path.join(addon,'server.mjs')).href);
const czech=JSON.parse(await fs.readFile(new URL('../src/locales/cs.json',import.meta.url),'utf8')).translations;
const root=await fs.mkdtemp(path.join(os.tmpdir(),'fakturocel-language-'));
const app=await createApp({root:path.join(root,'data'),shareRoot:path.join(root,'share'),backupFolder:path.join(root,'share','backups'),webRoot:path.join(addon,'web'),googleTimer:false,allowRequest:r=>r.socket.remoteAddress==='127.0.0.1'});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const prefix='/api/hassio_ingress/language-test/';
const proxy=http.createServer((request,response)=>{
  if(!request.url.startsWith(prefix)){response.writeHead(404);response.end();return;}
  const forward=http.request({host:'127.0.0.1',port:app.server.address().port,path:'/'+request.url.slice(prefix.length),method:request.method,headers:{...request.headers,'x-remote-user-id':'language-owner','x-remote-user-name':'Test Owner','x-ingress-path':prefix}},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});
  forward.on('error',()=>response.destroy());request.pipe(forward);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || undefined});
  const page=await browser.newPage({viewport:{width:1500,height:1050}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const click=navigationClick(page);
  const closed=()=>page.waitForFunction(()=>!document.querySelector('#modal').innerHTML);
  const discardModal=async()=>{
    await click('closeModal');
    await page.waitForFunction(()=>!document.querySelector('#modal').innerHTML || document.querySelector('#messageOverlay [data-message="ok"]'));
    if(await page.locator('#messageOverlay').count())await page.locator('#messageOverlay [data-message="ok"]').click();
    await closed();
  };
  const settle=()=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  await page.goto(`http://127.0.0.1:${proxy.address().port}${prefix}`);
  await page.locator('[name="enabled"]').selectOption('false');
  await page.locator('[name="disableConfirmed"]').check();
  await click('securitySave');
  await page.locator('#messageOverlay [data-message="ok"]').click();
  await page.getByText('Welcome to Fakturocel').waitFor();
  const company={id:'language-company',name:'Save',city:'Cancel',custom:{'language-field':'Save'}};
  const state=app.store.read().state;
  const document=newDocument(state);document.id='language-document';document.number='Save';document.customer=structuredClone(company);document.notes='Cancel';
  document.items=[{name:'Save',qty:1,unit:'Cancel',price:100,custom:{}}];
  const template=defaultTemplate();template.id='language-template';template.family='language-template';template.name='Cancel';template.status='draft';
  const textNode=template.nodes.find(node=>node.kind==='text');textNode.name='Save';textNode.runs=[{text:'Cancel'}];
  const records={
    companies:[company],documents:[document],templates:[template],
    activities:[{id:'language-activity',name:'Cancel',unit:'Save',price:100}],
    texts:[{id:'language-text',name:'Save',text:'Cancel'}],
    fields:[{id:'language-field',name:'Cancel',scope:'company',type:'choice',options:['Save','Cancel'],default:'Save'}],
    checks:[{id:'language-check',title:'Save',note:'Cancel',status:'open',severity:'warning'}],
    views:[{id:'language-view',name:'Cancel',route:'invoice',filters:{},sort:{key:'date',dir:-1},columns:['number','customer','status'],search:''}]
  };
  await app.store.commit({ops:Object.entries(records).flatMap(([collection,rows])=>rows.map(value=>({collection,id:value.id,rev:0,value})))},{id:'language-owner',name:'Test Owner',role:'owner'});
  const preserved=structuredClone(app.store.read().state);
  await page.reload();
  for(const language of ['cs','en']){
    await click('nav:settings');await click('settingsTab:general');
    await page.locator('[name="appLanguage"]').selectOption(language);
    await page.waitForFunction(language=>document.documentElement.lang===language,language);
    await click('nav:companies');await settle();
    const row=page.locator('[data-record-id="language-company"]');
    assert.equal((await row.locator('td').nth(0).innerText()).trim(),'Save');
    assert.equal((await row.locator('td').nth(2).innerText()).trim(),'Cancel');
    await click('editRecord:companies:language-company');await settle();
    const choice=page.locator('[name="custom_language-field"]');
    assert.equal(await choice.inputValue(),'Save');
    assert.deepEqual(await choice.locator('option').allTextContents(),['','Save','Cancel']);
    assert.equal(await choice.locator('..').locator(':scope > span[data-no-translate]').innerText(),'Cancel');
    await click('closeModal');await closed();
    await click('nav:invoice');await settle();
    assert.equal(await page.locator('[data-action="useView:language-view"]').innerText(),'Cancel');
    assert.equal(await page.locator('[data-action="openDoc:language-document"].link').innerText(),'Save');
    await click('openDoc:language-document');await settle();
    assert.equal(await page.locator('[data-action="docCustomer"]').innerText(),'Save');
    assert.equal(await page.locator('[data-item="name"]').inputValue(),'Save');
    assert.equal(await page.locator('[name="notes"]').inputValue(),'Cancel');
    await click('docCustomer');await settle();
    assert.equal(await page.locator('.picker-row strong').innerText(),'Save');
    await page.locator('[data-pick="0"]').click();
    await page.locator('[name="notes"]').waitFor();
    // Selecting the same customer marks the local draft dirty; leave via the existing discard confirmation.
    await discardModal();
    await click('nav:checks');await settle();
    const check=page.locator('tr').filter({has:page.locator('[data-action="editCheck:language-check"]')});
    assert.equal(await check.locator('td').nth(1).innerText(),'Save');
    await click('nav:templates');await settle();
    const templateRow=page.locator('tr').filter({has:page.locator('[data-action="editTemplate:language-template"]')});
    assert.equal(await templateRow.locator('td').first().innerText(),'Cancel');
    await click('editTemplate:language-template');
    await page.locator('#pages svg text').first().waitFor();
    await settle();
    assert((await page.locator('#pages svg text').allTextContents()).includes('Cancel'));
    assert.equal(await page.locator(`[data-action="edSelect:${textNode.id}"]`).innerText(),'Save');
    await discardModal();
    const after=app.store.read().state;
    for(const key of Object.keys(records))assert.deepEqual(after[key],preserved[key],key+' is unchanged');
    assert.equal(after.settings.language,language);
    await page.reload();
    await page.getByRole('heading',{name:language==='cs'?czech.Overview:'Overview',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),language);
  }
  assert.deepEqual(errors,[]);
  console.log('Built application preserves company names, custom choices, document drafts, picker values, saved views, checks and template content in EN/CZ.');
}finally{
  await browser?.close();
  await new Promise(resolve=>proxy.close(resolve));
  await app.close();
  // This test only removes the temporary directory it created above.
  assert(path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()),'fakturocel-language-')));
  await fs.rm(root,{recursive:true,force:true});
}
