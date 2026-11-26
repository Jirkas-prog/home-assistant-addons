const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const dictionary = vm.runInNewContext(`function savedLanguage(){return 'cs';}\n${source.slice(0, source.indexOf('const sourceTexts'))}\nJSON.stringify(english)`);
const storyCode = block('function storyStateLabel(', 'function renderImportSettings(');
const bindings = block("$('#story-settings-form').addEventListener('input'", 'const languageObserver');

function fixture() {
  const nodes = new Map(), requests = [], notices = [];
  function element(tag = 'div', className = '', textContent = '') {
    return {
      tag, className, textContent, value: '', hidden: false, disabled: false, checked: false, open: false, src: '', children: [], events: new Map(),
      classList: { toggle() {} },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      contains: () => false, addEventListener(type, callback) { this.events.set(type, callback); },
      showModal() { this.open = true; }, close() { this.open = false; this.events.get('close')?.(); },
      removeAttribute(name) { delete this[name]; }
    };
  }
  function node(selector) { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); }
  const record = { attempt_id: 'attempt_one', item_id: 'a'.repeat(32), state: 'published', filename: '0001.jpg', story_requested: true, story_state: 'error', story_error: 'Upload unavailable', story_error_cs: 'Nahrávání není dostupné', story_started_at: '' };
  const state = { connected: true, busy: 0, language: 'en', storyDirty: false, storyResolving: null, storyCreating: null, storyPreviewGeneration: 0, data: {
    account: { connected: true, username: 'preview_only' }, settings: { connection_method: 'browser', enabled: false, calendar_entity: 'calendar.example', story_enabled: true, story_brand_name: 'Czech This View', story_headline: 'NEW POST', story_footer: 'YOUR TAKE? JOIN THE CONVERSATION.' },
    queue: [{ id: 'a'.repeat(32), status: 'queued', filename: '0001.jpg' }], history: [record], browser_status: { active: false, busy: false }
  } };
  const ui = { state, node, requests, notices, element, record, onLoad: null, onPost: null };
  const context = {
    state, $: node, document: { activeElement: null }, URL, Date, encodeURIComponent, english: JSON.parse(dictionary),
    element, button(text, className, callback) { const result = element('button', className, text); result.events.set('click', callback); return result; },
    toast: (text, error) => notices.push({ text, error }), renderHistory() {},
    loadState: async () => { if (ui.onLoad) await ui.onLoad(); context.renderStoryCreate(); },
    run: async (action, trigger, success) => {
      if (state.busy || trigger?.disabled) return null;
      state.busy++;
      try { const result = await action(); if (success) context.toast(success); await context.loadState(); return result; }
      catch (error) { context.toast(error.message, true); await context.loadState(); return null; }
      finally { state.busy--; }
    },
    api: async (route, options) => {
      const request = { route, method: options.method, payload: JSON.parse(options.body) }; requests.push(request);
      if (ui.onPost) return ui.onPost(request);
      if (route === 'settings') { Object.assign(state.data.settings, request.payload); return { ok: true }; }
      if (route.endsWith('/story/resolve')) { record.story_state = request.payload.published ? 'published' : 'error'; return { ok: true, attempt: record }; }
      record.story_state = 'published'; record.story_started_at = '2026-11-26T10:00:00Z'; return { ok: true, attempt: record };
    }
  };
  vm.createContext(context);
  vm.runInContext(block('function translate(', 'function applyLanguage(') + storyCode + bindings, context, { filename: 'app.js Story UI' });
  const event = selector => ({ target: node(selector), preventDefault() {} });
  return Object.assign(ui, { context, event,
    render: () => context.renderStorySettings(),
    save: () => context.saveStorySettings(event('#story-settings-form')),
    preview: () => context.openStoryPreview('a'.repeat(32)),
    retry: () => context.retryStory(record, node('#retry')),
    openResolve: () => context.openStoryResolve(record),
    resolve: () => context.submitStoryResolve(event('#story-resolve-form')),
    openCreate: () => context.openStoryCreate(record),
    create: () => context.submitStoryCreate(event('#story-create-confirmation')),
    changeManual(checked) { node('#manual-story-requested').checked = checked; node('#manual-story-requested').events.get('change')(event('#manual-story-requested')); }
  });
}

test('Story settings save only Story fields and retain dirty edits during state refresh', async () => {
  const ui = fixture(); ui.render();
  assert.equal(ui.node('#story-enabled').checked, true);
  ui.node('#story-headline').value = '  TAKE A CLOSER LOOK  ';
  ui.state.storyDirty = true; ui.render();
  assert.equal(ui.node('#story-headline').value, '  TAKE A CLOSER LOOK  ');
  assert.equal(ui.node('#story-preview-next').disabled, true);
  await ui.save();
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.requests[0], { route: 'settings', method: 'PUT', payload: {
    story_enabled: true, story_template: 'contrast_v1', story_brand_name: 'Czech This View', story_headline: 'TAKE A CLOSER LOOK', story_footer: 'YOUR TAKE? JOIN THE CONVERSATION.'
  } });
  assert.equal(ui.state.data.settings.enabled, false);
  assert.equal(ui.state.data.settings.calendar_entity, 'calendar.example');
  assert.equal(ui.state.storyDirty, false);
});

test('invalid Story text is rejected before any mutation', async () => {
  for (const value of ['', 'a'.repeat(81), 'Two\nlines', 'Bad\u0000text']) {
    const ui = fixture(); ui.render(); ui.node('#story-headline').value = value; await ui.save();
    assert.equal(ui.requests.length, 0); assert.ok(ui.notices.length);
  }
});

test('Story preview is read-only, uses saved settings and stops rendering after close', () => {
  const ui = fixture(); ui.preview();
  const image = ui.node('#story-preview-image');
  assert.match(image.src, /^api\/story\/preview\?post_id=a{32}&v=\d+$/);
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.node('#story-preview-dialog').open, true);
  assert.equal(ui.node('#story-preview-status').textContent, 'Loading the Story preview…');
  const lateLoad = image.onload; ui.node('#story-preview-dialog').close(); lateLoad();
  assert.equal(image.hidden, true);
  assert.equal(image.onload, null);
  ui.state.storyDirty = true; ui.preview();
  assert.equal(ui.node('#story-preview-dialog').open, false);
  ui.state.storyDirty = false; ui.state.data.queue = []; ui.state.data.history = []; ui.preview();
  assert.equal(ui.node('#story-preview-dialog').open, false);
});

test('Story retry submits only its existing attempt and blocks double clicks', async () => {
  const ui = fixture();
  let finish, started;
  const sent = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { finish = resolve; });
  ui.onPost = () => { started(); return held; };
  const first = ui.retry(); await sent; await ui.retry();
  assert.equal(ui.requests.length, 1);
  assert.deepEqual(ui.requests[0], { route: 'attempts/attempt_one/story/retry', method: 'POST', payload: {} });
  finish({ ok: false, attempt: { ...ui.record, story_state: 'uncertain' } }); await first;
  assert.equal(ui.record.state, 'published');
  assert.equal(ui.state.data.settings.enabled, false);
  assert.equal(ui.notices.at(-1).error, true);
});

test('Story retry checks fresh state and never retries an uncertain or started Story', async () => {
  for (const change of [
    ui => { ui.record.story_state = 'uncertain'; },
    ui => { ui.record.story_started_at = '2026-11-26T10:00:00Z'; },
    ui => { ui.record.story_state = 'published'; },
    ui => { ui.state.connected = false; }
  ]) {
    const ui = fixture(); ui.onLoad = () => change(ui); await ui.retry();
    assert.equal(ui.requests.length, 0);
  }
  const login = fixture(); login.state.data.browser_status.active = true; await login.retry(); assert.equal(login.requests.length, 0);
});

test('Story transport failure refreshes history without automatically posting again', async () => {
  const ui = fixture(); let loads = 0;
  ui.onLoad = () => { loads++; };
  ui.onPost = () => { ui.record.story_state = 'uncertain'; throw new Error('Network lost'); };
  await ui.retry();
  assert.equal(ui.requests.length, 1); assert.ok(loads >= 2);
  await ui.retry();
  assert.equal(ui.requests.length, 1);
});

test('verified not-published Story resolution records evidence without sending feed or Story', async () => {
  const ui = fixture(); ui.record.story_state = 'uncertain'; ui.record.story_started_at = '2026-11-26T10:00:00Z'; ui.openResolve();
  ui.node('#story-resolve-published').value = 'false'; ui.context.toggleStoryResolveFields();
  assert.equal(ui.node('#story-resolve-confirm').checked, false);
  ui.node('#story-resolve-confirm').checked = true;
  ui.node('#story-resolve-note').value = 'Checked the original account: no Story was posted.';
  await ui.resolve();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].route, 'attempts/attempt_one/story/resolve');
  assert.equal(ui.requests[0].payload.published, false);
  assert.equal(ui.record.state, 'published');
  assert.equal(ui.record.story_state, 'error');
  assert.equal(ui.node('#story-resolve-dialog').open, false);
});

test('Story resolution requires confirmation and a valid Story URL or verification note', async () => {
  const ui = fixture(); ui.record.story_state = 'uncertain'; ui.openResolve();
  await ui.resolve(); assert.equal(ui.requests.length, 0);
  ui.node('#story-resolve-confirm').checked = true;
  for (const url of ['https://instagram.com.evil.example/stories/account/42/', 'https://www.instagram.com/p/example/', 'javascript:alert(1)', 'https://user:password@instagram.com/stories/account/42/']) {
    ui.node('#story-resolve-permalink').value = url; await ui.resolve();
  }
  assert.equal(ui.requests.length, 0);
  ui.node('#story-resolve-permalink').value = 'https://www.instagram.com/stories/account/1234567890/'; await ui.resolve();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].payload.published, true);
});

test('history separates Story status, localized errors and eligible actions from the published feed', () => {
  const ui = fixture();
  let container = ui.element(); ui.context.appendStoryResult(container, ui.record);
  let section = container.children[0];
  assert.equal(section.children[0].textContent, 'STORY · ERROR');
  assert.equal(section.children[1].textContent, 'Upload unavailable');
  assert.equal(section.children.filter(child => child.tag === 'button').length, 1);
  ui.state.language = 'cs'; ui.record.story_state = 'uncertain';
  container = ui.element(); ui.context.appendStoryResult(container, ui.record); section = container.children[0];
  assert.equal(section.children[0].textContent, 'STORY · OVĚŘIT VÝSLEDEK');
  assert.equal(section.children[1].textContent, 'Nahrávání není dostupné');
  assert.equal(section.children.find(child => child.tag === 'button').textContent, 'Ověřit výsledek Story');
  assert.equal(ui.record.state, 'published');
});

test('manual Story choice cannot change once submitted or while global Stories are disabled', () => {
  const ui = fixture();
  ui.state.manualPublish = { storyRequested: true, submitted: false };
  ui.changeManual(false); assert.equal(ui.state.manualPublish.storyRequested, false);
  ui.state.manualPublish.submitted = true; ui.changeManual(true);
  assert.equal(ui.state.manualPublish.storyRequested, false);
  assert.equal(ui.node('#manual-story-requested').disabled, true);
  ui.state.manualPublish.submitted = false; ui.state.data.settings.story_enabled = false; ui.changeManual(true);
  assert.equal(ui.state.manualPublish.storyRequested, false);
});

test('successful Story cards hide internal audit notes and stale errors, while review states keep relevant details', () => {
  for (const language of ['cs', 'en']) {
    const ui = fixture(); ui.state.language = language;
    ui.record.story_note = 'Story creation explicitly requested for this already-published feed post.';
    ui.record.story_note_cs = 'Uživatel výslovně požádal o přidání Story k tomuto již zveřejněnému příspěvku.';
    for (const status of ['published', 'pending', 'preparing', 'publishing', 'skipped']) {
      ui.record.story_state = status;
      const container = ui.element(); ui.context.appendStoryResult(container, ui.record, false);
      assert.equal(container.children[0].children.some(child => child.tag === 'p'), false, `${language}/${status} must not display an internal audit note or stale error`);
    }
    for (const status of ['error', 'uncertain']) {
      ui.record.story_state = status;
      const container = ui.element(); ui.context.appendStoryResult(container, ui.record, false);
      const details = container.children[0].children.filter(child => child.tag === 'p').map(child => child.textContent);
      assert.deepEqual(details, language === 'cs' ? [ui.record.story_error_cs, ui.record.story_note_cs] : [ui.record.story_error, ui.record.story_note]);
    }
  }
});

test('explicit Story create previews an archived post and requires both loaded image and account confirmation', async () => {
  const ui = fixture(); ui.record.story_state = 'skipped'; ui.record.story_requested = false; ui.state.data.queue = [];
  ui.state.data.settings.story_enabled = false;
  await ui.openCreate();
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.node('#story-preview-dialog').open, true);
  assert.equal(ui.node('#story-create-account').textContent, '@preview_only');
  assert.equal(ui.node('#story-create-filename').textContent, '0001.jpg');
  assert.match(ui.node('#story-preview-image').src, /post_id=a{32}/);
  ui.node('#story-create-confirm').checked = true;
  await ui.create(); assert.equal(ui.requests.length, 0, 'an unloaded image cannot be submitted');
  ui.node('#story-preview-image').onload();
  ui.node('#story-create-confirm').checked = false;
  await ui.create(); assert.equal(ui.requests.length, 0, 'the destination account must be confirmed');
  ui.node('#story-create-confirm').checked = true;
  await ui.create();
  assert.deepEqual(ui.requests, [{ route: 'attempts/attempt_one/story/create', method: 'POST', payload: { expected_username: 'preview_only' } }]);
  assert.equal(ui.record.state, 'published');
  assert.equal(ui.state.data.settings.story_enabled, false, 'explicit Story creation must not enable automatic Stories');
  assert.equal(ui.state.data.settings.enabled, false);
  assert.equal(ui.state.data.queue.length, 0);
});

test('Story create rechecks the original attempt, account and template immediately before submission', async () => {
  for (const change of [
    ui => { ui.record.story_state = 'published'; },
    ui => { ui.state.data.account.username = 'another_account'; },
    ui => { ui.state.data.settings.story_headline = 'CHANGED AFTER PREVIEW'; },
    ui => { ui.state.data.browser_status.active = true; },
    ui => { ui.record.item_id = 'b'.repeat(32); }
  ]) {
    const ui = fixture(); ui.record.story_state = 'skipped'; await ui.openCreate();
    ui.node('#story-preview-image').onload(); ui.node('#story-create-confirm').checked = true;
    ui.onLoad = () => change(ui);
    await ui.create(); assert.equal(ui.requests.length, 0);
  }
});

test('Story create double click and unknown transport result never submit the feed or automatically retry', async () => {
  const ui = fixture(); ui.record.story_state = 'skipped'; await ui.openCreate();
  ui.node('#story-preview-image').onload(); ui.node('#story-create-confirm').checked = true;
  let finish, started;
  const sent = new Promise(resolve => { started = resolve; });
  ui.onPost = () => { started(); return new Promise((resolve, reject) => { finish = reject; }); };
  const first = ui.create(); await sent; await ui.create();
  assert.equal(ui.requests.length, 1);
  finish(new Error('Network interrupted')); await first;
  await ui.context.loadState(); await ui.create();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.state.storyCreating.submitted, true);
  assert.equal(ui.node('#story-create-submit').hidden, true);
  assert.equal(ui.node('#story-create-refresh').hidden, false);
  ui.record.story_state = 'published'; await ui.context.loadState();
  assert.equal(ui.state.storyCreating.error, '');
  assert.equal(ui.node('#story-create-result').textContent, 'STORY · PUBLISHED');
  assert.equal(ui.requests.length, 1);
});

test('history offers create only for skipped Stories, and closing preview discards late image callbacks', async () => {
  const ui = fixture(); ui.record.story_state = 'skipped';
  const holder = ui.element(); ui.context.appendStoryResult(holder, ui.record);
  assert.equal(holder.children[0].children.find(node => node.tag === 'button').textContent, 'Přidat Story');
  await ui.openCreate();
  const callback = ui.node('#story-preview-image').onload;
  ui.node('#story-preview-dialog').close();
  await ui.openCreate(); callback();
  assert.equal(ui.state.storyCreating.loaded, false, 'the previous image load must not authorize a new preview');
  assert.equal(ui.node('#story-create-submit').disabled, true);
});
