const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Metadata is merged by field. Text stays an explicit user choice whenever both
// writers changed it; no heuristic silently drops overlapping edits.
export function compareChanges(base, mine, current) {
  const merged = { ...current },
    conflicts = [];
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(current),
  ])) {
    if (
      ["revision", "file", "updated", "created", "targetRevision"].includes(key)
    )
      continue;
    if (equal(mine[key], base[key])) continue;
    if (equal(current[key], base[key]) || equal(current[key], mine[key])) {
      if (mine[key] === undefined) delete merged[key];
      else merged[key] = mine[key];
    } else
      conflicts.push({
        key,
        base: base[key],
        mine: mine[key],
        current: current[key],
      });
  }
  return { merged, conflicts };
}
