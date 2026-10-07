import { validateStock } from "./inventory.js";
import { validateTool, toolReferences, validDate } from "./tools.js";
import { validImportance } from "./importance.js";
import { validateCheckpoints } from "./checkpoints.js";
import { validateBoard } from "./boards.js";
export const TYPES = [
  "category",
  "project",
  "knowledge",
  "skill",
  "code",
  "item",
  "task",
];
export const STATUSES = ["draft", "learning", "active", "done"];
const idPattern = /^[a-z0-9][a-z0-9_-]{0,119}$/;
export function fail(message, status = 400, field) {
  throw Object.assign(new Error(message), {
    status,
    ...(field ? { field } : {}),
  });
}
export function validateNode(n) {
  validateBoard(n.board, fail);
  if (n.task?.columnId != null && !idPattern.test(n.task.columnId))
    fail("Invalid task column ID.");
  if (n.partial) fail("Load the complete record before saving changes.");
  if (!idPattern.test(n.id || ""))
    fail(
      "IDs may contain lowercase letters, numbers, hyphens and underscores.",
    );
  if (![1, 2].includes(n.schema))
    fail("Supported schema versions are 1 and 2.");
  if (typeof n.title !== "string" || !n.title.trim() || n.title.length > 180)
    fail("The title must contain 1–180 characters.", 400, "title");
  if (!TYPES.includes(n.type)) fail("Invalid record type.");
  if (!STATUSES.includes(n.status)) fail("Invalid status.");
  if (n.importance != null && !validImportance(n.importance))
    fail("Importance must be an integer from 1 to 5.");
  if (n.date != null && n.date !== "" && !validDate(n.date))
    fail("Invalid record date. Use YYYY-MM-DD.");
  if (n.parent !== null && !idPattern.test(n.parent || ""))
    fail("Invalid parent branch.");
  if (typeof n.body !== "string" || n.body.length > 1_000_000)
    fail("Text must not exceed 1 MB.");
  if (typeof n.summary !== "string" || n.summary.length > 2000)
    fail("Invalid short description.", 400, "summary");
  if (typeof n.color !== "string" || !/^#[0-9a-f]{6}$/i.test(n.color))
    fail("Invalid color.");
  for (const field of ["tags", "related"]) {
    if (
      !Array.isArray(n[field]) ||
      n[field].some((x) => typeof x !== "string" || x.length > 120)
    )
      fail(`Invalid ${field} field.`, 400, field);
  }
  if (
    !Array.isArray(n.resources) ||
    n.resources.some(
      (r) =>
        !r ||
        typeof r.label !== "string" ||
        (r.path != null && typeof r.path !== "string") ||
        (r.url != null &&
          (typeof r.url !== "string" || !/^https?:\/\//i.test(r.url))) ||
        (!r.path && !r.url),
    )
  )
    fail(
      "A resource needs a label and a path or HTTP(S) link.",
      400,
      "resources",
    );
  if (
    n.resources.some(
      (r) => r.locationId != null && !idPattern.test(r.locationId),
    )
  )
    fail("Invalid location ID.", 400, "resources");
  const resourceIds = new Set();
  for (const resource of n.resources) {
    if (resource.photo != null) {
      const photo = resource.photo;
      if (
        typeof photo !== "object" ||
        Array.isArray(photo) ||
        ["takenAt", "offset", "camera", "source"].some(
          (key) =>
            photo[key] != null &&
            (typeof photo[key] !== "string" || photo[key].length > 200),
        ) ||
        (photo.takenAt != null &&
          (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(
            photo.takenAt,
          ) ||
            !validDate(photo.takenAt.slice(0, 10)))) ||
        (photo.latitude != null &&
          (!Number.isFinite(photo.latitude) ||
            Math.abs(photo.latitude) > 90)) ||
        (photo.longitude != null &&
          (!Number.isFinite(photo.longitude) ||
            Math.abs(photo.longitude) > 180))
      )
        fail("Invalid photo metadata.");
    }
    if (resource.id != null || n.schema === 2) {
      if (!idPattern.test(resource.id || "") || resourceIds.has(resource.id))
        fail("Attachments must have unique stable IDs.");
      resourceIds.add(resource.id);
    }
  }
  if (
    n.previewResourceId != null &&
    n.previewResourceId !== "" &&
    (typeof n.previewResourceId !== "string" ||
      !resourceIds.has(n.previewResourceId))
  )
    fail(
      "The double-click document must reference an existing attachment ID.",
      400,
      "resources",
    );
  if (
    n.quantity != null &&
    (!Number.isSafeInteger(n.quantity) ||
      n.quantity < 1 ||
      n.quantity > 1_000_000_000)
  )
    fail("Quantity must be a positive integer.");
  if (n.projectId != null && n.projectId !== "" && !idPattern.test(n.projectId))
    fail("Invalid project ID.");
  if (n.stock != null) {
    validateStock(n.stock, fail);
  }
  if (n.tool != null) {
    if (n.type !== "knowledge") fail("Invalid tool field: recordType.");
    validateTool(n.tool, fail);
  }
  if (n.task != null) {
    if (typeof n.task !== "object" || Array.isArray(n.task))
      fail("Invalid task data.");
    validateCheckpoints(n.task, (message, status, field) =>
      fail(message, 400, field || "task.checkpoints"),
    );
    for (const key of ["start", "due"])
      if (
        n.task[key] &&
        (typeof n.task[key] !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(n.task[key]) ||
          !Number.isFinite(Date.parse(n.task[key])) ||
          new Date(n.task[key]).toISOString().slice(0, 10) !== n.task[key])
      )
        fail("Invalid task date.", 400, `task.${key}`);
    if (n.task.start && n.task.due && n.task.start > n.task.due)
      fail("The due date cannot be before the start date.", 400, "task.due");
    if (n.task.priority && !["low", "normal", "high"].includes(n.task.priority))
      fail("Invalid task priority.");
    if (
      n.task.assignee != null &&
      (typeof n.task.assignee !== "string" || n.task.assignee.length > 120)
    )
      fail("Invalid task assignee.");
  }
  return n;
}
export function graphIssues(nodes) {
  const map = new Map(nodes.map((n) => [n.id, n])),
    issues = [];
  const add = (n, code, target, message) =>
    issues.push({
      file: n.file || n.id + ".md",
      id: n.id,
      key: n.id + ":" + code + ":" + target,
      message,
    });
  const known = new Set(),
    finished = new Set();
  for (const n of nodes) {
    for (const ref of toolReferences(n)) {
      const target = map.get(ref.id);
      if (
        !target ||
        ref.id === n.id ||
        (ref.type && target.type !== ref.type) ||
        (ref.kind && target.tool?.kind !== ref.kind)
      )
        add(n, "tool", ref.id, "Invalid tool reference: " + ref.id + ".");
    }
    if (known.has(n.id)) add(n, "duplicate", n.id, "Duplicate record ID.");
    known.add(n.id);
    if (n.projectId && map.get(n.projectId)?.type !== "project")
      add(
        n,
        "project",
        n.projectId,
        "Record references a missing project: " + n.projectId,
      );
    if (n.parent && !map.has(n.parent))
      add(
        n,
        "parent",
        n.parent,
        "Record references a missing branch: " + n.parent,
      );
    for (const id of n.related)
      if (!map.has(id) || id === n.id)
        add(n, "related", id, "Invalid connection: " + id);
    const trail = new Set();
    let current = n;
    while (current && !finished.has(current.id)) {
      if (trail.has(current.id)) {
        add(
          current,
          "cycle",
          current.id,
          "A branch cannot be moved into itself or its descendants.",
        );
        break;
      }
      trail.add(current.id);
      current = map.get(current.parent);
    }
    for (const id of trail) finished.add(id);
  }
  return issues;
}
export function validateGraph(nodes) {
  const errors = graphIssues(nodes);
  if (errors.length) fail(errors[0].message);
}
