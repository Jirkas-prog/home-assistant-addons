import { esc, showError, toast } from './ui.js';
import { calculatorsValue, calculateFields, displayNumber } from './calculators-model.js';
import { evaluateFormula, formulaHelp, numeric } from './formula.js';
import './calculators.css';
const icon = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 6h8v3H8zM8 13h2m4 0h2m-8 4h2m4 0h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
let root,
  definitions = [],
  active = '',
  opened = false,
  previousFocus = null,
  work = new Map(),
  memory = 0,
  answer = 0,
  history = [],
  signature = '';
const current = () => definitions.find(c => c.id === active),
  workspace = () => {
    if (!work.has(active)) work.set(active, {
      expression: '',
      value: null,
      error: '',
      angle: 'deg',
      inputs: {}
    });
    return work.get(active);
  };
const button = (action, label, extra = '') => `<button type="button" data-calc="${esc(action)}" ${extra}>${label}</button>`;
const key = (value, label = value) => button('key', esc(label), `data-value="${esc(value)}"`);
function mount() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'calculator-root';
  document.body.append(root);
  root.onpointerdown = e => {
    if (!opened && e.target.closest('#calculator-launcher')) previousFocus = document.activeElement;
  };
  root.onclick = e => {
    const b = e.target.closest('[data-calc]');
    if (!b || b.disabled) return;
    void action(b.dataset.calc, b).catch(e => showError(e, "Calculator"));
  };
  root.oninput = e => {
    const w = workspace();
    if (e.target.id === 'calcExpression') {
      w.expression = e.target.value;
      w.justEvaluated = false;
      w.value = null;
      w.error = '';
      result();
    }
    if (e.target.dataset.ref) {
      w.inputs[e.target.dataset.ref] = e.target.value;
      result();
    }
  };
  root.onchange = e => {
    if (e.target.id === 'calcSelect') {
      active = e.target.value;
      draw();
      root.querySelector('#calcSelect').focus();
    }
    if (e.target.id === 'calcAngle') {
      workspace().angle = e.target.value;
      workspace().value = null;
      workspace().error = '';
      result();
    }
  };
  root.onkeydown = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideCalculator();
    } else if (e.key === 'Enter' && e.target.id === 'calcExpression') {
      e.preventDefault();
      e.stopPropagation();
      void action('evaluate');
    } else if (e.key === 'Tab' && opened) {
      const all = [...root.querySelectorAll('button,input,select,textarea,summary')].filter(x => !x.disabled && x.getClientRects().length);
      if (e.shiftKey && document.activeElement === all[0]) {
        e.preventDefault();
        all.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
        e.preventDefault();
        all[0].focus();
      }
    }
  };
}
export function syncCalculators(state) {
  mount();
  if (!state) {
    definitions = [];
    work.clear();
    history = [];
    memory = 0;
    answer = 0;
    active = '';
    opened = false;
    signature = '';
    root.innerHTML = '';
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const next = calculatorsValue(state.settings.calculators),
    sig = JSON.stringify(next);
  if (sig === signature) return;
  signature = sig;
  definitions = next;
  for (const [id, w] of work) {
    const c = next.find(c => c.id === id);
    if (!c) work.delete(id);else if (c.kind === 'formula') w.inputs = Object.fromEntries(Object.entries(w.inputs).filter(([ref]) => c.fields.some(f => f.ref === ref)));
  }
  if (!next.some(c => c.enabled && c.id === active)) active = next.find(c => c.enabled)?.id || '';
  draw();
}
export function showCalculator() {
  if (!definitions.length || document.querySelector('#messageOverlay')) return;
  if (!root.contains(document.activeElement)) previousFocus = document.activeElement;
  opened = true;
  document.querySelector('#modal .dialog')?.setAttribute('aria-modal', 'false');
  draw();
  root.querySelector('#calcExpression,#calculator-panel input,#calcSelect')?.focus();
}
export function hideCalculator() {
  opened = false;
  document.querySelector('#modal .dialog')?.setAttribute('aria-modal', 'true');
  draw();
  if (previousFocus?.isConnected) previousFocus.focus();
}
function draw() {
  if (!root || !definitions.length) return;
  root.innerHTML = `<button id="calculator-launcher" type="button" data-calc="toggle" aria-label="${opened ? "Hide" : "Open"} calculator" title="Calculator (Alt+C)" aria-controls="calculator-panel" aria-expanded="${opened}">${icon}<span>Calculator</span></button>${opened ? panel() : ''}`;
  if (opened) result();
}
function panel() {
  const c = current(),
    w = workspace();
  return `<section id="calculator-panel" role="dialog" aria-modal="false" aria-label="Calculator"><header><div><strong>Calculator</strong><small id="calcMemoryLabel"></small></div>${button('hide', '×', "aria-label=\"Hide Calculator\" class=\"icon\"")}</header><div class="calc-scroll"><label>Calculator type<select id="calcSelect">${definitions.filter(c => c.enabled).map(c => `<option value="${esc(c.id)}" ${c.id === active ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><p class="calc-description">${esc(c.description)}</p>${c.kind === 'formula' ? `<div class="calc-inputs">${c.fields.map(f => `<label>${esc(f.label)}${f.unit ? ' · ' + esc(f.unit) : ''}<input type="text" inputmode="decimal" data-ref="${f.ref}" aria-label="${esc(f.label)}" value="${esc(w.inputs[f.ref] ?? f.default)}" maxlength="40" autocomplete="off"></label>`).join('')}</div>${button('resetFields', "Return to default values")}<div id="calcResults"></div>` : `${c.kind === 'scientific' ? "<label>Angles<select id=\"calcAngle\"><option value=\"deg\" " + (w.angle === 'deg' ? 'selected' : '') + ">DEG · degrees</option><option value=\"rad\" " + (w.angle === 'rad' ? 'selected' : '') + ">RAD · radians</option></select></label>" : ''}<label>Expression<input id="calcExpression" type="text" inputmode="text" autocomplete="off" value="${esc(w.expression)}" maxlength="4000" placeholder="E.g. (125 + 80) * 1.2"></label><div id="calcResults"></div><div class="calc-memory">${button('mc', 'MC', "title=\"Clear Memory\"")}${button('mr', 'MR', "title=\"Insert Memory\"")}${button('mplus', 'M+', "title=\"Add result to memory\"")}${button('mminus', 'M−', "title=\"Subtract result from memory\"")}</div>${c.kind === 'scientific' ? `<div class="calc-science">${['SIN(', 'COS(', 'TAN(', 'ASIN(', 'ACOS(', 'ATAN(', 'LN(', 'LOG(', 'SQRT(', '^', 'PI()', 'FACT('].map(v => key(v, v.replace('(', '').replace(')', ''))).join('')}</div>` : ''}<div class="calc-keys">${button('clear', 'C', "title=\"Delete expression\"")}${button('backspace', '⌫', "aria-label=\"Delete last character\"")}${key('(')}${key(')')}${['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', ',', '%', '+'].map(v => key(v, {
    '/': '÷',
    '*': '×',
    '-': '−'
  }[v] || v)).join('')}${key('ANS', 'Ans')}${key('^', 'xʸ')}${button('evaluate', '=', "class=\"primary calc-equals\" aria-label=\"Calculate\"")}</div><details class="calc-history"><summary>Calculation history (${history.length})</summary><div>${history.map((h, i) => button('history', `${esc(h.expression)}${h.kind === 'scientific' ? ' · ' + h.angle.toUpperCase() : ''}<strong>= ${esc(displayNumber(h.value))}</strong>`, `data-index="${i}"`)).join('') || "<p>No calculation yet.</p>"}</div>${button('clearHistory', "Clear history")}</details>`}<details><summary>Formulas and control</summary><p>${esc(formulaHelp)}</p><p>A percentage converts a number to hundredths: 10% = 0.1. Write multiplication with *. Calculations use Excel's order of operations; −2^2 = 4, for −4 write −(2^2).</p><p>Hiding the panel as well as switching calculators will keep the values, M memory and history in this tab. Refreshing the page, closing it, locking it or clearing the data clears the memory.</p></details></div></section>`;
}
function values() {
  const c = current(),
    w = workspace();
  if (c.kind === 'formula') return calculateFields(c, w.inputs);
  return [{
    label: "Result",
    value: w.value,
    error: w.error
  }];
}
function result() {
  if (!opened) return;
  let rows;
  try {
    rows = values();
  } catch (e) {
    rows = [{
      label: "Fill in the values",
      error: e.message
    }];
  }
  root.querySelector('#calcResults').innerHTML = rows.map((r, i) => `<div class="calc-result ${i === 0 ? 'calc-main-result' : ''}"><label>${esc(r.label)}${r.error ? `<span class="field-error" role="status">${esc(r.error)}</span>` : `<input readonly aria-label="${esc(r.label)}" value="${esc(r.value === null || r.value === undefined ? '—' : displayNumber(r.value, r.decimals))}" title="Result can be marked and copied">${r.unit ? `<small>${esc(r.unit)}</small>` : ''}`}</label>${!r.error && r.value !== null && r.value !== undefined ? `<div>${button('copy', "Copy", `data-index="${i}"`)}${button('storeMemory', 'Do M', `data-index="${i}" title="Save result to memory"`)}</div>` : ''}</div>`).join('');
  root.querySelector('#calcMemoryLabel').textContent = "Memory M: " + displayNumber(memory) + ' · Alt+C';
}
function calculate() {
  const w = workspace();
  try {
    w.value = evaluateFormula(w.expression, {
      ANS: answer,
      M: memory
    }, {
      angle: current().kind === 'scientific' ? w.angle : 'rad'
    });
    answer = w.value;
    w.justEvaluated = true;
    w.error = '';
    return w.value;
  } catch (e) {
    w.value = null;
    w.error = e.message;
    return null;
  }
}
function insert(text) {
  const input = root.querySelector('#calcExpression'),
    w = workspace();
  if (!input) return;
  if (w.justEvaluated) {
    input.value = /^[+\-*/^%]$/.test(text) ? String(w.value ?? answer) : '';
    input.setSelectionRange(input.value.length, input.value.length);
    w.justEvaluated = false;
  }
  const start = input.selectionStart ?? input.value.length,
    end = input.selectionEnd ?? start;
  w.expression = (input.value.slice(0, start) + text + input.value.slice(end)).slice(0, 4000);
  w.value = null;
  w.error = '';
  input.value = w.expression;
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
  result();
}
async function copy(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px';
  root.append(area);
  area.select();
  let copied;
  try {
    copied = document.execCommand('copy');
  } finally {
    area.remove();
  }
  if (!copied) throw Error("Copying is not available. Highlight the result and copy it manually.");
}
async function action(name, b) {
  if (name === 'toggle') {
    opened ? hideCalculator() : showCalculator();
    return;
  }
  if (name === 'hide') {
    hideCalculator();
    return;
  }
  const w = workspace();
  if (name === 'key') return insert(b.dataset.value);
  if (name === 'mr') return insert('(' + String(memory) + ')');
  if (name === 'backspace') {
    w.justEvaluated = false;
    const input = root.querySelector('#calcExpression');
    let start = input.selectionStart,
      end = input.selectionEnd;
    if (start === end) start = Math.max(0, start - 1);
    input.setSelectionRange(start, end);
    insert('');
    return;
  }
  if (name === 'clear') {
    w.justEvaluated = false;
    w.expression = '';
    w.value = null;
    w.error = '';
    draw();
    root.querySelector('#calcExpression').focus();
    return;
  }
  if (name === 'resetFields') {
    w.inputs = {};
    draw();
    return;
  }
  if (name === 'evaluate') {
    const value = calculate();
    if (value !== null) {
      history.unshift({
        expression: w.expression,
        value,
        angle: w.angle,
        kind: current().kind
      });
      history = history.slice(0, 20);
    }
    draw();
    root.querySelector('#calcExpression').focus();
    return;
  }
  if (name === 'history') {
    const h = history[Number(b.dataset.index)],
      target = definitions.find(c => c.enabled && c.kind === h.kind);
    if (target) active = target.id;
    Object.assign(workspace(), {
      expression: h.expression,
      value: h.value,
      angle: h.angle,
      justEvaluated: true,
      error: ''
    });
    draw();
    return;
  }
  if (name === 'clearHistory') {
    history = [];
    draw();
    return;
  }
  if (name === 'mc') {
    memory = 0;
    result();
    return;
  }
  if (name === 'mplus' || name === 'mminus') {
    const v = w.value ?? calculate();
    if (v !== null) {
      try {
        memory = numeric(memory + (name === 'mplus' ? v : -v));
      } catch (e) {
        w.error = e.message;
      }
    }
    result();
    return;
  }
  const r = values()[Number(b?.dataset.index)];
  if (!r || r.error || r.value === null) return;
  if (name === 'storeMemory') {
    memory = r.value;
    result();
  }
  if (name === 'copy') {
    await copy((r.decimals === undefined ? Number(r.value.toPrecision(14)) : Number(r.value.toFixed(r.decimals))).toString().replace('.', ','));
    toast("The result has been copied.");
  }
}
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyC' && !document.querySelector('#messageOverlay')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    opened ? hideCalculator() : showCalculator();
  }
}, true);
