import { esc } from './escape.js';
export { esc };
export const $ = s => document.querySelector(s);
export const button = (action, label, cls = 'secondary') => `<button type="button" data-action="${esc(action)}" class="${cls}">${label}</button>`;
export const field = (label, name, value = '', type = 'text', extra = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const select = (label, name, options, value = '') => `<label>${esc(label)}<select name="${esc(name)}">${options.map(o => {
  const [v, l] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
}).join('')}</select></label>`;
export const area = (label, name, value = '', extra = '') => `<label>${esc(label)}<textarea name="${esc(name)}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
export const table = (heads, rows) => `<div class="table-wrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="empty">No records yet.</td></tr>`}</tbody></table></div>`;
export const actions = new Map();
export const on = (key, fn) => actions.set(key, fn);
const modalStack = [];
let busy = false,
  activeJob = Promise.resolve(),
  closeHook = null,
  modalOpener = null,
  messageTail = Promise.resolve(),
  toastTimer;
export let modalDirty = false;
export const setDirty = v => {
  modalDirty = v;
};
function trapFocus(e, root) {
  if (e.key !== 'Tab') return;
  const items = [...root.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(e => e.getClientRects().length);
  if (!items.length) return;
  const first = items[0],
    last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
function messageDialog({
  title,
  message,
  details = '',
  confirmText = "I understand",
  cancelText = '',
  danger = false,
  password = false
}) {
  const open = () => new Promise(resolve => {
    const previous = document.activeElement,
      overlay = document.createElement('div');
    overlay.id = 'messageOverlay';
    overlay.className = 'message-veil';
    overlay.innerHTML = `<section class="message-dialog ${danger ? 'message-error' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="messageTitle" aria-describedby="messageText"><div class="message-symbol" aria-hidden="true">${danger ? '!' : '?'}</div><h2 id="messageTitle">${esc(title)}</h2><p id="messageText">${esc(message)}</p>${details ? `<details><summary>Details</summary><pre>${esc(details)}</pre></details>` : ''}<div class="form-actions">${cancelText ? `<button type="button" data-message="cancel">${esc(cancelText)}</button>` : ''}<button type="button" class="${danger ? 'danger-fill' : 'primary'}" data-message="ok">${esc(confirmText)}</button></div></section>`;
    if (password) overlay.querySelector('.form-actions').insertAdjacentHTML('beforebegin', "<label>Password<input id=\"messagePassword\" type=\"password\" autocomplete=\"current-password\" maxlength=\"256\"></label><p id=\"passwordProblem\" class=\"field-error\" role=\"status\"></p>");
    const covered = [...document.body.children].filter(x => x !== overlay && x.tagName !== 'SCRIPT').map(el => ({
      el,
      inert: el.inert
    }));
    covered.forEach(({
      el
    }) => el.inert = true);
    document.body.append(overlay);
    const finish = value => {
      overlay.remove();
      covered.forEach(({
        el,
        inert
      }) => el.inert = inert);
      if (previous?.isConnected) previous.focus();
      resolve(value);
    };
    const accept = () => {
      const input = overlay.querySelector('#messagePassword');
      if (password && !input.value) {
        overlay.querySelector('#passwordProblem').textContent = "Enter your password.";
        input.focus();
        return;
      }
      const value = password ? input.value : true;
      if (input) input.value = '';
      finish(value);
    };
    overlay.querySelector('[data-message="ok"]').onclick = accept;
    overlay.querySelector('[data-message="cancel"]')?.addEventListener('click', () => finish(password ? null : false));
    overlay.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(password ? null : !cancelText);
      } else if (password && e.key === 'Enter') {
        e.preventDefault();
        accept();
      } else trapFocus(e, overlay);
    };
    (overlay.querySelector('#messagePassword') || overlay.querySelector('[data-message="cancel"]') || overlay.querySelector('[data-message="ok"]')).focus();
  });
  const pending = messageTail.then(open);
  messageTail = pending.catch(() => {});
  return pending;
}
export const confirmDialog = (message, options = {}) => messageDialog({
  title: "Confirm the change",
  message,
  confirmText: "Continue",
  cancelText: "Cancel",
  ...options
});
export const requestPassword = (message, title = "The password for the encrypted file") => messageDialog({
  title,
  message,
  password: true,
  confirmText: "Continue",
  cancelText: "Cancel"
});
export function showError(error, title = "The action could not be completed") {
  const e = error instanceof Error ? error : Error(String(error || "Unknown error."));
  let message = e.message,
    details = '';
  if (e instanceof SyntaxError || /Unexpected token|JSON at position|JSON\.parse|not valid JSON/i.test(message)) {
    details = message;
    message = "The file is invalid or corrupted. Select the correct file and try again.";
  } else if (/Failed to fetch|NetworkError|Load failed|timed out|timeout/i.test(message)) {
    details = message;
    message = "The connection to the server has been lost. Verify the connection and try the action again. The detailed data remains in the open form.";
  } else if (/Cannot (?:read|set)|is not a function|is not defined|Invalid|Failed to|ENOENT|EACCES|ENOSPC|Unknown|unsupported|not supported|NaN/i.test(message)) {
    details = message;
    message = "The operation could not be completed. Check the entered data or the selected file. The error details are given below.";
  }
  if (e.status === 409 || e.status === 403) {
    const box = $('#conflict');
    if (box) {
      box.hidden = false;
      box.querySelector('span').textContent = message;
    }
  }
  return messageDialog({
    title: e.status === 409 ? "Data has changed" : title,
    message,
    details,
    danger: true
  }).then(() => {
    if (e.field?.isConnected) e.field.focus();
  });
}
export function toast(text, error = false) {
  if (error) {
    void showError(text, "Notice");
    return;
  }
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').className = 'show';
  toastTimer = setTimeout(() => $('#toast').className = '', 9000);
}
export function job(fn) {
  const task = activeJob.then(async () => {
    busy = true;
    document.body.classList.add('busy');
    try {
      return await fn();
    } catch (e) {
      await showError(e);
    } finally {
      busy = false;
      document.body.classList.remove('busy');
    }
  });
  activeJob = task.catch(() => {});
  return task;
}
function focusKey(el) {
  if (!el) return null;
  if (el.id) return {
    kind: 'id',
    value: el.id
  };
  if (el.name) return {
    kind: 'name',
    value: el.name
  };
  if (el.dataset?.action) return {
    kind: 'action',
    value: el.dataset.action
  };
  if (el.dataset?.item) {
    return {
      kind: 'item',
      value: el.dataset.item,
      index: el.closest('[data-item-index]')?.dataset.itemIndex
    };
  }
  return null;
}
function findFocus(key) {
  if (!key) return null;
  const safe = value => CSS.escape(String(value));
  if (key.kind === 'id') return document.getElementById(key.value);
  if (key.kind === 'name') return $(`[name="${safe(key.value)}"]`);
  if (key.kind === 'action') return $(`[data-action="${safe(key.value)}"]`);
  if (key.kind === 'item') return $(`[data-item-index="${safe(key.index)}"] [data-item="${safe(key.value)}"]`);
  return null;
}
export function modal(title, body, setup, onClosed, key = title) {
  const host = $('#modal'),
    previous = host.querySelector('.dialog'),
    same = host.dataset.modalKey === key,
    scrolls = same && previous ? [previous, ...previous.querySelectorAll('[data-preserve-scroll]')].map((el, i) => ({
      i,
      top: el.scrollTop,
      left: el.scrollLeft
    })) : [],
    active = same ? focusKey(document.activeElement) : null,
    selection = same && document.activeElement && 'selectionStart' in document.activeElement ? {
      start: document.activeElement.selectionStart,
      end: document.activeElement.selectionEnd
    } : null;
  if (!same) {
    closeHook?.();
    closeHook = onClosed || null;
    modalOpener = document.activeElement;
  } else if (onClosed) closeHook = onClosed;
  const formLike = /<form\b|contenteditable=|class="designer\b/i.test(body),
    backLabel = formLike ? "Cancel and close" : "Back";
  host.dataset.modalTitle = title;
  host.dataset.modalKey = key;
  host.innerHTML = `<div class="veil"><section class="dialog" role="dialog" aria-modal="${$('#calculator-panel') ? 'false' : 'true'}" aria-label="${esc(title)}"><header class="dialog-head"><h2>${esc(title)}</h2>${button('closeModal', '×', 'icon')}</header>${body}<footer class="dialog-bottom">${button('closeModal', backLabel)}</footer></section></div>`;
  modalDirty = same ? modalDirty : false;
  for (const form of host.querySelectorAll('form')) form.noValidate = true;
  setup?.();
  const containers = [host.querySelector('.dialog'), ...host.querySelectorAll('[data-preserve-scroll]')];
  for (const pos of scrolls) {
    const el = containers[pos.i];
    if (el) {
      el.scrollTop = pos.top;
      el.scrollLeft = pos.left;
    }
  }
  const target = findFocus(active);
  if (target) {
    target.focus({
      preventScroll: true
    });
    if (selection && 'setSelectionRange' in target) try {
      target.setSelectionRange(selection.start, selection.end);
    } catch {}
  } else if (!same) (host.querySelector('input,select,textarea,[contenteditable="true"],button:not(.icon)') || host.querySelector('button'))?.focus({
    preventScroll: true
  });
}
export async function closeModal() {
  if (modalDirty && !(await confirmDialog("Discard unsaved changes?", {
    title: "Unsaved changes",
    confirmText: "Discard changes",
    cancelText: "Continue editing",
    danger: true
  }))) return false;
  closeHook?.();
  closeHook = null;
  const opener = modalOpener;
  $('#modal').innerHTML = '';
  delete $('#modal').dataset.modalTitle;
  delete $('#modal').dataset.modalKey;
  modalDirty = false;
  if (modalStack.length) {
    const previous = modalStack.pop();
    $('#modal').append(...previous.nodes);
    $('#modal').dataset.modalTitle = previous.title || '';
    $('#modal').dataset.modalKey = previous.key || previous.title || '';
    modalDirty = previous.dirty;
    closeHook = previous.closeHook;
    modalOpener = previous.opener;
    previous.active?.focus?.({
      preventScroll: true
    });
  } else {
    modalOpener = null;
    if (opener?.isConnected) opener.focus({
      preventScroll: true
    });
  }
  return true;
}
on('closeModal', closeModal);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const a = b.dataset.action,
    fn = actions.get(a) || actions.get(a.split(':')[0]);
  if (fn) void job(() => fn(a.slice(a.indexOf(':') + 1), b, e));
});
document.addEventListener('input', e => {
  if (e.target.closest('#modal form')) modalDirty = true;
  e.target.removeAttribute('aria-invalid');
  e.target.parentElement?.querySelector('[data-validation-error]')?.remove();
});
document.addEventListener('invalid', e => e.preventDefault(), true);
document.addEventListener('submit', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if ($('#messageOverlay') || e.target.closest('#calculator-root')) return;
  const root = $('#modal .dialog');
  if (!root) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    void job(closeModal);
  } else trapFocus(e, root);
});
window.addEventListener('error', e => {
  if (e.error) {
    e.preventDefault();
    void showError(e.error);
  }
});
window.addEventListener('unhandledrejection', e => {
  e.preventDefault();
  void showError(e.reason);
});
export function validateForm(form) {
  const f = typeof form === 'string' ? $(form) : form;
  let first;
  const problems = [];
  f.noValidate = true;
  f.querySelectorAll('[data-validation-error]').forEach(e => e.remove());
  for (const el of f.querySelectorAll('input,select,textarea')) {
    el.removeAttribute('aria-invalid');
    if (el.disabled || !el.willValidate || el.validity.valid) continue;
    const label = el.closest('label'),
      name = label ? [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : el.name;
    const v = el.validity;
    let text = v.valueMissing ? "Fill in this field." : v.badInput ? "Please enter a valid number." : v.typeMismatch ? "Enter the value in the correct format." : v.rangeUnderflow ? `The smallest allowed value is ${el.min}.` : v.rangeOverflow ? `The largest allowed value is ${el.max}.` : v.stepMismatch ? `Use the value in steps ${el.step || 1}.` : v.tooLong ? "Shorten the text." : 'Oprav hodnotu v tomto poli.';
    el.setAttribute('aria-invalid', 'true');
    const hint = document.createElement('span');
    hint.className = 'field-error';
    hint.dataset.validationError = 'true';
    hint.textContent = text;
    el.after(hint);
    problems.push((name || 'Field') + ': ' + text);
    first ||= el;
  }
  if (first) throw Object.assign(Error(problems.join('\n')), {
    field: first
  });
  return true;
}
export function values(form = '#recordForm') {
  const f = $(form);
  validateForm(f);
  return Object.fromEntries(new FormData(f));
}
export function formDialog(title, html, save) {
  modal(title, `<form id="recordForm" novalidate>${html}<div class="form-actions sticky-actions">${button('formSave', "Impose", 'primary')}${button('closeModal', "Cancel")}</div></form>`);
  on('formSave', async () => {
    await save(values());
    modalDirty = false;
    await closeModal();
  });
}
export function picker(title, items, selected) {
  if ($('#modal').childNodes.length) {
    const nodes = [...$('#modal').childNodes];
    modalStack.push({
      nodes,
      dirty: modalDirty,
      closeHook,
      opener: modalOpener,
      active: document.activeElement,
      title: $('#modal').dataset.modalTitle,
      key: $('#modal').dataset.modalKey
    });
    closeHook = null;
    modalOpener = null;
    for (const n of nodes) n.remove();
    delete $('#modal').dataset.modalTitle;
    delete $('#modal').dataset.modalKey;
  }
  modal(title, `<input id="pickerSearch" placeholder="Search by name or company ID…" class="picker-search"><div id="pickerResults" class="picker-results" data-preserve-scroll></div>`, () => {
    let rows = items,
      index = 0;
    const draw = () => {
      $('#pickerResults').innerHTML = rows.map((r, i) => `<button type="button" data-pick="${i}" class="picker-row ${index === i ? 'selected' : ''}"><strong>${esc(r.label)}</strong><small>${esc(r.detail)}</small></button>`).join('') || "<p>No result.</p>";
    };
    const search = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    $('#pickerSearch').oninput = e => {
      rows = items.filter(r => search(r.label + ' ' + r.detail).includes(search(e.target.value)));
      index = 0;
      draw();
    };
    const choose = async index => {
      modalDirty = false;
      await closeModal();
      await selected(rows[index]);
    };
    $('#pickerResults').onclick = e => {
      const b = e.target.closest('[data-pick]');
      if (b) void job(() => choose(+b.dataset.pick));
    };
    $('#pickerSearch').onkeydown = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        index = Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
        e.preventDefault();
        draw();
        $('#pickerResults [data-pick="' + index + '"]')?.scrollIntoView({
          block: 'nearest'
        });
      }
      if (e.key === 'Enter' && rows[index]) {
        e.preventDefault();
        void job(() => choose(index));
      }
    };
    draw();
  });
}
