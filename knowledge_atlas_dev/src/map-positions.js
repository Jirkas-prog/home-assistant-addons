// Saved coordinates are independent of the disposable, computed layout cache.
export function applyMapPositions(nodes, computed, saved = []) {
  if (!saved.length) return computed;
  const base = new Map(computed.map((p) => [p.id, p]));
  const placed = new Map(
    saved
      .filter((p) => base.has(p.id))
      .map((p) => [p.id, { ...base.get(p.id), x: p.x, y: p.y, z: p.z }]),
  );
  const parents = new Map(nodes.map((n) => [n.id, n.parent]));
  for (const p of computed) {
    const trail = [],
      visited = new Set();
    let id = p.id;
    while (base.has(id) && !placed.has(id) && !visited.has(id)) {
      visited.add(id);
      trail.push(id);
      id = parents.get(id);
    }
    for (const child of trail.reverse()) {
      const original = base.get(child),
        parent = parents.get(child);
      const anchor = placed.get(parent),
        origin = base.get(parent);
      placed.set(
        child,
        anchor && origin
          ? {
              ...original,
              x: anchor.x + original.x - origin.x,
              y: anchor.y + original.y - origin.y,
              z: anchor.z + original.z - origin.z,
            }
          : { ...original },
      );
    }
  }
  return computed.map((p) => placed.get(p.id));
}

export const positionSnapshot = (positions) =>
  positions.map(({ id, x, y, z }) => ({ id, x, y, z }));

// Use the actual dragged position: the libraries report end deltas differently.
// The full hierarchy includes descendants hidden by search or importance filters.
export function createBranchDrag(nodes, positions, id) {
  const children = new Map();
  for (const n of nodes) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  }
  const ids = new Set([id]),
    queue = [id];
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) || [])
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
  const snapshot = positionSnapshot(positions),
    origin = snapshot.find((p) => p.id === id);
  const initial = new Map(
    snapshot.filter((p) => ids.has(p.id)).map((p) => [p.id, { ...p }]),
  );
  return (node, rendered = []) => {
    if (!origin) return snapshot;
    const start = initial.get(id);
    const delta = {
      x: node.x - start.x,
      y: node.y - start.y,
      z: node.z - start.z,
    };
    for (const p of [...snapshot, ...rendered]) {
      const before = initial.get(p.id);
      if (!before) continue;
      for (const axis of ["x", "y", "z"])
        p[axis] = p[`f${axis}`] = before[axis] + delta[axis];
    }
    return positionSnapshot(snapshot);
  };
}
