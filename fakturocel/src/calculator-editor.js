import { $, esc, button, field, area, select, modal, on, setDirty, closeModal, validateForm, confirmDialog, toast } from './ui.js';
import { calculatorsValue, defaultCalculators, validateCalculators, calculateFields, displayNumber, calculatorKinds } from './calculators-model.js';
import { formulaHelp, numeric } from './formula.js';
import { randomId as uid } from './crypto.js';
import { hideCalculator } from './calculators.js';
export function openCalculatorSettings(state, save) {
  let draft = calculatorsValue(state.settings.calculators),
    selected = draft[0].id,
    dirty = false;
  hideCalculator();
  const current = () => draft.find(c => c.id === selected);
  const changed = () => {
    dirty = true;
    setDirty(true);
  };
  function form(c) {
    return `<form id="calculatorSettingsForm" class="calc-manager-form" novalidate>${field("Calculator name", 'calc_name', c.name, 'text', 'required maxlength="100"')}${area("Description and instructions", 'calc_description', c.description, 'maxlength="1500"')}${select('Show in list', 'calc_enabled', [['true', "Yes"], ['false', "No"]], String(c.enabled))}<p class="muted">Type: ${esc(calculatorKinds[c.kind])}</p>${c.kind === 'formula' ? `<h3>Numeric fields</h3><p class="calc-settings-help">Use references A1, A2, and so on in formulas. You can rename each label. An empty minimum or maximum means there is no limit.</p>${c.fields.map((f, i) => `<section class="calc-field-row"><header><strong>${f.ref}</strong>${button('calcRemoveField:' + i, 'Remove field', 'small')}</header><div class="form-grid">${field("Label", 'field_' + i + '_label', f.label, 'text', 'required maxlength="100"')}${field("Unit", 'field_' + i + '_unit', f.unit, 'text', 'maxlength="32"')}${field("Default value", 'field_' + i + '_default', f.default, 'text', 'inputmode="decimal" required maxlength="40"')}${field('Minimum', 'field_' + i + '_min', f.min ?? '', 'text', 'inputmode="decimal" maxlength="40"')}${field('Maximum', 'field_' + i + '_max', f.max ?? '', 'text', 'inputmode="decimal" maxlength="40"')}</div></section>`).join('')}${button('calcAddField', "+ Add numeric field")}<h3>Results and formulas</h3>${c.results.map((r, i) => `<section class="calc-output-row"><header><strong>Result ${i + 1}</strong>${button('calcRemoveResult:' + i, "Remove result", 'small')}</header>${field("Result label", 'result_' + i + '_label', r.label, 'text', 'required maxlength="100"')}${area('Formula', 'result_' + i + '_formula', r.formula, 'required maxlength="4000" class="calc-formula" placeholder="=ROUND(A1*A2;2)"')}<div class="form-grid">${field("Result unit", 'result_' + i + '_unit', r.unit, 'text', 'maxlength="32"')}${field("Decimal places", 'result_' + i + '_decimals', r.decimals, 'number', 'min="0" max="10" step="1" required')}</div></section>`).join('')}${button('calcAddResult', "+ Add result")}<details class="calc-settings-help"><summary>How to write formulas</summary><p>${esc(formulaHelp)}</p><p>Example: =ROUND(A1*A2;2). Safe division: =IF(A2=0;0;A1/A2). Use a decimal point or comma in numbers and separate function arguments with a semicolon.</p><p>Formulas use the numeric fields in this calculator. References to sheets, other files, and text functions are not supported. SIN, COS, and TAN use radians, as in Excel formulas.</p></details><div id="calculatorPreview" class="calc-preview" aria-live="polite"></div>` : "<p>This calculator has a display and memory. Add calculations with custom fields by creating a new calculator or copying a special calculator.</p>"}</form>`;
  }
  function preview() {
    const target = $('#calculatorPreview');
    if (!target) return;
    try {
      validateCalculators([current().enabled ? current() : {
        ...current(),
        enabled: true
      }]);
      const rows = calculateFields(current());
      target.innerHTML = "<strong>Preview from default values</strong>" + rows.map(r => `<p>${esc(r.label)}: <strong>${r.error ? esc(r.error) : esc(displayNumber(r.value, r.decimals)) + ' ' + esc(r.unit)}</strong></p>`).join('');
    } catch (e) {
      target.innerHTML = "<strong>Edit settings</strong><p class=\"field-error\">" + esc(e.message) + '</p>';
    }
  }
  function paint() {
    modal("Calculator settings", `<p>The order and custom calculators are saved in settings and a full backup. Changes apply to all users.</p><div class="calc-manager-actions">${button('calcNew', "+ New calculator", 'primary')}${button('calcDuplicate', "Make a copy")}${button('calcDelete', "Delete the calculator", 'danger')}${button('calcDefaults', "Restore default list")}</div><div class="calc-manager"><div id="calculatorList" class="calc-manager-nav">${draft.map((c, i) => `<section class="calc-manager-row">${button('calcSelectEdit:' + c.id, esc(c.name) + (c.enabled ? '' : " · hidden"), c.id === selected ? 'selected' : '')}<div><button type="button" data-action="calcMoveUp:${esc(c.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(c.name)} up">↑</button><button type="button" data-action="calcMoveDown:${esc(c.id)}" ${i === draft.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(c.name)} down">↓</button></div></section>`).join('')}</div><div>${form(current())}</div></div><div class="form-actions sticky-actions">${button('calcSettingsSave', "Save calculators", 'primary')}${button('closeModal', "Close")}</div>`, () => {
      const f = $('#calculatorSettingsForm');
      f.oninput = f.onchange = e => {
        const name = e.target.name,
          c = current();
        if (!name) return;
        if (name === 'calc_name') c.name = e.target.value;
        if (name === 'calc_description') c.description = e.target.value;
        if (name === 'calc_enabled') c.enabled = e.target.value === 'true';
        const m = /^(field|result)_(\d+)_(\w+)$/.exec(name);
        if (m) {
          const row = (m[1] === 'field' ? c.fields : c.results)[+m[2]];
          if (!row) return;
          const key = m[3],
            v = e.target.value;
          if (['min', 'max'].includes(key) && v.trim() === '') delete row[key];else row[key] = key === 'decimals' ? Number(v) : v;
        }
        changed();
        preview();
      };
      preview();
    });
    setDirty(dirty);
  }
  on('calcSelectEdit', id => {
    selected = id;
    paint();
  });
  const move = (id, direction) => {
    const i = draft.findIndex(c => c.id === id),
      next = i + direction;
    if (next < 0 || next >= draft.length) return;
    [draft[i], draft[next]] = [draft[next], draft[i]];
    changed();
    paint();
  };
  on('calcMoveUp', id => move(id, -1));
  on('calcMoveDown', id => move(id, 1));
  on('calcNew', () => {
    if (draft.length >= 100) throw Error("The list can contain a maximum of 100 calculators.");
    const c = {
      id: uid(),
      name: "My calculator",
      description: '',
      kind: 'formula',
      enabled: true,
      fields: [{
        ref: 'A1',
        label: 'Value 1',
        unit: '',
        default: 0
      }, {
        ref: 'A2',
        label: 'Value 2',
        unit: '',
        default: 0
      }],
      results: [{
        label: "Result",
        formula: '=SUM(A1;A2)',
        unit: '',
        decimals: 2
      }]
    };
    draft.push(c);
    selected = c.id;
    changed();
    paint();
  });
  on('calcDuplicate', () => {
    if (draft.length >= 100) throw Error("The list can contain a maximum of 100 calculators.");
    const c = structuredClone(current());
    c.id = uid();
    c.name = c.name.slice(0, 90) + ' – kopie';
    draft.splice(draft.findIndex(x => x.id === selected) + 1, 0, c);
    selected = c.id;
    changed();
    paint();
  });
  on('calcDelete', async () => {
    if (draft.length === 1) throw Error("Keep at least one calculator.");
    if (!(await confirmDialog("Remove calculator \"" + current().name + "\" from the list? The change will only be made after saving the settings.", {
      title: "Remove the calculator",
      confirmText: 'Remove',
      danger: true
    }))) return;
    draft = draft.filter(c => c.id !== selected);
    selected = draft[0].id;
    changed();
    paint();
  });
  on('calcDefaults', async () => {
    if (!(await confirmDialog("Replace entire list with default calculators? Custom calculators will be removed after saving.", {
      title: "Default calculators",
      confirmText: 'Nahradit seznam',
      danger: true
    }))) return;
    draft = defaultCalculators();
    selected = draft[0].id;
    changed();
    paint();
  });
  on('calcAddField', () => {
    const c = current();
    if (c.fields.length >= 200) throw Error("The calculator can have a maximum of 200 number fields.");
    const n = Math.max(c.nextRef || 1, Math.max(0, ...c.fields.map(f => +f.ref.slice(1))) + 1);
    c.nextRef = n + 1;
    c.fields.push({
      ref: 'A' + n,
      label: 'Value ' + n,
      unit: '',
      default: 0
    });
    changed();
    paint();
  });
  on('calcRemoveField', index => {
    if (current().fields.length === 1) throw Error("Leave at least one numeric field.");
    current().nextRef = Math.max(current().nextRef || 1, Math.max(...current().fields.map(f => +f.ref.slice(1))) + 1);
    current().fields.splice(+index, 1);
    changed();
    paint();
  });
  on('calcAddResult', () => {
    if (current().results.length >= 20) throw Error("The calculator can have a maximum of 20 results.");
    current().results.push({
      label: "Another result",
      formula: '=' + current().fields[0].ref,
      unit: '',
      decimals: 2
    });
    changed();
    paint();
  });
  on('calcRemoveResult', index => {
    if (current().results.length === 1) throw Error("Leave at least one result.");
    current().results.splice(+index, 1);
    changed();
    paint();
  });
  on('calcSettingsSave', async () => {
    validateForm('#calculatorSettingsForm');
    validateCalculators(draft);
    const normalized = structuredClone(draft);
    for (const c of normalized) for (const f of c.fields || []) for (const k of ['default', 'min', 'max']) if (f[k] !== undefined) f[k] = numeric(f[k]);
    await save(normalized);
    dirty = false;
    setDirty(false);
    await closeModal();
    toast("Calculators and their order have been saved.");
  });
  paint();
}
