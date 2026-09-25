'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const serverFile = path.join(projectRoot, 'mybrowser', 'server.js');
const allocatedTestPorts = new Set();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => {
        if (error) return reject(error);
        if (allocatedTestPorts.has(port)) return freePort().then(resolve, reject);
        allocatedTestPorts.add(port);
        resolve(port);
      });
    });
  });
}

async function waitFor(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timeout: ${url}`);
}

test('MyBrowser spravuje hostované weby, odkazy, oblíbené a historické offline verze', { timeout: 60000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-mybrowser-'));
  const dataDir = path.join(temp, 'data');
  const shareDir = path.join(temp, 'share');
  const managedDir = path.join(shareDir, 'Weby');
  const existingDir = path.join(shareDir, 'npm-app');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(existingDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({
    default_root: managedDir,
    allowed_roots: [shareDir],
    startup_delay: 0,
    max_upload_mb: 5,
    max_archive_mb: 20
  }));

  const uiPort = await freePort();
  const gatewayPort = await freePort();
  const staticPort = await freePort();
  const npmPort = await freePort();
  const bunPort = await freePort();
  const remotePort = await freePort();
  const remoteServer = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/') {
      const body = Buffer.from('<!doctype html><html><head><title>Testovací katalog</title><meta name="description" content="Archivovatelná stránka"><meta property="og:image" content="/cover.png"><link rel="stylesheet" href="/style.css"></head><body><h1>Offline funguje</h1><img src="/image.png"><script src="/ads/banner.js"></script><a href="/dalsi">Další</a></body></html>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length }); return res.end(body);
    }
    if (route === '/style.css') { const body=Buffer.from('body{background-image:url("/bg.png")}'); res.writeHead(200,{'content-type':'text/css','content-length':body.length}); return res.end(body); }
    if (route === '/ads/banner.js') { const body=Buffer.from('document.body.dataset.ad="shown"'); res.writeHead(200,{'content-type':'text/javascript','content-length':body.length}); return res.end(body); }
    if (['/cover.png','/image.png','/bg.png'].includes(route)) { const body=Buffer.from([137,80,78,71,13,10,26,10]); res.writeHead(200,{'content-type':'image/png','content-length':body.length}); return res.end(body); }
    const body=Buffer.from('<!doctype html><title>Další</title>'); res.writeHead(200,{'content-type':'text/html','content-length':body.length}); res.end(body);
  });
  await new Promise((resolve, reject) => { remoteServer.once('error', reject); remoteServer.listen(remotePort, '127.0.0.1', resolve); });
  const output = [];
  const child = spawn(process.execPath, [serverFile], {
    cwd: path.dirname(serverFile),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: dataDir, UI_PORT: String(uiPort), UI_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort), GATEWAY_HOST: '127.0.0.1', ALLOW_LOCAL_UI: '1', ALLOW_PRIVATE_FETCH: '1', DISABLE_BUNDLED_GUIDE: '1' }
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  async function api(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${uiPort}/api/${route}`, options);
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error), { status: response.status });
    return value;
  }
  const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('close', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    await new Promise(resolve => remoteServer.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });

  try {
    const uiResponse = await waitFor(`http://127.0.0.1:${uiPort}/`);
    assert.match(uiResponse.headers.get('content-security-policy'), /img-src[^;]*blob:/);
    const uiHtml = await uiResponse.text();
    assert.match(uiHtml, /MyBrowser/);
    assert.match(uiHtml, /id="brandIcon"/);
    assert.match(uiHtml, /iconUrl='data:image\/png;base64,iVBOR/);
    assert.doesNotMatch(uiHtml, /__MYBROWSER_ICON_DATA__/);
    assert.match(uiHtml, /<img class="empty-icon" src="\$\{iconUrl\}"/);
    assert.match(uiHtml, /siteCoverDropZone/);
    assert.match(uiHtml, /server-sidebar/);
    assert.match(uiHtml, /uploadFileInChunks/);
    assert.match(uiHtml, /<strong>0 %<\/strong>/);
    assert.match(uiHtml, /siteEmbedUrl/);
    assert.match(uiHtml, /hasGeneratedPreview/);
    assert.match(uiHtml, /Vlastní brána/);
    assert.match(uiHtml, /queueImmediateSiteUploads/);
    assert.match(uiHtml, /data-more/);
    assert.match(uiHtml, /card-side-actions/);
    assert.match(uiHtml, /showOnHome/);
    assert.match(uiHtml, /Hledat v knihovně nebo na webu/);
    assert.match(uiHtml, /Zpřístupnit offline/);
    assert.match(uiHtml, /browserCanvas/);
    assert.match(uiHtml, /browser\/sessions/);
    assert.match(uiHtml, /Spouštím Chromium/);
    assert.match(uiHtml, /fileSelectAll/);
    assert.match(uiHtml, /Nová složka/);
    assert.match(uiHtml, /pendingFileOperation/);
    assert.doesNotMatch(uiHtml, /else if\(isSite&&running\)preview/);
    for (const asset of ['icon.png', 'logo.png', 'sidebar-icon.png']) {
      const response = await fetch(`http://127.0.0.1:${uiPort}/api/assets/${asset}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.ok((await response.arrayBuffer()).byteLength > 1000);
      const ingressResponse = await fetch(`http://127.0.0.1:${uiPort}/api/hassio_ingress/test-token/api/assets/${asset}`);
      assert.equal(ingressResponse.status, 200);
      assert.equal(ingressResponse.headers.get('content-type'), 'image/png');
      assert.ok((await ingressResponse.arrayBuffer()).byteLength > 1000);
    }

    const initial = await api('state');
    assert.equal(initial.sites.length, 0);
    assert.equal(initial.links.length, 0);
    assert.equal(initial.settings.defaultRoot, path.resolve(managedDir));
    assert.equal(initial.settings.nextManagedPath, path.join(managedDir, '001_Názevwebu'));
    assert.equal(initial.settings.gatewayPort, gatewayPort);
    assert.equal(typeof initial.settings.chromiumBrowser, 'boolean');
    assert.match(initial.settings.browserDownloadDir, /MyBrowser[\\/]Stazene$/);

    const created = await api('sites', json('POST', {
      name: 'Rodinný web', slug: 'rodinny-web', port: staticPort, runtime: 'static',
      rootMode: 'managed', autostart: true, spaFallback: true
    }));
    assert.equal(created.runtime, 'static');
    assert.equal(created.path, path.join(managedDir, '001_Rodinnýweb'));
    assert.ok(fs.existsSync(created.path));

    const coverBytes = Buffer.from([137,80,78,71,13,10,26,10]);
    const rejectedCover = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/cover`, {
      method: 'PUT', headers: { 'content-type': 'image/svg+xml' }, body: '<svg></svg>'
    });
    assert.equal(rejectedCover.status, 415);
    const coverUpload = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/cover`, {
      method: 'PUT', headers: { 'content-type': 'image/png' }, body: coverBytes
    });
    assert.equal(coverUpload.status, 201);
    const coveredSite = (await api('state')).sites.find(site => site.id === created.id);
    assert.equal(coveredSite.hasCover, true);
    const siteCover = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/cover`);
    assert.equal(siteCover.status, 200);
    assert.equal(siteCover.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await siteCover.arrayBuffer()), coverBytes);

    const html = '<!doctype html><title>Rodinný web</title><h1>Funguje</h1>';
    const upload = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/files?path=index.html`, {
      method: 'PUT', headers: { 'content-type': 'text/html' }, body: html
    });
    assert.equal(upload.status, 201);

    const chunkedBytes = Buffer.from('část-1|část-2|část-3');
    const chunkUploadId = crypto.randomUUID();
    const sendChunk = (offset, end) => fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/files?path=chunked.txt&upload=${chunkUploadId}&offset=${offset}&total=${chunkedBytes.length}`, {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: chunkedBytes.subarray(offset, end)
    });
    assert.equal((await sendChunk(0, 7)).status, 202);
    assert.equal(fs.existsSync(path.join(created.path, 'chunked.txt')), false);
    assert.equal((await sendChunk(7, 14)).status, 202);
    assert.equal((await sendChunk(7, 14)).status, 202);
    assert.equal((await sendChunk(14, chunkedBytes.length)).status, 201);
    assert.deepEqual(fs.readFileSync(path.join(created.path, 'chunked.txt')), chunkedBytes);

    await api(`sites/${created.id}/action`, json('POST', { action: 'start' }));
    assert.match(await (await waitFor(`http://127.0.0.1:${staticPort}/`)).text(), /Funguje/);
    const spaResponse = await fetch(`http://127.0.0.1:${staticPort}/libovolna/spa/cesta`, { headers: { accept: 'text/html' } });
    assert.equal(spaResponse.status, 200);
    assert.match(await spaResponse.text(), /Funguje/);

    const files = await api(`sites/${created.id}/files?path=`);
    assert.deepEqual(files.entries.map(entry => entry.name), ['chunked.txt', 'index.html']);
    await assert.rejects(() => api(`sites/${created.id}/files?path=${encodeURIComponent('../state.json')}`), /Cesta nesmí/);

    await api(`sites/${created.id}/files`, json('POST', { action: 'mkdir', path: 'assets' }));
    await api(`sites/${created.id}/files`, json('POST', { action: 'mkdir', path: 'backup' }));
    for (const [name, body] of [['a.txt', 'soubor-a'], ['b.txt', 'soubor-b']]) {
      const response = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/files?path=${encodeURIComponent(`assets/${name}`)}`, {
        method: 'PUT', headers: { 'content-type': 'text/plain' }, body
      });
      assert.equal(response.status, 201);
    }
    let assets = await api(`sites/${created.id}/files?path=assets`);
    assert.deepEqual(assets.entries.map(entry => entry.name), ['a.txt', 'b.txt']);

    await api(`sites/${created.id}/files`, json('POST', { action: 'copy', paths: ['assets/a.txt', 'assets/b.txt'], destination: 'backup' }));
    let backup = await api(`sites/${created.id}/files?path=backup`);
    assert.deepEqual(backup.entries.map(entry => entry.name), ['a.txt', 'b.txt']);
    await api(`sites/${created.id}/files`, json('POST', { action: 'rename', path: 'backup/a.txt', name: 'prejmenovano.txt' }));
    backup = await api(`sites/${created.id}/files?path=backup`);
    assert.deepEqual(backup.entries.map(entry => entry.name), ['b.txt', 'prejmenovano.txt']);

    const downloaded = await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/files?path=${encodeURIComponent('backup/prejmenovano.txt')}&download=1`);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition'), /attachment/);
    assert.equal(await downloaded.text(), 'soubor-a');

    await api(`sites/${created.id}/files`, json('POST', { action: 'move', paths: ['backup/b.txt'], destination: '' }));
    assert.equal(fs.readFileSync(path.join(created.path, 'b.txt'), 'utf8'), 'soubor-b');
    await assert.rejects(() => api(`sites/${created.id}/files`, json('POST', { action: 'move', paths: ['assets'], destination: 'assets' })), /do ní samotné/);
    await assert.rejects(() => api(`sites/${created.id}/files`, json('POST', { action: 'mkdir', path: '../mimo' })), /Cesta nesmí/);

    await api(`sites/${created.id}/files`, json('POST', { action: 'delete', paths: ['assets', 'backup', 'b.txt'] }));
    assert.equal(fs.existsSync(path.join(created.path, 'assets')), false);
    assert.equal(fs.existsSync(path.join(created.path, 'backup')), false);
    assert.equal(fs.existsSync(path.join(created.path, 'b.txt')), false);

    const gatewaySite = await api('sites', json('POST', {
      name: 'Web přes bránu', runtime: 'static', accessMode: 'gateway', rootMode: 'managed',
      autostart: false, spaFallback: true
    }));
    assert.equal(gatewaySite.accessMode, 'gateway');
    assert.notEqual(gatewaySite.port, gatewayPort);
    const gatewayHtml = '<!doctype html><title>Brána funguje</title><h1>Adresa pod cestou funguje</h1>';
    assert.equal((await fetch(`http://127.0.0.1:${uiPort}/api/sites/${gatewaySite.id}/files?path=index.html`, {
      method: 'PUT', headers: { 'content-type': 'text/html' }, body: gatewayHtml
    })).status, 201);
    await api(`sites/${gatewaySite.id}/action`, json('POST', { action: 'start' }));
    const gatewayRedirect = await fetch(`http://127.0.0.1:${gatewayPort}/${gatewaySite.slug}`, { redirect: 'manual' });
    assert.equal(gatewayRedirect.status, 308);
    assert.equal(gatewayRedirect.headers.get('location'), `/${gatewaySite.slug}/`);
    assert.match(await (await waitFor(`http://127.0.0.1:${gatewayPort}/${gatewaySite.slug}/`)).text(), /Adresa pod cestou funguje/);
    assert.match(await (await waitFor(`http://127.0.0.1:${uiPort}/api/gateway/${gatewaySite.slug}/`)).text(), /Adresa pod cestou funguje/);
    assert.match(await (await fetch(`http://127.0.0.1:${gatewayPort}/`)).text(), /Web přes bránu/);
    const generatedPreviewFile = path.join(dataDir, 'site-previews', `${gatewaySite.id}.png`);
    fs.writeFileSync(generatedPreviewFile, Buffer.from([137,80,78,71,13,10,26,10]));
    const gatewayState = await api('state');
    assert.equal(gatewayState.sites.find(site => site.id === gatewaySite.id).hasGeneratedPreview, true);
    assert.equal((await fetch(`http://127.0.0.1:${uiPort}/api/sites/${gatewaySite.id}/preview`)).status, 200);

    const uploadSession = await api('upload-sessions', { method: 'POST' });
    const stagedBytes = Buffer.from('<!doctype html><title>Nahráno na pozadí</title>');
    const stagedUploadId = crypto.randomUUID();
    const stagedUpload = await fetch(`http://127.0.0.1:${uiPort}/api/upload-sessions/${uploadSession.id}/files?path=background.html&upload=${stagedUploadId}&offset=0&total=${stagedBytes.length}`, {
      method: 'PUT', headers: { 'content-type': 'text/html' }, body: stagedBytes
    });
    assert.equal(stagedUpload.status, 201);
    assert.equal(fs.existsSync(path.join(gatewaySite.path, 'background.html')), false);
    await api(`upload-sessions/${uploadSession.id}`, json('POST', { siteId: gatewaySite.id }));
    assert.deepEqual(fs.readFileSync(path.join(gatewaySite.path, 'background.html')), stagedBytes);

    const abandonedSession = await api('upload-sessions', { method: 'POST' });
    await api(`upload-sessions/${abandonedSession.id}`, { method: 'DELETE' });
    await assert.rejects(() => api(`upload-sessions/${abandonedSession.id}`, json('POST', { siteId: gatewaySite.id })), /nebyla nalezena/);

    const customGatewaySite = await api('sites', json('POST', {
      name: 'Vlastní veřejná brána', runtime: 'static', accessMode: 'custom_gateway',
      customGatewayUrl: 'https://web.example.test/moje-stranka', rootMode: 'managed', autostart: false
    }));
    assert.equal(customGatewaySite.accessMode, 'custom_gateway');
    assert.equal(customGatewaySite.customGatewayUrl, 'https://web.example.test/moje-stranka/');
    assert.notEqual(customGatewaySite.port, gatewayPort);
    await fetch(`http://127.0.0.1:${uiPort}/api/sites/${customGatewaySite.id}/files?path=index.html`, {
      method: 'PUT', headers: { 'content-type': 'text/html' }, body: '<h1>Vlastní brána funguje</h1>'
    });
    await api(`sites/${customGatewaySite.id}/action`, json('POST', { action: 'start' }));
    assert.match(await (await waitFor(`http://127.0.0.1:${gatewayPort}/${customGatewaySite.slug}/`)).text(), /Vlastní brána funguje/);

    await api(`library/site/${gatewaySite.id}`, json('PATCH', { showOnHome: false }));
    assert.equal((await api('state')).sites.find(site => site.id === gatewaySite.id).showOnHome, false);
    await api(`library/site/${gatewaySite.id}`, json('PATCH', { showOnHome: true }));
    assert.equal((await api('state')).sites.find(site => site.id === gatewaySite.id).showOnHome, true);

    fs.writeFileSync(path.join(existingDir, 'package.json'), JSON.stringify({
      name: 'test-npm-site', private: true, scripts: { start: 'node app.js' }
    }));
    fs.writeFileSync(path.join(existingDir, 'app.js'), `require('node:http').createServer((q,s)=>s.end('npm-ok')).listen(Number(process.env.PORT),'0.0.0.0');`);
    const npmSite = await api('sites', json('POST', {
      name: 'npm aplikace', port: npmPort, runtime: 'npm', rootMode: 'existing', path: existingDir,
      script: 'start', buildScript: 'build', autostart: false
    }));
    await api(`sites/${npmSite.id}/action`, json('POST', { action: 'start' }));
    assert.equal(await (await waitFor(`http://127.0.0.1:${npmPort}/`)).text(), 'npm-ok');
    const logs = await api(`sites/${npmSite.id}/logs`);
    assert.ok(logs.logs.some(line => /npm run start/.test(line.message)));

    const gatewayNpmSite = await api('sites', json('POST', {
      name: 'npm přes bránu', runtime: 'npm', accessMode: 'gateway', rootMode: 'existing', path: existingDir,
      script: 'start', buildScript: 'build', autostart: false
    }));
    await api(`sites/${gatewayNpmSite.id}/action`, json('POST', { action: 'start' }));
    assert.equal(await (await waitFor(`http://127.0.0.1:${gatewayPort}/${gatewayNpmSite.slug}/`)).text(), 'npm-ok');
    assert.equal(await (await waitFor(`http://127.0.0.1:${uiPort}/api/gateway/${gatewayNpmSite.slug}/`)).text(), 'npm-ok');

    const updated = await api(`sites/${npmSite.id}`, json('PUT', { name: 'npm aplikace 2', autostart: true }));
    assert.equal(updated.name, 'npm aplikace 2');
    assert.equal(updated.autostart, true);

    await api(`library/site/${created.id}`, json('PATCH', { favorite: true }));
    const link = await api('links', json('POST', {
      url: `http://127.0.0.1:${remotePort}/`, favorite: true, blockAds: true
    }));
    assert.equal(link.blockAds, true);
    let linkedState;
    const metadataDeadline = Date.now() + 10000;
    do {
      linkedState = await api('state');
      if (linkedState.links[0]?.metadataStatus === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < metadataDeadline);
    assert.equal(linkedState.links[0].name, 'Testovací katalog');
    const coverDeadline = Date.now() + 10000;
    while (!linkedState.links[0].hasCover && Date.now() < coverDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      linkedState = await api('state');
    }
    assert.equal(linkedState.links[0].hasCover, true);
    assert.equal((await fetch(`http://127.0.0.1:${uiPort}/api/links/${link.id}/cover`)).status, 200);

    const proxied = await fetch(`http://127.0.0.1:${uiPort}/view/${link.id}/`);
    assert.equal(proxied.status, 200);
    const proxiedHtml = await proxied.text();
    assert.match(proxiedHtml, /\.\/resource\?url=/);
    assert.doesNotMatch(proxiedHtml, /banner\.js/);
    const browsed = await fetch(`http://127.0.0.1:${uiPort}/browse/?url=${encodeURIComponent(`http://127.0.0.1:${remotePort}/`)}`);
    assert.equal(browsed.status, 200);
    const browsedHtml = await browsed.text();
    assert.match(browsedHtml, /Offline funguje/);
    assert.match(browsedHtml, /\.\/\?url=/);
    assert.doesNotMatch(browsedHtml, /banner\.js/);
    await api(`library/link/${link.id}/view`, { method: 'POST' });

    await api('library/favorites', json('PUT', { order: [{ kind: 'link', id: link.id }, { kind: 'site', id: created.id }] }));
    linkedState = await api('state');
    assert.equal(linkedState.links[0].favoriteOrder, 0);
    assert.equal(linkedState.sites.find(item => item.id === created.id).favoriteOrder, 1);
    assert.equal(linkedState.links[0].views, 1);

    async function createAndWaitForArchive() {
      const started = await api(`links/${link.id}/archives`, { method: 'POST' });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const current = (await api('state')).links.find(item => item.id === link.id).archives.find(item => item.id === started.archive.id);
        if (current.status === 'ready') return current;
        if (current.status === 'failed') throw new Error(current.error);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Timeout při vytváření offline archivu');
    }
    const firstArchive = await createAndWaitForArchive();
    const secondArchive = await createAndWaitForArchive();
    assert.notEqual(firstArchive.id, secondArchive.id);
    linkedState = await api('state');
    assert.equal(linkedState.links[0].archives.filter(item => item.status === 'ready').length, 2);
    const offline = await fetch(`http://127.0.0.1:${uiPort}/offline/${link.id}/${firstArchive.id}/index.html`);
    assert.equal(offline.status, 200);
    const offlineHtml = await offline.text();
    assert.match(offlineHtml, /Offline funguje/);
    assert.doesNotMatch(offlineHtml, /banner\.js/);
    assert.match(await (await fetch(`http://127.0.0.1:${uiPort}/viewer?id=${link.id}&archive=${firstArchive.id}`)).text(), /MyBrowser/);

    const bunDir = path.join(shareDir, 'bun-app');
    fs.mkdirSync(bunDir, { recursive: true });
    fs.writeFileSync(path.join(bunDir, 'package.json'), JSON.stringify({
      name: 'test-bun-site', private: true, scripts: { start: 'bun app.js' }
    }));
    fs.writeFileSync(path.join(bunDir, 'app.js'), `Bun.serve({port:Number(process.env.PORT),hostname:'0.0.0.0',fetch(){return new Response('bun-ok')}});`);
    const bunSite = await api('sites', json('POST', {
      name: 'Bun aplikace', port: bunPort, runtime: 'bun', rootMode: 'existing', path: bunDir,
      script: 'start', buildScript: 'build', autostart: false
    }));
    await api(`sites/${bunSite.id}/action`, json('POST', { action: 'start' }));
    assert.equal(await (await waitFor(`http://127.0.0.1:${bunPort}/`)).text(), 'bun-ok');

    await api(`sites/${bunSite.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${customGatewaySite.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${gatewayNpmSite.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${gatewaySite.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${npmSite.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${created.id}/action`, json('POST', { action: 'stop' }));
    await api(`sites/${created.id}?deleteFiles=1`, { method: 'DELETE' });
    assert.equal(fs.existsSync(created.path), false);
    assert.equal((await fetch(`http://127.0.0.1:${uiPort}/api/sites/${created.id}/cover`)).status, 404);

    await assert.rejects(() => api('sites', json('POST', {
      name: 'Mimo úložiště', port: staticPort, runtime: 'static', rootMode: 'existing', path: os.tmpdir()
    })), /Složka musí být uvnitř/);
  } catch (error) {
    error.message += `\nVýstup serveru:\n${output.join('')}`;
    throw error;
  }
});

test('čerstvá instalace přidá průvodce jednou a ikona funguje i pod Ingress cestou', { timeout: 30000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-mybrowser-guide-'));
  const dataDir = path.join(temp, 'data');
  const shareDir = path.join(temp, 'share');
  const managedDir = path.join(shareDir, 'Weby');
  fs.mkdirSync(dataDir, { recursive: true });
  const uiPort = await freePort();
  const gatewayPort = await freePort();
  fs.writeFileSync(path.join(dataDir, 'options.json'), JSON.stringify({
    default_root: managedDir,
    allowed_roots: [shareDir],
    gateway_port: gatewayPort,
    startup_delay: 0,
    max_upload_mb: 5,
    max_archive_mb: 20
  }));

  const output = [];
  let child;
  function startChild() {
    child = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATA_DIR: dataDir, UI_PORT: String(uiPort), UI_HOST: '127.0.0.1', GATEWAY_HOST: '127.0.0.1', ALLOW_LOCAL_UI: '1' }
    });
    child.stdout.on('data', chunk => output.push(chunk.toString()));
    child.stderr.on('data', chunk => output.push(chunk.toString()));
  }
  async function stopChild() {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  async function api(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:${uiPort}/api/${route}`, options);
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  }

  t.after(async () => {
    await stopChild();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  try {
    startChild();
    const ingressUi = await waitFor(`http://127.0.0.1:${uiPort}/api/hassio_ingress/test-token`);
    assert.match(await ingressUi.text(), /iconUrl='data:image\/png;base64,iVBOR/);
    const ingressIcon = await fetch(`http://127.0.0.1:${uiPort}/api/hassio_ingress/test-token/api/assets/icon.png`);
    assert.equal(ingressIcon.status, 200);
    assert.equal(ingressIcon.headers.get('content-type'), 'image/png');

    let current = await api('state');
    assert.equal(current.sites.length, 1);
    const guide = current.sites[0];
    assert.equal(guide.name, 'Průvodce MyBrowserem');
    assert.equal(guide.slug, 'pruvodce-mybrowserem');
    assert.equal(guide.accessMode, 'gateway');
    assert.equal(guide.autostart, true);
    assert.equal(guide.favorite, true);
    assert.equal(guide.bundledGuide, true);
    assert.ok(fs.existsSync(path.join(guide.path, 'index.html')));
    assert.ok(fs.existsSync(path.join(guide.path, 'icon.png')));
    assert.match(await (await waitFor(`http://127.0.0.1:${gatewayPort}/${guide.slug}/`)).text(), /Průvodce MyBrowserem/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')).guideInstalled, true);

    await api(`sites/${guide.id}?deleteFiles=1`, { method: 'DELETE' });
    assert.equal(fs.existsSync(guide.path), false);
    await stopChild();
    startChild();
    await waitFor(`http://127.0.0.1:${uiPort}/`);
    current = await api('state');
    assert.equal(current.sites.length, 0);
  } catch (error) {
    error.message += `\nVýstup serveru:\n${output.join('')}`;
    throw error;
  }
});
