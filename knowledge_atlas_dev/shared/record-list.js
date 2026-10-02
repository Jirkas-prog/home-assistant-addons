import { validDate } from "./tools.js";
import { recordImportance } from "./importance.js";

// Calendar dates stay in their recorded timezone; do not convert them to UTC.
export function recordDate(node) {
  const date =
    node.date ||
    (node.tool?.kind === "journal" ? node.tool.date : "") ||
    node.task?.due ||
    node.task?.start;
  if (validDate(date)) return { date, source: "event" };
  for (const source of ["created", "updated"]) {
    const value =
      typeof node[source] === "string" ? node[source].slice(0, 10) : "";
    if (validDate(value)) return { date: value, source };
  }
  return { date: "", source: "unknown" };
}

export const LIST_SORTS = ["order", "newest", "oldest", "importance"];
export function sortRecords(nodes, mode = "order") {
  return [...nodes].sort((a, b) => {
    if (mode === "newest" || mode === "oldest") {
      const left = recordDate(a).date,
        right = recordDate(b).date;
      if (!left !== !right) return left ? -1 : 1;
      const byDate = left.localeCompare(right) * (mode === "newest" ? -1 : 1);
      if (byDate) return byDate;
    }
    if (mode === "importance") {
      const byImportance = recordImportance(b) - recordImportance(a);
      if (byImportance) return byImportance;
    }
    return (
      (a.position || Infinity) - (b.position || Infinity) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function reconcileOrder(
  nodes,
  saved,
  presentIds = nodes.map((n) => n.id),
) {
  const known = new Set(saved),
    present = new Set(presentIds);
  const added = nodes
    .filter((n) => !known.has(n.id))
    .sort(
      (a, b) =>
        String(b.created || "").localeCompare(String(a.created || "")) ||
        a.id.localeCompare(b.id),
    );
  return [...added.map((n) => n.id), ...saved.filter((id) => present.has(id))];
}

export function moveInOrder(ids, id, position) {
  const next = ids.filter((value) => value !== id);
  next.splice(Math.min(position - 1, next.length), 0, id);
  return next;
}
