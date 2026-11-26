const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/browser.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture({ hold = {}, fail = {} } = {}) {
  const nodes = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const requests = [], timers = new Map(), frames = [], revoked = [];
  let nextTimer = 0, inFlight = 0, maxInFlight = 0;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: ['#browser-error', '#browser-complete', '#browser-screen', '#browser-restart'].includes(selector),
      disabled: false, value: '', textContent: '', dataset: {}, attributes: {}, events: new Map(),
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      removeAttribute(name) { delete this.attributes[name]; if (name === 'src') delete this.src; },
      addEventListener(type, callback) { this.events.set(type, callback); },
      querySelectorAll() { return [node('#browser-text'), node('#text-submit')]; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 760 }; },
      focus() {}
    });
    return nodes.get(selector);
  }
  const browserStatus = { active: true, mode: 'desktop', width: 1100, height: 760, connected: false, url: 'https://www.instagram.com/accounts/login/' };
  const context = {
    document: { hidden: false, documentElement: {}, querySelector: node, querySelectorAll: () => [], addEventListener: (type, callback) => documentEvents.set(type, callback) },
    window: { addEventListener: (type, callback) => windowEvents.set(type, callback) },
    location: { href: '' }, localStorage: { getItem: () => 'en' }, AbortController,
    URL: { createObjectURL: () => { const url = `blob:frame-${frames.length}`; frames.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const endpoint = url.split('/api/')[1];
      requests.push({ endpoint, options, body: options.body ? JSON.parse(options.body) : undefined });
      inFlight++; maxInFlight = Math.max(inFlight, maxInFlight);
      const concurrent = inFlight > 1;
      try {
        if (hold[endpoint]) await hold[endpoint].promise;
        const message = concurrent ? 'Browser is busy.' : fail[endpoint];
        if (!message && endpoint === 'browser/mode') {
          const mode = JSON.parse(options.body).mode;
          Object.assign(browserStatus, { mode, width: mode === 'mobile' ? 390 : 1100, height: mode === 'mobile' ? 844 : 760 });
        }
        return { ok: !message, json: async () => message ? { error: message } : endpoint === 'browser/finish' ? { connected: true, username: 'example' } : endpoint === 'browser/close' ? { active: false } : browserStatus, blob: async () => ({ type: 'image/jpeg' }) };
      } finally { inFlight--; }
    }
  };
  vm.runInNewContext(source, context, { filename: 'browser.js' });
  return {
    requests, frames, revoked, node,
    get maxInFlight() { return maxInFlight; },
    event(selector, type, data = {}) { return node(selector).events.get(type)({ preventDefault() {}, ...data }); },
    pagehide() { windowEvents.get('pagehide')(); },
    runPoll() {
      for (const [id, entry] of timers) if (entry.delay === 1200) { timers.delete(id); entry.callback(); return; }
      throw new Error('No polling timer scheduled.');
    }
  };
}

test('typing waits for an in-flight screenshot, without a busy error or duplicated input', async () => {
  const frame = deferred();
  const ui = fixture({ hold: { 'browser/frame': frame } });
  await flush();
  assert.equal(ui.requests.at(-1).endpoint, 'browser/frame');
  ui.event('#browser-screen', 'keydown', { key: 'a' });
  ui.event('#browser-screen', 'keydown', { key: 'b' });
  await flush();
  assert.equal(ui.requests.filter(r => r.endpoint === 'browser/input').length, 0);
  frame.resolve();
  await flush();
  assert.equal(ui.maxInFlight, 1);
  assert.deepEqual(ui.requests.filter(r => r.endpoint === 'browser/input').map(r => r.body), [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
  assert.equal(ui.node('#browser-error').hidden, true);
  assert.equal(ui.node('#browser-finish').disabled, false);
});

test('finish waits for a screenshot and accepted input, then keeps the verified view closed', async () => {
  const frame = deferred();
  const ui = fixture({ hold: { 'browser/frame': frame } });
  await flush();
  ui.event('#browser-screen', 'keydown', { key: 'Enter' });
  const finished = ui.event('#browser-finish', 'click');
  await flush();
  assert.equal(ui.requests.some(r => r.endpoint === 'browser/finish'), false);
  frame.resolve();
  await finished;
  await flush();
  assert.equal(ui.maxInFlight, 1);
  assert.deepEqual(ui.requests.filter(r => /browser\/(input|finish)$/.test(r.endpoint)).map(r => r.endpoint), ['browser/input', 'browser/finish']);
  assert.equal(ui.node('#browser-complete').hidden, false);
  assert.match(ui.node('#browser-complete').textContent, /@example/);
  assert.equal(ui.node('#browser-screen').hidden, true);
  assert.equal(ui.frames.length, 0, 'the frame completing after Finish was pressed must not render');
});

test('closing the page drops queued input and stale frames before its serialized close', async () => {
  const frame = deferred();
  const ui = fixture({ hold: { 'browser/frame': frame } });
  await flush();
  ui.event('#browser-screen', 'keydown', { key: 'x' });
  await flush();
  ui.pagehide();
  frame.resolve();
  await flush();
  assert.equal(ui.maxInFlight, 1);
  assert.equal(ui.requests.filter(r => r.endpoint === 'browser/input').length, 0);
  assert.equal(ui.requests.filter(r => r.endpoint === 'browser/close').length, 1);
  assert.equal(ui.requests.at(-1).options.keepalive, true);
  assert.equal(ui.frames.length, 0);
  assert.equal(ui.node('#browser-screen').hidden, true);
});

test('a failed input is shown once and is never retried', async () => {
  const ui = fixture({ fail: { 'browser/input': 'Connection interrupted.' } });
  await flush();
  ui.event('#browser-screen', 'keydown', { key: 'a' });
  ui.event('#browser-screen', 'keydown', { key: 'b' });
  await flush();
  assert.equal(ui.requests.filter(r => r.endpoint === 'browser/input').length, 1);
  assert.equal(ui.node('#browser-error').textContent, 'Connection interrupted.');
  assert.equal(ui.node('#browser-error').hidden, false);
  assert.equal(ui.node('#browser-screen').hidden, true);
});

test('mobile switch serializes accepted input and uses the returned screenshot dimensions', async () => {
  const frame = deferred();
  const ui = fixture({ hold: { 'browser/frame': frame } });
  await flush();
  ui.event('#browser-screen', 'keydown', { key: 'x' });
  const changed = ui.event('#browser-mobile', 'click');
  await flush();
  assert.equal(ui.requests.some(r => r.endpoint === 'browser/mode'), false);
  frame.resolve();
  await changed; await flush();
  assert.equal(ui.maxInFlight, 1);
  assert.deepEqual(ui.requests.filter(r => /browser\/(input|mode)$/.test(r.endpoint)).map(r => r.endpoint), ['browser/input', 'browser/mode']);
  assert.equal(ui.node('.browser-viewport').dataset.mode, 'mobile');
  assert.equal(ui.node('#browser-screen').getAttribute('width'), '390');
  assert.equal(ui.node('#browser-screen').getAttribute('height'), '844');
  assert.equal(ui.node('#browser-mobile').getAttribute('aria-pressed'), 'true');
  ui.event('#browser-screen', 'click', { clientX: 550, clientY: 380 });
  await flush();
  assert.deepEqual(ui.requests.filter(r => r.endpoint === 'browser/input').at(-1).body, { type: 'click', x: 195, y: 422 });
  await ui.event('#browser-desktop', 'click'); await flush();
  assert.equal(ui.node('.browser-viewport').dataset.mode, 'desktop');
  assert.equal(ui.node('#browser-screen').getAttribute('width'), '1100');
});

test('a failed mode switch clears the stale clickable screenshot and never retries', async () => {
  const ui = fixture({ fail: { 'browser/mode': 'Emulation unavailable.' } });
  await flush();
  await ui.event('#browser-mobile', 'click'); await flush();
  assert.equal(ui.requests.filter(r => r.endpoint === 'browser/mode').length, 1);
  assert.equal(ui.node('#browser-screen').hidden, true);
  assert.equal(ui.node('#browser-error').textContent, 'Emulation unavailable.');
});
