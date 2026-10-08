import { recordImportance } from "./importance.js";
import { randomRecordColor } from "./record-appearance.js";

export const TASK_VIEWS = ["timeline", "board", "calendar"];
export const CALENDAR_VIEWS = ["day", "week", "month", "year"];

// Calendar projections are display data; always open/save the original task by ID.
export function taskCalendarEntry(task) {
  const start = task.task?.start || task.task?.due;
  if (!start) return null;
  return { ...task, tool: { date: start, endDate: task.task?.due || start } };
}

export function journalFromTask(task, { id, date, projectId = "" }) {
  return {
    schema: 2,
    id,
    title: task.title,
    type: "knowledge",
    status: "active",
    parent: projectId || task.parent || null,
    projectId,
    importance: recordImportance(task),
    color: randomRecordColor(),
    summary: "",
    body: "",
    tags: [...task.tags],
    related: [task.id],
    resources: [],
    tool: {
      schema: 1,
      kind: "journal",
      date,
      endDate: date,
      period: "day",
      places: [],
      minutes: 0,
      next: "",
    },
  };
}

export function projectForTask(
  title,
  { id, parent, color = randomRecordColor() },
) {
  return {
    schema: 2,
    id,
    title: title.trim(),
    type: "project",
    status: "active",
    parent: parent || null,
    color,
    summary: "",
    body: "",
    tags: [],
    related: [],
    resources: [],
  };
}
