export function locationDescendants(locations, id) {
  const found = new Set([id]),
    children = new Map(),
    queue = [id];
  for (const location of locations) {
    if (!children.has(location.parentId)) children.set(location.parentId, []);
    children.get(location.parentId).push(location.id);
  }
  for (let i = 0; i < queue.length; i++)
    for (const child of children.get(queue[i]) || [])
      if (!found.has(child)) {
        found.add(child);
        queue.push(child);
      }
  return found;
}
export function locationLabel(locations, id) {
  const map = new Map(locations.map((l) => [l.id, l])),
    seen = new Set(),
    names = [];
  let current = map.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = map.get(current.parentId);
  }
  return names.join(" / ") || id;
}
export function validateLocationTree(locations, fail) {
  const map = new Map(locations.map((l) => [l.id, l]));
  for (const l of locations) {
    if (
      l.parentId &&
      (!map.has(l.parentId) ||
        l.kind !== "physical" ||
        map.get(l.parentId).kind !== "physical")
    )
      fail("A physical place must belong to another physical place.");
    const seen = new Set();
    let current = l;
    while (current) {
      if (seen.has(current.id))
        fail("Location hierarchy cannot contain cycles.");
      seen.add(current.id);
      current = map.get(current.parentId);
    }
  }
}
