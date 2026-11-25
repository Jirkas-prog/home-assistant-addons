const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8');
const block = (first, next) => source.slice(source.indexOf(first), source.indexOf(next));
const settingsCode = [
  block('function renderSettings()', 'function renderDirectLogin()'),
  block('async function loadCalendars()', 'function openResolve('),
  block("$('#settings-form').addEventListener('input'", "for (const id of ['#resolve-close'")
].join('\n');

function fixture({ saved = 'calendar.example', calendars = null, failure = false } = {}) {
  const nodes = new Map(), requests = [], notices = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', hidden: false, textContent: '', dataset: {}, options: [], events: new Map(),
      contains: () => false,
      addEventListener(type, callback) { this.events.set(type, callback); },
      replaceChildren() { this.options = []; this.value = ''; },
      append(option) { this.options.push(option); }
    });
    return nodes.get(selector);
  }
  const state = { data: { settings: { connection_method: 'browser', schedule_source: 'home_assistant', calendar_entity: saved }, account: {} }, connected: true, calendars, calendarsLoading: false, settingsDirty: false, settingsCalendarDirty: false, calendarDirty: false, language: 'en' };
  const context = {
    state, $: node, document: { activeElement: null },
    element: (tag, className, textContent) => ({ tag, className, textContent, value: '' }),
    renderDirectLogin() {}, renderImportSettings() {}, updateCallback() {},
    FormData: class { entries() { return Object.entries({ calendar_entity: node('#calendar-entity').value, schedule_source: 'home_assistant' }); } },
    api: async (route, options) => {
      if (route === 'calendars') { if (failure) throw new Error('Unavailable.'); return { calendars: calendars || [] }; }
      const payload = JSON.parse(options.body); requests.push(payload); Object.assign(state.data.settings, payload); return { ok: true };
    },
    run: action => action(), toast: message => notices.push(message)
  };
  vm.createContext(context);
  vm.runInContext(settingsCode, context, { filename: 'app.js calendar settings' });
  return { state, context, node, requests, notices,
    render: () => context.renderSettings(),
    load: () => context.loadCalendars(),
    change(value) { node('#calendar-entity').value = value; node('#calendar-entity').events.get('change')(); },
    save: () => node('#settings-form').events.get('submit')({ target: node('#settings-form'), preventDefault() {} })
  };
}

test('saved calendar is displayed before the calendar list loads, even when the placeholder has focus', () => {
  const ui = fixture();
  ui.context.document.activeElement = ui.node('#calendar-entity');
  ui.render();
  assert.equal(ui.node('#calendar-entity').value, 'calendar.example');
  assert.equal(ui.node('#ha-calendar-select').value, 'calendar.example');
  assert.ok(ui.node('#calendar-entity').options.some(option => option.value === 'calendar.example'));
  ui.state.calendars = [{ entity_id: 'calendar.example', name: 'Saved calendar' }, { entity_id: 'calendar.other', name: 'Other calendar' }];
  ui.render();
  assert.equal(ui.node('#calendar-entity').value, 'calendar.example');
  assert.ok(ui.node('#calendar-entity').options.some(option => option.value === 'calendar.other'), 'the first loaded list must replace the focused fallback');
});

test('list failure before settings arrive does not hide the later saved selection', async () => {
  const ui = fixture({ failure: true });
  const savedData = ui.state.data;
  ui.state.data = null;
  await ui.load();
  ui.state.data = savedData;
  ui.state.settingsDirty = true; // An unrelated field was edited while loading.
  ui.render();
  assert.equal(ui.node('#calendar-entity').value, 'calendar.example');
  assert.equal(ui.node('#calendars-error').hidden, false);
});

test('saving an untouched loading placeholder never submits an empty calendar', async () => {
  const ui = fixture();
  ui.node('#calendar-entity').value = '';
  await ui.save();
  assert.equal(ui.requests.length, 1);
  assert.equal(Object.hasOwn(ui.requests[0], 'calendar_entity'), false);
  assert.equal(ui.state.data.settings.calendar_entity, 'calendar.example');
  assert.equal(ui.node('#calendar-entity').value, 'calendar.example');
});

test('explicit calendar changes survive failed loading and are persisted', async () => {
  const ui = fixture({ calendars: [{ entity_id: 'calendar.other', name: 'Other calendar' }], failure: true });
  ui.render();
  ui.change('calendar.other');
  await ui.load();
  ui.render();
  assert.equal(ui.node('#calendar-entity').value, 'calendar.other');
  await ui.save();
  assert.equal(ui.requests[0].calendar_entity, 'calendar.other');
  assert.equal(ui.state.settingsCalendarDirty, false);
});

test('an explicit user clearing is preserved, while saving before state loads is blocked', async () => {
  const ui = fixture();
  ui.render();
  ui.change('');
  ui.render();
  await ui.save();
  assert.equal(ui.requests[0].calendar_entity, '');
  const loading = fixture();
  loading.state.data = null;
  await loading.save();
  assert.equal(loading.requests.length, 0);
  assert.equal(loading.notices.length, 1);
});
