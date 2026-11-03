export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[c]);

// User-authored text must not be interpreted as an interface translation key.
export const userText = value => `<span data-no-translate>${esc(value)}</span>`;
