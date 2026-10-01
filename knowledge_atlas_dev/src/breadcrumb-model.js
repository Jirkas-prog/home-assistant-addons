export function createRecordNavigation(nodes) {
  const records = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = (node) => (records.has(node.parent) ? node.parent : null);
  const children = new Map();
  for (const node of records.values()) {
    const parent = parentOf(node);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  return {
    path(id) {
      const path = [],
        seen = new Set();
      let node = records.get(id);
      while (node && !seen.has(node.id)) {
        seen.add(node.id);
        path.push(node);
        node = records.get(node.parent);
      }
      return path.reverse();
    },
    siblings(id) {
      const node = records.get(id);
      return node ? children.get(parentOf(node)) || [] : [];
    },
  };
}
