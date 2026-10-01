const names = {
  number: "Number",
  date: "Issue date",
  due: "Due date",
  status: "State",
  currency: "Currency",
  payment: "Method of payment",
  vs: "Variable symbol",
  discount: 'Discount',
  intro: "Introductory text",
  notes: "Note",
  customer: "Customer",
  supplier: "Supplier",
  items: "Items",
  name: "Name",
  street: 'Street',
  city: "City",
  zip: "Postal code",
  ico: "ID number",
  dic: "Tax ID",
  contact: 'Contact',
  email: 'E-mail',
  phone: 'Phone',
  qty: "Quantity",
  unit: "Unit",
  price: "Price",
  custom: "Custom fields",
  archived: "Archived",
  templateId: "Template",
  reason: "Reason",
  title: "Description",
  severity: "Severity",
  hours: 'Hours',
  description: "Job description"
};
const scalar = value => value === null || value === undefined ? '—' : typeof value === 'boolean' ? value ? "Yes" : "No" : typeof value === 'string' && value.length > 180 ? value.slice(0, 177) + '…' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function label(path) {
  return path.map(part => typeof part === 'number' ? `Item ${part + 1}` : names[part] || part).join(' › ');
}
export function fieldDiff(local, remote) {
  const rows = [];
  function walk(a, b, path = []) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a) ? a : [],
        bb = Array.isArray(b) ? b : [],
        length = Math.max(aa.length, bb.length);
      for (let i = 0; i < length; i++) walk(aa[i], bb[i], [...path, i]);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], [...path, key]);
      return;
    }
    rows.push({
      path: path.join('.'),
      label: label(path),
      local: scalar(a),
      remote: scalar(b)
    });
  }
  walk(local, remote);
  return rows;
}
export function recordChange(state, collection, id) {
  const events = (state.audit || []).filter(event => event.collection === collection && event.recordId === id).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))),
    event = events[0];
  if (!event) return {
    source: "Original or imported data",
    at: '',
    actor: ''
  };
  const local = event.actorId === 'local-owner',
    source = local ? "Standalone application" : event.actorId ? 'Home Assistant' : 'Import';
  return {
    source,
    at: event.at || '',
    actor: event.actor || '',
    action: event.action || ''
  };
}
export function changeLabel(info) {
  const displayLocale = typeof document !== 'undefined' && document.documentElement?.lang === 'cs' ? 'cs-CZ' : 'en-GB',
    at = info.at ? new Date(info.at).toLocaleString(displayLocale) : "the time is unknown",
    actor = info.actor && info.actor !== "Device owner" ? ' · ' + info.actor : '';
  return `${info.source}${actor} · ${at}`;
}
