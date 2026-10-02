import { recordImportance } from "../shared/importance.js";

export function labelEligible(node, scale, selected, hover) {
  if (node.id === selected || node.id === hover) return true;
  if (node.context) return node.depth === 0;
  const radius = node.r * scale;
  if (radius > 80) return false;
  return (
    radius >= (node.matched ? 0.1 : 5) ||
    (node.childCount > 0 && node.extent * scale >= 28 && radius >= 0.1) ||
    (node.depth <= 1 && radius >= 0.4)
  );
}

// A screen-space grid prevents labels from overlapping, independent of zoom.
export function declutterLabels(candidates, width, height, selected, hover) {
  const bins = new Map(),
    visible = new Set(),
    cell = 100;
  const cells = ([x, y, w, h]) => {
    const keys = [];
    for (let a = Math.floor(x / cell); a <= Math.floor((x + w) / cell); a++)
      for (let b = Math.floor(y / cell); b <= Math.floor((y + h) / cell); b++)
        keys.push(`${a}:${b}`);
    return keys;
  };
  const priority = (n) =>
    (n.id === hover ? 2000 : n.id === selected ? 1000 : 0) +
    (n.matched ? 100 : 0) +
    recordImportance(n) * 6 -
    n.depth * 8;
  candidates.sort(
    (a, b) =>
      priority(b.node) - priority(a.node) || a.node.id.localeCompare(b.node.id),
  );
  for (const { node, box } of candidates) {
    const [x, y, w, h] = box;
    if (x + w < 0 || y + h < 0 || x > width || y > height) continue;
    const keys = cells(box);
    if (
      keys.some((key) =>
        (bins.get(key) || []).some(
          ([a, b, c, d]) =>
            x < a + c + 5 && x + w + 5 > a && y < b + d + 5 && y + h + 5 > b,
        ),
      )
    )
      continue;
    visible.add(node.id);
    for (const key of keys) {
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(box);
    }
  }
  return visible;
}
