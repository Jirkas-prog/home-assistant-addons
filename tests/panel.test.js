'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Availability, probeOrigin } = require('../mybrowser/availability');
const { BraveDesktop } = require('../mybrowser/brave');
const { panelStrings } = require('../mybrowser/locales');

async function listen(server, port = 0) { server.listen(port, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
async function freePort() {
  // Stay outside Windows' ephemeral client-port range while Brave starts.
  for (let attempt = 0; attempt < 30; attempt++) {
    const server = http.createServer();
    try { const port = await listen(server, 20000 + Math.floor(Math.random() * 20000)); await new Promise(resolve => server.close(resolve)); return port; }
    catch { server.close(); }
  }
  throw new Error('No test port available');
}
async function until(check, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (value) { error = value; }
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw error || new Error('Timed out waiting for the test condition');
}

test('availability checks are bounded, cached, and never request saved action URLs', async t => {
  const requests = [];
  let status = 401, hang = false;
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    if (!hang) { res.writeHead(status); res.end(); }
  });
  const port = await listen(server), url = `http://127.0.0.1:${port}/set?power=on`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const availability = new Availability(async value => assert.equal(value, `http://127.0.0.1:${port}/`));
  const results = await Promise.all([availability.check(url), availability.check(url)]);
  assert.equal(results[0].reachable, true);
  assert.equal(results[0].status, 401);
  assert.deepEqual(requests, [['HEAD', '/']]);
  status = 405;
  assert.equal((await probeOrigin(url)).reachable, true, 'A device rejecting HEAD still responds');
  status = 503;
  assert.equal((await probeOrigin(url)).status, 503, 'HTTP errors are not confused with no connection');
  hang = true;
  assert.equal((await probeOrigin(url, { timeout: 80 })).reachable, false);
  const forbidden = new Availability(async () => { throw new Error('blocked'); });
  assert.equal((await forbidden.check(url)).error, 'ADDRESS_NOT_ALLOWED');
});

test('panel translation changes text, not the executable program', () => {
  const source = fs.readFileSync(path.join(__dirname, '../mybrowser/panel.html'), 'utf8');
  const en = panelStrings('en'), cs = panelStrings('cs');
  assert.deepEqual(Object.keys(en), Object.keys(cs));
  assert.equal(en.title, 'Setup pages');
  assert.notEqual(en.title, cs.title);
  for (const language of ['en', 'cs']) {
    const rendered = source.replace('__PANEL_STRINGS__', JSON.stringify(panelStrings(language)));
    new Function(rendered.split('<script>')[1].split('</script>')[0]);
    assert.equal(rendered.replace(JSON.stringify(panelStrings(language)), '__PANEL_STRINGS__'), source);
  }
});

const braveBin = process.env.MYBROWSER_TEST_BRAVE || (process.platform === 'win32'
  ? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' : '/usr/bin/brave-browser');

test('real Brave preserves device forms; the panel locks layout, persists pins, and supports both languages', {
  skip: !fs.existsSync(braveBin) && 'Set MYBROWSER_TEST_BRAVE to run the real-browser test', timeout: 90000
}, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mybrowser-panel-'));
  const dataDir = path.join(temp, 'data'), shareDir = path.join(temp, 'share');
  fs.mkdirSync(dataDir); fs.mkdirSync(shareDir);
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({ default_root: shareDir, allowed_roots: [shareDir], startup_delay: 0 }));
  const device = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url.startsWith('/brave/') ? '<title>Stream transport fixture</title><p>Stream transport fixture (not a live device image)</p>'
      : '<!doctype html><title>Device setup</title><input id="setting" value="initial"><a href="/set?power=on">Apply</a><form action="/set"><button>Apply</button></form><script>window.deviceScriptRan=true</script><p>Device setup fixture</p>');
  });
  const devicePort = await listen(device), debugPort = await freePort(), uiPort = await freePort(), gatewayPort = await freePort();
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ version: 5, sites: {}, guideInstalled: true, language: 'en', links: {
    [a]: { name: 'Desk lights', url: `http://127.0.0.1:${devicePort}/a`, favorite: true, favoriteOrder: 0, archives: [] },
    [b]: { name: 'Hall lights', url: `http://127.0.0.1:${devicePort}/b`, favorite: false, archives: [] }
  } }));
  const browser = spawn(braveBin, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(temp, 'profile')}`, `--remote-debugging-port=${debugPort}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const brave = new BraveDesktop({ port: debugPort });
  let app, output = '';
  const startApp = () => {
    app = spawn(process.execPath, [path.join(__dirname, '../mybrowser/server.js')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, DATA_DIR: dataDir, UI_PORT: String(uiPort), UI_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort), GATEWAY_HOST: '127.0.0.1',
      BRAVE_PORT: String(devicePort), BRAVE_DEBUG_PORT: String(debugPort), ALLOW_LOCAL_UI: '1', DISABLE_BUNDLED_GUIDE: '1'
    } });
    app.stdout.on('data', chunk => output += chunk); app.stderr.on('data', chunk => output += chunk);
  };
  const stopApp = async () => { if (app?.exitCode === null) { const closed = once(app, 'close'); app.kill(); await closed; } };
  t.after(async () => {
    await stopApp();
    try { const target = (await brave.targets())[0]; if (target) await brave.command(target, 'Browser.close'); } catch {}
    if (browser.exitCode === null) { const closed = once(browser, 'close'); browser.kill(); await closed; }
    device.closeAllConnections(); await new Promise(resolve => device.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const origin = `http://127.0.0.1:${uiPort}`;
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(`${origin}/api/${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status }); return value;
  };
  const evaluate = async (target, expression) => {
    const result = await brave.command(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  try {
    await until(() => brave.targets()); startApp();
    let state = await until(() => api('state'));
    assert.equal(state.links.find(x => x.id === a).pinned, true, 'Existing favorites migrate without being deleted');
    assert.equal(state.links.find(x => x.id === b).pinned, false);
    await api(`library/link/${b}`, 'PATCH', { pinned: true });
    await api('panel/order', 'PUT', { order: [{ kind: 'link', id: b }, { kind: 'link', id: a }] });
    await assert.rejects(api('panel/order', 'PUT', { order: [{ kind: 'link', id: a }] }), { status: 400 });
    await assert.rejects(api(`library/link/${a}`, 'PATCH', { pinned: 'false' }), { status: 400 });
    assert.equal((await api('panel/availability'))[`link:${a}`].reachable, true);

    const openedA = await api('panel/open', 'POST', { kind: 'link', id: a });
    const targetA = (await brave.targets()).find(x => x.id === openedA.targetId);
    await until(() => evaluate(targetA, 'Boolean(document.getElementById("setting"))'));
    await evaluate(targetA, 'document.getElementById("setting").value="unsaved brightness 73"');
    const openedB = await api('panel/open', 'POST', { kind: 'link', id: b });
    assert.notEqual(openedA.targetId, openedB.targetId);
    const reopenedA = await api('panel/open', 'POST', { kind: 'link', id: a });
    assert.equal(reopenedA.targetId, openedA.targetId);
    assert.equal(await evaluate(targetA, 'document.getElementById("setting").value'), 'unsaved brightness 73');
    // Internal navigation must also survive tab switches, not just input values.
    await evaluate(targetA, 'history.pushState({},"","/a/subpage")');
    await api('panel/open', 'POST', { kind: 'link', id: b });
    await api('panel/open', 'POST', { kind: 'link', id: a });
    assert.match(await evaluate(targetA, 'location.href'), /\/a\/subpage$/);
    const archive = (await api(`links/${a}/archives`, 'POST')).archive;
    await until(async () => (await api('state')).links.find(x => x.id === a).archives.find(x => x.id === archive.id)?.status === 'ready');

    const uiTarget = await brave.request('/json/new?about:blank', { method: 'PUT' });
    const browserErrors = [], debugSocket = new WebSocket(uiTarget.webSocketDebuggerUrl), commands = new Map();
    let commandId = 0;
    await once(debugSocket, 'open');
    t.after(() => debugSocket.close());
    debugSocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
      if (commands.has(message.id)) { commands.get(message.id)(message); commands.delete(message.id); }
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId, timer = setTimeout(() => { commands.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
      commands.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
      debugSocket.send(JSON.stringify({ id, method, params }));
    });
    await cdp('Runtime.enable');
    // Use an ingress prefix so all panel, editor and stream URLs are exercised.
    const panelUrl = `${origin}/api/hassio_ingress/test-panel/`;
    await brave.command(uiTarget, 'Page.navigate', { url: panelUrl });
    await until(() => evaluate(uiTarget, 'document.querySelectorAll("[role=tab]").length===2 && !switching'));
    assert.equal(await evaluate(uiTarget, 'document.querySelectorAll("[data-unpin]").length'), 0);
    assert.equal(await evaluate(uiTarget, 'document.querySelectorAll("aside").length'), 0);
    assert.ok(await evaluate(uiTarget, 'Math.abs(document.getElementById("pageSurface").getBoundingClientRect().bottom-innerHeight)<2'), 'Live page must fill the remaining panel height');
    assert.equal(await evaluate(uiTarget, 'document.getElementById("editButton").textContent'), 'Edit panel');
    assert.equal(await evaluate(uiTarget, 'document.querySelector("[role=tab]").textContent.trim()'), 'Hall lights');
    await evaluate(uiTarget, 'window.originalFrame=document.getElementById("braveFrame");document.querySelectorAll("[role=tab]")[1].click()');
    await until(() => evaluate(uiTarget, `activeKey==='link:${a}' && !switching`));
    assert.equal(await evaluate(uiTarget, 'originalFrame===document.getElementById("braveFrame")'), true);
    await evaluate(uiTarget, 'document.getElementById("snapshotButton").click()');
    await until(() => evaluate(uiTarget, '!document.getElementById("snapshotFrame").hidden'));
    assert.equal(await evaluate(uiTarget, 'document.getElementById("snapshotFrame").getAttribute("sandbox")'), '');
    assert.deepEqual(await evaluate(uiTarget, `(()=>{const copy=document.createElement('template');copy.innerHTML=document.getElementById('snapshotFrame').srcdoc;return{script:!!copy.content.querySelector('script'),link:copy.content.querySelector('a').hasAttribute('href'),inputDisabled:copy.content.querySelector('input').disabled,buttonDisabled:copy.content.querySelector('button').disabled}})()`), { script: false, link: false, inputDisabled: true, buttonDisabled: true });
    await evaluate(uiTarget, 'document.getElementById("liveButton").click()');
    await until(() => evaluate(uiTarget, '!switching && !offline'));
    assert.equal(await evaluate(targetA, 'document.getElementById("setting").value'), 'unsaved brightness 73');
    await evaluate(uiTarget, 'document.getElementById("editButton").click()');
    assert.equal(await evaluate(uiTarget, 'document.querySelectorAll("[data-unpin]").length'), 2);
    await evaluate(uiTarget, `document.querySelector('[data-move="1"]').click()`);
    await until(() => evaluate(uiTarget, '!mutation && document.querySelector("[role=tab]").textContent.trim()==="Desk lights"'));
    await evaluate(uiTarget, `document.querySelector('[data-key="link:${b}"] [data-unpin]').click()`);
    await until(() => evaluate(uiTarget, 'document.querySelectorAll("[role=tab]").length===1 && !mutation'));
    assert.equal((await api('state')).links.length, 2, 'Unpinning must not delete the saved device');
    await evaluate(uiTarget, 'document.getElementById("addLinkButton").click()');
    await evaluate(uiTarget, `document.getElementById('linkName').value='Workbench';document.getElementById('linkUrl').value='http://127.0.0.1:${devicePort}/workbench';document.getElementById('linkForm').requestSubmit()`);
    await until(() => evaluate(uiTarget, 'items().length===3 && !document.getElementById("linkDialog").open'));
    assert.equal((await api('state')).links.find(x => x.name === 'Workbench').pinned, true);

    await evaluate(uiTarget, 'document.getElementById("language").value="cs";document.getElementById("language").dispatchEvent(new Event("change"))');
    await until(() => evaluate(uiTarget, 'document.documentElement.lang==="cs" && typeof editing!=="undefined" && editing && !switching'));
    assert.equal(await evaluate(uiTarget, 'document.getElementById("editButton").textContent'), panelStrings('cs').done);
    assert.deepEqual(browserErrors, []);
    if (process.env.PANEL_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.PANEL_SCREENSHOT_DIR, { recursive: true });
      await cdp('Page.bringToFront');
      for (const [name, width, height] of [['panel-desktop', 1440, 900], ['panel-mobile', 390, 844]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await until(() => evaluate(uiTarget, `innerWidth===${width} && innerHeight===${height}`));
        const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(process.env.PANEL_SCREENSHOT_DIR, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
        assert.ok(await evaluate(uiTarget, 'document.documentElement.scrollWidth<=innerWidth'), 'Panel must not overflow horizontally');
      }
    }
    await evaluate(uiTarget, 'document.getElementById("editButton").click()');
    assert.equal(await evaluate(uiTarget, 'document.querySelectorAll("[data-unpin]").length'), 0);
    await evaluate(uiTarget, 'document.getElementById("libraryButton").click()');
    await until(() => evaluate(uiTarget, 'document.getElementById("libraryDialog").open'));
    await evaluate(uiTarget, `document.querySelector('#libraryItems [data-key="link:${b}"]').click()`);
    await until(() => evaluate(uiTarget, `activeKey==='link:${b}' && !switching`));
    assert.equal(await evaluate(uiTarget, 'pins().length'), 2, 'Opening an unpinned page must not pin it');
    if (process.env.PANEL_SCREENSHOT_DIR) {
      await cdp('Page.bringToFront');
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.PANEL_SCREENSHOT_DIR, 'panel-live-mobile.png'), Buffer.from(screenshot.data, 'base64'));
      assert.ok(await evaluate(uiTarget, 'Math.abs(document.getElementById("pageSurface").getBoundingClientRect().bottom-innerHeight)<2'));
    }
    await api(`library/link/${b}`, 'PATCH', { favorite: true });
    await stopApp(); startApp();
    state = await until(() => api('state'));
    assert.equal(state.settings.language, 'cs');
    assert.equal(state.links.find(x => x.id === a).pinned, true);
    assert.equal(state.links.find(x => x.id === b).pinned, false);
    assert.equal(state.links.find(x => x.id === a).pinOrder, 0);
    assert.equal(state.links.find(x => x.id === a).favorite, true);
  } catch (error) { error.message += `\nServer output:\n${output}`; throw error; }
});
