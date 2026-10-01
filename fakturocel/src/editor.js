import { assetUrl } from './api.js';
import { clone, uid, fieldsFor, fieldValue, newDocument, defaultTemplate, bytesBase64, base64Bytes } from './model.js';
import { renderDocument, validateTemplate } from './renderer.js';
import { $, esc, button, field, select, area, on, toast, modal, closeModal, setDirty, job, picker } from './ui.js';
import { loadAsset, downloadBytes, api, pickFile, upload, base } from './api.js';
import { interfaceScale } from './appearance.js';
const PT = 72 / 25.4;
export function openEditor(source, s, save) {
  let t = clone(source),
    selected = t.nodes[0]?.id,
    history = [],
    future = [],
    zoom = 2.6,
    showTokens = false,
    lastLayout = null,
    sample = 'demo',
    drawId = 0,
    lastRange = null;
  const loadedFonts = new Set();
  if (t.status === 'active') {
    t = {
      ...t,
      id: uid(),
      status: 'draft',
      version: (t.version || 1) + 1,
      previousId: t.id
    };
  }
  const editorSource = t.editor && typeof t.editor === 'object' ? t.editor : {};
  t.editor = {
    showRulers: editorSource.showRulers !== false,
    showGrid: !!editorSource.showGrid,
    snap: editorSource.snap !== false,
    gridSize: Number.isFinite(+editorSource.gridSize) && +editorSource.gridSize >= .5 && +editorSource.gridSize <= 50 ? +editorSource.gridSize : 1,
    guidesX: Array.isArray(editorSource.guidesX) ? editorSource.guidesX.filter(Number.isFinite).slice(0, 100) : [],
    guidesY: Array.isArray(editorSource.guidesY) ? editorSource.guidesY.filter(Number.isFinite).slice(0, 100) : []
  };
  const node = () => t.nodes.find(n => n.id === selected);
  function historyState() {
    const el = $('#historyState');
    if (el) el.textContent = `${history.length} undo steps · ${future.length} redo steps`;
  }
  function checkpoint() {
    history.push(clone(t));
    if (history.length > 80) history.shift();
    future = [];
    setDirty(true);
    historyState();
  }
  function snapAxis(value, size, guides = []) {
    if (!t.editor.snap) return Math.round(value * 10) / 10;
    const grid = Math.max(.5, +t.editor.gridSize || 5);
    let result = Math.round(value / grid) * grid,
      best = Infinity;
    for (const guide of guides) for (const offset of [0, size / 2, size]) {
      const distance = Math.abs(value + offset - guide);
      if (distance < best && distance <= 2) {
        best = distance;
        result = guide - offset;
      }
    }
    return Math.round(result * 10) / 10;
  }
  const ruler = (axis, length) => Array.from({
    length: Math.floor(length / 10) + 1
  }, (_, i) => `<span class="ruler-mark" style="${axis === 'x' ? 'left' : 'top'}:${i * 10 * zoom}px">${i * 10}</span>`).join('');
  function guideList() {
    const root = $('#guideList');
    if (!root) return;
    root.innerHTML = [...t.editor.guidesX.map((value, i) => `<div class="guide-row">${field("Vertical guide (mm)", 'guideX_' + i, value, 'number', 'step="0.5"')}${button('edGuideDelete:x:' + i, '×', 'icon')}</div>`), ...t.editor.guidesY.map((value, i) => `<div class="guide-row">${field("Horizontal guide (mm)", 'guideY_' + i, value, 'number', 'step="0.5"')}${button('edGuideDelete:y:' + i, '×', 'icon')}</div>`)].join('') || "<p class=\"muted\">Without your own clues.</p>";
    for (const input of root.querySelectorAll('input')) input.onchange = e => {
      checkpoint();
      const [, axis, index] = e.target.name.match(/^guide([XY])_(\d+)$/) || [];
      if (!axis) return;
      t.editor[axis === 'X' ? 'guidesX' : 'guidesY'][+index] = +e.target.value;
      draw();
    };
  }
  function example() {
    if (sample !== 'demo' && s.documents.some(d => d.id === sample)) return s.documents.find(d => d.id === sample);
    const d = newDocument(s);
    d.number = '20260001';
    d.supplier = {
      ...d.supplier,
      name: d.supplier.name || "Sample supplier"
    };
    d.customer = {
      name: "Sample customer",
      street: "Sample address",
      city: "City",
      zip: '',
      ico: ''
    };
    d.items = [{
      name: "Sample work",
      qty: 2,
      price: 1250,
      unit: 'hours'
    }];
    d.custom = Object.fromEntries(s.fields.map(f => [f.id, f.default || "Sample"]));
    return d;
  }
  function shell() {
    modal("Template editor", `<div class="designer"><div class="designer-top">${button('edUndo', "↶ Undo")}${button('edRedo', '↷ Redo')}<span id="historyState" class="history-state"></span>${field("Template name", 'templateName', t.name)}${select("Preview", 'sample', [['demo', "Sample document"], ...s.documents.map(d => [d.id, d.number + ' · ' + d.customer?.name])], sample)}${select("Zoom", 'zoom', [['1.5', '57 %'], ['2.6', '100 %'], ['3.5', '135 %']], zoom)}${button('edTokens', showTokens ? 'Show values' : "Show field names")}${button('edPdf', "Preview PDF")}${button('edSave', "Save draft", 'primary')}${button('edPublish', 'Publish version', 'primary')}</div><div class="designer-body"><section class="designer-left" data-preserve-scroll><h3>Add element</h3><div class="element-buttons">${[['text', "Text / data"], ['image', "Picture"], ['rect', "Color area"], ['line', "Line"], ['qr', "QR code"], ['table', 'Table']].map(([k, l]) => button('edAdd:' + k, l)).join('')}</div><h3>Page</h3><div class="form-grid">${field("Width (mm)", 'pageWidth', t.page.width, 'number')}${field("Height (mm)", 'pageHeight', t.page.height, 'number')}${field("Top edge", 'pageTop', t.page.top, 'number')}${field("Bottom edge", 'pageBottom', t.page.bottom, 'number')}</div><h3>Grid and guides</h3><div class="designer-grid-settings"><label><input type="checkbox" name="showRulers" ${t.editor.showRulers ? 'checked' : ''}> Show rulers</label><label><input type="checkbox" name="showGrid" ${t.editor.showGrid ? 'checked' : ''}> Show grid</label><label><input type="checkbox" name="snap" ${t.editor.snap ? 'checked' : ''}> Snap elements</label>${field("Grid pitch (mm)", 'gridSize', t.editor.gridSize, 'number', 'min="0.5" max="50" step="0.5"')}<div>${button('edGuideAdd:x', "+ Vertical guide")}${button('edGuideAdd:y', "+ Horizontal guide")}</div></div><div id="guideList" class="guide-list"></div><h3>Layers</h3><div id="layers"></div><p class="muted">Drag or arrow keys to move. Shift + arrow moves by 5 mm. Ctrl+Z and Ctrl+Y return steps. A locked layer cannot be accidentally moved.</p></section><section class="designer-canvas" data-preserve-scroll><div id="designError" role="alert"></div><div id="pages"></div></section><section id="properties" class="designer-properties" data-preserve-scroll></section></div></div>`, undefined, () => document.removeEventListener('keydown', editorKeys));
    $('.dialog').classList.add('designer-dialog');
    bindTop();
    properties();
    guideList();
    historyState();
    draw();
  }
  function bindTop() {
    const el = $('[name="templateName"]');
    el.onchange = () => {
      checkpoint();
      t.name = el.value;
    };
    $('[name="sample"]').onchange = e => {
      sample = e.target.value;
      properties();
      draw();
    };
    $('[name="zoom"]').onchange = e => {
      zoom = +e.target.value;
      draw();
    };
    for (const [name, key] of [['pageWidth', 'width'], ['pageHeight', 'height'], ['pageTop', 'top'], ['pageBottom', 'bottom']]) $(`[name="${name}"]`).onchange = e => {
      checkpoint();
      t.page[key] = +e.target.value;
      draw();
    };
    for (const name of ['showRulers', 'showGrid', 'snap']) $(`[name="${name}"]`).onchange = e => {
      checkpoint();
      t.editor[name] = e.target.checked;
      draw();
    };
    $('[name="gridSize"]').onchange = e => {
      const value = +e.target.value;
      if (!Number.isFinite(value) || value < .5 || value > 50) throw Error("The pitch of the grid must be from 0.5 to 50 mm.");
      checkpoint();
      t.editor.gridSize = value;
      draw();
    };
  }
  function richHtml(runs) {
    return (runs || []).map((r, i) => `<span data-run="${i}" ${r.field ? `data-field="${esc(r.field)}" contenteditable="false" class="variable"` : ''} style="font-weight:${r.bold ? '700' : '400'};font-style:${r.italic ? 'italic' : 'normal'};text-decoration:${r.underline ? 'underline' : 'none'};color:${esc(r.color || node().color)};font-size:${r.size || node().size || 10}pt">${esc(r.field ? showTokens ? '[' + (fieldsFor(s)[r.field] || r.field) + ']' : fieldValue(r, example(), s) : r.text).replaceAll('\n', '<br>')}</span>`).join('');
  }
  function readRich() {
    const root = $('#richText'),
      old = node().runs || [],
      runs = [];
    function walk(e, style = {}) {
      if (e.nodeType === 3) {
        if (e.textContent) runs.push({
          text: e.textContent,
          ...style
        });
        return;
      }
      if (e.nodeType !== 1) return;
      const next = {
        ...style
      };
      if (e.style.color) next.color = rgbHex(e.style.color);
      if (e.style.fontWeight) next.bold = ['700', 'bold'].includes(e.style.fontWeight);
      if (e.style.fontStyle) next.italic = e.style.fontStyle === 'italic';
      if (e.style.textDecoration) next.underline = e.style.textDecoration.includes('underline');
      if (e.style.fontSize) next.size = parseFloat(e.style.fontSize);
      if (e.dataset.field) {
        runs.push({
          ...old[+e.dataset.run],
          ...next,
          field: e.dataset.field,
          text: undefined
        });
        return;
      }
      if (e.tagName === 'BR') {
        runs.push({
          text: '\n',
          ...next
        });
        return;
      }
      if (['DIV', 'P'].includes(e.tagName) && e !== root && runs.length) runs.push({
        text: '\n'
      });
      e.childNodes.forEach(c => walk(c, next));
    }
    root.childNodes.forEach(c => walk(c));
    node().runs = runs;
  }
  function rgbHex(c) {
    if (c.startsWith('#')) return c;
    const m = c.match(/\d+/g);
    return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : '#172f35';
  }
  function properties() {
    const n = node();
    $('#layers').innerHTML = [...t.nodes].reverse().map(n => `<div class="layer-row">${button('edSelect:' + n.id, `${n.locked ? '🔒 ' : ''}${esc(n.name)}${n.group ? ' · skupina' : ''}`, selected === n.id ? 'layer selected' : 'layer')}${button('edLayerLock:' + n.id, n.locked ? 'Odemknout' : 'Zamknout', 'icon')}${button('edLayerUp:' + n.id, '↑', 'icon')}</div>`).join('');
    if (!n) {
      $('#properties').innerHTML = 'Vyber prvek.';
      return;
    }
    const props = `${field("Element name", 'nodeName', n.name)}<div class="form-grid">${field('X (mm)', 'x', n.x, 'number', 'step="0.5"')}${field(n.anchor === 'after' ? 'Gap after block (mm)' : 'Y (mm)', 'y', n.y, 'number', 'step="0.5"')}${field("Width (mm)", 'w', n.w, 'number', 'step="0.5"')}${field("Height (mm)", 'h', n.h, 'number', 'step="0.5"')}</div>${select("Location", 'anchor', [['', "Fixed position"], ['after', "Flow after another block"]], n.anchor || '')}${n.anchor === 'after' ? select('Follows', 'after', t.nodes.filter(x => x.id !== n.id).map(x => [x.id, x.name]), n.after) : ''}${select("Display", 'repeat', [['first', "First-page content"], ['all', "All pages"], ['last', "Last page"], ['continuation', "Continuation pages"]], n.repeat || 'first')}${field('Color', 'color', n.color || '#172f35', 'color')}${select("Intentional overlay of other content", 'allowOverlap', [['false', "Disable overlay"], ['true', "Enable overlay"]], String(!!n.allowOverlap))}${field("Group (same name = joint move)", 'group', n.group || '')}${select("Element lock", 'locked', [['false', "Unlocked"], ['true', "Locked"]], String(!!n.locked))}`;
    let special = '';
    if (n.kind === 'text') special = `<h3>Text and variables</h3><p class="muted">Select a section of text or click on a variable to apply a style. The value of the variable changes according to the selected document.</p><div class="rich-tools">${button('edBold', 'B')}${button('edItalic', 'I')}${button('edUnderline', 'U')}${button('edField', "+ Insert data")}</div><div id="richText" contenteditable="true" role="textbox" aria-label="Text field content" class="rich-text">${richHtml(n.runs)}</div><div class="form-grid">${field("Font size / selection", 'size', n.size || 10, 'number', 'min="5" max="96"')}${select("Font", 'font', [['regular', 'Liberation Sans'], ['bold', "Liberation Sans bold"], ['italic', "Liberation Sans Italics"], ...s.media.filter(m => m.mime?.includes('font')).map(m => [m.id, m.name])], n.font || 'regular')}${select("Alignment", 'align', [['left', 'Left'], ['center', "To the center"], ['right', 'Right']], n.align || 'left')}${field("Inner edge (mm)", 'padding', n.padding || 0, 'number', 'min="0" max="20"')}${select("Hold the text together", 'keepTogether', [['false', "Allow splitting"], ['true', "Move the whole block"]], String(!!n.keepTogether))}${field("Spacing", 'lineHeight', n.lineHeight || 1.35, 'number', 'min="1" max="3" step="0.05"')}</div>${select("Long text", 'overflow', [['grow', "Break and continue"], ['error', 'Stop if it does not fit']], n.overflow || 'grow')}${select("Modified variable", 'runIndex', (n.runs || []).map((r, i) => r.field ? [String(i), fieldsFor(s)[r.field] || r.field] : null).filter(Boolean))}<div id="runSettings"></div>`;
    if (n.kind === 'image') special = `${select("Picture", 'mediaId', [['', "Choose a picture"], ...s.media.filter(m => m.mime?.startsWith('image/') && !m.archived).map(m => [m.id, m.name])], n.mediaId)}${select("Customization", 'fit', [['contain', "Maintain aspect ratio"], ['cover', "Fill with clipping"], ['stretch', "Stretch out"]], n.fit || 'contain')}${field("Opacity (0–1)", 'opacity', n.opacity ?? 1, 'number', 'min="0" max="1" step="0.1"')}<p class="muted">Add new images in the Media Library.</p>`;
    if (n.kind === 'qr') special = `${select('QR content', 'qrType', [['payment', "QR payment from the document"], ['text', "Custom text / link"]], n.qrType || 'payment')}${field("Custom content", 'value', n.value || '')}`;
    if (n.kind === 'table') special = `${field("Font size", 'size', n.size || 9, 'number', 'min="5" max="30"')}${field("Header color", 'headerColor', n.headerColor || '#e8f3ef', 'color')}<h3>Table columns</h3><div id="columnEditor">${n.columns.map((c, i) => `<div class="column-edit" data-col="${i}">${field("Name", 'colLabel', c.label)}${select("Data", 'colKey', [['name', "Item"], ['qty', "Quantity"], ['unit', "Unit"], ['price', "Unit price"], ['total', "Total"], ...s.fields.filter(f => f.scope === 'item').map(f => ['custom.' + f.id, f.name])], c.key)}${field("Column width (%)", 'colWidth', c.width, 'number', 'min="1"')}${button('edColUp:' + i, '↑')}${button('edColDelete:' + i, 'Remove')}</div>`).join('')}</div>${button('edColAdd', '+ Column')}`;
    $('#properties').innerHTML = `<h3>Properties</h3>${props}${special}<details><summary>Display condition</summary>${select("Show when", 'conditionField', [['', "Always"], ...Object.entries(fieldsFor(s))], n.condition?.field || '')}${select("Condition", 'conditionOp', [['eq', 'Equals'], ['neq', "Does not equal"], ['empty', "It is empty"], ['notempty', "It is filled"], ['gt', "It is greater than"]], n.condition?.op || 'eq')}${field('Value', 'conditionValue', n.condition?.value || '')}</details><div class="form-actions">${button('edAlignLeft', "To the left edge")}${button('edCenter', "To the center")}${button('edFront', "Forward")}${button('edBack', 'Backward')}${button('edDuplicate', 'Duplicate')}${button('edDelete', 'Delete', 'danger')}</div>`;
    $('#properties').onchange = e => {
      const key = e.target.name;
      if (!key || ['runIndex', 'runFormat', 'runFallback', 'runRequired'].includes(key)) return;
      if (['colLabel', 'colKey', 'colWidth'].includes(key)) {
        checkpoint();
        const c = n.columns[+e.target.closest('[data-col]').dataset.col];
        c[key === 'colLabel' ? 'label' : key === 'colKey' ? 'key' : 'width'] = key === 'colWidth' ? +e.target.value : e.target.value;
        draw();
        return;
      }
      if (['color', 'size'].includes(key) && lastRange && $('#richText')?.contains(lastRange.commonAncestorContainer)) {
        styleSelection(key === 'size' ? 'fontSize' : 'color', key === 'size' ? e.target.value + 'pt' : e.target.value);
        return;
      }
      checkpoint();
      if (key.startsWith('condition')) {
        n.condition = {
          field: $('[name="conditionField"]').value,
          op: $('[name="conditionOp"]').value,
          value: $('[name="conditionValue"]').value
        };
      } else {
        let value = ['x', 'y', 'w', 'h', 'size', 'lineHeight', 'opacity', 'padding'].includes(key) ? +e.target.value : ['locked', 'allowOverlap', 'keepTogether'].includes(key) ? e.target.value === 'true' : e.target.value;
        if (key === 'x') value = snapAxis(value, n.w, t.editor.guidesX);
        if (key === 'y' && n.anchor !== 'after') value = snapAxis(value, n.h, t.editor.guidesY);
        n[key === 'nodeName' ? 'name' : key] = value;
      }
      if (key === 'anchor') {
        n.after ||= t.nodes.find(x => x.id !== n.id)?.id;
        properties();
      }
      draw();
    };
    if (n.kind === 'text') {
      const rich = $('#richText');
      rich.oninput = () => {
        checkpoint();
        readRich();
        draw();
      };
      rich.onmouseup = rich.onkeyup = () => {
        const sel = getSelection();
        if (sel.rangeCount && rich.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange();
      };
      rich.onclick = e => {
        const token = e.target.closest('[data-field]');
        if (token) {
          const range = document.createRange();
          range.selectNode(token);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          lastRange = range.cloneRange();
          $('[name="runIndex"]').value = token.dataset.run;
          runSettings();
        }
      };
      rich.onpaste = e => {
        e.preventDefault();
        const value = e.clipboardData.getData('text/plain');
        const sel = getSelection();
        if (sel.rangeCount) {
          const r = sel.getRangeAt(0);
          r.deleteContents();
          r.insertNode(document.createTextNode(value));
          checkpoint();
          readRich();
          draw();
        }
      };
      $('[name="runIndex"]').onchange = runSettings;
      runSettings();
    }
  }
  function runSettings() {
    const i = +$('[name="runIndex"]')?.value,
      r = node()?.runs?.[i];
    const box = $('#runSettings');
    if (!box) return;
    if (!r?.field) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `${select("Value format", 'runFormat', [['', 'Automatic'], ['text', 'Text'], ['date', 'Date'], ['money', "Amount"], ['number', "Number"]], r.format || '')}${field("Replacement text for empty data", 'runFallback', r.fallback || '')}${select("Mandatory in output", 'runRequired', [['false', "No"], ['true', "Yes"]], String(!!r.required))}`;
    box.onchange = e => {
      checkpoint();
      r.format = $('[name="runFormat"]').value;
      r.fallback = $('[name="runFallback"]').value;
      r.required = $('[name="runRequired"]').value === 'true';
      draw();
    };
  }
  function styleSelection(prop, value) {
    const rich = $('#richText');
    if (!rich) return;
    checkpoint();
    if (lastRange && rich.contains(lastRange.commonAncestorContainer) && !lastRange.collapsed) {
      const span = document.createElement('span');
      span.style[prop] = value;
      span.append(lastRange.extractContents());
      for (const child of span.querySelectorAll('[style]')) child.style[prop] = value;
      lastRange.insertNode(span);
      lastRange.selectNodeContents(span);
      readRich();
    } else {
      if (prop === 'fontWeight') node().runs = (node().runs || []).map(r => ({
        ...r,
        bold: value === '700'
      }));else if (prop === 'fontStyle') node().runs = (node().runs || []).map(r => ({
        ...r,
        italic: value === 'italic'
      }));else if (prop === 'color') node().color = value;else if (prop === 'fontSize') node().size = parseFloat(value);else node().runs = (node().runs || []).map(r => ({
        ...r,
        underline: value === 'underline'
      }));
    }
    draw();
  }
  async function draw() {
    const id = ++drawId;
    try {
      const d = example(),
        display = clone(t);
      if (showTokens) for (const n of display.nodes) if (n.runs) n.runs = n.runs.map(r => r.field ? {
        ...r,
        text: '[' + (fieldsFor(s)[r.field] || r.field) + ']',
        field: undefined
      } : r);
      const rendered = await renderDocument(d, s, display, loadAsset, {
        preview: true
      });
      for (const m of s.media.filter(m => m.mime?.includes('font'))) {
        if (loadedFonts.has(m.id)) continue;
        const face = new FontFace('media-' + m.id, await loadAsset(m.hash));
        await face.load();
        document.fonts.add(face);
        loadedFonts.add(m.id);
      }
      if (id !== drawId) return;
      lastLayout = rendered;
      $('#designError').textContent = rendered.errors.join(' ');
      const fontStyle = o => `font-family:${['regular', 'bold', 'italic', 'boldItalic'].includes(o.font) ? 'Liberation' : 'media-' + esc(o.font)};font-weight:${o.font === 'bold' || o.font === 'boldItalic' ? '700' : '400'};font-style:${o.font === 'italic' || o.font === 'boldItalic' ? 'italic' : 'normal'}`;
      $('#pages').innerHTML = rendered.pages.map((ops, p) => `<div class="paper" data-page="${p}" style="width:${t.page.width * zoom}px;height:${t.page.height * zoom}px">${t.editor.showRulers ? `<div class="paper-ruler paper-ruler-x">${ruler('x', t.page.width)}</div><div class="paper-ruler paper-ruler-y">${ruler('y', t.page.height)}</div>` : ''}${t.editor.showGrid ? `<div class="paper-grid" style="background-size:${t.editor.gridSize * zoom}px ${t.editor.gridSize * zoom}px"></div>` : ''}${t.editor.guidesX.map(x => `<div class="design-guide vertical" style="left:${x * zoom}px"></div>`).join('')}${t.editor.guidesY.map(y => `<div class="design-guide horizontal" style="top:${y * zoom}px"></div>`).join('')}<svg viewBox="0 0 ${t.page.width} ${t.page.height}" aria-label="Page ${p + 1}">${ops.map(o => o.kind === 'text' ? `<text data-node="${esc(o.nodeId)}" x="${o.x}" y="${o.y}" fill="${esc(o.color)}" font-size="${o.size / PT}" style="${fontStyle(o)}" ${o.underline ? 'text-decoration="underline"' : ''}>${esc(showTokens && t.nodes.find(n => n.id === o.nodeId)?.runs?.some(r => r.field) ? o.text : o.text)}</text>` : o.kind === 'image' ? `${o.clip ? `<defs><clipPath id="crop-${esc(o.nodeId)}-${p}"><rect x="${o.clip.x}" y="${o.clip.y}" width="${o.clip.w}" height="${o.clip.h}"/></clipPath></defs><g clip-path="url(#crop-${esc(o.nodeId)}-${p})">` : ''}<image data-node="${esc(o.nodeId)}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" opacity="${o.opacity ?? 1}" href="${esc(assetUrl(o.hash))}" preserveAspectRatio="none"/>${o.clip ? '</g>' : ''}` : o.kind === 'line' ? `<line data-node="${esc(o.nodeId)}" x1="${o.x}" x2="${o.x + o.w}" y1="${o.y}" y2="${o.y}" stroke="${esc(o.color)}" stroke-width="${Math.max(.1, o.h)}"/>` : `<rect data-node="${esc(o.nodeId)}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${esc(o.color)}" opacity="${o.opacity ?? 1}"/>`).join('')}</svg>${t.nodes.filter(n => {
        const b = rendered.bounds[n.id];
        return b ? b.page === p : p === 0;
      }).map(n => {
        const b = rendered.bounds[n.id] || {
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h
        };
        return `<div class="node-hit ${selected === n.id ? 'chosen' : ''} ${n.locked ? 'locked' : ''}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.name)}${n.locked ? " (locked)" : ''}" style="left:${b.x * zoom}px;top:${b.y * zoom}px;width:${b.w * zoom}px;height:${Math.max(4, b.h) * zoom}px">${selected === n.id ? `<span>${n.locked ? '🔒 ' : ''}${esc(n.name)}</span>${n.locked ? '' : '<i data-resize="true"></i>'}` : ''}</div>`;
      }).join('')}</div>`).join('');
      bindCanvas();
    } catch (e) {
      if (id === drawId) $('#designError').textContent = e.message;
    }
  }
  function bindCanvas() {
    for (const hit of document.querySelectorAll('.node-hit')) {
      hit.onpointerdown = e => {
        if (e.button !== 0) return;
        const id = hit.dataset.node,
          n = t.nodes.find(n => n.id === id);
        selected = id;
        properties();
        if (n.locked) {
          draw();
          return;
        }
        e.preventDefault();
        checkpoint();
        hit.setPointerCapture(e.pointerId);
        const ox = e.clientX,
          oy = e.clientY,
          initial = clone(t.nodes),
          resize = !!e.target.dataset.resize;
        hit.onpointermove = move => {
          const rawX = (move.clientX - ox) / (zoom * interfaceScale()),
            rawY = (move.clientY - oy) / (zoom * interfaceScale());
          for (const target of t.nodes.filter(x => x.id === id || n.group && x.group === n.group)) {
            const start = initial.find(x => x.id === target.id);
            if (resize && target.id === id) {
              const right = snapAxis(start.x + start.w + rawX, 0, t.editor.guidesX),
                bottom = snapAxis(start.y + start.h + rawY, 0, t.editor.guidesY);
              target.w = Math.max(5, Math.min(t.page.width - target.x, right - target.x));
              target.h = Math.max(3, bottom - target.y);
            } else {
              target.x = Math.max(0, Math.min(t.page.width - target.w, snapAxis(start.x + rawX, target.w, t.editor.guidesX)));
              target.y = Math.max(0, snapAxis(start.y + rawY, target.h, t.editor.guidesY));
            }
          }
          const current = t.nodes.find(x => x.id === id),
            start = initial.find(x => x.id === id);
          hit.style.transform = resize ? 'none' : `translate(${(current.x - start.x) * zoom}px,${(current.y - start.y) * zoom}px)`;
          if (resize) {
            hit.style.width = current.w * zoom + 'px';
            hit.style.height = Math.max(4, current.h) * zoom + 'px';
          }
        };
        hit.onpointerup = () => {
          hit.onpointermove = null;
          hit.onpointerup = null;
          properties();
          draw();
        };
      };
      hit.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const n = t.nodes.find(n => n.id === hit.dataset.node);
        if (n.locked) return;
        checkpoint();
        const step = e.shiftKey ? 5 : .5;
        n.x = Math.max(0, Math.min(t.page.width - n.w, n.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0)));
        n.y = Math.max(0, n.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0));
        properties();
        draw();
      };
    }
  }
  on('edSelect', id => {
    selected = id;
    lastRange = null;
    properties();
    draw();
  });
  on('edLayerLock', id => {
    const n = t.nodes.find(n => n.id === id);
    if (!n) return;
    checkpoint();
    n.locked = !n.locked;
    selected = id;
    properties();
    draw();
  });
  on('edLayerUp', id => {
    const index = t.nodes.findIndex(n => n.id === id);
    if (index < 0 || index === t.nodes.length - 1) return;
    checkpoint();
    [t.nodes[index], t.nodes[index + 1]] = [t.nodes[index + 1], t.nodes[index]];
    selected = id;
    properties();
    draw();
  });
  on('edGuideAdd', axis => {
    checkpoint();
    if (axis === 'x') t.editor.guidesX.push(Math.round(t.page.width / 2));else t.editor.guidesY.push(Math.round(t.page.height / 2));
    guideList();
    draw();
  });
  on('edGuideDelete', value => {
    const [axis, index] = value.split(':');
    checkpoint();
    t.editor[axis === 'x' ? 'guidesX' : 'guidesY'].splice(+index, 1);
    guideList();
    draw();
  });
  on('edAdd', kind => {
    checkpoint();
    const n = kind === 'table' ? clone(defaultTemplate().nodes.find(n => n.kind === 'table')) : {
      kind,
      x: 20,
      y: 40,
      w: kind === 'qr' ? 35 : 80,
      h: kind === 'line' ? .3 : kind === 'qr' ? 35 : 15,
      size: 11,
      color: '#147b6d',
      runs: [{
        text: "Custom text"
      }],
      repeat: 'first',
      overflow: 'grow',
      qrType: 'payment'
    };
    n.id = uid();
    n.name = {
      text: 'Text',
      image: "Picture",
      rect: 'Plocha',
      line: "Line",
      qr: "QR code",
      table: 'Table'
    }[kind];
    if (kind === 'image') n.mediaId = s.media.find(m => m.mime?.startsWith('image/'))?.id;
    t.nodes.push(n);
    selected = n.id;
    properties();
    draw();
  });
  on('edField', () => {
    const fields = fieldsFor(s);
    const choice = document.createElement('select');
    choice.innerHTML = "<option value=\"\">Select data…</option>" + Object.entries(fields).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $('#properties').prepend(choice);
    choice.focus();
    choice.onchange = () => {
      if (!choice.value) return;
      checkpoint();
      node().runs.push({
        field: choice.value
      });
      choice.remove();
      properties();
      draw();
    };
  });
  for (const [a, prop, value] of [['edBold', 'fontWeight', '700'], ['edItalic', 'fontStyle', 'italic'], ['edUnderline', 'textDecoration', 'underline']]) on(a, () => {
    let element = lastRange?.startContainer;
    if (element?.nodeType === 3) element = element.parentElement;
    const token = element?.querySelector?.('[data-field]') || element;
    const current = token ? getComputedStyle(token)[prop] : '';
    styleSelection(prop, current === value ? {
      fontWeight: '400',
      fontStyle: 'normal',
      textDecoration: 'none'
    }[prop] : value);
  });
  const undo = () => {
    if (history.length) {
      future.push(clone(t));
      t = history.pop();
      selected = t.nodes.some(n => n.id === selected) ? selected : t.nodes[0]?.id;
      properties();
      guideList();
      historyState();
      draw();
    }
  };
  const redo = () => {
    if (future.length) {
      history.push(clone(t));
      t = future.pop();
      properties();
      guideList();
      historyState();
      draw();
    }
  };
  on('edUndo', undo);
  on('edRedo', redo);
  on('edDelete', () => {
    if (!node() || node().locked) return;
    if (t.nodes.some(n => n.after === selected)) throw Error("First, change the chaining of the blocks that use this element.");
    checkpoint();
    t.nodes = t.nodes.filter(n => n.id !== selected);
    selected = t.nodes[0]?.id;
    properties();
    draw();
  });
  on('edDuplicate', () => {
    checkpoint();
    const n = {
      ...clone(node()),
      id: uid(),
      name: node().name + ' kopie',
      y: node().y + 5
    };
    t.nodes.push(n);
    selected = n.id;
    properties();
    draw();
  });
  for (const [a, fn] of [['edAlignLeft', n => n.x = 14], ['edCenter', n => n.x = (t.page.width - n.w) / 2], ['edFront', n => {
    t.nodes = t.nodes.filter(x => x.id !== n.id);
    t.nodes.push(n);
  }], ['edBack', n => {
    t.nodes = t.nodes.filter(x => x.id !== n.id);
    t.nodes.unshift(n);
  }]]) on(a, () => {
    checkpoint();
    fn(node());
    properties();
    draw();
  });
  on('edColAdd', () => {
    checkpoint();
    node().columns.push({
      key: 'name',
      label: 'Column',
      width: 15
    });
    properties();
    draw();
  });
  on('edColDelete', i => {
    if (node().columns.length === 1) return;
    checkpoint();
    node().columns.splice(+i, 1);
    properties();
    draw();
  });
  on('edColUp', i => {
    if (+i < 1) return;
    checkpoint();
    const c = node().columns;
    [c[i - 1], c[i]] = [c[i], c[i - 1]];
    properties();
    draw();
  });
  on('edTokens', () => {
    showTokens = !showTokens;
    properties();
    draw();
  });
  on('edPdf', async () => {
    const r = await renderDocument(example(), s, t, loadAsset);
    await downloadBytes(r.bytes, 'Nahled-sablony.pdf', 'application/pdf');
  });
  function editorKeys(e) {
    if (!$('#modal .designer')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }
  const persist = async active => {
    validateTemplate(t, s);
    if (active) await renderDocument(example(), s, t, loadAsset);
    const saved = {
      ...t,
      status: active ? 'active' : 'draft'
    };
    await save(saved);
    setDirty(false);
    closeModal();
    toast(active ? "The new version of the template is active." : "Template draft saved.");
  };
  on('edSave', () => persist(false));
  on('edPublish', () => persist(true));
  document.addEventListener('keydown', editorKeys);
  shell();
  setDirty(true);
}
export async function exportTemplate(t, s) {
  const mediaIds = new Set(t.nodes.flatMap(n => [n.mediaId, n.font, ...(n.runs || []).map(r => r.font)]).filter(Boolean)),
    media = s.media.filter(m => mediaIds.has(m.id)),
    fields = s.fields.filter(f => JSON.stringify(t).includes('custom.' + f.id)),
    blobs = {};
  for (const m of media) blobs[m.hash] = {
    base64: bytesBase64(await loadAsset(m.hash)),
    mime: m.mime,
    name: m.name
  };
  const result = {
    format: 'FakturocelTemplate',
    version: 1,
    template: t,
    fields,
    media,
    blobs
  };
  const sealed = await api('export/template', {
    bundle: result
  });
  await downloadBytes(new TextEncoder().encode(sealed.text), 'Sablona-' + t.name.replace(/[^\w-]/g, '_') + ".fakturocel-template");
}
