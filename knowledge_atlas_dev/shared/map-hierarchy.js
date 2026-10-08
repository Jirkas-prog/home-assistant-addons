// A map is a forest: many roots and children, but one parent per record.
export function parentChangeIssue(nodes, childId, parentId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const child = byId.get(childId);
  if (!child || (parentId !== null && !byId.has(parentId))) return "missing";
  if (childId === parentId) return "self";
  const seen = new Set();
  let current = parentId;
  while (current !== null && byId.has(current)) {
    if (current === childId || seen.has(current)) return "cycle";
    seen.add(current);
    current = byId.get(current).parent;
  }
  if (child.parent === parentId) return "unchanged";
  return null;
}

export const mapLinkId = (endpoint) =>
  typeof endpoint === "object" ? endpoint?.id : endpoint;
