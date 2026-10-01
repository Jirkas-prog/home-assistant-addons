import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { serialize, validateNode } from "../server/store.js";
import { safePath, resolveResource } from "../server/documents.js";
import { atlasStructure, filterNodes } from "../src/atlas-model.js";
import { projectFor } from "../src/work-model.js";
import { recordImportance, withImportance } from "../shared/importance.js";
import { taskInterval, packTimeline } from "../src/timeline-model.js";
const record = (id, type = "knowledge") => ({
  schema: 1,
  id,
  title: id,
  type,
  parent: null,
  status: "draft",
  summary: "",
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [],
  body: "",
});
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-work-"));
  const { app, store, settings } = await createApp({
    directory,
    allowOpen: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    assert.ok(
      path.resolve(directory).startsWith(path.join(os.tmpdir(), "atlas-work-")),
    );
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const request = (url, method = "GET", body) =>
    fetch(base + url, {
      method,
      headers: {
        "X-Knowledge-Client": "atlas",
        "Content-Type": "application/json",
      },
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
          }
        : {}),
    });
  const upload = (name, body) =>
    fetch(base + "documents?path=" + encodeURIComponent(name), {
      method: "POST",
      headers: {
        "X-Knowledge-Client": "atlas",
        "Content-Type": "application/octet-stream",
      },
      body,
    });
  return {
    directory,
    store,
    settings,
    base,
    request,
    upload,
  };
}
test("task importance saves without changing the schedule or notes and rejects stale edits", async (t) => {
  const f = await fixture(t);
  const original = await f.store.save({
    ...record("scheduled-task", "task"),
    body: "Keep these instructions.",
    status: "done",
    task: {
      start: "2026-10-01",
      due: "2026-10-02",
      priority: "high",
      assignee: "Owner",
      custom: "keep",
    },
  });
  assert.equal(recordImportance(original), 5);
  const response = await f.request(
    `nodes/${original.id}`,
    "PUT",
    withImportance(original, 2),
  );
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.importance, 2);
  assert.deepEqual(saved.task, { ...original.task, priority: "low" });
  assert.equal(saved.body, original.body);
  assert.equal(saved.status, "done");
  assert.equal(saved.startDay, undefined);
  assert.equal(saved.endDay, undefined);
  const interval = taskInterval(saved);
  assert.equal(interval.end - interval.start, 2);
  assert.equal(recordImportance(interval.node), 2);
  const stale = await f.request(
    `nodes/${original.id}`,
    "PUT",
    withImportance(original, 5),
  );
  assert.equal(stale.status, 409);
  assert.equal(
    (await (await f.request(`nodes/${original.id}`)).json()).importance,
    2,
  );
});

test("location CRUD persists, preserves links on rename, rejects used deletion and stale settings", async (t) => {
  const f = await fixture(t),
    old = await f.settings.read();
  const item = {
    ...record("meter", "item"),
    quantity: 2,
    resources: [
      {
        label: "Where",
        locationId: "dilna",
        path: "Top left drawer",
      },
    ],
  };
  await f.store.save(item);
  const before = await f.request("nodes");
  const updated = {
    ...old,
    locations: old.locations.map((l) =>
      l.id === "dilna"
        ? {
            ...l,
            name: "My workshop",
          }
        : l,
    ),
  };
  assert.equal((await f.request("settings", "PUT", updated)).status, 200);
  assert.equal((await f.request("settings", "PUT", old)).status, 409);
  const after = await f.request("nodes");
  assert.notEqual(before.headers.get("etag"), after.headers.get("etag"));
  const snapshot = await after.json();
  assert.equal(
    filterNodes(snapshot.nodes, {
      query: "my workshop",
      locations: snapshot.settings.locations,
    }).length,
    1,
  );
  const current = await f.settings.read();
  assert.equal(
    (
      await f.request("settings", "PUT", {
        ...current,
        locations: current.locations.filter((l) => l.id !== "dilna"),
      })
    ).status,
    409,
  );
  const add = await (
    await f.request("settings", "PUT", {
      ...current,
      locations: [
        ...current.locations,
        {
          id: "new-location",
          name: "Cabinet",
          kind: "physical",
        },
      ],
    })
  ).json();
  assert.equal(add.locations.at(-1).name, "Cabinet");
  assert.equal(
    (
      await f.request("settings", "PUT", {
        ...add,
        locations: add.locations.filter((l) => l.id !== "new-location"),
      })
    ).status,
    200,
  );
  const { settings: restarted } = await createApp({
    directory: f.directory,
  });
  assert.equal(
    (await restarted.read()).locations.find((l) => l.id === "dilna").name,
    "My workshop",
  );
});
test("relative document upload, editable UTF-8, conflict protection, history, readonly devices and PDF ranges", async (t) => {
  const f = await fixture(t);
  const config = await f.settings.read();
  const response = await f.upload("school/notebook.txt", "Original text");
  assert.equal(response.status, 201);
  const resource = await response.json();
  assert.equal(
    await fs.readFile(
      path.join(config.documentRoot, "school", "notebook.txt"),
      "utf8",
    ),
    "Original text",
  );
  assert.equal(
    (await f.upload("school/notebook.txt", "Overwrite")).status,
    409,
  );
  const n = await f.store.save({
    ...record("school"),
    resources: [resource],
  });
  const doc = await (await f.request("nodes/school/resources/0")).json();
  assert.equal(doc.body, "Original text");
  assert.equal(doc.editable, true);
  const save = await f.request("nodes/school/resources/0/text", "PUT", {
    body: "New content",
    revision: doc.revision,
    targetRevision: doc.targetRevision,
  });
  assert.equal(save.status, 200);
  assert.equal(
    (
      await f.request("nodes/school/resources/0/text", "PUT", {
        body: "Old content",
        revision: doc.revision,
        targetRevision: doc.targetRevision,
      })
    ).status,
    409,
  );
  assert.equal(
    (await fs.readdir(path.join(config.documentRoot, "school", ".history")))
      .length,
    1,
  );
  const pdf = await (
    await f.upload("school/sample.pdf", "%PDF-1.7\nexample")
  ).json();
  await f.store.save(
    {
      ...n,
      resources: [resource, pdf],
    },
    n.id,
    n.revision,
  );
  const file = await fetch(f.base + "nodes/school/resources/1/file", {
    headers: {
      Range: "bytes=0-7",
    },
  });
  assert.equal(file.status, 206);
  assert.match(file.headers.get("content-type"), /application\/pdf/);
  assert.equal(await file.text(), "%PDF-1.7");
  const device = await resolveResource(
    {
      label: "PC",
      locationId: "pc",
      path: "D:\\notes.txt",
    },
    config,
    true,
  );
  assert.equal(device.kind, "place");
  assert.equal(device.editable, false);
  const local = await resolveResource(
    {
      label: "PC",
      locationId: "pc",
      path: path.join(config.documentRoot, "school", "notebook.txt"),
    },
    config,
    false,
  );
  assert.equal(local.editable, false);
  const readonly = await f.settings.save(
    {
      ...config,
      locations: config.locations.map((l) =>
        l.id === "addon"
          ? {
              ...l,
              writable: false,
            }
          : l,
      ),
    },
    (await f.store.read()).nodes,
  );
  assert.equal(
    (
      await f.request("nodes/school/resources/0/text", "PUT", {
        body: "x",
        revision: (await save.json()).revision,
      })
    ).status,
    403,
  );
  assert.equal((await f.upload("no.txt", "x")).status, 403);
});
test("document containment rejects traversal, absolute paths, hidden files and symlink escapes", async (t) => {
  const f = await fixture(t),
    config = await f.settings.read();
  for (const name of [
    "../outside.txt",
    "sub/../../escape.txt",
    "C:/Windows/test.txt",
    "/etc/passwd",
    ".history/file.txt",
  ])
    assert.equal((await f.upload(name, "x")).status, 400, name);
  await fs.mkdir(config.documentRoot, {
    recursive: true,
  });
  const outside = path.join(f.directory, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "private");
  await fs.symlink(
    outside,
    path.join(config.documentRoot, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    safePath(config.documentRoot, "link/secret.txt"),
    (e) => e.status === 403,
  );
  await assert.rejects(
    safePath(config.documentRoot, "link/new/file.txt", {
      create: true,
    }),
    (e) => e.status === 403,
  );
  assert.equal(
    await fs.stat(path.join(outside, "new")).catch(() => null),
    null,
  );
});
test("manual item and task Markdown drives filters, statistics, board data and timeline without a rebuild", async (t) => {
  const f = await fixture(t);
  const project = record("project", "project"),
    task = {
      ...record("task", "task"),
      parent: "project",
      projectId: "project",
      task: {
        start: "2026-10-01",
        due: "2026-10-05",
        priority: "high",
        assignee: "Alex",
      },
    },
    item = {
      ...record("tool", "item"),
      quantity: 3,
      resources: [
        {
          label: "Storage",
          locationId: "kolej",
          path: "Cabinet",
        },
      ],
    };
  for (const n of [project, task, item])
    await fs.writeFile(path.join(f.directory, n.id + ".md"), serialize(n));
  const snapshot = await (await f.request("nodes")).json();
  assert.deepEqual(snapshot.errors, []);
  assert.equal(atlasStructure(snapshot.nodes).stats.tasks, 1);
  assert.equal(atlasStructure(snapshot.nodes).stats.items, 1);
  assert.equal(
    filterNodes(snapshot.nodes, {
      type: "item",
      location: "kolej",
    }).length,
    1,
  );
  assert.equal(
    filterNodes(snapshot.nodes, {
      type: "item",
      location: "dilna",
    }).length,
    0,
  );
  assert.equal(
    filterNodes(snapshot.nodes, {
      query: "alex",
    }).length,
    1,
  );
  const csv = await f.request("inventory.csv?location=kolej");
  assert.match(csv.headers.get("content-disposition"), /attachment/);
  assert.match(await csv.text(), /"tool";"3";"Dormitory · Cabinet"/);
  assert.doesNotMatch(
    await (await f.request("inventory.csv?location=dilna")).text(),
    /tool/,
  );
  assert.equal(projectFor(task, snapshot.nodes).id, "project");
  const interval = taskInterval(task);
  assert.equal(interval.end - interval.start, 5);
  const timeline = packTimeline([task, record("undated", "task")], {
    start: interval.start,
    days: 7,
  });
  assert.equal(timeline.items.length, 2);
  assert.equal(timeline.lanes, 2);
  const loaded = snapshot.nodes.find((n) => n.id === "task");
  assert.equal(
    (
      await f.request("nodes/task", "PUT", {
        ...loaded,
        status: "done",
      })
    ).status,
    200,
  );
  assert.match(
    await fs.readFile(path.join(f.directory, "task.md"), "utf8"),
    /status: done/,
  );
  assert.equal(
    (
      await f.request("nodes/project", "DELETE", {
        revision: snapshot.nodes.find((n) => n.id === "project").revision,
      })
    ).status,
    409,
  );
  assert.throws(
    () =>
      validateNode({
        ...task,
        task: {
          start: "2026-10-05",
          due: "2026-10-01",
        },
      }),
    /before the start/,
  );
  assert.throws(
    () =>
      validateNode({
        ...task,
        task: {
          due: "2026-02-30",
        },
      }),
    /date/,
  );
  await fs.unlink(path.join(f.directory, "tool.md"));
  assert.equal(
    atlasStructure((await (await f.request("nodes")).json()).nodes).stats.items,
    0,
  );
});
