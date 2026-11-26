const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8');
const manualCode = source.slice(source.indexOf('function manualPublishReason('), source.indexOf('function copySchedule('));
const storyCode = source.slice(source.indexOf('function storyStateLabel('), source.indexOf('function renderStorySettings('));
const storageKey = 'reality-twins-manual-publish';

function fixture() {
  const nodes = new Map(), requests = [], notices = [], storage = new Map();
  let counter = 0;
  const state = {
    connected: true, busy: 0, loading: false, language: 'en', manualOpening: false, manualPublish: null,
    data: {
      settings: { enabled: false, connection_method: 'browser', calendar_entity: 'calendar.example', schedule_source: 'home_assistant' },
      account: { connected: true, id: '42', username: 'preview_only' },
      queue: ['a', 'b'].map((letter, index) => ({ id: letter.repeat(32), status: 'queued', filename: `000${index + 1}.jpg`, caption: `Caption ${index + 1}`, sha256: letter.repeat(64) })),
      history: [], browser_status: { active: false, busy: false }
    }
  };
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: '', hidden: false, disabled: false, open: false, dataset: {}, src: '',
      classList: { toggle() {} }, focus() {},
      replaceChildren() {}, append() {},
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return nodes.get(selector);
  }
  const ui = { state, node, requests, notices, storage, onLoad: null, onPost: null, loads: 0 };
  const context = {
    state, $: node, encodeURIComponent,
    translate: text => text,
    URL, element: (tag, className, textContent) => ({ tag, className, textContent, append() {} }),
    toast: (...args) => notices.push(args),
    newId: () => `manual_request_${String(++counter).padStart(5, '0')}`,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    loadState: async () => {
      ui.loads++;
      if (ui.onLoad) await ui.onLoad();
      context.renderManualPublish();
    },
    api: async (route, options, timeout) => {
      const request = { route, method: options.method, body: JSON.parse(options.body), timeout };
      requests.push(request);
      if (ui.onPost) return ui.onPost(request);
      return { ok: true, attempt: attempt('published') };
    }
  };
  function attempt(status, extra = {}) {
    const manual = state.manualPublish;
    return { state: status, item_id: manual.postId, event_key: `manual:${manual.requestId}`, filename: manual.item?.filename, caption: manual.item?.caption, ...extra };
  }
  vm.createContext(context);
  vm.runInContext(storyCode + '\n' + manualCode, context, { filename: 'app.js manual publication' });
  return Object.assign(ui, {
    context, attempt,
    open: () => context.openManualPublish(),
    submit: (retry = false) => context.submitManualPublish(retry),
    render: () => context.renderManualPublish(),
    refresh: () => context.loadState(true),
    restore: () => context.restoreManualPublish()
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('manual publication works while paused and opening its preview never sends a post', async () => {
  const ui = fixture();
  assert.equal(ui.context.manualPublishReason(), '');
  await ui.open();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.node('#manual-publish-dialog').open, true);
  assert.equal(ui.node('#manual-publish-account').textContent, '@preview_only');
  assert.equal(ui.node('#manual-publish-caption').textContent, 'Caption 1');
  assert.equal(ui.node('#manual-publish-image').src, `api/queue/${'a'.repeat(32)}/image?v=${'a'.repeat(64)}`);
  assert.equal(ui.state.manualPublish.submitted, false);
});

test('empty queue, disconnected account, browser login and unresolved outcomes block new publication', async () => {
  const cases = [
    ui => { ui.state.data.queue = []; },
    ui => { ui.state.data.account.connected = false; },
    ui => { ui.state.data.browser_status.active = true; },
    ui => { ui.state.data.history = [{ state: 'uncertain' }]; },
    ui => { ui.state.data.history = [{ state: 'claimed' }]; },
    ui => { ui.state.data.queue[0].status = 'error'; }
  ];
  for (const change of cases) {
    const ui = fixture(); change(ui); ui.render();
    assert.equal(ui.node('#manual-publish-open').disabled, true);
    await ui.open();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.node('#manual-publish-dialog').open, false);
    assert.ok(ui.notices.length);
  }
});

test('double confirmation sends one selected item and leaves calendar and pause state untouched', async () => {
  const ui = fixture(), sent = deferred(), response = deferred();
  const originalSettings = JSON.stringify(ui.state.data.settings);
  ui.onPost = () => { sent.resolve(); return response.promise; };
  await ui.open();
  const requestId = ui.state.manualPublish.requestId;
  const first = ui.submit();
  await sent.promise;
  await ui.submit();
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.requests[0].body, { expected_post_id: 'a'.repeat(32), request_id: requestId, story_requested: true });
  assert.equal(ui.requests[0].route, 'publish-next');
  assert.equal(ui.requests[0].method, 'POST');
  assert.equal(ui.requests[0].timeout, 180000);
  assert.equal(ui.node('#manual-publish-confirm').disabled, true);
  response.resolve({ ok: true, attempt: ui.attempt('published') });
  await first;
  assert.equal(ui.state.manualPublish.attempt.state, 'published');
  assert.equal(ui.state.manualPublish.terminal, true);
  assert.equal(ui.storage.has(storageKey), false);
  assert.equal(ui.node('#manual-publish-status').textContent, 'Příspěvek byl zveřejněn.');
  assert.equal(JSON.stringify(ui.state.data.settings), originalSettings);
});

test('head, caption, image or account changing after preview prevents the initial POST', async () => {
  const changes = [
    ui => ui.state.data.queue.reverse(),
    ui => { ui.state.data.queue[0].caption = 'Changed caption'; },
    ui => { ui.state.data.queue[0].sha256 = 'new-image'; },
    ui => { ui.state.data.account.id = 'different-account'; }
  ];
  for (const change of changes) {
    const ui = fixture();
    await ui.open(); change(ui); await ui.submit();
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.state.manualPublish.terminal, true);
    assert.equal(ui.node('#manual-publish-confirm').hidden, true);
    assert.match(ui.state.manualPublish.error, /Fronta, popisek nebo účet/);
  }
});

test('transport failure retains the original key; reopening and refreshing never resend', async () => {
  const ui = fixture();
  ui.onPost = async () => { throw new Error('Transport interrupted'); };
  await ui.open(); await ui.submit();
  const originalPayload = ui.requests[0].body;
  assert.equal(ui.state.manualPublish.unknown, true);
  assert.equal(ui.state.manualPublish.terminal, false);
  assert.equal(JSON.parse(ui.storage.get(storageKey)).requestId, originalPayload.request_id);
  ui.node('#manual-publish-dialog').close();
  await ui.open(); await ui.refresh();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.state.manualPublish.requestId, originalPayload.request_id);
  ui.onPost = async () => ({ ok: true, replayed: true, attempt: ui.attempt('published') });
  await ui.submit(true);
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(ui.requests[1].body, originalPayload);
  assert.equal(ui.state.manualPublish.attempt.state, 'published');
});

test('409 on an explicit unknown-request retry preserves identity until history resolves the original request', async () => {
  const ui = fixture();
  ui.onPost = async () => { throw new Error('Transport interrupted'); };
  await ui.open(); await ui.submit();
  const originalPayload = ui.requests[0].body;
  ui.onPost = async () => { const error = new Error('Publisher is busy'); error.status = 409; throw error; };
  await ui.submit(true);
  assert.equal(ui.state.manualPublish.terminal, false);
  assert.equal(ui.state.manualPublish.unknown, true);
  assert.equal(JSON.parse(ui.storage.get(storageKey)).requestId, originalPayload.request_id);
  assert.deepEqual(ui.requests[1].body, originalPayload);
  ui.state.data.history = [ui.attempt('published')];
  ui.state.data.queue.shift();
  await ui.refresh();
  assert.equal(ui.requests.length, 2, 'history refresh must not submit the next queue item');
  assert.equal(ui.state.manualPublish.terminal, true);
  assert.equal(ui.state.manualPublish.attempt.state, 'published');
  assert.equal(ui.storage.has(storageKey), false);
});

test('an unknown-request retry refreshes changed image/caption/account before a second explicit confirmation', async () => {
  const ui = fixture();
  ui.onPost = async () => { throw new Error('Transport interrupted'); };
  await ui.open(); await ui.submit();
  const originalPayload = ui.requests[0].body;
  const originalImage = ui.node('#manual-publish-image').src;
  ui.state.data.queue[0].caption = 'New caption to review';
  ui.state.data.queue[0].sha256 = 'c'.repeat(64);
  ui.state.data.account = { connected: true, id: '43', username: 'different_preview' };
  await ui.submit(true);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.state.manualPublish.unknown, true);
  assert.equal(ui.state.manualPublish.requestId, originalPayload.request_id);
  assert.equal(ui.node('#manual-publish-caption').textContent, 'New caption to review');
  assert.equal(ui.node('#manual-publish-account').textContent, '@different_preview');
  assert.notEqual(ui.node('#manual-publish-image').src, originalImage);
  assert.ok(ui.node('#manual-publish-image').src.endsWith(`?v=${'c'.repeat(64)}`));
  ui.onPost = async () => ({ ok: true, attempt: ui.attempt('published') });
  await ui.submit(true);
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(ui.requests[1].body, originalPayload);
});

test('replayed in-progress attempts wait for history and uncertain outcomes never offer resend', async () => {
  const ui = fixture();
  ui.onPost = async () => ({ ok: false, replayed: true, attempt: ui.attempt('claimed') });
  await ui.open(); await ui.submit();
  assert.equal(ui.state.manualPublish.terminal, false);
  assert.equal(ui.state.manualPublish.unknown, false);
  assert.equal(ui.node('#manual-publish-retry').hidden, true);
  assert.notEqual(ui.node('#manual-publish-status').textContent, 'Příspěvek byl zveřejněn.');
  await ui.submit(true);
  assert.equal(ui.requests.length, 1);
  ui.state.data.history = [ui.attempt('uncertain', { error: 'Check profile.' })];
  await ui.refresh();
  assert.equal(ui.state.manualPublish.terminal, true);
  assert.equal(ui.node('#manual-publish-retry').hidden, true);
  assert.equal(ui.node('#manual-publish-open').disabled, true);
  assert.equal(ui.node('#manual-publish-error').textContent, 'Check profile.');
});

test('definitive first-request rejection is terminal, while an unrelated successful response remains unknown', async () => {
  const rejected = fixture();
  rejected.onPost = async () => { const error = new Error('Queue changed'); error.status = 409; throw error; };
  await rejected.open(); await rejected.submit();
  assert.equal(rejected.state.manualPublish.terminal, true);
  assert.equal(rejected.storage.has(storageKey), false);
  const unrelated = fixture();
  unrelated.onPost = async () => ({ ok: true, attempt: unrelated.attempt('published', { item_id: 'b'.repeat(32) }) });
  await unrelated.open(); await unrelated.submit();
  assert.equal(unrelated.state.manualPublish.unknown, true);
  assert.equal(unrelated.state.manualPublish.attempt, null);
  assert.notEqual(unrelated.node('#manual-publish-status').textContent, 'Příspěvek byl zveřejněn.');
});

test('reload restores only a validated request identity, without automatic publication', async () => {
  const ui = fixture();
  const identity = { postId: 'a'.repeat(32), requestId: 'request_from_previous_view' };
  ui.storage.set(storageKey, JSON.stringify(identity));
  ui.restore();
  await ui.open();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.state.manualPublish.requestId, identity.requestId);
  assert.equal(ui.state.manualPublish.unknown, true);
  assert.equal(ui.node('#manual-publish-caption').textContent, 'Caption 1');
  const invalid = fixture();
  invalid.storage.set(storageKey, JSON.stringify({ postId: '../../bad', requestId: 'short' }));
  invalid.restore();
  assert.equal(invalid.state.manualPublish, null);
  assert.equal(invalid.requests.length, 0);
});

test('Story choice follows the global default and remains unchanged across a transport retry', async () => {
  const ui = fixture();
  await ui.open();
  assert.equal(ui.state.manualPublish.storyRequested, true);
  assert.equal(ui.node('#manual-story-requested').checked, true);
  ui.state.manualPublish.storyRequested = false;
  ui.onPost = async () => { throw new Error('Transport interrupted'); };
  await ui.submit();
  assert.equal(ui.requests[0].body.story_requested, false);
  assert.equal(ui.node('#manual-story-requested').disabled, true);
  assert.equal(JSON.parse(ui.storage.get(storageKey)).storyRequested, false);
  ui.state.manualPublish = null;
  ui.restore();
  await ui.open();
  ui.onPost = async () => ({ ok: true, attempt: ui.attempt('published', { story_requested: false, story_state: 'skipped' }) });
  await ui.submit(true);
  assert.deepEqual(ui.requests[1].body, ui.requests[0].body);
  const disabled = fixture();
  disabled.state.data.settings.story_enabled = false;
  await disabled.open();
  assert.equal(disabled.state.manualPublish.storyRequested, false);
  assert.equal(disabled.node('#manual-story-requested').disabled, true);
});

test('disabling Stories after confirmation preview blocks the first POST and Story errors never resend feed', async () => {
  const changed = fixture(); await changed.open();
  changed.state.data.settings.story_enabled = false;
  await changed.submit();
  assert.equal(changed.requests.length, 0);
  assert.equal(changed.state.manualPublish.terminal, true);
  const ui = fixture();
  ui.onPost = async () => ({ ok: true, attempt: ui.attempt('published', { story_requested: true, story_state: 'uncertain' }) });
  await ui.open(); await ui.submit(); await ui.submit(true);
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.state.manualPublish.attempt.state, 'published');
  assert.equal(ui.node('#manual-publish-retry').hidden, true);
  assert.equal(ui.node('#manual-story-result').hidden, false);
  ui.state.data.history = [ui.attempt('published', { story_requested: true, story_state: 'published' })];
  await ui.refresh();
  assert.equal(ui.state.manualPublish.attempt.story_state, 'published', 'a late Story receipt must refresh even though feed is already terminal');
});
