// All navigation, counts and search results derive from the current files.
// No seed IDs or predefined branch names belong in this model.
import { locationDescendants, locationLabel } from "../shared/locations.js";
import { itemQuantity } from "../shared/inventory.js";
import { toolSearchText } from "../shared/tools.js";
import { recordImportance } from "../shared/importance.js";
export function atlasStructure(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.parent || !ids.has(n.parent));
  const container =
    roots.length === 1 && roots[0].type === "category" ? roots[0] : null;
  const categories = nodes.filter(
    (n) => n.type === "category" && n.id !== container?.id,
  );
  const categoryIds = new Set(categories.map((n) => n.id));
  const mainBranches = categories.filter((n) => !categoryIds.has(n.parent));
  return {
    roots,
    container,
    categories,
    mainBranches,
    homeId: container?.id || roots[0]?.id || nodes[0]?.id || "",
    stats: {
      total: nodes.length,
      projects: nodes.filter((n) => n.type === "project").length,
      notes: nodes.filter(
        (n) => ["knowledge", "skill", "code"].includes(n.type) && !n.tool,
      ).length,
      areas: categories.length,
      items: nodes.filter((n) => n.type === "item").length,
      units: nodes
        .filter((n) => n.type === "item")
        .reduce((sum, n) => sum + itemQuantity(n), 0),
      tasks: nodes.filter((n) => n.type === "task").length,
      tools: nodes.filter((n) => n.tool).length,
    },
  };
}
export function descendants(nodes, id) {
  const found = new Set([id]),
    queue = [id],
    children = new Map();
  for (const n of nodes) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) || []) {
      if (!found.has(child)) {
        found.add(child);
        queue.push(child);
      }
    }
  }
  return found;
}
const normalize = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const resourceLocation = (r) =>
  r.locationId ||
  (r.url || /^https?:\/\//i.test(r.path || "") ? "internet" : "pc");
export function matchesQuery(node, query, type = "all", locations = []) {
  if (
    type === "experience"
      ? node.tool?.experience !== true
      : type === "journal"
        ? node.tool?.kind !== "journal"
        : type !== "all" && node.type !== type
  )
    return false;
  if (!query.trim()) return true;
  const text = normalize(
    [
      node.title,
      node.summary,
      ...node.tags,
      node.body,
      toolSearchText(node),
      node.task?.assignee || "",
      ...(node.task?.checkpoints || []).flatMap((point) => [
        point.description,
        point.due,
      ]),
      ...(node.stock?.placements || []).flatMap((p) => [
        p.detail,
        locationLabel(locations, p.locationId),
      ]),
      ...node.resources.flatMap((r) => [
        r.label,
        r.path || r.url || "",
        locations.find((l) => l.id === resourceLocation(r))?.name || "",
      ]),
    ].join(" "),
  );
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word));
}
export function filterNodes(
  nodes,
  {
    scope = "",
    query = "",
    type = "all",
    importance = [],
    location = "",
    locations = [],
    searchIds = null,
  } = {},
) {
  const allowed = scope ? descendants(nodes, scope) : null;
  const places = location ? locationDescendants(locations, location) : null;
  return nodes.filter(
    (n) =>
      (!searchIds || searchIds.has(n.id)) &&
      (!allowed || allowed.has(n.id)) &&
      (!importance.length || importance.includes(recordImportance(n))) &&
      (!places ||
        (n.stock
          ? n.stock.placements.some(
              (p) => p.quantity > 0 && places.has(p.locationId),
            )
          : n.resources.some((r) => places.has(resourceLocation(r))))) &&
      matchesQuery(n, searchIds ? "" : query, type, locations),
  );
}
