import { validDate } from "./tools.js";
import { recordImportance } from "./importance.js";
import { fail } from "./schema.js";

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
  const known = new Set(saved.ids),
    present = new Set(presentIds);
  const added = nodes
    .filter((n) => !known.has(n.id))
    .sort(
      (a, b) =>
        String(b.created || "").localeCompare(String(a.created || "")) ||
        a.id.localeCompare(b.id),
    );
  const order = {
    ids: [
      ...added.map((n) => n.id),
      ...saved.ids.filter((id) => present.has(id)),
    ],
    fixed: Object.fromEntries(
      Object.entries(saved.fixed).filter(([id]) => present.has(id)),
    ),
  };
  order.ids = orderEntries(order).map((entry) => entry.id);
  return order;
}

export function orderEntries({ ids, fixed }) {
  const reserved = new Set(Object.values(fixed));
  let next = 1;
  return ids
    .map((id) => {
      const positionFixed = Object.hasOwn(fixed, id);
      while (!positionFixed && reserved.has(next)) next++;
      return {
        id,
        position: positionFixed ? fixed[id] : next++,
        positionFixed,
      };
    })
    .sort((a, b) => a.position - b.position);
}

export function moveInOrder(order, id, position, positionFixed) {
  const fixed = { ...order.fixed };
  const target = Math.min(
    position,
    Object.values(fixed).reduce(
      (max, value) => Math.max(max, value),
      order.ids.length,
    ),
  );
  if (
    Object.entries(fixed).some(
      ([owner, value]) => owner !== id && value === target,
    )
  )
    fail(
      "This list position is fixed by another record. Choose a different position.",
    );
  const keepFixed = positionFixed ?? Object.hasOwn(fixed, id);
  delete fixed[id];
  const free = order.ids.filter(
    (value) => value !== id && !Object.hasOwn(fixed, value),
  );
  const rank =
    target - 1 - Object.values(fixed).filter((value) => value < target).length;
  if (keepFixed) fixed[id] = target;
  else free.splice(Math.min(rank, free.length), 0, id);
  const next = { ids: [...Object.keys(fixed), ...free], fixed };
  next.ids = orderEntries(next).map((entry) => entry.id);
  return next;
}
