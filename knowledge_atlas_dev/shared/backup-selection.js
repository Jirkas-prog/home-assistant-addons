export const BACKUP_PARTS = ["tasks", "journals", "map", "inventory", "tools"];
export function backupPart(node) {
  if (node.type === "task") return "tasks";
  if (node.tool?.kind === "journal") return "journals";
  if (node.type === "item") return "inventory";
  if (node.tool) return "tools";
  return "map";
}
export function validateSelection(parts, fail) {
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    parts.some((p) => !BACKUP_PARTS.includes(p)) ||
    new Set(parts).size !== parts.length
  )
    fail("Select at least one valid backup section.");
  return parts;
}
