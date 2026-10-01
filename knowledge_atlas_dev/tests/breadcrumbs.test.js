import test from "node:test";
import assert from "node:assert/strict";
import { createRecordNavigation } from "../src/breadcrumb-model.js";

test("navigation follows current parents and updates siblings after manual additions, renames and moves", () => {
  const nodes = [
    { id: "root", title: "Workspace", parent: null },
    { id: "hardware", title: "Hardware", parent: "root" },
    { id: "software", title: "Software", parent: "root" },
    { id: "project", title: "Project", parent: "hardware" },
    { id: "note", title: "Notes", parent: "project" },
  ];
  const initial = createRecordNavigation(nodes);
  assert.deepEqual(
    initial.path("note").map((node) => node.id),
    ["root", "hardware", "project", "note"],
  );
  assert.deepEqual(
    initial.siblings("hardware").map((node) => node.id),
    ["hardware", "software"],
  );
  const edited = nodes.map((node) =>
    node.id === "project"
      ? { ...node, title: "Updated project", parent: "software" }
      : node,
  );
  edited.push({ id: "manual", title: "Manually added", parent: "software" });
  const current = createRecordNavigation(edited);
  assert.deepEqual(
    current.path("note").map((node) => node.id),
    ["root", "software", "project", "note"],
  );
  assert.deepEqual(
    current.siblings("manual").map((node) => node.title),
    ["Updated project", "Manually added"],
  );
  assert.deepEqual(
    createRecordNavigation(
      edited.filter((node) => node.id !== "manual"),
    ).siblings("manual"),
    [],
  );
});

test("root peers include missing-parent records and cycles do not freeze navigation", () => {
  const navigation = createRecordNavigation([
    { id: "a", title: "Same title", parent: null },
    { id: "b", title: "Same title", parent: "missing" },
    { id: "cycle-a", parent: "cycle-b" },
    { id: "cycle-b", parent: "cycle-a" },
  ]);
  assert.deepEqual(
    navigation.siblings("a").map((node) => node.id),
    ["a", "b"],
  );
  assert.deepEqual(
    navigation.path("b").map((node) => node.id),
    ["b"],
  );
  assert.equal(navigation.path("cycle-a").length, 2);
  assert.deepEqual(navigation.path("removed"), []);
  assert.deepEqual(createRecordNavigation([]).path("anything"), []);
});

test("deep record paths are iterative and have no fixed hierarchy limit", () => {
  const nodes = Array.from({ length: 10000 }, (_, index) => ({
    id: `n${index}`,
    parent: index ? `n${index - 1}` : null,
  }));
  const path = createRecordNavigation(nodes).path("n9999");
  assert.equal(path.length, 10000);
  assert.equal(path[0].id, "n0");
  assert.equal(path.at(-1).id, "n9999");
});
