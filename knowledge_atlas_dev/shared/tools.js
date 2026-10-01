import { itemQuantity } from "./inventory.js";
import { journalDays } from "./journal.js";

export const TOOL_KINDS = [
  "journal",
  "bom",
  "procedure",
  "run",
  "cards",
  "view",
];
export const VIEW_RULES = ["all", "projects-no-next", "overdue", "study-due"];
const id = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value);
export const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
export function validateTool(tool, fail) {
  const check = (value, field) => {
    if (!value) fail(`Invalid tool field: ${field}.`);
  };
  const text = (value, field, max = 2000, required = false) =>
    check(
      typeof value === "string" &&
        value.length <= max &&
        (!required || value.trim()),
      field,
    );
  const integer = (value, field, max = 1_000_000_000) =>
    check(Number.isSafeInteger(value) && value >= 0 && value <= max, field);
  const rows = (values, field, max = 500) => {
    check(Array.isArray(values) && values.length <= max, field);
    const seen = new Set();
    for (const row of values) {
      check(object(row) && id(row.id) && !seen.has(row.id), field + ".id");
      seen.add(row.id);
    }
  };
  check(
    object(tool) && tool.schema === 1 && TOOL_KINDS.includes(tool.kind),
    "kind",
  );
  if (tool.kind === "journal") {
    check(validDate(tool.date), "date");
    check(
      tool.endDate == null ||
        (validDate(tool.endDate) && tool.endDate >= tool.date),
      "endDate",
    );
    check(
      tool.period == null ||
        ["day", "week", "month", "custom"].includes(tool.period),
      "period",
    );
    integer(
      tool.minutes,
      "minutes",
      Math.min(5256000, journalDays(tool) * 1440),
    );
    text(tool.next, "next");
    if (tool.places != null) {
      rows(tool.places, "places", 100);
      for (const place of tool.places) {
        text(place.label, "placeLabel", 300);
        const coordinates = place.latitude != null || place.longitude != null;
        check(!!place.label.trim() || coordinates, "placeLabel");
        if (coordinates)
          check(
            Number.isFinite(place.latitude) &&
              Math.abs(place.latitude) <= 90 &&
              Number.isFinite(place.longitude) &&
              Math.abs(place.longitude) <= 180,
            "coordinates",
          );
      }
    }
  }
  if (tool.kind === "bom") {
    rows(tool.lines, "lines");
    check(typeof tool.reserve === "boolean", "reserve");
    for (const line of tool.lines) {
      text(line.label, "label", 180, true);
      check(!line.itemId || id(line.itemId), "itemId");
      integer(line.quantity, "quantity");
      check(line.quantity > 0, "quantity");
      text(line.note, "note");
    }
    const referenced = tool.lines
      .filter((line) => line.itemId)
      .map((line) => line.itemId);
    check(new Set(referenced).size === referenced.length, "duplicateItem");
  }
  if (["procedure", "run"].includes(tool.kind)) {
    rows(tool.steps, "steps");
    check(tool.steps.length > 0, "steps");
    for (const step of tool.steps) text(step.label, "step", 2000, true);
    if (tool.kind === "run") {
      check(id(tool.sourceId), "sourceId");
      text(tool.sourceRevision, "sourceRevision", 128, true);
      check(
        Array.isArray(tool.completed) &&
          new Set(tool.completed).size === tool.completed.length &&
          tool.completed.every((value) =>
            tool.steps.some((step) => step.id === value),
          ),
        "completed",
      );
      check(validDate(tool.date), "date");
    }
  }
  if (tool.kind === "cards") {
    rows(tool.cards, "cards");
    rows(tool.reviews, "reviews", 5000);
    for (const card of tool.cards) {
      text(card.question, "question", 5000, true);
      text(card.answer, "answer", 10000, true);
      check(!card.sourceId || id(card.sourceId), "sourceId");
      text(card.sourcePage, "sourcePage", 80);
    }
    for (const review of tool.reviews) {
      check(id(review.cardId), "cardId");
      check(
        ["again", "hard", "good", "easy"].includes(review.rating),
        "rating",
      );
      check(validDate(review.date) && validDate(review.due), "reviewDate");
      integer(review.interval, "interval", 3650);
      check(
        typeof review.at === "string" && Number.isFinite(Date.parse(review.at)),
        "reviewTime",
      );
    }
  }
  if (tool.kind === "view") {
    const f = tool.filter;
    check(object(f) && VIEW_RULES.includes(f.rule), "rule");
    text(f.query, "query", 500);
    text(f.tag, "tag", 120);
    check(
      [
        "all",
        "category",
        "project",
        "knowledge",
        "skill",
        "code",
        "item",
        "task",
      ].includes(f.type),
      "type",
    );
    check(
      ["all", "draft", "learning", "active", "done"].includes(f.status),
      "status",
    );
    check(!f.projectId || id(f.projectId), "projectId");
  }
  return tool;
}

export function toolReferences(node) {
  const tool = node.tool;
  if (!tool) return [];
  if (tool.kind === "bom")
    return tool.lines
      .filter((line) => line.itemId)
      .map((line) => ({ id: line.itemId, type: "item" }));
  if (tool.kind === "cards")
    return tool.cards
      .filter((card) => card.sourceId)
      .map((card) => ({ id: card.sourceId }));
  if (tool.kind === "run") return [{ id: tool.sourceId, kind: "procedure" }];
  if (tool.kind === "view" && tool.filter.projectId)
    return [{ id: tool.filter.projectId, type: "project" }];
  return [];
}
export function projectIdFor(node, nodes) {
  if (node.projectId) return node.projectId;
  const lookup = new Map(nodes.map((n) => [n.id, n])),
    seen = new Set();
  let parent = node.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const p = lookup.get(parent);
    if (p?.type === "project") return p.id;
    parent = p?.parent;
  }
  return "";
}
export function toolSearchText(node) {
  const tool = node.tool;
  if (!tool) return "";
  return [
    tool.kind,
    tool.date,
    tool.endDate,
    ...(tool.places || []).flatMap((p) => [p.label, p.latitude, p.longitude]),
    tool.next,
    ...(tool.lines || []).flatMap((x) => [x.label, x.note]),
    ...(tool.steps || []).map((x) => x.label),
    ...(tool.cards || []).flatMap((x) => [x.question, x.answer, x.sourcePage]),
    tool.filter?.query,
    tool.filter?.tag,
  ]
    .filter(Boolean)
    .join(" ");
}
export function cardState(deck, cardId, today) {
  const reviews = deck.tool.reviews.filter((r) => r.cardId === cardId);
  const last = reviews.at(-1);
  return {
    due: last?.due || today,
    interval: last?.interval || 0,
    reviewed: reviews.length,
    ready: !last || last.due <= today,
  };
}
export function nextReview(previous, rating, date) {
  const intervals = {
    again: 0,
    hard: Math.max(1, Math.ceil(previous * 1.2)),
    good: previous ? Math.ceil(previous * 2.3) : 1,
    easy: previous ? Math.ceil(previous * 3) : 4,
  };
  const interval = Math.min(3650, intervals[rating]);
  const due = new Date(Date.parse(date + "T00:00:00Z") + interval * 86400000)
    .toISOString()
    .slice(0, 10);
  return { interval, due };
}
export function bomModel(bom, nodes) {
  const otherDemand = new Map();
  for (const n of nodes)
    if (
      n.id !== bom.id &&
      n.tool?.kind === "bom" &&
      n.tool.reserve &&
      n.status !== "done"
    ) {
      for (const line of n.tool.lines)
        if (line.itemId)
          otherDemand.set(
            line.itemId,
            (otherDemand.get(line.itemId) || 0) + line.quantity,
          );
    }
  return bom.tool.lines.map((line) => {
    const item = nodes.find((n) => n.id === line.itemId && n.type === "item");
    const available = item ? itemQuantity(item) : 0,
      planned = otherDemand.get(line.itemId) || 0;
    const free = Math.max(0, available - planned);
    return {
      ...line,
      item,
      available,
      planned,
      free,
      shortage: Math.max(0, line.quantity - free),
      overbooked:
        planned +
          (bom.tool.reserve && bom.status !== "done" ? line.quantity : 0) >
        available,
    };
  });
}
export function matchesToolFilter(node, filter, nodes, today, matchesQuery) {
  if (node.tool?.kind === "view") return false;
  if (filter.type !== "all" && node.type !== filter.type) return false;
  if (filter.status !== "all" && node.status !== filter.status) return false;
  if (
    filter.projectId &&
    node.id !== filter.projectId &&
    projectIdFor(node, nodes) !== filter.projectId
  )
    return false;
  if (filter.tag && !node.tags.includes(filter.tag)) return false;
  if (filter.query && !matchesQuery(node, filter.query)) return false;
  if (filter.rule === "projects-no-next")
    return (
      node.type === "project" &&
      node.status !== "done" &&
      !nodes.some(
        (n) =>
          n.type === "task" &&
          n.status !== "done" &&
          projectIdFor(n, nodes) === node.id,
      )
    );
  if (filter.rule === "overdue")
    return (
      node.type === "task" &&
      node.status !== "done" &&
      !!node.task?.due &&
      node.task.due < today
    );
  if (filter.rule === "study-due")
    return (
      node.tool?.kind === "cards" &&
      node.tool.cards.some((c) => cardState(node, c.id, today).ready)
    );
  return true;
}
export function toolStats(nodes, today) {
  const tools = nodes.filter((n) => n.tool);
  return {
    total: tools.length,
    journal: tools.filter((n) => n.tool.kind === "journal").length,
    minutes: tools.reduce(
      (sum, n) => sum + (n.tool.kind === "journal" ? n.tool.minutes : 0),
      0,
    ),
    cards: tools.reduce(
      (sum, n) => sum + (n.tool.kind === "cards" ? n.tool.cards.length : 0),
      0,
    ),
    due: tools.reduce(
      (sum, n) =>
        sum +
        (n.tool.kind === "cards"
          ? n.tool.cards.filter((c) => cardState(n, c.id, today).ready).length
          : 0),
      0,
    ),
    runs: tools.filter((n) => n.tool.kind === "run" && n.status === "done")
      .length,
  };
}
