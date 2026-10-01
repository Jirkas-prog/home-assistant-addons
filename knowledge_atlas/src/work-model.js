import { t, locale } from "../shared/i18n.js";
export const TASK_STATUS = {
  get draft() {
    return t("m226");
  },
  get active() {
    return t("m227");
  },
  get learning() {
    return t("m228");
  },
  get done() {
    return t("m403");
  },
};
export const PRIORITIES = {
  get low() {
    return t("m229");
  },
  get normal() {
    return t("m230");
  },
  get high() {
    return t("m231");
  },
};
export const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const dayNumber = (date) =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
export function timelineModel(tasks, today = localDate()) {
  const scheduled = tasks
    .filter((t) => t.task?.start || t.task?.due)
    .map((t) => ({
      ...t,
      startDay: dayNumber(t.task.start || t.task.due),
      endDay: dayNumber(t.task.due || t.task.start),
    }));
  const now = dayNumber(today),
    days = scheduled.flatMap((t) => [t.startDay, t.endDay]);
  const min = Math.min(now, ...days) - 2,
    max = Math.max(now, ...days) + 3;
  return {
    scheduled: scheduled.sort((a, b) => a.startDay - b.startDay),
    unscheduled: tasks.filter((t) => !t.task?.start && !t.task?.due),
    min,
    max,
    span: max - min + 1,
    today: now,
  };
}
export function projectFor(task, nodes) {
  if (task.projectId) return nodes.find((n) => n.id === task.projectId);
  let parent = task.parent;
  const seen = new Set();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const n = nodes.find((n) => n.id === parent);
    if (n?.type === "project") return n;
    parent = n?.parent;
  }
  return null;
}
