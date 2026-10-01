export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5];
const legacyLevels = { low: 1, normal: 3, high: 5 };

export function validImportance(value) {
  return (
    IMPORTANCE_LEVELS.includes(value) ||
    (typeof value === "string" && Object.hasOwn(legacyLevels, value))
  );
}

export function recordImportance(node) {
  if (IMPORTANCE_LEVELS.includes(node.importance)) return node.importance;
  if (
    typeof node.importance === "string" &&
    Object.hasOwn(legacyLevels, node.importance)
  )
    return legacyLevels[node.importance];
  return node.type === "task" &&
    Object.hasOwn(legacyLevels, node.task?.priority)
    ? legacyLevels[node.task.priority]
    : 3;
}

export function importancePriority(node) {
  const value = recordImportance(node);
  return value <= 2 ? "low" : value >= 4 ? "high" : "normal";
}

export function withImportance(node, importance) {
  const updated = { ...node, importance };
  if (node.type === "task") {
    updated.task = { ...node.task, priority: importancePriority(updated) };
  }
  return updated;
}
