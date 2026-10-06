// Summaries are navigation data, never writable records.
export function workspaceNode(node, content) {
  if (
    content === "records" ||
    content === "map" ||
    (content === "tasks" && node.type === "task")
  )
    return node;
  const journal = content === "journal" && node.tool?.kind === "journal";
  return {
    id: node.id,
    title: node.title,
    parent: node.parent,
    type: node.type,
    color: node.color,
    status: node.status,
    importance: node.importance,
    position: node.position,
    positionFixed: node.positionFixed,
    created: node.created,
    updated: node.updated,
    date: node.date,
    revision: node.revision,
    projectId: node.projectId,
    ...(node.tool
      ? {
          tool: journal
            ? {
                kind: "journal",
                date: node.tool.date,
                endDate: node.tool.endDate,
                period: node.tool.period,
                experience: node.tool.experience,
                places: node.tool.places,
              }
            : { kind: node.tool.kind },
        }
      : {}),
    partial: true,
    body: "",
    resources: [],
    summary: journal ? node.summary : "",
    tags: journal ? node.tags : [],
    related: journal ? node.related : [],
    ...(journal ? { resourceCount: node.resources.length } : {}),
  };
}
