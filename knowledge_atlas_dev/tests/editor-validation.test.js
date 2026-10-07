import test from "node:test";
import assert from "node:assert/strict";
import { validateNode } from "../shared/schema.js";
import { validationTab, validationField } from "../shared/editor-validation.js";
import { workspaceNode } from "../shared/workspace.js";

const record = {
  schema: 2,
  id: "example",
  title: "Example",
  type: "knowledge",
  parent: null,
  status: "active",
  body: "Preserve the full notes.",
  summary: "Summary",
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [],
};
const journal = {
  ...record,
  tool: {
    schema: 1,
    kind: "journal",
    date: "2026-10-07",
    endDate: "2026-10-07",
    minutes: 0,
    next: "",
    places: [],
  },
};
function rejected(node, field, kind, tab, target = field) {
  assert.throws(
    () => validateNode(node),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.field, field);
      assert.equal(validationTab(kind, error.field), tab);
      assert.equal(validationField(error.field), target);
      return true;
    },
  );
}
test("invalid titles and dates identify their editor tab independently of translation", () => {
  rejected({ ...journal, title: " " }, "title", "journal", "entry");
  rejected(
    { ...journal, tool: { ...journal.tool, endDate: "2026-10-06" } },
    "tool.endDate",
    "journal",
    "entry",
  );
  rejected(
    {
      ...journal,
      tool: { ...journal.tool, startTime: "10:00", endTime: "09:00" },
    },
    "tool.timeRange",
    "journal",
    "entry",
    "tool.endTime",
  );
  rejected(
    {
      ...record,
      type: "task",
      task: { start: "2026-10-07", due: "2026-10-06" },
    },
    "task.due",
    "task",
    "details",
  );
  rejected(
    { ...record, type: "task", task: { start: "2026-02-30" } },
    "task.start",
    "task",
    "details",
  );
});
test("checkpoint, attachment, place and tag errors lead to the relevant editor panel", () => {
  rejected(
    {
      ...record,
      type: "task",
      task: {
        checkpoints: [
          { id: "review", due: "2026-10-08", description: "", done: false },
        ],
      },
    },
    "task.checkpoints.0.description",
    "task",
    "checkpoints",
  );
  for (const kind of ["task", "journal"])
    rejected(
      { ...record, resources: [{ id: "attachment", label: "Missing path" }] },
      "resources",
      kind,
      "attachments",
    );
  rejected(
    {
      ...journal,
      tool: {
        ...journal.tool,
        places: [
          { id: "place", label: "Workshop", latitude: 999, longitude: 0 },
        ],
      },
    },
    "tool.coordinates",
    "journal",
    "places",
    "tool.places",
  );
  rejected(
    { ...journal, tags: ["x".repeat(121)] },
    "tags",
    "journal",
    "organization",
  );
  assert.equal(validateNode(journal), journal);
});
test("tools profile retains operational metadata while excluding unrelated record bodies", () => {
  const task = { ...record, type: "task", task: { due: "2026-10-10" } };
  const item = {
    ...record,
    type: "item",
    quantity: 5,
    stock: { movements: [] },
  };
  for (const node of [record, task, item]) {
    const summary = workspaceNode(node, "tools");
    assert.equal(summary.partial, true);
    assert.equal(summary.body, "");
    assert.deepEqual(summary.task, node.task);
    assert.deepEqual(summary.stock, node.stock);
    assert.equal(summary.quantity, node.quantity);
    assert.throws(() => validateNode(summary), /complete record/);
    assert.equal(node.body, record.body);
  }
  assert.deepEqual(workspaceNode(journal, "tools"), journal);
});
