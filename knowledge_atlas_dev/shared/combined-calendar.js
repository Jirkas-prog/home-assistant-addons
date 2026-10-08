import { taskCalendarEntry } from "./task-workflow.js";

export const CALENDAR_COLORS = { task: "#64b5f6", journal: "#cc96ef" };

// Display projections only. Open the original record by ID before editing it.
export function combinedCalendarEntries(
  nodes,
  { tasks = true, journals = true } = {},
) {
  return nodes.flatMap((node) => {
    const kind = node.type === "task" ? "task" : node.tool?.kind;
    if (!((kind === "task" && tasks) || (kind === "journal" && journals)))
      return [];
    const entry = kind === "task" ? taskCalendarEntry(node) : node;
    return entry
      ? [{ ...entry, color: CALENDAR_COLORS[kind], calendarKind: kind }]
      : [];
  });
}
