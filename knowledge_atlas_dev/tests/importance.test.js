import test from "node:test";
import assert from "node:assert/strict";
import {
  recordImportance,
  importancePriority,
  withImportance,
} from "../shared/importance.js";

test("task stars preserve legacy priorities and prefer the explicit five-star rating", () => {
  for (const [priority, expected] of [
    ["low", 1],
    ["normal", 3],
    ["high", 5],
  ]) {
    assert.equal(
      recordImportance({ type: "task", task: { priority } }),
      expected,
    );
    assert.equal(
      recordImportance({ type: "task", importance: null, task: { priority } }),
      expected,
    );
    assert.equal(
      recordImportance({ type: "task", importance: 4, task: { priority } }),
      4,
    );
  }
  assert.equal(recordImportance({ type: "task" }), 3);
  assert.equal(
    recordImportance({ type: "project", task: { priority: "high" } }),
    3,
  );
  for (const [importance, expected] of [
    [1, "low"],
    [2, "low"],
    [3, "normal"],
    [4, "high"],
    [5, "high"],
  ]) {
    const original = {
      type: "task",
      task: { due: "2026-10-01", priority: "normal" },
    };
    const updated = withImportance(original, importance);
    assert.equal(importancePriority(updated), expected);
    assert.equal(updated.task.priority, expected);
    assert.equal(updated.task.due, original.task.due);
    assert.equal(original.task.priority, "normal");
    assert.equal(original.importance, undefined);
  }
});
