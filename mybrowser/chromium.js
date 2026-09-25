'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function safeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw httpError(400, 'Zadejte platnou webovou adresu'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, 'Prohlížeč podporuje HTTP a HTTPS adresy');
  return url.href;
}

function safeFileName(value) {
  const name = path.basename(String(value || 'soubor')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').slice(0, 180);
  return name && name !== '.' && name !== '..' ? name : 'soubor';
}

class CdpConnection {
  constructor(url, onEvent) {
    this.url = url;
    this.onEvent = onEvent;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const fail = event => reject(new Error(event?.message || 'Spojení s Chromiem se nepodařilo otevřít'));
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', fail, { once: true });
      socket.addEventListener('message', event => this.message(event.data));
      socket.addEventListener('close', () => this.closed());
    });
  }

  message(data) {
    let message;
    try { message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); }
    catch { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'Chromium odmítlo požadavek'));
      else pending.resolve(message.result || {});
      return;
    }
    this.onEvent?.(message);
  }

  call(method, params = {}, sessionId = null, timeout = 20000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chromium není připojené'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chromium neodpovědělo na ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(payload));
    });
  }

  closed() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Chromium ukončilo spojení'));
    }
    this.pending.clear();
  }

  close() {
    try { this.socket?.close(); } catch {}
    this.closed();
  }
}

class ChromiumBrowser {
  constructor({ executable, dataDir, downloadDir }) {
    this.executable = executable;
    this.profileDir = path.join(dataDir, 'chromium-profile');
    this.sessionRoot = path.join(dataDir, 'browser-sessions');
    this.downloadDir = downloadDir;
    this.process = null;
    this.cdp = null;
    this.startPromise = null;
    this.sessions = new Map();
    this.cdpSessions = new Map();
    this.targets = new Map();
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 60000);
    this.cleanupTimer.unref();
    fs.mkdirSync(this.profileDir, { recursive: true });
    fs.mkdirSync(this.sessionRoot, { recursive: true });
    fs.mkdirSync(this.downloadDir, { recursive: true });
  }

  get available() { return Boolean(this.executable); }

  async freePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
  }

  async start() {
    if (!this.available) throw httpError(503, 'Chromium není v add-onu dostupné');
    if (this.cdp) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startNow().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async startNow() {
    const port = await this.freePort();
    const args = [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
      '--no-first-run', '--no-default-browser-check', '--password-store=basic',
      '--remote-allow-origins=*', `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.profileDir}`, '--window-size=1600,900', 'about:blank'
    ];
    let errors = '';
    const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.process = child;
    child.stderr.on('data', chunk => { if (errors.length < 12000) errors += chunk.toString(); });
    child.once('exit', () => {
      if (this.process === child) this.process = null;
      this.cdp?.close();
      this.cdp = null;
      for (const session of this.sessions.values()) this.failSession(session, 'Chromium bylo ukončeno');
    });

    const deadline = Date.now() + 20000;
    let version;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(errors.trim().split('\n').pop() || `Chromium skončilo s kódem ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) { version = await response.json(); break; }
      } catch {}
      await wait(120);
    }
    if (!version?.webSocketDebuggerUrl) {
      try { child.kill('SIGKILL'); } catch {}
      throw new Error(errors.trim().split('\n').pop() || 'Chromium se nepodařilo spustit');
    }
    const connection = new CdpConnection(version.webSocketDebuggerUrl, message => this.onEvent(message));
    await connection.connect();
    this.cdp = connection;
    await this.cdp.call('Target.setDiscoverTargets', { discover: true });
    await this.cdp.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: this.downloadDir, eventsEnabled: true });
  }

  async create({ url, width, height, blockAds = false }) {
    await this.start();
    while (this.sessions.size >= 6) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
      await this.closeSession(oldest.id);
    }
    const id = crypto.randomUUID();
    const session = {
      id, targetId: null, cdpSessionId: null, width: this.dimension(width, 320, 1920, 1400),
      height: this.dimension(height, 240, 1200, 780), url: 'about:blank', title: 'Nová karta',
      loading: true, error: null, canGoBack: false, canGoForward: false, dialog: null,
      fileChooser: null, frame: null, frameSequence: 0, waiters: new Set(), touchedAt: Date.now(),
      uploadDir: path.join(this.sessionRoot, id), blockAds: Boolean(blockAds), metadataTimer: null
    };
    fs.mkdirSync(session.uploadDir, { recursive: true });
    this.sessions.set(id, session);
    try {
      const target = await this.cdp.call('Target.createTarget', { url: 'about:blank' });
      await this.attach(session, target.targetId);
      if (session.blockAds) {
        await this.callSession(session, 'Network.setBlockedURLs', { urls: ['*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://googleads.g.doubleclick.net/*'] });
      }
      await this.navigate(id, url);
      return this.publicState(session);
    } catch (error) {
      await this.closeSession(id);
      throw error;
    }
  }

  dimension(value, minimum, maximum, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  async attach(session, targetId) {
    if (session.cdpSessionId) {
      try { await this.callSession(session, 'Page.stopScreencast'); } catch {}
      this.cdpSessions.delete(session.cdpSessionId);
    }
    session.targetId = targetId;
    const attached = await this.cdp.call('Target.attachToTarget', { targetId, flatten: true });
    session.cdpSessionId = attached.sessionId;
    this.cdpSessions.set(attached.sessionId, session.id);
    this.targets.set(targetId, session.id);
    await Promise.all([
      this.callSession(session, 'Page.enable'),
      this.callSession(session, 'Runtime.enable'),
      this.callSession(session, 'Network.enable')
    ]);
    await this.callSession(session, 'Page.setInterceptFileChooserDialog', { enabled: true });
    await this.callSession(session, 'Emulation.setDeviceMetricsOverride', {
      width: session.width, height: session.height, deviceScaleFactor: 1, mobile: false
    });
    await this.callSession(session, 'Page.startScreencast', {
      format: 'jpeg', quality: 82, maxWidth: session.width, maxHeight: session.height, everyNthFrame: 1
    });
  }

  callSession(session, method, params = {}, timeout) {
    return this.cdp.call(method, params, session.cdpSessionId, timeout);
  }

  require(id) {
    const session = this.sessions.get(String(id));
    if (!session) throw httpError(404, 'Relace prohlížeče už neexistuje');
    session.touchedAt = Date.now();
    return session;
  }

  async navigate(id, value) {
    const session = this.require(id);
    const url = safeUrl(value);
    session.loading = true;
    session.error = null;
    session.url = url;
    const result = await this.callSession(session, 'Page.navigate', { url });
    if (result.errorText) session.error = result.errorText;
    this.scheduleMetadata(session, 150);
    return this.publicState(session);
  }

  async history(id, direction) {
    const session = this.require(id);
    const history = await this.callSession(session, 'Page.getNavigationHistory');
    const next = history.currentIndex + (direction === 'back' ? -1 : 1);
    if (next >= 0 && next < history.entries.length) {
      session.loading = true;
      await this.callSession(session, 'Page.navigateToHistoryEntry', { entryId: history.entries[next].id });
    }
    this.scheduleMetadata(session, 100);
    return this.publicState(session);
  }

  async reload(id) {
    const session = this.require(id);
    session.loading = true;
    await this.callSession(session, 'Page.reload', { ignoreCache: false });
    return this.publicState(session);
  }

  async resize(id, width, height) {
    const session = this.require(id);
    const nextWidth = this.dimension(width, 320, 1920, session.width);
    const nextHeight = this.dimension(height, 240, 1200, session.height);
    if (nextWidth === session.width && nextHeight === session.height) return this.publicState(session);
    session.width = nextWidth;
    session.height = nextHeight;
    await this.callSession(session, 'Emulation.setDeviceMetricsOverride', {
      width: session.width, height: session.height, deviceScaleFactor: 1, mobile: false
    });
    await this.callSession(session, 'Page.stopScreencast').catch(() => {});
    await this.callSession(session, 'Page.startScreencast', {
      format: 'jpeg', quality: 82, maxWidth: session.width, maxHeight: session.height, everyNthFrame: 1
    });
    return this.publicState(session);
  }

  async input(id, body) {
    const session = this.require(id);
    const type = String(body.type || '');
    if (type === 'mouse') {
      const allowed = new Set(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']);
      if (!allowed.has(body.event)) throw httpError(400, 'Neplatná událost myši');
      const params = {
        type: body.event,
        x: Math.min(session.width, Math.max(0, Number(body.x) || 0)),
        y: Math.min(session.height, Math.max(0, Number(body.y) || 0)),
        button: ['left', 'middle', 'right', 'none'].includes(body.button) ? body.button : 'none',
        buttons: Math.max(0, Number(body.buttons) || 0),
        clickCount: Math.max(0, Number(body.clickCount) || 0),
        modifiers: Math.max(0, Number(body.modifiers) || 0)
      };
      if (body.event === 'mouseWheel') {
        params.deltaX = Number(body.deltaX) || 0;
        params.deltaY = Number(body.deltaY) || 0;
      }
      await this.callSession(session, 'Input.dispatchMouseEvent', params);
    } else if (type === 'key') {
      const event = ['keyDown', 'keyUp', 'rawKeyDown', 'char'].includes(body.event) ? body.event : 'keyDown';
      await this.callSession(session, 'Input.dispatchKeyEvent', {
        type: event, key: String(body.key || ''), code: String(body.code || ''),
        text: event === 'keyDown' ? String(body.text || '') : undefined,
        unmodifiedText: event === 'keyDown' ? String(body.text || '') : undefined,
        windowsVirtualKeyCode: Number(body.keyCode) || 0,
        nativeVirtualKeyCode: Number(body.keyCode) || 0,
        modifiers: Math.max(0, Number(body.modifiers) || 0), autoRepeat: Boolean(body.repeat),
        isKeypad: Boolean(body.isKeypad), isSystemKey: Boolean(body.isSystemKey)
      });
    } else if (type === 'text') {
      await this.callSession(session, 'Input.insertText', { text: String(body.text || '').slice(0, 10000) });
    } else throw httpError(400, 'Neplatný vstup prohlížeče');
    return { ok: true };
  }

  stageDestination(id, value) {
    const session = this.require(id);
    let name = safeFileName(value);
    let destination = path.join(session.uploadDir, name);
    let suffix = 2;
    while (fs.existsSync(destination)) {
      const extension = path.extname(name);
      const stem = path.basename(name, extension);
      destination = path.join(session.uploadDir, `${stem}-${suffix++}${extension}`);
    }
    return destination;
  }

  async chooseFiles(id, files) {
    const session = this.require(id);
    if (!session.fileChooser) throw httpError(409, 'Web právě nečeká na výběr souboru');
    const candidates = (Array.isArray(files) ? files : []).map(value => path.join(session.uploadDir, safeFileName(value)));
    for (const file of candidates) {
      if (!file.startsWith(`${session.uploadDir}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError(400, 'Nahraný soubor nebyl nalezen');
    }
    await this.callSession(session, 'DOM.setFileInputFiles', {
      files: session.fileChooser.mode === 'selectSingle' ? candidates.slice(0, 1) : candidates,
      backendNodeId: session.fileChooser.backendNodeId
    });
    session.fileChooser = null;
    return { ok: true };
  }

  async dialog(id, accept, promptText = '') {
    const session = this.require(id);
    if (!session.dialog) throw httpError(409, 'Web právě nezobrazuje dialog');
    await this.callSession(session, 'Page.handleJavaScriptDialog', { accept: Boolean(accept), promptText: String(promptText || '') });
    session.dialog = null;
    return { ok: true };
  }

  async refreshMetadata(session) {
    if (!this.sessions.has(session.id) || !session.cdpSessionId) return;
    try {
      const [evaluation, history] = await Promise.all([
        this.callSession(session, 'Runtime.evaluate', { expression: '({url:location.href,title:document.title})', returnByValue: true }, 5000),
        this.callSession(session, 'Page.getNavigationHistory', {}, 5000)
      ]);
      const value = evaluation.result?.value || {};
      if (typeof value.url === 'string') session.url = value.url;
      if (typeof value.title === 'string' && value.title) session.title = value.title.slice(0, 300);
      session.canGoBack = history.currentIndex > 0;
      session.canGoForward = history.currentIndex + 1 < history.entries.length;
    } catch {}
  }

  scheduleMetadata(session, delay = 50) {
    clearTimeout(session.metadataTimer);
    session.metadataTimer = setTimeout(() => this.refreshMetadata(session), delay);
    session.metadataTimer.unref();
  }

  onEvent(message) {
    const browserSessionId = this.cdpSessions.get(message.sessionId);
    const session = browserSessionId ? this.sessions.get(browserSessionId) : null;
    if (session) {
      session.touchedAt = Date.now();
      if (message.method === 'Page.screencastFrame') {
        session.frame = Buffer.from(message.params.data, 'base64');
        session.frameSequence += 1;
        for (const resolve of session.waiters) resolve();
        session.waiters.clear();
        this.callSession(session, 'Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(() => {});
      } else if (message.method === 'Page.frameNavigated' && !message.params.frame?.parentId) {
        session.url = message.params.frame.url || session.url;
        session.loading = true;
        this.scheduleMetadata(session);
      } else if (message.method === 'Page.navigatedWithinDocument') {
        session.url = message.params.url || session.url;
        this.scheduleMetadata(session);
      } else if (message.method === 'Page.loadEventFired') {
        session.loading = false;
        this.scheduleMetadata(session);
      } else if (message.method === 'Page.javascriptDialogOpening') {
        session.dialog = {
          type: message.params.type || 'alert', message: String(message.params.message || ''),
          defaultPrompt: String(message.params.defaultPrompt || ''), hasBrowserHandler: Boolean(message.params.hasBrowserHandler)
        };
      } else if (message.method === 'Page.javascriptDialogClosed') session.dialog = null;
      else if (message.method === 'Page.fileChooserOpened') {
        session.fileChooser = { backendNodeId: message.params.backendNodeId, mode: message.params.mode || 'selectSingle', token: crypto.randomUUID() };
      } else if (message.method === 'Inspector.targetCrashed') this.failSession(session, 'Karta Chromia přestala odpovídat');
    }

    if (message.method === 'Target.targetInfoChanged') {
      const owner = this.sessions.get(this.targets.get(message.params.targetInfo?.targetId));
      if (owner) {
        owner.url = message.params.targetInfo.url || owner.url;
        owner.title = message.params.targetInfo.title || owner.title;
      }
    }
    if (message.method === 'Target.targetCreated') {
      const info = message.params.targetInfo;
      const ownerId = this.targets.get(info?.openerId);
      const owner = ownerId ? this.sessions.get(ownerId) : null;
      if (owner && info.type === 'page') {
        this.attach(owner, info.targetId).then(() => this.scheduleMetadata(owner, 150)).catch(error => this.failSession(owner, error.message));
      }
    }
  }

  failSession(session, message) {
    session.error = String(message || 'Chyba Chromia');
    session.loading = false;
    for (const resolve of session.waiters) resolve();
    session.waiters.clear();
  }

  publicState(session) {
    return {
      id: session.id, url: session.url, title: session.title, loading: session.loading,
      error: session.error, canGoBack: session.canGoBack, canGoForward: session.canGoForward,
      width: session.width, height: session.height, frameSequence: session.frameSequence,
      dialog: session.dialog, fileChooser: session.fileChooser ? { mode: session.fileChooser.mode, token: session.fileChooser.token } : null
    };
  }

  async state(id) {
    const session = this.require(id);
    await this.refreshMetadata(session);
    return this.publicState(session);
  }

  async frame(id, after, timeout = 12000) {
    const session = this.require(id);
    const sequence = Number(after) || 0;
    if (session.frame && session.frameSequence > sequence) return { body: session.frame, sequence: session.frameSequence };
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); session.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, Math.min(20000, Math.max(500, Number(timeout) || 12000)));
      session.waiters.add(done);
    });
    if (session.frame && session.frameSequence > sequence) return { body: session.frame, sequence: session.frameSequence };
    return null;
  }

  async closeSession(id) {
    const session = this.sessions.get(String(id));
    if (!session) return false;
    this.sessions.delete(session.id);
    this.cdpSessions.delete(session.cdpSessionId);
    this.targets.delete(session.targetId);
    clearTimeout(session.metadataTimer);
    for (const resolve of session.waiters) resolve();
    session.waiters.clear();
    try { if (this.cdp) await this.cdp.call('Target.closeTarget', { targetId: session.targetId }, null, 5000); } catch {}
    try { fs.rmSync(session.uploadDir, { recursive: true, force: true }); } catch {}
    return true;
  }

  cleanupIdle() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const session of this.sessions.values()) if (session.touchedAt < cutoff) this.closeSession(session.id).catch(() => {});
  }

  async close() {
    clearInterval(this.cleanupTimer);
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    this.cdp?.close();
    this.cdp = null;
    if (this.process && this.process.exitCode === null) {
      try { this.process.kill('SIGTERM'); } catch {}
      await Promise.race([new Promise(resolve => this.process?.once('exit', resolve)), wait(3000)]);
      if (this.process?.exitCode === null) try { this.process.kill('SIGKILL'); } catch {}
    }
    this.process = null;
  }
}

module.exports = { ChromiumBrowser, safeUrl };
