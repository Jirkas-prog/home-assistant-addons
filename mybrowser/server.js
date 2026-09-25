'use strict';

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { RemoteManager } = require('./remote');
const { ChromiumBrowser } = require('./chromium');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '.data');
const stateFile = path.join(dataDir, 'state.json');
const optionsFile = process.env.OPTIONS_FILE || path.join(dataDir, 'options.json');
const siteCoverDir = path.join(dataDir, 'site-covers');
const sitePreviewDir = path.join(dataDir, 'site-previews');
const uploadStageDir = path.join(dataDir, 'upload-staging');
const bundledGuideDir = path.join(__dirname, 'guide');
const uiPort = Number(process.env.UI_PORT || 8099);
const uiHost = process.env.UI_HOST || '0.0.0.0';
const allowedRuntimeNames = new Set(['static', 'npm', 'bun']);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(siteCoverDir, { recursive: true });
fs.mkdirSync(sitePreviewDir, { recursive: true });
fs.mkdirSync(uploadStageDir, { recursive: true });
for (const entry of fs.readdirSync(uploadStageDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const candidate = path.join(uploadStageDir, entry.name);
  try {
    if (Date.now() - fs.statSync(candidate).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(candidate, { recursive: true, force: true });
  } catch {}
}

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Nelze načíst ${file}: ${error.message}`); }
}

const addonOptions = readJsonFile(optionsFile, {});
const gatewayPort = clampInteger(addonOptions.gateway_port ?? process.env.GATEWAY_PORT, 1024, 65535, 3000);
const gatewayHost = process.env.GATEWAY_HOST || '0.0.0.0';
const defaultRoot = path.resolve(String(addonOptions.default_root || process.env.DEFAULT_ROOT || '/share/Weby'));
const startupDelay = clampInteger(addonOptions.startup_delay, 0, 60, 2);
const maxUploadBytes = clampInteger(addonOptions.max_upload_mb, 1, 4096, 250) * 1024 * 1024;
const maxArchiveBytes = clampInteger(addonOptions.max_archive_mb, 10, 2048, 100) * 1024 * 1024;
const allowedRoots = (Array.isArray(addonOptions.allowed_roots) && addonOptions.allowed_roots.length
  ? addonOptions.allowed_roots
  : ['/share', '/media', '/config'])
  .map(value => path.resolve(String(value)));

if (gatewayPort === uiPort) throw new Error('Port veřejné brány se nesmí shodovat s portem správy');

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function usesGateway(value) {
  const mode = typeof value === 'string' ? value : value?.accessMode;
  return mode === 'gateway' || mode === 'custom_gateway';
}

function normalizeCustomGatewayUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Vlastní brána musí být platná HTTP nebo HTTPS adresa'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Vlastní brána musí používat HTTP nebo HTTPS');
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isAllowedPath(candidate) {
  const resolved = path.resolve(candidate);
  return allowedRoots.some(root => isInside(root, resolved));
}

if (!isAllowedPath(defaultRoot)) {
  throw new Error(`Výchozí složka ${defaultRoot} musí být uvnitř: ${allowedRoots.join(', ')}`);
}
fs.mkdirSync(defaultRoot, { recursive: true });

let state = readJsonFile(stateFile, { version: 4, sites: {}, links: {}, guideInstalled: false });
if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('state.json nemá platný formát');
state.version = 4;
state.sites ||= {};
state.links ||= {};
state.guideInstalled = Boolean(state.guideInstalled);
if (typeof state.sites !== 'object' || Array.isArray(state.sites) || typeof state.links !== 'object' || Array.isArray(state.links)) throw new Error('state.json nemá platný seznam webů');

for (const [id, site] of Object.entries(state.sites)) {
  if (!site || typeof site !== 'object' || !/^[0-9a-f-]{36}$/.test(id)) delete state.sites[id];
  else {
    site.accessMode = ['gateway', 'custom_gateway', 'port'].includes(site.accessMode) ? site.accessMode : Number(site.port) === gatewayPort ? 'gateway' : 'port';
    if (site.accessMode === 'custom_gateway') {
      try { site.customGatewayUrl = normalizeCustomGatewayUrl(site.customGatewayUrl); }
      catch { site.accessMode = 'gateway'; delete site.customGatewayUrl; }
    }
    if (!Number.isInteger(site.port) || site.port < 1024 || site.port > 65535 || site.port === uiPort || site.port === gatewayPort) site.port = nextBackendPort(id);
    site.favorite = Boolean(site.favorite);
    site.favoriteOrder = Number.isInteger(site.favoriteOrder) ? site.favoriteOrder : 999999;
    site.views = Number.isInteger(site.views) ? site.views : 0;
    site.lastViewedAt ||= null;
    site.showOnHome = site.showOnHome !== false;
    site.previewDirty = site.previewDirty !== false;
  }
}
for (const [id, link] of Object.entries(state.links)) {
  if (!link || typeof link !== 'object' || !/^[0-9a-f-]{36}$/.test(id)) delete state.links[id];
  else {
    link.favorite = Boolean(link.favorite);
    link.favoriteOrder = Number.isInteger(link.favoriteOrder) ? link.favoriteOrder : 999999;
    link.views = Number.isInteger(link.views) ? link.views : 0;
    link.lastViewedAt ||= null;
    link.showOnHome = link.showOnHome !== false;
    link.blockAds = link.blockAds !== false;
    link.archives = Array.isArray(link.archives) ? link.archives : [];
  }
}

function saveState() {
  const temp = `${stateFile}.${process.pid}.tmp`;
  const handle = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(handle, JSON.stringify({ version: 4, sites: state.sites, links: state.links, guideInstalled: state.guideInstalled }, null, 2));
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  fs.renameSync(temp, stateFile);
}

saveState();

const runtimes = new Map();

function runtimeFor(id) {
  if (!runtimes.has(id)) {
    runtimes.set(id, {
      status: 'stopped',
      startedAt: null,
      stoppedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      pid: null,
      process: null,
      httpServer: null,
      watcher: null,
      previewTimer: null,
      previewCapturing: false,
      previewAttempts: 0,
      stopping: false,
      logs: [],
      operation: null
    });
  }
  return runtimes.get(id);
}

function appendLog(id, level, text) {
  const runtime = runtimeFor(id);
  const stamp = new Date().toISOString();
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    runtime.logs.push({ at: stamp, level, message: line.slice(0, 4000) });
  }
  if (runtime.logs.length > 600) runtime.logs.splice(0, runtime.logs.length - 600);
}

function chromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return candidates.find(candidate => path.isAbsolute(candidate) && fs.existsSync(candidate)) || null;
}

const chromiumBin = chromiumExecutable();
const adjacentBrowserDownloadDir = path.join(path.dirname(defaultRoot), 'MyBrowser', 'Stazene');
const browserDownloadDir = isAllowedPath(adjacentBrowserDownloadDir) ? adjacentBrowserDownloadDir : path.join(defaultRoot, '_MyBrowser', 'Stazene');
const browser = new ChromiumBrowser({ executable: chromiumBin, dataDir, downloadDir: browserDownloadDir });

function localSiteUrl(site) {
  return usesGateway(site) ? `http://127.0.0.1:${gatewayPort}/${encodeURIComponent(site.slug)}/` : `http://127.0.0.1:${site.port}/`;
}

function scheduleSitePreview(id, delay = 1600) {
  const site = state.sites[id];
  const runtime = runtimeFor(id);
  if (!site || site.coverMime || !chromiumBin || runtime.status !== 'running') return;
  if (!site.previewDirty && fs.existsSync(path.join(sitePreviewDir, `${id}.png`))) return;
  clearTimeout(runtime.previewTimer);
  runtime.previewTimer = setTimeout(() => {
    runtime.previewTimer = null;
    captureSitePreview(id).catch(error => appendLog(id, 'stderr', `Náhled se nepodařilo vytvořit: ${error.message}`));
  }, delay);
  runtime.previewTimer.unref();
}

function markSiteFilesChanged(id, delay = 1600) {
  const site = state.sites[id];
  if (!site) return;
  if (!site.previewDirty) {
    site.previewDirty = true;
    saveState();
  }
  const runtime = runtimeFor(id);
  runtime.previewAttempts = 0;
  scheduleSitePreview(id, delay);
}

function ensureSiteWatcher(id) {
  const site = state.sites[id];
  const runtime = runtimeFor(id);
  if (!site || runtime.watcher || !fs.existsSync(site.path)) return;
  try {
    runtime.watcher = fs.watch(site.path, { recursive: true }, (_event, filename) => {
      if (String(filename || '').endsWith('.uploading')) return;
      markSiteFilesChanged(id);
    });
    runtime.watcher.on('error', error => {
      appendLog(id, 'stderr', `Sledování souborů: ${error.message}`);
      runtime.watcher?.close();
      runtime.watcher = null;
    });
  } catch (error) {
    appendLog(id, 'stderr', `Sledování souborů není dostupné: ${error.message}`);
  }
}

async function captureSitePreview(id) {
  const site = state.sites[id];
  const runtime = runtimeFor(id);
  if (!site || site.coverMime || !chromiumBin || runtime.status !== 'running' || runtime.previewCapturing) return;
  runtime.previewCapturing = true;
  const destination = path.join(sitePreviewDir, `${id}.png`);
  const temp = path.join(sitePreviewDir, `${id}.${crypto.randomUUID()}.png`);
  try {
    await new Promise((resolve, reject) => {
      const args = ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1900,1069', '--virtual-time-budget=5000', `--screenshot=${temp}`, localSiteUrl(site)];
      const child = spawn(chromiumBin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let errors = '';
      child.stderr.on('data', chunk => { if (errors.length < 4000) errors += chunk.toString(); });
      const timeout = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 25000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => {
        clearTimeout(timeout);
        if (code === 0 && fs.existsSync(temp) && fs.statSync(temp).size > 1000) resolve();
        else reject(new Error(errors.trim().split('\n').pop() || `Chromium skončil s kódem ${code}`));
      });
    });
    fs.rmSync(destination, { force: true });
    fs.renameSync(temp, destination);
    site.previewDirty = false;
    site.previewUpdatedAt = new Date().toISOString();
    runtime.previewAttempts = 0;
    saveState();
    appendLog(id, 'system', 'Automatický náhled byl aktualizován (1900 × 1069 px)');
  } catch (error) {
    fs.rmSync(temp, { force: true });
    runtime.previewAttempts += 1;
    if (runtime.previewAttempts < 3) scheduleSitePreview(id, 4000);
    throw error;
  } finally {
    runtime.previewCapturing = false;
  }
}

const remote = new RemoteManager({ dataDir, state, save: saveState, maxArchiveBytes, appendLog });

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'web';
}

function uniqueSlug(value, ignoredId = null) {
  const base = slugify(value);
  let candidate = base;
  let suffix = 2;
  const used = new Set(Object.entries(state.sites).filter(([id]) => id !== ignoredId).map(([, site]) => site.slug));
  while (used.has(candidate)) candidate = `${base.slice(0, 35)}-${suffix++}`;
  return candidate;
}

function managedFolderName(value) {
  const name = String(value || 'Názevwebu')
    .normalize('NFC')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return name || 'Názevwebu';
}

function nextManagedNumber() {
  const names = new Set();
  for (const site of Object.values(state.sites)) {
    if (site.rootMode === 'managed') names.add(path.basename(site.path));
  }
  for (const entry of fs.readdirSync(defaultRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) names.add(entry.name);
  }
  const used = [...names]
    .map(name => /^(\d+)_/.exec(name))
    .filter(Boolean)
    .map(match => Number(match[1]));
  return used.length ? Math.max(...used) + 1 : 1;
}

function suggestedManagedPath(name) {
  const number = String(nextManagedNumber()).padStart(3, '0');
  return path.join(defaultRoot, `${number}_${managedFolderName(name)}`);
}

function resolveManagedDirectory(value, name) {
  const requested = path.resolve(String(value || suggestedManagedPath(name)));
  if (!isInside(defaultRoot, requested) || requested === defaultRoot) {
    throw new Error(`Nová složka musí být uvnitř ${defaultRoot}`);
  }
  const collision = Object.values(state.sites).find(site => path.resolve(site.path) === requested);
  if (collision) throw new Error(`Složku už používá web ${collision.name}`);
  fs.mkdirSync(requested, { recursive: true });
  return requested;
}

function validScript(value, fallback) {
  const script = String(value || fallback || '').trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(script)) throw new Error('Název skriptu obsahuje nepovolené znaky');
  return script;
}

function validatePort(value, ignoredId = null) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port musí být celé číslo od 1024 do 65535');
  if (port === uiPort) throw new Error(`Port ${port} používá správa add-onu`);
  if (port === gatewayPort) throw new Error(`Port ${port} používá veřejná brána MyBrowseru`);
  const collision = Object.entries(state.sites).find(([id, site]) => id !== ignoredId && site.port === port);
  if (collision) throw new Error(`Port ${port} už používá web ${collision[1].name}`);
  return port;
}

function nextBackendPort(ignoredId = null) {
  const used = new Set(Object.entries(state.sites).filter(([id]) => id !== ignoredId).map(([, site]) => Number(site.port)));
  used.add(uiPort);
  used.add(gatewayPort);
  for (let port = 31000; port <= 60999; port++) if (!used.has(port)) return port;
  throw new Error('Není k dispozici žádný interní port pro web');
}

function resolveExistingDirectory(value) {
  const requested = path.resolve(String(value || ''));
  if (!isAllowedPath(requested)) throw new Error(`Složka musí být uvnitř: ${allowedRoots.join(', ')}`);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) throw new Error('Zadaná složka neexistuje nebo není adresář');
  const real = fs.realpathSync(requested);
  const allowedRealRoots = allowedRoots.filter(fs.existsSync).map(root => fs.realpathSync(root));
  if (!allowedRealRoots.some(root => isInside(root, real))) throw new Error('Složka přes symbolický odkaz míří mimo povolené úložiště');
  return requested;
}

function createSite(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Zadejte název webu');
  const runtime = String(body.runtime || 'static');
  if (!allowedRuntimeNames.has(runtime)) throw new Error('Neznámý typ webu');
  const slug = uniqueSlug(body.slug || name);
  const accessMode = ['gateway', 'custom_gateway'].includes(body.accessMode) ? body.accessMode : 'port';
  const rootMode = body.rootMode === 'existing' ? 'existing' : 'managed';
  let rootPath;
  if (rootMode === 'existing') rootPath = resolveExistingDirectory(body.path);
  else rootPath = resolveManagedDirectory(body.path, name);
  const site = {
    name,
    slug,
    runtime,
    accessMode,
    port: usesGateway(accessMode) ? nextBackendPort() : validatePort(body.port),
    customGatewayUrl: accessMode === 'custom_gateway' ? normalizeCustomGatewayUrl(body.customGatewayUrl) : null,
    path: rootPath,
    rootMode,
    script: runtime === 'static' ? '' : validScript(body.script, 'start'),
    buildScript: runtime === 'static' ? '' : validScript(body.buildScript, 'build'),
    autostart: Boolean(body.autostart),
    spaFallback: runtime === 'static' ? body.spaFallback !== false : false,
    favorite: Boolean(body.favorite),
    favoriteOrder: 999999,
    views: 0,
    lastViewedAt: null,
    showOnHome: body.showOnHome !== false,
    previewDirty: true,
    indexFile: 'index.html',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const id = crypto.randomUUID();
  state.sites[id] = site;
  saveState();
  appendLog(id, 'system', `Web byl vytvořen ve složce ${site.path}`);
  ensureSiteWatcher(id);
  return { id, site };
}

function installBundledGuide() {
  if (process.env.DISABLE_BUNDLED_GUIDE === '1' || state.guideInstalled) return null;
  const existing = Object.entries(state.sites).find(([, site]) => site.bundledGuide || site.slug === 'pruvodce-mybrowserem');
  if (existing) {
    existing[1].bundledGuide = true;
    state.guideInstalled = true;
    saveState();
    return existing[0];
  }
  if (!fs.existsSync(path.join(bundledGuideDir, 'index.html'))) throw new Error('V balíčku chybí vestavěný průvodce');
  const result = createSite({
    name: 'Průvodce MyBrowserem',
    slug: 'pruvodce-mybrowserem',
    runtime: 'static',
    accessMode: 'gateway',
    rootMode: 'managed',
    autostart: true,
    spaFallback: true,
    favorite: true
  });
  try {
    fs.cpSync(bundledGuideDir, result.site.path, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(result.site.path, 'icon.png'));
    result.site.bundledGuide = true;
    result.site.updatedAt = new Date().toISOString();
    state.guideInstalled = true;
    saveState();
    markSiteFilesChanged(result.id, 400);
    appendLog(result.id, 'system', 'Vestavěný průvodce byl připraven');
    return result.id;
  } catch (error) {
    runtimeFor(result.id).watcher?.close();
    runtimes.delete(result.id);
    delete state.sites[result.id];
    fs.rmSync(result.site.path, { recursive: true, force: true });
    saveState();
    throw error;
  }
}

function nextFavoriteOrder() {
  const values = [
    ...Object.values(state.sites).filter(item => item.favorite).map(item => item.favoriteOrder),
    ...Object.values(state.links).filter(item => item.favorite).map(item => item.favoriteOrder)
  ].filter(Number.isFinite);
  return values.length ? Math.max(...values) + 1 : 0;
}

function publicLink(id, link) {
  return {
    id,
    kind: 'link',
    name: link.name,
    url: link.url,
    resolvedUrl: link.resolvedUrl || null,
    description: link.description || '',
    favorite: Boolean(link.favorite),
    favoriteOrder: link.favoriteOrder,
    views: link.views || 0,
    lastViewedAt: link.lastViewedAt || null,
    showOnHome: link.showOnHome !== false,
    blockAds: link.blockAds !== false,
    archives: link.archives || [],
    metadataStatus: link.metadataStatus || null,
    metadataError: link.metadataError || null,
    metadataUpdatedAt: link.metadataUpdatedAt || null,
    hasCover: Boolean(link.coverMime),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt
  };
}

async function createLink(body) {
  const url = (await remote.assertPublicUrl(body.url)).href;
  const requestedName = String(body.name || '').trim().slice(0, 100);
  const id = crypto.randomUUID();
  const link = {
    name: requestedName || new URL(url).hostname,
    autoTitle: !requestedName,
    url,
    description: '',
    favorite: Boolean(body.favorite),
    favoriteOrder: body.favorite ? nextFavoriteOrder() : 999999,
    views: 0,
    lastViewedAt: null,
    blockAds: body.blockAds !== false,
    archives: [],
    metadataStatus: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.links[id] = link;
  saveState();
  remote.refreshMetadata(id).catch(error => console.error(`Metadata odkazu ${id}:`, error.message));
  return publicLink(id, link);
}

async function updateLink(id, body) {
  const link = state.links[id];
  if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
  let refresh = false;
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Zadejte název odkazu');
    link.name = name;
    link.autoTitle = false;
  }
  if (body.url !== undefined) {
    const url = (await remote.assertPublicUrl(body.url)).href;
    if (url !== link.url) { link.url = url; link.resolvedUrl = null; refresh = true; }
  }
  if (body.blockAds !== undefined) link.blockAds = Boolean(body.blockAds);
  link.updatedAt = new Date().toISOString();
  saveState();
  if (refresh || body.refreshMetadata) remote.refreshMetadata(id).catch(error => console.error(`Metadata odkazu ${id}:`, error.message));
  return publicLink(id, link);
}

function libraryEntity(kind, id) {
  if (kind === 'site') return state.sites[id] ? { item: state.sites[id], kind } : null;
  if (kind === 'link') return state.links[id] ? { item: state.links[id], kind } : null;
  return null;
}

function updateLibraryItem(kind, id, body) {
  const entity = libraryEntity(kind, id);
  if (!entity) throw httpError(404, 'Položka nebyla nalezena');
  if (body.favorite !== undefined) {
    const favorite = Boolean(body.favorite);
    if (favorite && !entity.item.favorite) entity.item.favoriteOrder = nextFavoriteOrder();
    entity.item.favorite = favorite;
  }
  if (kind === 'link' && body.blockAds !== undefined) entity.item.blockAds = Boolean(body.blockAds);
  if (body.showOnHome !== undefined) entity.item.showOnHome = Boolean(body.showOnHome);
  entity.item.updatedAt = new Date().toISOString();
  saveState();
}

function recordView(kind, id) {
  const entity = libraryEntity(kind, id);
  if (!entity) throw httpError(404, 'Položka nebyla nalezena');
  entity.item.views = (Number(entity.item.views) || 0) + 1;
  entity.item.lastViewedAt = new Date().toISOString();
  saveState();
  return entity.item.views;
}

function reorderFavorites(order) {
  if (!Array.isArray(order)) throw new Error('Pořadí musí být seznam');
  const favorites = [
    ...Object.entries(state.sites).filter(([, item]) => item.favorite).map(([id]) => `site:${id}`),
    ...Object.entries(state.links).filter(([, item]) => item.favorite).map(([id]) => `link:${id}`)
  ];
  const keys = order.map(entry => `${entry.kind}:${entry.id}`);
  if (new Set(keys).size !== keys.length || keys.length !== favorites.length || favorites.some(key => !keys.includes(key))) throw new Error('Pořadí musí obsahovat právě všechny oblíbené položky');
  order.forEach((entry, index) => { libraryEntity(entry.kind, entry.id).item.favoriteOrder = index; });
  saveState();
}

function updateSite(id, body) {
  const site = state.sites[id];
  if (!site) throw httpError(404, 'Web nebyl nalezen');
  const next = { ...site };
  if (body.name !== undefined) {
    next.name = String(body.name || '').trim().slice(0, 80);
    if (!next.name) throw new Error('Zadejte název webu');
  }
  if (body.accessMode !== undefined) {
    if (!['gateway', 'custom_gateway', 'port'].includes(body.accessMode)) throw new Error('Neznámý způsob přístupu k webu');
    if (body.accessMode !== next.accessMode) {
      next.accessMode = body.accessMode;
      if (usesGateway(next.accessMode)) next.port = nextBackendPort(id);
    }
  }
  if (next.accessMode === 'custom_gateway') next.customGatewayUrl = normalizeCustomGatewayUrl(body.customGatewayUrl === undefined ? next.customGatewayUrl : body.customGatewayUrl);
  else next.customGatewayUrl = null;
  if (next.accessMode === 'port' && body.port !== undefined) next.port = validatePort(body.port, id);
  if (body.runtime !== undefined) {
    next.runtime = String(body.runtime);
    if (!allowedRuntimeNames.has(next.runtime)) throw new Error('Neznámý typ webu');
  }
  if (body.path !== undefined && String(body.path) !== site.path) {
    next.path = resolveExistingDirectory(body.path);
    next.rootMode = 'existing';
  }
  if (next.runtime === 'static') {
    next.script = '';
    next.buildScript = '';
    next.spaFallback = body.spaFallback === undefined ? Boolean(site.spaFallback) : Boolean(body.spaFallback);
  } else {
    next.script = validScript(body.script === undefined ? site.script : body.script, 'start');
    next.buildScript = validScript(body.buildScript === undefined ? site.buildScript : body.buildScript, 'build');
    next.spaFallback = false;
  }
  if (body.autostart !== undefined) next.autostart = Boolean(body.autostart);
  next.updatedAt = new Date().toISOString();
  state.sites[id] = next;
  saveState();
  return next;
}

function publicSite(id, site) {
  const runtime = runtimeFor(id);
  return {
    id, kind: 'site',
    ...site,
    hasCover: Boolean(site.coverMime && fs.existsSync(path.join(siteCoverDir, id))),
    hasGeneratedPreview: fs.existsSync(path.join(sitePreviewDir, `${id}.png`)),
    process: {
      status: runtime.status,
      startedAt: runtime.startedAt,
      stoppedAt: runtime.stoppedAt,
      exitCode: runtime.exitCode,
      signal: runtime.signal,
      error: runtime.error,
      pid: runtime.pid,
      operation: runtime.operation ? { ...runtime.operation, child: undefined } : null,
      logCount: runtime.logs.length
    }
  };
}

function executableFor(runtime) {
  if (runtime === 'bun') return 'bun';
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function wireOutput(id, child) {
  child.stdout?.on('data', chunk => appendLog(id, 'stdout', chunk.toString('utf8')));
  child.stderr?.on('data', chunk => appendLog(id, 'stderr', chunk.toString('utf8')));
}

function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? `Port ${port} už používá jiná služba` : error.message)));
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });
}

async function startSite(id, reason = 'ručně') {
  const site = state.sites[id];
  if (!site) throw httpError(404, 'Web nebyl nalezen');
  const runtime = runtimeFor(id);
  if (runtime.operation?.state === 'running') throw new Error('Právě probíhá instalace nebo sestavení');
  if (runtime.status === 'running' || runtime.status === 'starting') return;
  resolveExistingDirectory(site.path);
  runtime.status = 'starting';
  runtime.error = null;
  runtime.exitCode = null;
  runtime.signal = null;
  runtime.stopping = false;
  appendLog(id, 'system', usesGateway(site) ? `Spouštím (${reason}) pod cestou /${site.slug}/` : `Spouštím (${reason}) na portu ${site.port}`);
  try {
    if (site.runtime === 'static' && usesGateway(site)) {
      runtime.status = 'running';
      runtime.startedAt = new Date().toISOString();
      runtime.pid = process.pid;
      appendLog(id, 'system', `Statický web je dostupný přes bránu na /${site.slug}/`);
      ensureSiteWatcher(id);
      scheduleSitePreview(id, 1200);
      return;
    }
    await portIsAvailable(site.port);
    if (site.runtime === 'static') {
      const webServer = http.createServer((req, res) => serveStaticSite(site, req, res));
      runtime.httpServer = webServer;
      webServer.on('error', error => {
        runtime.error = error.message;
        runtime.status = 'failed';
        runtime.httpServer = null;
        appendLog(id, 'stderr', error.message);
      });
      await new Promise((resolve, reject) => {
        webServer.once('error', reject);
        webServer.listen(site.port, '0.0.0.0', () => {
          webServer.removeListener('error', reject);
          resolve();
        });
      });
      runtime.status = 'running';
      runtime.startedAt = new Date().toISOString();
      runtime.pid = process.pid;
      appendLog(id, 'system', `Statický web naslouchá na 0.0.0.0:${site.port}`);
      ensureSiteWatcher(id);
      scheduleSitePreview(id, 1200);
      return;
    }

    const packageFile = path.join(site.path, 'package.json');
    if (!fs.existsSync(packageFile)) throw new Error('Ve složce chybí package.json');
    const child = spawn(executableFor(site.runtime), ['run', site.script], {
      cwd: site.path,
      shell: process.platform === 'win32' && site.runtime === 'npm',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(site.port),
        HOST: usesGateway(site) ? '127.0.0.1' : '0.0.0.0',
        HOSTNAME: usesGateway(site) ? '127.0.0.1' : '0.0.0.0',
        BASE_PATH: usesGateway(site) ? `/${site.slug}/` : '/',
        NODE_ENV: 'production',
        FORCE_COLOR: '0'
      }
    });
    runtime.process = child;
    runtime.pid = child.pid;
    runtime.status = 'running';
    runtime.startedAt = new Date().toISOString();
    wireOutput(id, child);
    child.once('error', error => {
      runtime.error = error.message;
      runtime.status = 'failed';
      appendLog(id, 'stderr', error.message);
    });
    child.once('close', (code, signal) => {
      runtime.process = null;
      runtime.pid = null;
      runtime.exitCode = code;
      runtime.signal = signal;
      runtime.stoppedAt = new Date().toISOString();
      runtime.status = runtime.stopping || code === 0 ? 'stopped' : 'failed';
      if (!runtime.stopping && code !== 0) runtime.error = `Proces skončil s kódem ${code}${signal ? ` (${signal})` : ''}`;
      appendLog(id, runtime.status === 'failed' ? 'stderr' : 'system', `Proces skončil: kód ${code ?? '—'}${signal ? `, signál ${signal}` : ''}`);
      runtime.stopping = false;
    });
    appendLog(id, 'system', `${site.runtime} run ${site.script} byl spuštěn (PID ${child.pid})`);
    ensureSiteWatcher(id);
    scheduleSitePreview(id, 2500);
  } catch (error) {
    runtime.status = 'failed';
    runtime.error = error.message;
    runtime.pid = null;
    runtime.process = null;
    if (runtime.httpServer) {
      try { runtime.httpServer.close(); } catch {}
      runtime.httpServer = null;
    }
    appendLog(id, 'stderr', error.message);
    throw error;
  }
}

async function stopSite(id, reason = 'ručně') {
  const runtime = runtimeFor(id);
  if (!state.sites[id]) throw httpError(404, 'Web nebyl nalezen');
  clearTimeout(runtime.previewTimer);
  runtime.previewTimer = null;
  if (runtime.status === 'stopped') return;
  runtime.stopping = true;
  runtime.status = 'stopping';
  appendLog(id, 'system', `Zastavuji (${reason})`);
  if (runtime.httpServer) {
    const server = runtime.httpServer;
    runtime.httpServer = null;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(resolve => server.close(() => resolve()));
    runtime.status = 'stopped';
    runtime.pid = null;
    runtime.stoppedAt = new Date().toISOString();
    runtime.stopping = false;
    appendLog(id, 'system', 'Statický web byl zastaven');
    return;
  }
  if (runtime.process) {
    const child = runtime.process;
    if (process.platform === 'win32' && child.pid) {
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', resolve);
        killer.once('close', resolve);
      });
      await new Promise(resolve => setTimeout(resolve, 150));
    } else {
      await new Promise(resolve => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; clearTimeout(force); resolve(); } };
        child.once('close', done);
        try { child.kill('SIGTERM'); } catch { done(); }
        const force = setTimeout(() => {
          appendLog(id, 'stderr', 'Proces nereagoval, ukončuji ho násilně');
          try { child.kill('SIGKILL'); } catch {}
          setTimeout(done, 1000).unref();
        }, 8000);
        force.unref();
      });
    }
  }
  runtime.status = 'stopped';
  runtime.pid = null;
  runtime.stoppedAt = new Date().toISOString();
  runtime.stopping = false;
}

async function restartSite(id) {
  await stopSite(id, 'restart');
  await startSite(id, 'restart');
}

function runOperation(id, kind) {
  const site = state.sites[id];
  if (!site) throw httpError(404, 'Web nebyl nalezen');
  if (site.runtime === 'static') throw new Error('Statický web nepotřebuje balíčky ani sestavení');
  const runtime = runtimeFor(id);
  if (runtime.status === 'running' || runtime.status === 'starting' || runtime.status === 'stopping') throw new Error('Před touto akcí web zastavte');
  if (runtime.operation?.state === 'running') throw new Error('Jiná úloha už probíhá');
  resolveExistingDirectory(site.path);
  const executable = executableFor(site.runtime);
  let args;
  if (kind === 'install') {
    if (site.runtime === 'npm') args = [fs.existsSync(path.join(site.path, 'package-lock.json')) ? 'ci' : 'install'];
    else args = ['install'];
  } else if (kind === 'build') args = ['run', site.buildScript];
  else throw new Error('Neznámá úloha');

  const operation = { kind, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null };
  runtime.operation = operation;
  appendLog(id, 'system', `Spouštím: ${executable} ${args.join(' ')}`);
  const child = spawn(executable, args, {
    cwd: site.path,
    shell: process.platform === 'win32' && site.runtime === 'npm',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NODE_ENV: kind === 'build' ? 'production' : (process.env.NODE_ENV || 'production') }
  });
  operation.child = child;
  wireOutput(id, child);
  child.once('error', error => {
    operation.state = 'failed';
    operation.error = error.message;
    operation.finishedAt = new Date().toISOString();
    appendLog(id, 'stderr', error.message);
  });
  child.once('close', code => {
    operation.state = code === 0 ? 'done' : 'failed';
    operation.exitCode = code;
    operation.finishedAt = new Date().toISOString();
    delete operation.child;
    appendLog(id, code === 0 ? 'system' : 'stderr', `${kind === 'install' ? 'Instalace' : 'Sestavení'} skončilo s kódem ${code}`);
  });
  return operation;
}

function normalizedRelative(value, allowEmpty = true) {
  const decoded = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (decoded.includes('\0')) throw new Error('Neplatná cesta');
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) throw new Error('Cesta nesmí obsahovat . ani ..');
  if (parts.some(part => /[\x00-\x1f]/.test(part))) throw new Error('Cesta obsahuje nepovolené řídicí znaky');
  const result = parts.join(path.sep);
  if (!allowEmpty && !result) throw new Error('Kořenovou složku nelze touto akcí použít');
  return result;
}

function safeExisting(site, relative, expected = null) {
  const root = fs.realpathSync(resolveExistingDirectory(site.path));
  const candidate = path.resolve(site.path, normalizedRelative(relative));
  if (!isInside(path.resolve(site.path), candidate) || !fs.existsSync(candidate)) throw httpError(404, 'Soubor nebo složka nebyly nalezeny');
  const real = fs.realpathSync(candidate);
  if (!isInside(root, real)) throw new Error('Cesta míří mimo kořen webu');
  const stat = fs.statSync(real);
  if (expected === 'file' && !stat.isFile()) throw new Error('Cesta není soubor');
  if (expected === 'directory' && !stat.isDirectory()) throw new Error('Cesta není složka');
  return { root, candidate, real, stat };
}

function safeDestination(site, relative) {
  const rootPath = resolveExistingDirectory(site.path);
  const root = fs.realpathSync(rootPath);
  const rel = normalizedRelative(relative, false);
  const candidate = path.resolve(rootPath, rel);
  if (!isInside(path.resolve(rootPath), candidate)) throw new Error('Cesta míří mimo kořen webu');
  let ancestor = path.dirname(candidate);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Nelze určit bezpečnou cílovou složku');
    ancestor = parent;
  }
  if (!isInside(root, fs.realpathSync(ancestor))) throw new Error('Cesta přes symbolický odkaz míří mimo kořen webu');
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  if (!isInside(root, fs.realpathSync(path.dirname(candidate)))) throw new Error('Cílová složka míří mimo kořen webu');
  return candidate;
}

function uploadSessionRoot(id, create = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw httpError(400, 'Neplatná upload relace');
  const root = path.resolve(uploadStageDir, id);
  if (!isInside(uploadStageDir, root) || root === uploadStageDir) throw httpError(400, 'Neplatná upload relace');
  if (create) fs.mkdirSync(root, { recursive: false });
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw httpError(404, 'Upload relace nebyla nalezena');
  return root;
}

function uploadSessionDestination(id, relative) {
  const root = uploadSessionRoot(id);
  const rel = normalizedRelative(relative, false);
  const candidate = path.resolve(root, rel);
  if (!isInside(root, candidate)) throw new Error('Cesta míří mimo upload relaci');
  fs.mkdirSync(path.dirname(candidate), { recursive: true });
  return candidate;
}

function commitUploadSession(id, siteId) {
  const root = uploadSessionRoot(id);
  const site = state.sites[siteId];
  if (!site) throw httpError(404, 'Web nebyl nalezen');
  resolveExistingDirectory(site.path);
  fs.cpSync(root, site.path, {
    recursive: true,
    force: true,
    filter: source => !source.endsWith('.uploading')
  });
  fs.rmSync(root, { recursive: true, force: true });
  appendLog(siteId, 'system', 'Nahrávání na pozadí bylo dokončeno');
  markSiteFilesChanged(siteId, 500);
}

function listFiles(site, relative) {
  const directory = safeExisting(site, relative, 'directory');
  return fs.readdirSync(directory.real, { withFileTypes: true }).map(entry => {
    const full = path.join(directory.real, entry.name);
    const stat = fs.lstatSync(full);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other',
      size: entry.isFile() ? stat.size : null,
      modifiedAt: stat.mtime.toISOString()
    };
  }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'cs') : a.type === 'directory' ? -1 : 1);
}

function simpleFileName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Zadejte platný název bez lomítek');
  return name;
}

function fileOperationEntries(site, paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('Vyberte alespoň jednu položku');
  if (paths.length > 2000) throw new Error('Najednou lze zpracovat nejvýše 2000 položek');
  const normalized = [...new Set(paths.map(value => normalizedRelative(value, false)))];
  return normalized.map(relative => {
    const entry = safeExisting(site, relative);
    return { relative, ...entry, lstat: fs.lstatSync(entry.candidate) };
  });
}

function newFileDestination(site, relative) {
  const destination = safeDestination(site, relative);
  if (fs.existsSync(destination)) throw new Error(`Cílová položka už existuje: ${normalizedRelative(relative)}`);
  return destination;
}

function runFileOperation(id, body) {
  const site = state.sites[id];
  if (!site) throw httpError(404, 'Web nebyl nalezen');
  const action = String(body.action || '');
  if (action === 'mkdir') {
    const relative = normalizedRelative(body.path, false);
    const destination = newFileDestination(site, relative);
    fs.mkdirSync(destination, { recursive: false });
    appendLog(id, 'system', `Vytvořena složka: ${relative}`);
    markSiteFilesChanged(id);
    return { ok: true, affected: 1 };
  }
  if (action === 'rename') {
    const source = safeExisting(site, normalizedRelative(body.path, false));
    const name = simpleFileName(body.name);
    const relative = path.join(path.dirname(normalizedRelative(body.path, false)), name);
    const destination = newFileDestination(site, relative);
    fs.renameSync(source.candidate, destination);
    appendLog(id, 'system', `Přejmenováno: ${normalizedRelative(body.path, false)} → ${relative}`);
    markSiteFilesChanged(id);
    return { ok: true, affected: 1, path: relative.replace(/\\/g, '/') };
  }
  if (action === 'delete') {
    const entries = fileOperationEntries(site, body.paths).sort((a, b) => b.relative.length - a.relative.length);
    for (const entry of entries) fs.rmSync(entry.candidate, { recursive: true, force: false });
    appendLog(id, 'system', `Hromadně odstraněno: ${entries.length} položek`);
    markSiteFilesChanged(id);
    return { ok: true, affected: entries.length };
  }
  if (action === 'move' || action === 'copy') {
    const entries = fileOperationEntries(site, body.paths);
    for (const parent of entries.filter(entry => entry.lstat.isDirectory())) {
      if (entries.some(entry => entry !== parent && isInside(parent.real, entry.real))) throw new Error('Nelze současně zpracovat složku i položku uvnitř ní');
    }
    const destinationDirectory = safeExisting(site, normalizedRelative(body.destination || ''), 'directory');
    const targets = entries.map(entry => {
      if (entry.lstat.isDirectory() && isInside(entry.real, destinationDirectory.real)) throw new Error('Složku nelze vložit do ní samotné ani do její podsložky');
      const relative = path.join(normalizedRelative(body.destination || ''), path.basename(entry.relative));
      const target = newFileDestination(site, relative);
      return { entry, relative, target };
    });
    const uniqueTargets = new Set(targets.map(item => path.resolve(item.target)));
    if (uniqueTargets.size !== targets.length) throw new Error('Vybrané položky mají v cíli stejný název');
    for (const item of targets) {
      if (action === 'copy') fs.cpSync(item.entry.candidate, item.target, { recursive: item.entry.lstat.isDirectory(), errorOnExist: true, force: false });
      else {
        try { fs.renameSync(item.entry.candidate, item.target); }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          fs.cpSync(item.entry.candidate, item.target, { recursive: item.entry.lstat.isDirectory(), errorOnExist: true, force: false });
          fs.rmSync(item.entry.candidate, { recursive: true, force: false });
        }
      }
    }
    appendLog(id, 'system', `${action === 'copy' ? 'Zkopírováno' : 'Přesunuto'}: ${entries.length} položek do ${normalizedRelative(body.destination || '').replace(/\\/g, '/') || 'kořene'}`);
    markSiteFilesChanged(id);
    return { ok: true, affected: entries.length };
  }
  throw new Error('Neznámá souborová operace');
}

async function receiveUpload(req, destination) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxUploadBytes) throw httpError(413, `Soubor překračuje limit ${Math.round(maxUploadBytes / 1024 / 1024)} MB`);
  const temp = `${destination}.${crypto.randomUUID()}.uploading`;
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > maxUploadBytes ? httpError(413, 'Soubor je příliš velký') : null, chunk);
    }
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o644 }));
    fs.renameSync(temp, destination);
    return size;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

async function receiveUploadChunk(req, destination, uploadId, offset, total) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw httpError(400, 'Neplatný identifikátor nahrávání');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total) || total < 0 || offset > total) throw httpError(400, 'Neplatný rozsah nahrávání');
  if (total > maxUploadBytes) throw httpError(413, `Soubor překračuje limit ${Math.round(maxUploadBytes / 1024 / 1024)} MB`);
  const declared = Number(req.headers['content-length'] || 0);
  const maxChunkBytes = Math.min(maxUploadBytes, 8 * 1024 * 1024);
  if (!Number.isFinite(declared) || declared < 0 || declared > maxChunkBytes || offset + declared > total) throw httpError(413, 'Část souboru je příliš velká');
  const temp = `${destination}.${uploadId}.uploading`;
  if (offset > 0 && !fs.existsSync(temp)) {
    if (fs.existsSync(destination) && fs.statSync(destination).size === total && offset + declared === total) {
      for await (const _chunk of req) { /* dokončená část byla potvrzena až po přerušení spojení */ }
      return { bytes: 0, received: total, total, complete: true, replayed: true };
    }
    throw httpError(409, 'Nahrávání nelze navázat; zkuste soubor nahrát znovu');
  }
  if (offset === 0) fs.rmSync(temp, { force: true });
  const current = fs.existsSync(temp) ? fs.statSync(temp).size : 0;
  if (current < offset) throw httpError(409, 'Části souboru dorazily v nesprávném pořadí');
  if (current > offset) fs.truncateSync(temp, offset);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > maxChunkBytes || offset + size > total ? httpError(413, 'Část souboru je příliš velká') : null, chunk);
    }
  });
  try {
    const stream = fs.createWriteStream(temp, offset === 0 ? { flags: 'w', mode: 0o644 } : { flags: 'r+', start: offset, mode: 0o644 });
    await pipeline(req, limiter, stream);
    const received = offset + size;
    const complete = received === total;
    if (complete) {
      fs.rmSync(destination, { force: true });
      fs.renameSync(temp, destination);
    }
    return { bytes: size, received, total, complete };
  } catch (error) {
    if (offset === 0) fs.rmSync(temp, { force: true });
    else if (fs.existsSync(temp)) fs.truncateSync(temp, offset);
    throw error;
  }
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm'
};

async function serveStaticSite(site, req, res) {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    let relative;
    try { relative = normalizedRelative(decodeURIComponent(url.pathname)); }
    catch { throw httpError(400, 'Neplatná URL'); }
    let candidate = path.resolve(site.path, relative);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, site.indexFile || 'index.html');
    let found = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    if (!found && site.spaFallback && String(req.headers.accept || '').includes('text/html')) {
      candidate = path.join(site.path, site.indexFile || 'index.html');
      found = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    }
    if (!found) throw httpError(404, 'Nenalezeno');
    const root = fs.realpathSync(site.path);
    const real = fs.realpathSync(candidate);
    if (!isInside(root, real)) throw httpError(403, 'Přístup mimo složku webu je zakázán');
    const stat = fs.statSync(real);
    const headers = {
      'content-type': mimeTypes[path.extname(real).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const code = error.statusCode || 500;
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(code === 404 ? '404 – stránka nebyla nalezena' : error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function gatewayTarget(pathname) {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  let slug;
  try { slug = decodeURIComponent(match[1]); } catch { return null; }
  const entry = Object.entries(state.sites).find(([, site]) => usesGateway(site) && site.slug === slug);
  return entry ? { id: entry[0], site: entry[1], prefix: `/${entry[1].slug}`, remainder: match[2] || '' } : null;
}

function gatewayIndex(res) {
  const sites = Object.entries(state.sites).filter(([, site]) => usesGateway(site));
  const rows = sites.map(([id, site]) => {
    const running = runtimeFor(id).status === 'running';
    return `<li><a href="/${encodeURIComponent(site.slug)}/">${escapeHtml(site.name)}</a> <small>${running ? 'běží' : 'zastaven'}</small></li>`;
  }).join('');
  const body = Buffer.from(`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MyBrowser</title><style>body{margin:0;background:#17181b;color:#f7f7f8;font:16px system-ui;padding:48px}main{max-width:760px;margin:auto}a{color:#5db8f4}li{margin:14px 0}small{color:#aeb2bc}</style><main><h1>MyBrowser</h1><p>Weby dostupné přes veřejnou bránu:</p><ul>${rows || '<li>Zatím tu není žádný web.</li>'}</ul></main></html>`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function proxyGatewayRequest(target, req, res, forwardedPath) {
  const headers = { ...req.headers, host: `127.0.0.1:${target.site.port}`, 'x-forwarded-prefix': `${target.prefix}/`, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': 'http' };
  delete headers.connection;
  delete headers.upgrade;
  const upstream = http.request({ hostname: '127.0.0.1', port: target.site.port, method: req.method, path: forwardedPath, headers }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers };
    if (typeof responseHeaders.location === 'string' && responseHeaders.location.startsWith('/')) responseHeaders.location = `${target.prefix}${responseHeaders.location}`;
    if (Array.isArray(responseHeaders['set-cookie'])) responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map(cookie => cookie.replace(/Path=\/(?![^;])/i, `Path=${target.prefix}/`));
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', error => {
    if (res.headersSent) return res.destroy(error);
    const body = Buffer.from(`Web ${target.site.name} není momentálně dostupný.`);
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
    res.end(body);
  });
  req.pipe(upstream);
}

async function serveGateway(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') return gatewayIndex(res);
  const target = gatewayTarget(url.pathname);
  if (!target) {
    const body = Buffer.from('404 – web nebyl nalezen');
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
    return res.end(body);
  }
  if (!target.remainder) {
    res.writeHead(308, { location: `${target.prefix}/${url.search}`, 'cache-control': 'no-store' });
    return res.end();
  }
  if (runtimeFor(target.id).status !== 'running') {
    const body = Buffer.from(`Web ${target.site.name} je zastaven.`);
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
    return res.end(body);
  }
  const forwardedPath = `${target.remainder || '/'}${url.search}`;
  if (target.site.runtime === 'static') {
    const originalUrl = req.url;
    req.url = forwardedPath;
    try { return await serveStaticSite(target.site, req, res); }
    finally { req.url = originalUrl; }
  }
  return proxyGatewayRequest(target, req, res, forwardedPath);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function readJson(req, maximum = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw httpError(413, 'Požadavek je příliš velký');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'Neplatná JSON data'); }
}

function isUiRequestAllowed(req) {
  const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (process.env.ALLOW_LOCAL_UI === '1' && ['127.0.0.1', '::1'].includes(address)) return true;
  const proxies = String(process.env.INGRESS_PROXY_IPS || '172.30.32.2').split(',').map(value => value.trim());
  return proxies.includes(address);
}

function toolVersion(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
    return result.status === 0 ? String(result.stdout || result.stderr).trim().split(/\s+/)[0] : null;
  } catch { return null; }
}

const versions = { node: process.version.replace(/^v/, ''), npm: toolVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm'), bun: toolVersion('bun') };
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'icon.png')).toString('base64')}`;
const ui = Buffer.from(fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8').replace('__MYBROWSER_ICON_DATA__', iconDataUrl));
const viewer = fs.readFileSync(path.join(__dirname, 'viewer.html'));
const brandAssets = new Map([
  ['/api/assets/icon.png', path.join(__dirname, 'icon.png')],
  ['/api/assets/logo.png', path.join(__dirname, 'logo.png')],
  ['/api/assets/sidebar-icon.png', path.join(__dirname, 'sidebar-icon.png')]
]);

function routeFromPathname(value) {
  if (/\/viewer\/?$/.test(value)) return '/viewer';
  if (/\/api\/hassio_ingress\/[^/]+\/?$/.test(value)) return '/';
  const markers = ['/api/', '/view/', '/browse/', '/offline/'];
  let position = -1;
  for (const marker of markers) position = Math.max(position, value.lastIndexOf(marker));
  if (position >= 0) return value.slice(position).replace(/\/+$/, '') || '/';
  return value.replace(/\/+$/, '') || '/';
}

function serveLocalFile(res, file, extraHeaders = {}) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  fs.createReadStream(file).pipe(res);
}

const uiServer = http.createServer(async (req, res) => {
  try {
    if (!isUiRequestAllowed(req)) return sendJson(res, 403, { error: 'Správa je dostupná pouze přes Home Assistant Ingress' });
    const url = new URL(req.url, 'http://localhost');
    const route = routeFromPathname(url.pathname);

    const embeddedSiteRoute = /^\/api\/gateway\/([^/]+)(\/.*)?$/.exec(route);
    if (embeddedSiteRoute) {
      let slug;
      try { slug = decodeURIComponent(embeddedSiteRoute[1]); } catch { throw httpError(400, 'Neplatná adresa webu'); }
      const entry = Object.entries(state.sites).find(([, site]) => site.slug === slug);
      if (!entry) throw httpError(404, 'Web nebyl nalezen');
      const [id, site] = entry;
      if (runtimeFor(id).status !== 'running') throw httpError(503, `Web ${site.name} je zastaven`);
      const marker = url.pathname.lastIndexOf('/api/gateway/');
      const actualPrefix = `${url.pathname.slice(0, marker)}/api/gateway/${encodeURIComponent(site.slug)}`;
      const target = { id, site, prefix: actualPrefix, remainder: embeddedSiteRoute[2] || '/' };
      const forwardedPath = `${target.remainder}${url.search}`;
      if (site.runtime === 'static') {
        const originalUrl = req.url;
        req.url = forwardedPath;
        try { return await serveStaticSite(site, req, res); }
        finally { req.url = originalUrl; }
      }
      return proxyGatewayRequest(target, req, res, forwardedPath);
    }

    if (req.method === 'GET' && brandAssets.has(route)) {
      return serveLocalFile(res, brandAssets.get(route), { 'cache-control': 'public, max-age=86400' });
    }

    const liveView = /^\/view\/([0-9a-f-]{36})$/.exec(route);
    if (req.method === 'GET' && liveView) {
      const result = await remote.proxy(liveView[1], url.searchParams.get('url') || null, false);
      const headers = {
        'content-type': result.contentType,
        'content-length': result.body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      };
      if (result.html) headers['content-security-policy'] = "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src * data: blob:";
      res.writeHead(result.status || 200, headers);
      return res.end(result.body);
    }
    const liveResource = /^\/view\/([0-9a-f-]{36})\/resource$/.exec(route);
    if (req.method === 'GET' && liveResource) {
      const target = url.searchParams.get('url');
      if (!target) throw new Error('Chybí adresa vzdáleného souboru');
      const result = await remote.proxy(liveResource[1], target, true);
      res.writeHead(result.status || 200, {
        'content-type': result.contentType,
        'content-length': result.body.length,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        ...(result.html ? { 'content-security-policy': "sandbox allow-scripts allow-forms allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'" } : {})
      });
      return res.end(result.body);
    }
    if (req.method === 'GET' && route === '/browse') {
      const target = url.searchParams.get('url');
      if (!target) throw new Error('Chybí adresa webu');
      const result = await remote.proxyUrl(target, false, true);
      const headers = {
        'content-type': result.contentType,
        'content-length': result.body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      };
      if (result.html) headers['content-security-policy'] = "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src * data: blob:";
      res.writeHead(result.status || 200, headers);
      return res.end(result.body);
    }
    if (req.method === 'GET' && route === '/browse/resource') {
      const target = url.searchParams.get('url');
      if (!target) throw new Error('Chybí adresa vzdáleného souboru');
      const result = await remote.proxyUrl(target, true, true);
      res.writeHead(result.status || 200, {
        'content-type': result.contentType,
        'content-length': result.body.length,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff'
      });
      return res.end(result.body);
    }
    const offlineRoute = /^\/offline\/([0-9a-f-]{36})\/([a-z0-9-]+)(?:\/(.*))?$/.exec(route);
    if (req.method === 'GET' && offlineRoute) {
      const file = remote.offlineFile(offlineRoute[1], offlineRoute[2], offlineRoute[3] || 'index.html');
      return serveLocalFile(res, file, path.basename(file) === 'index.html' ? {
        'cache-control': 'no-store',
        'content-security-policy': "sandbox allow-scripts allow-forms allow-popups allow-downloads; default-src 'self' data:; img-src 'self' data:; media-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; frame-src 'none'"
      } : {});
    }
    if (req.method === 'GET' && route === '/viewer') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'content-length': viewer.length, 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:"
      });
      return res.end(viewer);
    }

    if (req.method === 'GET' && (route === '/' || (!route.startsWith('/api/') && !route.startsWith('/view/') && !route.startsWith('/offline/')))) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': ui.length,
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob: http: https:; connect-src 'self'; frame-src 'self' http: https:; frame-ancestors 'self'"
      });
      return res.end(ui);
    }

    if (req.method === 'GET' && route === '/api/state') {
      return sendJson(res, 200, {
        sites: Object.entries(state.sites).map(([id, site]) => publicSite(id, site)),
        links: Object.entries(state.links).map(([id, link]) => publicLink(id, link)),
        settings: {
          defaultRoot,
          nextManagedPath: suggestedManagedPath('Názevwebu'),
          allowedRoots,
          startupDelay,
          maxUploadMb: Math.round(maxUploadBytes / 1024 / 1024),
          maxArchiveMb: Math.round(maxArchiveBytes / 1024 / 1024),
          uiPort,
          gatewayPort,
          automaticPreviews: Boolean(chromiumBin),
          chromiumBrowser: browser.available,
          browserDownloadDir,
          versions
        }
      });
    }

    if (req.method === 'POST' && route === '/api/browser/sessions') {
      const body = await readJson(req);
      let target = body.url;
      if (body.siteId) {
        const site = state.sites[String(body.siteId)];
        if (!site) throw httpError(404, 'Web nebyl nalezen');
        if (runtimeFor(String(body.siteId)).status !== 'running') throw httpError(503, `Web ${site.name} je zastaven`);
        target = localSiteUrl(site);
      }
      return sendJson(res, 201, await browser.create({
        url: target, width: body.width, height: body.height, blockAds: body.blockAds
      }));
    }
    const browserSessionRoute = /^\/api\/browser\/sessions\/([0-9a-f-]{36})$/.exec(route);
    if (browserSessionRoute && req.method === 'GET') return sendJson(res, 200, await browser.state(browserSessionRoute[1]));
    if (browserSessionRoute && req.method === 'PATCH') {
      const body = await readJson(req);
      return sendJson(res, 200, await browser.resize(browserSessionRoute[1], body.width, body.height));
    }
    if (browserSessionRoute && req.method === 'DELETE') {
      await browser.closeSession(browserSessionRoute[1]);
      return sendJson(res, 200, { ok: true });
    }
    const browserFrameRoute = /^\/api\/browser\/sessions\/([0-9a-f-]{36})\/frame$/.exec(route);
    if (browserFrameRoute && req.method === 'GET') {
      const frame = await browser.frame(browserFrameRoute[1], url.searchParams.get('after'), url.searchParams.get('wait'));
      if (!frame) { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
      res.writeHead(200, {
        'content-type': 'image/jpeg', 'content-length': frame.body.length, 'cache-control': 'no-store',
        'x-frame-sequence': String(frame.sequence), 'x-content-type-options': 'nosniff'
      });
      return res.end(frame.body);
    }
    const browserActionRoute = /^\/api\/browser\/sessions\/([0-9a-f-]{36})\/(navigate|back|forward|reload|input|dialog)$/.exec(route);
    if (browserActionRoute && req.method === 'POST') {
      const [id, action] = browserActionRoute.slice(1);
      const body = await readJson(req);
      if (action === 'navigate') return sendJson(res, 200, await browser.navigate(id, body.url));
      if (action === 'back' || action === 'forward') return sendJson(res, 200, await browser.history(id, action));
      if (action === 'reload') return sendJson(res, 200, await browser.reload(id));
      if (action === 'input') return sendJson(res, 200, await browser.input(id, body));
      return sendJson(res, 200, await browser.dialog(id, body.accept, body.promptText));
    }
    const browserFilesRoute = /^\/api\/browser\/sessions\/([0-9a-f-]{36})\/files$/.exec(route);
    if (browserFilesRoute && req.method === 'PUT') {
      const destination = browser.stageDestination(browserFilesRoute[1], url.searchParams.get('name'));
      const bytes = await receiveUpload(req, destination);
      return sendJson(res, 201, { ok: true, name: path.basename(destination), bytes });
    }
    if (browserFilesRoute && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 200, await browser.chooseFiles(browserFilesRoute[1], body.files));
    }

    if (req.method === 'POST' && route === '/api/upload-sessions') {
      const id = crypto.randomUUID();
      uploadSessionRoot(id, true);
      return sendJson(res, 201, { id });
    }
    const uploadSessionFilesRoute = /^\/api\/upload-sessions\/([0-9a-f-]{36})\/files$/.exec(route);
    if (uploadSessionFilesRoute && req.method === 'PUT') {
      const relative = url.searchParams.get('path') || '';
      const destination = uploadSessionDestination(uploadSessionFilesRoute[1], relative);
      const uploadId = url.searchParams.get('upload');
      if (uploadId) {
        const result = await receiveUploadChunk(req, destination, uploadId, Number(url.searchParams.get('offset')), Number(url.searchParams.get('total')));
        return sendJson(res, result.complete ? 201 : 202, { ok: true, ...result });
      }
      const bytes = await receiveUpload(req, destination);
      return sendJson(res, 201, { ok: true, bytes });
    }
    const uploadSessionRoute = /^\/api\/upload-sessions\/([0-9a-f-]{36})$/.exec(route);
    if (uploadSessionRoute && req.method === 'POST') {
      const body = await readJson(req);
      commitUploadSession(uploadSessionRoute[1], String(body.siteId || ''));
      return sendJson(res, 200, { ok: true });
    }
    if (uploadSessionRoute && req.method === 'DELETE') {
      const root = uploadSessionRoot(uploadSessionRoute[1]);
      fs.rmSync(root, { recursive: true, force: true });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && route === '/api/links') {
      return sendJson(res, 201, await createLink(await readJson(req)));
    }
    const linkRoute = /^\/api\/links\/([0-9a-f-]{36})$/.exec(route);
    if (linkRoute && req.method === 'PUT') return sendJson(res, 200, await updateLink(linkRoute[1], await readJson(req)));
    if (linkRoute && req.method === 'DELETE') {
      const id = linkRoute[1];
      const link = state.links[id];
      if (!link) throw httpError(404, 'Odkaz nebyl nalezen');
      if ((link.archives || []).some(item => item.status === 'downloading')) throw new Error('Odkaz nelze odebrat během stahování offline verze');
      remote.deleteLinkData(id);
      delete state.links[id];
      saveState();
      return sendJson(res, 200, { ok: true });
    }
    const metadataRoute = /^\/api\/links\/([0-9a-f-]{36})\/metadata$/.exec(route);
    if (metadataRoute && req.method === 'POST') {
      remote.refreshMetadata(metadataRoute[1]).catch(error => console.error(error));
      return sendJson(res, 202, { ok: true });
    }
    const coverRoute = /^\/api\/links\/([0-9a-f-]{36})\/cover$/.exec(route);
    if (coverRoute && req.method === 'GET') {
      const cover = remote.coverFor(coverRoute[1]);
      if (!cover) throw httpError(404, 'Náhled není dostupný');
      const stat = fs.statSync(cover.file);
      res.writeHead(200, { 'content-type': cover.mime, 'content-length': stat.size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(cover.file).pipe(res);
    }
    const archiveRoute = /^\/api\/links\/([0-9a-f-]{36})\/archives$/.exec(route);
    if (archiveRoute && req.method === 'POST') return sendJson(res, 202, { archive: remote.startArchive(archiveRoute[1]) });
    const archiveItemRoute = /^\/api\/links\/([0-9a-f-]{36})\/archives\/([a-z0-9-]+)$/.exec(route);
    if (archiveItemRoute && req.method === 'DELETE') {
      remote.deleteArchive(archiveItemRoute[1], archiveItemRoute[2]);
      return sendJson(res, 200, { ok: true });
    }

    const libraryItemRoute = /^\/api\/library\/(site|link)\/([0-9a-f-]{36})$/.exec(route);
    if (libraryItemRoute && req.method === 'PATCH') {
      updateLibraryItem(libraryItemRoute[1], libraryItemRoute[2], await readJson(req));
      const entity = libraryEntity(libraryItemRoute[1], libraryItemRoute[2]);
      return sendJson(res, 200, libraryItemRoute[1] === 'site' ? publicSite(libraryItemRoute[2], entity.item) : publicLink(libraryItemRoute[2], entity.item));
    }
    const viewRoute = /^\/api\/library\/(site|link)\/([0-9a-f-]{36})\/view$/.exec(route);
    if (viewRoute && req.method === 'POST') return sendJson(res, 200, { views: recordView(viewRoute[1], viewRoute[2]) });
    if (req.method === 'PUT' && route === '/api/library/favorites') {
      reorderFavorites((await readJson(req)).order);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && route === '/api/sites') {
      const result = createSite(await readJson(req));
      return sendJson(res, 201, publicSite(result.id, result.site));
    }

    const siteRoute = /^\/api\/sites\/([0-9a-f-]{36})$/.exec(route);
    if (siteRoute && req.method === 'PUT') {
      const id = siteRoute[1];
      const runtime = runtimeFor(id);
      const wasRunning = ['running', 'starting'].includes(runtime.status);
      const before = state.sites[id] ? { ...state.sites[id] } : null;
      const next = updateSite(id, await readJson(req));
      const changedForPreview = before && (before.runtime !== next.runtime || before.path !== next.path || before.accessMode !== next.accessMode || before.port !== next.port);
      const needsRestart = before && wasRunning && (before.port !== next.port || before.accessMode !== next.accessMode || before.runtime !== next.runtime || before.path !== next.path || before.script !== next.script || before.spaFallback !== next.spaFallback);
      if (before?.path !== next.path) {
        const runtime = runtimeFor(id);
        runtime.watcher?.close();
        runtime.watcher = null;
        ensureSiteWatcher(id);
      }
      if (changedForPreview) markSiteFilesChanged(id, 2200);
      if (needsRestart) await restartSite(id);
      return sendJson(res, 200, publicSite(id, next));
    }
    if (siteRoute && req.method === 'DELETE') {
      const id = siteRoute[1];
      const site = state.sites[id];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      await stopSite(id, 'odebrání');
      const deleteFiles = url.searchParams.get('deleteFiles') === '1';
      if (deleteFiles) {
        if (site.rootMode !== 'managed') throw new Error('Soubory odkazované existující složky se z bezpečnostních důvodů nemažou');
        const managed = path.resolve(site.path);
        if (!isInside(defaultRoot, managed) || managed === defaultRoot) throw new Error('Složka není bezpečná pro odstranění');
        fs.rmSync(managed, { recursive: true, force: true });
      }
      fs.rmSync(path.join(siteCoverDir, id), { force: true });
      fs.rmSync(path.join(sitePreviewDir, `${id}.png`), { force: true });
      const runtime = runtimeFor(id);
      runtime.watcher?.close();
      clearTimeout(runtime.previewTimer);
      delete state.sites[id];
      runtimes.delete(id);
      saveState();
      return sendJson(res, 200, { ok: true, filesDeleted: deleteFiles });
    }

    const siteCoverRoute = /^\/api\/sites\/([0-9a-f-]{36})\/cover$/.exec(route);
    const sitePreviewRoute = /^\/api\/sites\/([0-9a-f-]{36})\/preview$/.exec(route);
    if (sitePreviewRoute && req.method === 'GET') {
      const id = sitePreviewRoute[1];
      const file = path.join(sitePreviewDir, `${id}.png`);
      if (!state.sites[id] || !fs.existsSync(file)) throw httpError(404, 'Automatický náhled není dostupný');
      const stat = fs.statSync(file);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': stat.size, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (siteCoverRoute && req.method === 'GET') {
      const id = siteCoverRoute[1];
      const site = state.sites[id];
      const file = path.join(siteCoverDir, id);
      if (!site || !site.coverMime || !fs.existsSync(file)) throw httpError(404, 'Úvodní obrázek není dostupný');
      const stat = fs.statSync(file);
      res.writeHead(200, { 'content-type': site.coverMime, 'content-length': stat.size, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(file).pipe(res);
    }
    if (siteCoverRoute && req.method === 'PUT') {
      const id = siteCoverRoute[1];
      const site = state.sites[id];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']).has(mime)) throw httpError(415, 'Úvodní obrázek musí být JPG, PNG, WebP, GIF nebo AVIF');
      const bytes = await receiveUpload(req, path.join(siteCoverDir, id));
      site.coverMime = mime;
      site.coverUpdatedAt = new Date().toISOString();
      site.updatedAt = site.coverUpdatedAt;
      saveState();
      appendLog(id, 'system', `Nahrán úvodní obrázek (${bytes} B)`);
      return sendJson(res, 201, { ok: true, bytes, hasCover: true });
    }
    if (siteCoverRoute && req.method === 'DELETE') {
      const id = siteCoverRoute[1];
      const site = state.sites[id];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      fs.rmSync(path.join(siteCoverDir, id), { force: true });
      delete site.coverMime;
      delete site.coverUpdatedAt;
      site.updatedAt = new Date().toISOString();
      saveState();
      scheduleSitePreview(id, 200);
      return sendJson(res, 200, { ok: true });
    }

    const actionRoute = /^\/api\/sites\/([0-9a-f-]{36})\/action$/.exec(route);
    if (actionRoute && req.method === 'POST') {
      const id = actionRoute[1];
      const body = await readJson(req);
      if (body.action === 'start') await startSite(id);
      else if (body.action === 'stop') await stopSite(id);
      else if (body.action === 'restart') await restartSite(id);
      else if (body.action === 'install' || body.action === 'build') runOperation(id, body.action);
      else throw new Error('Neznámá akce');
      return sendJson(res, 202, { ok: true, site: publicSite(id, state.sites[id]) });
    }

    const logsRoute = /^\/api\/sites\/([0-9a-f-]{36})\/logs$/.exec(route);
    if (logsRoute && req.method === 'GET') {
      if (!state.sites[logsRoute[1]]) throw httpError(404, 'Web nebyl nalezen');
      return sendJson(res, 200, { logs: runtimeFor(logsRoute[1]).logs });
    }
    if (logsRoute && req.method === 'DELETE') {
      if (!state.sites[logsRoute[1]]) throw httpError(404, 'Web nebyl nalezen');
      runtimeFor(logsRoute[1]).logs = [];
      return sendJson(res, 200, { ok: true });
    }

    const filesRoute = /^\/api\/sites\/([0-9a-f-]{36})\/files$/.exec(route);
    if (filesRoute && req.method === 'GET') {
      const site = state.sites[filesRoute[1]];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      const relative = url.searchParams.get('path') || '';
      if (url.searchParams.get('download') === '1') {
        const file = safeExisting(site, relative, 'file');
        res.writeHead(200, {
          'content-type': mimeTypes[path.extname(file.real).toLowerCase()] || 'application/octet-stream',
          'content-length': file.stat.size,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.candidate)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff'
        });
        return fs.createReadStream(file.real).pipe(res);
      }
      return sendJson(res, 200, { path: normalizedRelative(relative).replace(/\\/g, '/'), entries: listFiles(site, relative) });
    }
    if (filesRoute && req.method === 'POST') {
      return sendJson(res, 200, runFileOperation(filesRoute[1], await readJson(req)));
    }
    if (filesRoute && req.method === 'PUT') {
      const id = filesRoute[1];
      const site = state.sites[id];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      const relative = url.searchParams.get('path') || '';
      const destination = safeDestination(site, relative);
      const uploadId = url.searchParams.get('upload');
      if (uploadId) {
        const result = await receiveUploadChunk(req, destination, uploadId, Number(url.searchParams.get('offset')), Number(url.searchParams.get('total')));
        if (result.complete) {
          appendLog(id, 'system', `Nahrán soubor ${normalizedRelative(relative)} (${result.total} B po částech)`);
          markSiteFilesChanged(id);
        }
        return sendJson(res, result.complete ? 201 : 202, { ok: true, ...result });
      }
      const bytes = await receiveUpload(req, destination);
      appendLog(id, 'system', `Nahrán soubor ${normalizedRelative(relative)} (${bytes} B)`);
      markSiteFilesChanged(id);
      return sendJson(res, 201, { ok: true, bytes });
    }
    if (filesRoute && req.method === 'DELETE') {
      const id = filesRoute[1];
      const site = state.sites[id];
      if (!site) throw httpError(404, 'Web nebyl nalezen');
      const relative = normalizedRelative(url.searchParams.get('path') || '', false);
      const target = path.resolve(site.path, relative);
      if (!isInside(path.resolve(site.path), target)) throw new Error('Cesta míří mimo kořen webu');
      const parent = fs.realpathSync(path.dirname(target));
      const root = fs.realpathSync(site.path);
      if (!isInside(root, parent)) throw new Error('Cesta míří mimo kořen webu');
      fs.rmSync(target, { recursive: true, force: false });
      appendLog(id, 'system', `Odstraněno: ${relative}`);
      markSiteFilesChanged(id);
      return sendJson(res, 200, { ok: true });
    }

    throw httpError(404, 'Neznámý požadavek');
  } catch (error) {
    console.error(error);
    if (res.headersSent) res.destroy();
    else sendJson(res, error.statusCode || 400, { error: error.message });
  }
});

const gatewayServer = http.createServer((req, res) => {
  serveGateway(req, res).catch(error => {
    console.error('Chyba veřejné brány:', error);
    if (res.headersSent) res.destroy(error);
    else {
      const body = Buffer.from(error.message || 'Chyba veřejné brány');
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    }
  });
});

try {
  const guideId = installBundledGuide();
  if (guideId) console.log('Vestavěný průvodce MyBrowserem byl přidán do knihovny');
} catch (error) {
  console.error(`Vestavěný průvodce se nepodařilo připravit: ${error.message}`);
}

gatewayServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const target = gatewayTarget(url.pathname);
  if (!target || target.site.runtime === 'static' || runtimeFor(target.id).status !== 'running') return socket.destroy();
  const forwardedPath = `${target.remainder || '/'}${url.search}`;
  const upstream = net.connect(target.site.port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${target.site.port}`, 'x-forwarded-prefix': `${target.prefix}/`, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': 'http' };
    const lines = [`${req.method} ${forwardedPath} HTTP/${req.httpVersion}`];
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
      else if (value !== undefined) lines.push(`${name}: ${value}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

gatewayServer.listen(gatewayPort, gatewayHost, () => {
  console.log(`Veřejná brána MyBrowseru naslouchá na ${gatewayHost}:${gatewayPort}`);
});

uiServer.listen(uiPort, uiHost, () => {
  console.log(`MyBrowser naslouchá na ${uiHost}:${uiPort}`);
  console.log(`Výchozí složka webů: ${defaultRoot}`);
  for (const id of Object.keys(state.sites)) ensureSiteWatcher(id);
  setTimeout(() => {
    for (const [id, site] of Object.entries(state.sites)) {
      if (!site.autostart) continue;
      startSite(id, 'automaticky po startu add-onu').catch(error => console.error(`Autostart ${site.name}:`, error.message));
    }
  }, startupDelay * 1000).unref();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Přijat ${signal}, zastavuji weby…`);
  const operations = [];
  for (const id of Object.keys(state.sites)) {
    runtimeFor(id).watcher?.close();
    operations.push(stopSite(id, 'ukončení add-onu').catch(error => console.error(error)));
  }
  await Promise.all(operations);
  await browser.close();
  await Promise.all([
    new Promise(resolve => uiServer.close(resolve)),
    new Promise(resolve => gatewayServer.close(resolve))
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
