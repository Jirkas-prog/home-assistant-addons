import { clone, collections, emptyState, validateState } from './model.js';
export function canonical(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const same = (a, b) => canonical(a) === canonical(b);
// Three-way merge: simultaneous changes to the same record are never guessed.
export function mergeData(base, local, remote, choices = {}) {
  const initial = !base;
  base = base || emptyState();
  const result = clone(remote),
    conflicts = [],
    changes = [];
  function choose(key, b, l, r, label) {
    if (same(l, r)) return clone(l);
    if (same(l, b)) return clone(r);
    if (same(r, b)) return clone(l);
    if (choices[key] === 'local') return clone(l);
    if (choices[key] === 'remote') return clone(r);
    conflicts.push({
      key,
      label,
      local: l ?? null,
      remote: r ?? null
    });
    return clone(r);
  }
  for (const collection of collections) {
    const b = new Map(base[collection].map(v => [v.id, v])),
      l = new Map(local[collection].map(v => [v.id, v])),
      r = new Map(remote[collection].map(v => [v.id, v]));
    const ids = new Set([...r.keys(), ...l.keys(), ...b.keys()]);
    result[collection] = [];
    for (const id of ids) {
      const key = collection + ':' + id,
        label = (l.get(id) || r.get(id) || b.get(id))?.number || (l.get(id) || r.get(id) || b.get(id))?.name || id;
      const value = choose(key, b.get(id), l.get(id), r.get(id), collection + ' · ' + label);
      if (value !== undefined) result[collection].push(value);
      if (!same(value, r.get(id))) changes.push({
        key,
        label,
        action: value === undefined ? 'delete' : r.has(id) ? 'update' : 'add'
      });
    }
  }
  // Supplier and independent settings are separate conflicts, not a whole-database choice.
  result.supplier = choose('supplier', base.supplier, local.supplier, remote.supplier, "Supplier data");
  for (const key of new Set([...Object.keys(local.settings), ...Object.keys(remote.settings), ...Object.keys(base.settings)])) {
    const value = choose('settings:' + key, base.settings[key], local.settings[key], remote.settings[key], "Settings · " + key);
    if (value === undefined) delete result.settings[key];else result.settings[key] = value;
  }
  if (!same(result.supplier, remote.supplier)) changes.push({
    key: 'supplier',
    label: "Supplier",
    action: 'update'
  });
  if (!same(result.settings, remote.settings)) changes.push({
    key: 'settings',
    label: "Settings",
    action: 'update'
  });
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (['schema', 'supplier', 'settings', 'usedNumbers', 'audit', 'migrations', ...collections].includes(key)) continue;
    const value = choose('extra:' + key, base[key], local[key], remote[key], "Additional dates · " + key);
    if (value === undefined) delete result[key];else result[key] = value;
  }
  result.usedNumbers = [...new Set([...remote.usedNumbers, ...local.usedNumbers])];
  result.audit = [...new Map([...remote.audit, ...local.audit].map(x => [x.id, x])).values()];
  result.migrations = [...new Set([...(remote.migrations || []), ...(local.migrations || [])])];
  if (!conflicts.length) {
    validateState(result);
    if (!result.templates.some(t => t.id === result.settings.templateId && t.status === 'active')) throw Error("Merged data needs an active default template. Select it in the settings before transferring.");
    for (const company of base.companies) if (!result.companies.some(c => c.id === company.id) && result.documents.some(d => d.customer?.id === company.id)) throw Error("Unable to merge company deletions " + company.name + ", which the document used in the meantime. Archive the company.");
  }
  return {
    state: result,
    conflicts,
    changes,
    initial
  };
}
