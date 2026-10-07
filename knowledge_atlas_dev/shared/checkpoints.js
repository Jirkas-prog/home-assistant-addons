import { recordImportance } from "./importance.js";

export const dateDay = (date) =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
export const validDate = (date) =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
export const checkpoints = (node) => node.task?.checkpoints || [];

export function validateCheckpoints(task, fail) {
  if (task.checkpoints == null) return;
  if (!Array.isArray(task.checkpoints) || task.checkpoints.length > 200)
    fail("Checkpoints must be a list of at most 200 entries.");
  const ids = new Set();
  for (const [index, point] of task.checkpoints.entries()) {
    if (
      !point ||
      typeof point !== "object" ||
      Array.isArray(point) ||
      typeof point.id !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(point.id) ||
      ids.has(point.id)
    )
      fail("Checkpoints must have unique stable IDs.");
    ids.add(point.id);
    if (!validDate(point.due))
      fail(
        "Each checkpoint needs a valid due date.",
        400,
        `task.checkpoints.${index}.due`,
      );
    if (
      typeof point.description !== "string" ||
      !point.description.trim() ||
      point.description.length > 2000
    )
      fail(
        "A checkpoint description must contain 1–2000 characters.",
        400,
        `task.checkpoints.${index}.description`,
      );
    if (typeof point.done !== "boolean")
      fail("Checkpoint completion must be true or false.");
    if (
      (task.start && point.due < task.start) ||
      (task.due && point.due > task.due)
    )
      fail(
        "Checkpoint dates must fall within the task dates.",
        400,
        `task.checkpoints.${index}.due`,
      );
    if (
      point.completedAt != null &&
      (typeof point.completedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
          point.completedAt,
        ) ||
        !validDate(point.completedAt.slice(0, 10)) ||
        !Number.isFinite(Date.parse(point.completedAt)) ||
        !point.done)
    )
      fail(
        "A completion timestamp requires a completed checkpoint and a valid UTC time.",
      );
  }
}
export function withCheckpointDone(
  node,
  id,
  done,
  now = new Date().toISOString(),
) {
  if (!checkpoints(node).some((point) => point.id === id))
    throw new Error("The checkpoint no longer exists.");
  return {
    ...node,
    task: {
      ...node.task,
      checkpoints: checkpoints(node).map((point) =>
        point.id === id
          ? {
              ...point,
              done,
              completedAt: done
                ? point.done && point.completedAt
                  ? point.completedAt
                  : now
                : null,
            }
          : point,
      ),
    },
  };
}
export function pendingDeadlines(node) {
  const dates = checkpoints(node)
    .filter((point) => !point.done)
    .map((point) => ({
      day: dateDay(point.due),
      due: point.due,
      checkpointId: point.id,
      description: point.description,
    }));
  if (node.status !== "done" && node.task?.due)
    dates.push({
      day: dateDay(node.task.due),
      due: node.task.due,
      checkpointId: null,
    });
  return dates.sort(
    (a, b) =>
      a.day - b.day ||
      Number(a.checkpointId === null) - Number(b.checkpointId === null) ||
      (a.checkpointId || "").localeCompare(b.checkpointId || "", "en"),
  );
}

export function taskUrgencies(tasks, today) {
  const now = dateDay(today);
  const pending = new Map(
    tasks.map((node) => [node.id, pendingDeadlines(node)]),
  );
  const events = tasks
    .flatMap((node) =>
      pending.get(node.id).map((event) => ({
        ...event,
        id: node.id,
        importance: recordImportance(node),
      })),
    )
    .sort((a, b) => a.day - b.day);
  const lowerBound = (day) => {
    let lo = 0,
      hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[mid].day < day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return new Map(
    tasks.map((node) => {
      const dates = pending.get(node.id),
        next = dates[0];
      const horizon = 2 + 2 * recordImportance(node);
      const daysLeft = next ? next.day - now : null;
      const overdueCheckpoints = checkpoints(node).filter(
        (p) => !p.done && p.due < today,
      ).length;
      const overdueTask =
        node.status !== "done" && !!node.task?.due && node.task.due < today;
      const overdue = overdueCheckpoints > 0 || overdueTask;
      const nearby = new Map();
      if (next && !overdue && daysLeft <= horizon) {
        for (
          let i = lowerBound(next.day - 3);
          i < events.length && events[i].day <= next.day + 3;
          i++
        ) {
          const event = events[i];
          if (event.id === node.id) continue;
          const weight =
            (event.importance / 5) * (1 - Math.abs(event.day - next.day) / 4);
          nearby.set(event.id, Math.max(nearby.get(event.id) || 0, weight));
        }
      }
      const base = next ? Math.max(0, Math.min(1, 1 - daysLeft / horizon)) : 0;
      const pressure =
        Math.min(
          0.2,
          [...nearby.values()].reduce((sum, weight) => sum + weight * 0.08, 0),
        ) * base;
      const score = overdue ? 1 : Math.min(1, base + pressure);
      return [
        node.id,
        {
          score,
          level:
            score >= 0.75 ? "urgent" : score >= 0.35 ? "attention" : "onTrack",
          overdue,
          overdueTask,
          overdueCheckpoints,
          next,
          daysLeft,
          horizon,
          nearbyCount: nearby.size,
          completed: node.status === "done" && !dates.length,
        },
      ];
    }),
  );
}
export function urgencyStyle(urgency) {
  const hue = Math.round(120 * (1 - urgency.score));
  return {
    "--urgency-border": `hsl(${hue} 70% 64%)`,
    "--urgency-fill": `hsl(${hue} 36% 19%)`,
  };
}
