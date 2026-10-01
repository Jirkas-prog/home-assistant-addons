import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Store,
  parseMarkdown,
  serialize,
  validateGraph,
} from "../server/store.js";
import { createApp } from "../server/index.js";
const record = (id, parent = null) => ({
  schema: 1,
  id,
  title: `Node ${id}`,
  type: "knowledge",
  parent,
  status: "draft",
  summary: "Unicode round trip \u{1f30d}",
  color: "#a7e87b",
  tags: ["unicode"],
  related: [],
  resources: [],
  body: "# Text\n\n```js\nconst a = 1;\n```",
});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-test-"));
  t.after(() =>
    fs.rm(dir, {
      recursive: true,
      force: true,
    }),
  );
  const s = new Store(dir);
  await s.init();
  return s;
}
test("Markdown preserves Unicode, code and additional provenance", () => {
  const n = {
    ...record("test"),
    evidence: {
      source: "D:\\Project",
      kind: "folder",
    },
  };
  assert.deepEqual(parseMarkdown(serialize(n)), n);
});
test("save, restart, conflict, history and archive preserve files", async (t) => {
  const s = await fixture(t);
  const first = await s.save(record("one"));
  const restart = new Store(s.directory);
  assert.equal((await restart.read()).nodes[0].title, first.title);
  const next = await s.save(
    {
      ...first,
      title: "Edited",
    },
    first.id,
    first.revision,
  );
  await assert.rejects(
    s.save(
      {
        ...first,
        title: "Old change",
      },
      first.id,
      first.revision,
    ),
    (e) => e.status === 409,
  );
  assert.equal(
    (await fs.readdir(path.join(s.directory, ".history", "one"))).length,
    1,
  );
  await s.archive(next.id, next.revision);
  assert.equal((await s.read()).nodes.length, 0);
  assert.equal((await fs.readdir(path.join(s.directory, ".trash"))).length, 1);
});
test("rejects cycles, missing parents, invalid related references, traversal and duplicate IDs", async (t) => {
  const s = await fixture(t);
  const a = await s.save(record("a"));
  await s.save(record("b", "a"));
  await assert.rejects(
    s.save(
      {
        ...a,
        parent: "b",
      },
      "a",
      a.revision,
    ),
    /child branches|descendants/,
  );
  await assert.rejects(s.save(record("c", "absent")), /missing/);
  await assert.rejects(
    s.save({
      ...record("d"),
      related: ["absent"],
    }),
    /connection/,
  );
  await assert.rejects(s.save(record("../escape")), /ID/);
  await assert.rejects(s.save(record("a")), (e) => e.status === 409);
  await assert.rejects(
    s.archive("a", a.revision),
    /child branches|descendants/,
  );
});
test("supports 12000 nested nodes with iterative validation", () => {
  const nodes = Array.from(
    {
      length: 12000,
    },
    (_, i) => record(`node-${i}`, i ? `node-${i - 1}` : null),
  );
  assert.doesNotThrow(() => validateGraph(nodes));
});
test("manual file changes are read, invalid files stay preserved and healthy records remain editable", async (t) => {
  const s = await fixture(t);
  await s.save(record("a"));
  await fs.writeFile(
    path.join(s.directory, "a.md"),
    serialize({
      ...record("a"),
      title: "Changed externally",
    }),
  );
  assert.equal((await s.read()).nodes[0].title, "Changed externally");
  await fs.writeFile(path.join(s.directory, "broken.md"), "invalid");
  assert.equal((await s.read()).errors.length, 1);
  await s.save(record("b"));
  assert.equal((await s.read()).nodes.length, 2);
  assert.equal(
    await fs.readFile(path.join(s.directory, "broken.md"), "utf8"),
    "invalid",
  );
  await assert.rejects(s.save(record("broken")), (e) => e.status === 409);
});
test("archive rejects incoming references", async (t) => {
  const s = await fixture(t);
  const a = await s.save(record("a"));
  await s.save({
    ...record("b"),
    related: ["a"],
  });
  await assert.rejects(s.archive("a", a.revision), /incoming/);
});
test("HTTP CRUD, export, markdown resource and CSRF protection", async (t) => {
  const s = await fixture(t);
  const { app } = await createApp({
    directory: s.directory,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (p, method = "GET", body, headers = {}) =>
    fetch(url + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
        ...headers,
      },
      ...(body
        ? {
            body: JSON.stringify(body),
          }
        : {}),
    });
  assert.equal(
    (
      await fetch(url + "/api/nodes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(record("x")),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/nodes", "POST", record("x"), {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const created = await request("/api/nodes", "POST", record("x"));
  assert.equal(created.status, 201);
  const n = await created.json();
  assert.equal((await request("/api/nodes")).status, 200);
  const change = await request("/api/nodes/x", "PUT", {
    ...n,
    title: "New version",
  });
  assert.equal(change.status, 200);
  const updated = await change.json();
  assert.equal((await request("/api/nodes/x", "PUT", n)).status, 409);
  const md = await request("/api/nodes/x/markdown");
  assert.match(await md.text(), /New version/);
  const zip = await request("/api/export");
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.equal((await zip.arrayBuffer()).byteLength > 0, true);
  const source = path.join(s.directory, "reference.txt");
  await fs.writeFile(source, "ignored");
  const sourceMd = path.join(
    path.dirname(s.directory),
    `${path.basename(s.directory)}-source.md`,
  );
  await fs.writeFile(sourceMd, "# Attached document");
  t.after(() =>
    fs.rm(sourceMd, {
      force: true,
    }),
  );
  const withSource = await (
    await request("/api/nodes/x", "PUT", {
      ...updated,
      resources: [
        {
          label: "README",
          path: sourceMd,
        },
      ],
    })
  ).json();
  const read = await request("/api/nodes/x/resources/0");
  assert.equal((await read.json()).body, "# Attached document");
  assert.equal(
    (
      await request("/api/nodes/x", "DELETE", {
        revision: withSource.revision,
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/nodes/x/markdown")).status, 404);
});
test("Ingress refuses direct network access", async (t) => {
  const s = await fixture(t);
  const { app } = await createApp({
    directory: s.directory,
    ingress: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/nodes`,
    {
      headers: {
        "X-Ingress-Path": "/api/hassio_ingress/forged",
      },
    },
  );
  assert.equal(res.status, 403);
});
