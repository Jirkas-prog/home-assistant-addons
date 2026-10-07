// Validation refers to stable field names, never translated error messages.
export function validationField(field) {
  return (
    {
      "tool.time": "tool.startTime",
      "tool.timeRange": "tool.endTime",
      "tool.placeLabel": "tool.places",
      "tool.coordinates": "tool.places",
    }[field] || field
  );
}
export function validationTab(kind, field = "") {
  if (kind === "task") {
    if (field.startsWith("task.checkpoints")) return "checkpoints";
    if (field === "resources") return "attachments";
    return "details";
  }
  if (kind === "journal") {
    if (field === "resources") return "attachments";
    if (field === "related") return "links";
    if (/^tool\.(places|placeLabel|coordinates)/.test(field)) return "places";
    if (
      ["summary", "tags", "projectId", "tool.next", "tool.experience"].includes(
        field,
      )
    )
      return "organization";
    return "entry";
  }
}
