// Column identities remain stable when their visible names change.
export const DEFAULT_COLUMNS = [
  { id: "nice-to-have", key: "board.optional", status: "draft" },
  { id: "backlog", key: "board.backlog", status: "draft" },
  { id: "in-progress", key: "board.active", status: "active" },
  { id: "stuck", key: "board.stuck", status: "learning" },
  { id: "done", key: "board.done", status: "done" },
];
export function columnsFor(project) {
  return project?.board?.columns || DEFAULT_COLUMNS;
}
export function columnFor(task, columns = DEFAULT_COLUMNS) {
  return (
    columns.find(
      (c) => c.id === task.task?.columnId && c.status === task.status,
    ) ||
    columns.find((c) => c.id === "backlog" && c.status === task.status) ||
    columns.find((c) => c.status === task.status)
  );
}
export function validateBoard(board, fail) {
  if (board == null) return;
  if (
    board.schema !== 1 ||
    !Array.isArray(board.columns) ||
    !board.columns.length ||
    board.columns.length > 30
  )
    fail("A board needs between 1 and 30 columns.");
  const ids = new Set();
  for (const c of board.columns) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(c.id || "") ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 80 ||
      !["draft", "active", "learning", "done"].includes(c.status)
    )
      fail("Invalid board column.");
    ids.add(c.id);
  }
  if (
    ["draft", "active", "learning", "done"].some(
      (s) => !board.columns.some((c) => c.status === s),
    )
  )
    fail("Keep at least one column for each task status.");
}
