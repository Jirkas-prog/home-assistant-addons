import { $, esc, button, field, select, modal, on, setDirty, closeModal, validateForm, toast } from './ui.js';
import { appearanceValue, defaultAppearance, palettes, validateAppearance, contrastReport } from './appearance-model.js';
import { applyAppearance } from './appearance.js';
const colorLabels = {
  background: "Application background",
  surface: "Cards and forms",
  text: "Main text",
  muted: "Labels and additional text",
  accent: "The main color of the buttons",
  sidebar: "Sidebar",
  sidebarText: "Sidebar text"
};
export function openAppearance(state, save, addLogo, logoUrl) {
  const original = appearanceValue(state.settings.appearance);
  let draft = structuredClone(original),
    media = [...state.media],
    committed = false;
  function form() {
    return `<form id="appearanceForm" novalidate><p>The appearance changes immediately in the preview. Saved settings apply to the application and are carried over in a full backup. Invoice PDFs continue to use the selected document template.</p><div class="form-grid">${select("Environment theme", 'theme', [['light', "Light"], ['dark', "Dark"], ['system', "By device"], ['custom', "Custom colors"]], draft.theme)}${select("Interface scale", 'scale', [90, 100, 110, 120, 130, 140, 150].map(n => [n, n + ' %']), draft.scale)}${field("Main text (px)", 'fontSize', draft.fontSize, 'number', 'min="14" max="22" step="1"')}${field("Additional texts (px)", 'smallTextSize', draft.smallTextSize, 'number', 'min="12" max="18" step="1"')}${select("Interface font", 'font', [['noto', 'Noto Sans'], ['system', "System font"], ['liberation', 'Liberation Sans']], draft.font)}${select('Spacing', 'density', [['comfortable', "Comfortably"], ['compact', "Compact"]], draft.density)}</div><h3>Environment colors</h3><p class="muted">Changing the color turns on the custom theme. When saving, the readability of the text is checked.</p><div class="appearance-colors">${Object.entries(colorLabels).map(([k, l]) => field(l, 'color_' + k, draft.colors[k], 'color')).join('')}</div><h3>Branding</h3><div class="form-grid">${field("The name of the application", 'brandName', draft.brandName, 'text', 'maxlength="80" required')}${field("Subtitle (can be left blank)", 'tagline', draft.tagline, 'text', 'maxlength="120"')}${select('Application logo', 'logoId', [['', "The original logo"], ...media.filter(m => m.mime?.startsWith('image/') && !m.archived).map(m => [m.id, m.name])], draft.logoId)}${field('Logo size (px)', 'logoSize', draft.logoSize, 'number', 'min="32" max="80" step="1"')}</div>${button('appearanceLogo', "Upload your own logo")}<div id="appearancePreview" class="appearance-preview"></div><p id="appearanceProblem" class="field-error" role="status"></p><div class="form-actions sticky-actions">${button('appearanceSave', "Save appearance", 'primary')}${button('appearanceReset', "Restore original appearance")}${button('closeModal', "Close")}</div></form>`;
  }
  function preview() {
    try {
      validateAppearance(draft, media);
      applyAppearance(draft);
      $('#appearanceProblem').textContent = '';
    } catch (e) {
      $('#appearanceProblem').textContent = e.message;
    }
    const colors = draft.theme === 'custom' ? draft.colors : palettes[draft.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : draft.theme],
      checks = contrastReport(colors);
    $('#appearancePreview').innerHTML = `<div class="preview-brand"><img src="${esc(logoUrl(draft, media))}" alt="Logo"><div><strong>${esc(draft.brandName)}</strong><small>${esc(draft.tagline)}</small></div></div><h3>Readability preview</h3><p>Invoice No. 20260001 · Regular text and document data.</p><small>Additional text and form labels.</small><div class="status-badges"><span class="badge draft">In progress</span><span class="badge issued">Unpaid</span><span class="badge paid">Paid</span><span class="badge overdue">Overdue</span></div><h3>Contrast control</h3><div class="contrast-report">${checks.map(check => `<div class="contrast-check ${check.ratio >= check.minimum ? 'pass' : 'fail'}"><strong>${check.ratio >= check.minimum ? 'Pass' : "Needs adjustment"} · ${check.ratio.toFixed(2)} : 1</strong><span>${esc(check.label)} · minimum ${check.minimum} : 1</span></div>`).join('')}</div>`;
  }
  const repaint = () => {
    modal("Appearance and readability of the application", form(), () => {
      $('#appearanceForm').oninput = e => {
        const key = e.target.name;
        if (!key) return;
        const value = e.target.value;
        if (key.startsWith('color_')) {
          draft.colors[key.slice(6)] = value;
          draft.theme = 'custom';
          $('[name="theme"]').value = 'custom';
        } else {
          draft[key] = ['scale', 'fontSize', 'smallTextSize', 'logoSize'].includes(key) ? Number(value) : value;
          if (key === 'theme' && value !== 'custom') {
            draft.colors = {
              ...palettes[value === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : value]
            };
            for (const k of Object.keys(colorLabels)) $('[name="color_' + k + '"]').value = draft.colors[k];
          }
        }
        setDirty(true);
        preview();
      };
      preview();
    }, () => {
      if (!committed) applyAppearance(original);
    });
  };
  on('appearanceReset', () => {
    draft = defaultAppearance();
    repaint();
    setDirty(true);
  });
  on('appearanceLogo', async () => {
    const m = await addLogo();
    if (!m) return;
    media.push(m);
    draft.logoId = m.id;
    repaint();
    setDirty(true);
  });
  on('appearanceSave', async () => {
    validateForm('#appearanceForm');
    validateAppearance(draft, media);
    await save(draft);
    committed = true;
    setDirty(false);
    await closeModal();
    applyAppearance(draft);
    toast("The appearance of the application has been saved.");
  });
  repaint();
}
