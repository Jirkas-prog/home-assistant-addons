import { filterNodes } from "./atlas-model.js";
import { mapNodeRadius } from "./map-node-geometry.js";
import { recordImportance } from "../shared/importance.js";

export { MAP_LAYOUTS } from "../shared/map-layouts.js";

// Content, translations and filters do not invalidate geometric positions.
export function layoutKey(nodes, layout, dimensions) {
  return JSON.stringify([
    7,
    layout,
    dimensions,
    nodes
      .map((n) => [n.id, n.parent, n.type, recordImportance(n)])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
}

// Importance still distinguishes peers; a descendant never outgrows its parent.
// The smooth cap keeps even very deep trees positive rather than underflowing.
function hierarchyRadius(radius, parentRadius) {
  return parentRadius == null
    ? radius
    : Math.min(radius, parentRadius / (1 + parentRadius * 0.006));
}

function hierarchy(nodes) {
  const records = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map(),
    roots = [],
    ordered = [],
    seen = new Set();
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!records.has(n.parent)) roots.push(n);
    else {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
  }
  function walk(root) {
    const queue = [{ n: root, depth: 0 }];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (seen.has(item.n.id)) continue;
      seen.add(item.n.id);
      ordered.push(item);
      for (const child of children.get(item.n.id) || [])
        if (!seen.has(child.id))
          queue.push({ n: child, depth: item.depth + 1 });
    }
  }
  roots.forEach(walk);
  // An invalid manual hierarchy must not make every remaining record disappear.
  for (const n of nodes)
    if (!seen.has(n.id)) {
      roots.push(n);
      walk(n);
    }
  const depth = new Map(ordered.map(({ n, depth }) => [n.id, depth]));
  for (const [id, items] of children)
    children.set(
      id,
      items.filter((n) => depth.get(n.id) > depth.get(id)),
    );
  return { roots, ordered, children };
}

function classicLayout(nodes) {
  const { roots, ordered, children } = hierarchy(nodes),
    weights = new Map(),
    radii = new Map();
  for (const { n } of [...ordered].reverse())
    weights.set(
      n.id,
      Math.max(
        1,
        (children.get(n.id) || []).reduce((s, c) => s + weights.get(c.id), 0),
      ),
    );
  const queue = roots.map((n, i) => ({
    n,
    depth: 0,
    start: (i * Math.PI * 2) / roots.length,
    end: ((i + 1) * Math.PI * 2) / roots.length,
  }));
  const positions = [];
  for (let i = 0; i < queue.length; i++) {
    const { n, depth, start, end } = queue[i];
    const angle = (start + end) / 2 - Math.PI / 2,
      radius = depth * 145 + (roots.length > 1 ? 90 : 0);
    radii.set(
      n.id,
      hierarchyRadius(mapNodeRadius(n, depth), radii.get(n.parent)),
    );
    positions.push({
      id: n.id,
      depth,
      childCount: (children.get(n.id) || []).length,
      r: radii.get(n.id),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: depth ? Math.sin(angle * 2 + depth) * 90 * depth : 0,
    });
    let cursor = start;
    for (const c of children.get(n.id) || []) {
      const span = ((end - start) * weights.get(c.id)) / weights.get(n.id);
      queue.push({ n: c, depth: depth + 1, start: cursor, end: cursor + span });
      cursor += span;
    }
  }
  return positions;
}

// Pack disjoint subtree boxes into shelves, with extra space for group boundaries.
function shelves(items, dimensions, multiplier = 1) {
  const volume = items.reduce(
    (sum, item) =>
      sum + item.size.slice(0, dimensions).reduce((a, b) => a * b, 1),
    0,
  );
  const target =
    multiplier *
    Math.max(volume ** (1 / dimensions), ...items.flatMap((item) => item.size));
  const extent = [0, 0, 0],
    cursor = [0, 0, 0];
  let rowHeight = 0,
    layerDepth = 0;
  const slots = items.map((item) => {
    const [w, h, d] = item.size;
    if (cursor[0] && cursor[0] + w > target) {
      cursor[0] = 0;
      cursor[1] += rowHeight;
      rowHeight = 0;
    }
    if (dimensions === 3 && cursor[1] && cursor[1] + h > target) {
      cursor[0] = cursor[1] = rowHeight = 0;
      cursor[2] += layerDepth;
      layerDepth = 0;
    }
    const center = cursor.map((v, axis) => v + item.size[axis] / 2);
    cursor[0] += w;
    rowHeight = Math.max(rowHeight, h);
    layerDepth = Math.max(layerDepth, d);
    center.forEach((v, axis) => {
      extent[axis] = Math.max(extent[axis], v + item.size[axis] / 2);
    });
    return { id: item.id, center };
  });
  for (const slot of slots)
    slot.center = slot.center.map((v, axis) => v - extent[axis] / 2);
  return {
    slots,
    size: extent,
    radius: Math.hypot(...extent.slice(0, dimensions)) / 2,
  };
}

// Golden-angle shells fill a plane or a volume. A spatial grid rejects collisions
// against entire child subtrees, not only their central stars.
function nebula(items, dimensions) {
  const cell = Math.max(...items.map((n) => n.radius * 2)),
    bins = new Map(),
    slots = [];
  const key = (x, y, z) => `${x},${y},${z}`;
  const conflicts = (p, r) => {
    const c = p.map((v) => Math.floor(v / cell));
    for (let x = c[0] - 1; x <= c[0] + 1; x++)
      for (let y = c[1] - 1; y <= c[1] + 1; y++)
        for (
          let z = dimensions === 3 ? c[2] - 1 : 0;
          z <= (dimensions === 3 ? c[2] + 1 : 0);
          z++
        )
          for (const other of bins.get(key(x, y, z)) || [])
            if (
              Math.hypot(...p.map((v, axis) => v - other.center[axis])) <
              r + other.radius + 1
            )
              return true;
    return false;
  };
  let cursor = 0,
    previousRadius = 0;
  for (const item of items) {
    if (item.radius !== previousRadius) cursor = 0;
    previousRadius = item.radius;
    let center;
    do {
      if (slots.length === 1 && cursor === 0) {
        cursor++;
        center = [slots[0].radius + item.radius + 2, 0, 0];
        break;
      }
      const i = cursor++,
        angle = i * 2.399963229728653;
      const distance =
        i === 0 ? 0 : (item.radius * 2 + 4) * i ** (1 / dimensions);
      const z = dimensions === 3 ? 2 * ((i * 0.618033988749895) % 1) - 1 : 0;
      const planar = Math.sqrt(1 - z * z);
      center = [
        Math.cos(angle) * distance * planar,
        Math.sin(angle) * distance * planar,
        z * distance,
      ];
    } while (conflicts(center, item.radius));
    const slot = { id: item.id, center, radius: item.radius };
    slots.push(slot);
    const bin = key(...center.map((v) => Math.floor(v / cell)));
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(slot);
  }
  const min = [0, 1, 2].map((axis) =>
    Math.min(...slots.map((s) => s.center[axis] - s.radius)),
  );
  const max = [0, 1, 2].map((axis) =>
    Math.max(...slots.map((s) => s.center[axis] + s.radius)),
  );
  const center = min.map((v, axis) => (v + max[axis]) / 2);
  if (dimensions === 2) center[2] = 0;
  slots.forEach((s) => {
    s.center = s.center.map((v, axis) => v - center[axis]);
  });
  const radius = Math.max(
    ...slots.map((s) => Math.hypot(...s.center) + s.radius),
  );
  return {
    slots,
    radius,
    size: [radius * 2, radius * 2, dimensions === 3 ? radius * 2 : 0],
  };
}

function compactShelves(items, dimensions) {
  return [1, 1.35, 1.8]
    .map((factor) => shelves(items, dimensions, factor))
    .sort(
      (a, b) =>
        Math.max(
          a.size[0] / (dimensions === 2 ? 1.4 : 1),
          a.size[1],
          a.size[2],
        ) -
        Math.max(
          b.size[0] / (dimensions === 2 ? 1.4 : 1),
          b.size[1],
          b.size[2],
        ),
    )[0];
}

// Keep compact subtree boxes, but vary the packing axes at every branch.
// Bounded jitter stays inside each reserved cell, including its complete subtree.
// Unlike nested bounding spheres, boxes do not inflate empty corners at each level.
function constellation(items, dimensions, id) {
  let seed = 2166136261;
  for (const character of id)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  const axes = dimensions === 3 ? [0, 1, 2] : [0, 1];
  for (let i = axes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [axes[i], axes[j]] = [axes[j], axes[i]];
  }
  const signs = axes.map(() => (random() < 0.5 ? -1 : 1));
  const gap = items.length > 1 ? 32 : 0;
  const group = compactShelves(
    items.map((item) => {
      const size = axes.map((axis) => item.size[axis] + gap);
      if (dimensions === 2) size.push(0);
      return { ...item, size };
    }),
    dimensions,
  );
  const size = [0, 0, 0];
  axes.forEach((axis, i) => {
    size[axis] = group.size[i];
  });
  for (const slot of group.slots) {
    const center = [0, 0, 0];
    axes.forEach((axis, i) => {
      center[axis] = slot.center[i] * signs[i] + (random() - 0.5) * gap;
    });
    slot.center = center;
  }
  return { ...group, size };
}

// Reserve an entire horizontal column for each subtree. Parents sit above
// their children; same-depth nodes cannot overlap and chains need no extra width.
function terraces({ roots, ordered, children }, geometry, dimensions) {
  const packed = new Map();
  const pack = (items) => {
    if (!items.length) return { slots: [], size: [120, 120, 0] };
    if (items.length === 1)
      return {
        slots: [{ id: items[0].id, center: [0, 0, 0] }],
        size: items[0].size,
      };
    if (dimensions === 3)
      return shelves(
        items.map((item) => ({
          ...item,
          size: [item.size[0] + 50, item.size[1] + 50, 0],
        })),
        2,
      );
    const width = items.reduce((sum, item) => sum + item.size[0] + 50, -50);
    let cursor = -width / 2;
    const slots = items.map((item) => {
      const center = [cursor + item.size[0] / 2, 0, 0];
      cursor += item.size[0] + 50;
      return { id: item.id, center };
    });
    return { slots, size: [width, 0, 0] };
  };
  for (const { n } of [...ordered].reverse()) {
    const items = (children.get(n.id) || []).map((child) => ({
      id: child.id,
      ...packed.get(child.id),
    }));
    const group = pack(items);
    group.levels = items.reduce(
      (levels, item) => Math.max(levels, item.levels + 1),
      0,
    );
    packed.set(n.id, group);
  }
  const forest = pack(roots.map((n) => ({ id: n.id, ...packed.get(n.id) })));
  const queue = forest.slots.map((slot) => ({
    id: slot.id,
    offset: slot.center,
  }));
  const maxDepth = ordered.reduce(
    (depth, item) => Math.max(depth, item.depth),
    0,
  );
  // Wide 3D trees need taller levels to make their depth readable from an angle.
  const levelGap =
    dimensions === 3
      ? Math.max(200, Math.min(forest.size[0], forest.size[1]) / (maxDepth + 1))
      : 200;
  const middle = (maxDepth * levelGap) / 2;
  const positions = [];
  for (let i = 0; i < queue.length; i++) {
    const { id, offset } = queue[i],
      group = packed.get(id),
      node = geometry.get(id);
    positions.push({
      ...node,
      x: offset[0],
      y: (node.depth * levelGap - middle) * (dimensions === 3 ? -1 : 1),
      z: dimensions === 3 ? offset[1] : 0,
      extent: Math.hypot(
        group.size[0] / 2,
        dimensions === 3 ? group.size[1] / 2 : 0,
        group.levels * levelGap,
      ),
    });
    for (const slot of group.slots)
      queue.push({
        id: slot.id,
        offset: slot.center.map((v, axis) => v + offset[axis]),
      });
  }
  return positions;
}

export function computeLayout(nodes, layout = "classic", dimensions = 2) {
  if (!nodes.length) return [];
  if (layout === "classic") return classicLayout(nodes);
  const { roots, ordered, children } = hierarchy(nodes);
  const geometry = new Map();
  for (const { n, depth } of ordered)
    geometry.set(n.id, {
      id: n.id,
      depth,
      childCount: (children.get(n.id) || []).length,
      r: hierarchyRadius(
        Math.max(11, 32 / (1 + depth * 0.45)) *
          (0.6 + recordImportance(n) * 0.14),
        geometry.get(n.parent)?.r,
      ),
    });
  if (layout === "terraces")
    return terraces({ roots, ordered, children }, geometry, dimensions);
  if (layout === "grid") {
    const width = Math.ceil(nodes.length ** (1 / dimensions)),
      spacing = 160;
    const traversal = [],
      stack = [...roots].reverse();
    while (stack.length) {
      const n = stack.pop();
      traversal.push(n);
      stack.push(...[...(children.get(n.id) || [])].reverse());
    }
    return traversal.map((n, i) => ({
      ...geometry.get(n.id),
      x:
        ((Math.floor(i / width) % 2 ? width - 1 - (i % width) : i % width) -
          (width - 1) / 2) *
        spacing,
      y:
        ((dimensions === 3
          ? Math.floor(i / width) % width
          : Math.floor(i / width)) -
          (width - 1) / 2) *
        spacing,
      z:
        dimensions === 3
          ? (Math.floor(i / width ** 2) - (width - 1) / 2) * spacing
          : 0,
      extent: spacing,
    }));
  }
  const packed = new Map();
  const pack = (items, id) =>
    layout === "constellations"
      ? constellation(items, dimensions, id)
      : layout === "nebula"
        ? nebula(items, dimensions)
        : compactShelves(items, dimensions);
  for (const { n } of [...ordered].reverse()) {
    const radius = geometry.get(n.id).r + 35;
    const own = {
      id: n.id,
      radius,
      size: [radius * 2, radius * 2, dimensions === 3 ? radius * 2 : 0],
    };
    const items = (children.get(n.id) || []).map((c) => ({
      id: c.id,
      ...packed.get(c.id),
    }));
    items.sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id));
    packed.set(n.id, pack([own, ...items], n.id));
  }
  const forest = pack(
    roots.map((n) => ({ id: n.id, ...packed.get(n.id) })),
    "forest",
  );
  const queue = forest.slots.map((s) => ({ id: s.id, offset: s.center })),
    result = [];
  for (let i = 0; i < queue.length; i++) {
    const { id, offset } = queue[i],
      group = packed.get(id);
    for (const slot of group.slots) {
      const position = slot.center.map((v, axis) => v + offset[axis]);
      if (slot.id === id)
        result.push({
          ...geometry.get(id),
          x: position[0],
          y: position[1],
          z: position[2],
          extent: group.radius,
        });
      else queue.push({ id: slot.id, offset: position });
    }
  }
  return result;
}

export function mapGraph(nodes, positions, filters = {}) {
  const matches = new Set(filterNodes(nodes, filters).map((n) => n.id));
  const source = new Map(nodes.map((n) => [n.id, n])),
    keep = new Set(matches);
  const filtering = !!(
    filters.query ||
    filters.scope ||
    (filters.type && filters.type !== "all") ||
    filters.importance?.length
  );
  // Show ancestors as context; they are dimmed and are not counted as matches.
  for (const id of matches) {
    let current = source.get(id);
    while (
      current &&
      current.id !== filters.scope &&
      source.has(current.parent) &&
      !keep.has(current.parent)
    ) {
      keep.add(current.parent);
      current = source.get(current.parent);
    }
  }
  const positioned = positions
    .filter((p) => keep.has(p.id))
    .map((p) => ({
      ...source.get(p.id),
      ...p,
      fx: p.x,
      fy: p.y,
      fz: p.z,
      matched: filtering && matches.has(p.id),
      context: !matches.has(p.id),
    }));
  const links = [],
    pairs = new Set();
  for (const n of positioned) {
    if (keep.has(n.parent))
      links.push({
        source: n.parent,
        target: n.id,
        kind: "tree",
        color: n.color,
      });
    for (const id of n.related || []) {
      const key = [n.id, id].sort().join("|");
      if (keep.has(id) && !pairs.has(key)) {
        links.push({
          source: n.id,
          target: id,
          kind: "related",
          color: n.color,
        });
        pairs.add(key);
      }
    }
  }
  return { nodes: positioned, links, matchCount: matches.size };
}
