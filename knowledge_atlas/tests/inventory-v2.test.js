import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../server/index.js";
import { Store, serialize, validateNode } from "../server/store.js";
import { filterNodes, atlasStructure } from "../src/atlas-model.js";
import { itemQuantity, itemPlaces } from "../shared/inventory.js";
import { locationLabel } from "../shared/locations.js";
const item = () => ({
  schema: 2,
  id: "parts",
  title: "Resistors",
  type: "item",
  parent: null,
  status: "active",
  summary: "Components",
  color: "#a7e87b",
  tags: [],
  related: [],
  resources: [],
  body: "",
  stock: {
    mode: "stock",
    placements: [
      { id: "drawer", locationId: "drawer", detail: "Box A", quantity: 3 },
      { id: "desk", locationId: "kolej", detail: "Desk", quantity: 2 },
    ],
  },
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-stock-")),
    directory = path.join(root, "library");
  const { app, store, settings } = await createApp({
    directory,
    allowOpen: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    assert.ok(
      path.resolve(root).startsWith(path.join(os.tmpdir(), "atlas-stock-")),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  const config = await settings.read();
  await settings.save(
    {
      ...config,
      locations: [
        ...config.locations,
        {
          id: "drawer",
          kind: "physical",
          name: "Top drawer",
          parentId: "dilna",
        },
      ],
    },
    [],
  );
  const request = (url, method = "GET", body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Knowledge-Client": "atlas",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { directory, store, settings, request };
}
test("manual stock files drive subtree filters, quantity totals and matching CSV rows", async (t) => {
  const f = await fixture(t),
    n = item(),
    config = await f.settings.read();
  await fs.writeFile(path.join(f.directory, "parts.md"), serialize(n));
  const snapshot = await (await f.request("nodes")).json();
  assert.deepEqual(snapshot.errors, []);
  assert.equal(atlasStructure(snapshot.nodes).stats.units, 5);
  assert.equal(itemQuantity(n, "dilna", config.locations), 3);
  assert.equal(itemQuantity(n, "kolej", config.locations), 2);
  assert.equal(
    filterNodes(snapshot.nodes, {
      type: "item",
      location: "dilna",
      locations: config.locations,
    }).length,
    1,
  );
  assert.equal(
    filterNodes(snapshot.nodes, {
      query: "workshop top drawer",
      locations: config.locations,
    }).length,
    1,
  );
  assert.match(
    itemPlaces(n, config.locations, "dilna"),
    /Workshop \/ Top drawer.*Box A.*3/,
  );
  assert.match(
    await (await f.request("inventory.csv?location=dilna")).text(),
    /"Resistors";"3";"Workshop \/ Top drawer · Box A \(3\)"/,
  );
  assert.doesNotMatch(
    await (await f.request("inventory.csv?location=dilna")).text(),
    /Dormitory/,
  );
  n.stock.placements[0].quantity = 0;
  await fs.writeFile(path.join(f.directory, "parts.md"), serialize(n));
  assert.equal(
    filterNodes((await f.store.read()).nodes, {
      location: "dilna",
      locations: config.locations,
    }).length,
    0,
  );
});
test("location replacement preserves quantities, attachment IDs, children and a complete rollback library", async (t) => {
  const f = await fixture(t),
    n = item();
  n.resources = [
    {
      id: "manual",
      label: "Printed manual",
      locationId: "dilna",
      path: "Shelf",
    },
  ];
  await f.store.save(n);
  const config = await f.settings.read();
  const response = await f.request("locations/dilna/replace", "POST", {
    target: "kolej",
    revision: config.revision,
  });
  assert.equal(response.status, 200);
  const result = await response.json(),
    saved = (await f.store.read()).nodes[0],
    next = await f.settings.read();
  assert.equal(itemQuantity(saved), 5);
  assert.equal(saved.resources[0].id, "manual");
  assert.equal(saved.resources[0].locationId, "kolej");
  assert.equal(next.locations.find((l) => l.id === "drawer").parentId, "kolej");
  assert.equal(itemQuantity(saved, "kolej", next.locations), 5);
  assert.equal(
    next.locations.some((l) => l.id === "dilna"),
    false,
  );
  assert.equal(
    (await new Store(result.rollbackDirectory).read()).nodes[0].resources[0]
      .locationId,
    "dilna",
  );
  assert.ok((await fs.stat(result.backup)).size > 0);
});
test("location cycles, used deletion and incompatible location kinds are rejected", async (t) => {
  const f = await fixture(t),
    config = await f.settings.read();
  await assert.rejects(
    f.settings.save(
      {
        ...config,
        locations: config.locations.map((l) =>
          l.id === "dilna" ? { ...l, parentId: "drawer" } : l,
        ),
      },
      [],
    ),
    /cycles/,
  );
  await f.store.save(item());
  await assert.rejects(
    f.settings.save(
      {
        ...config,
        locations: config.locations.filter((l) => l.id !== "drawer"),
      },
      (await f.store.read()).nodes,
    ),
    /physical place/,
  );
  assert.equal(
    (
      await f.request("locations/dilna/replace", "POST", {
        target: "drawer",
        revision: config.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    locationLabel(config.locations, "drawer"),
    "Workshop / Top drawer",
  );
});
test("stock validation rejects negative, duplicate and excessive unique quantities", () => {
  let n = item();
  n.stock.placements[0].quantity = -1;
  assert.throws(() => validateNode(n), /nonnegative/);
  n = item();
  n.stock.placements[1].id = n.stock.placements[0].id;
  assert.throws(() => validateNode(n), /unique IDs/);
  n = item();
  n.stock.mode = "unique";
  assert.throws(() => validateNode(n), /at most one/);
});
test("transfers, loans and returns are revision checked, idempotent and conserve owned units", async (t) => {
  const f = await fixture(t);
  let node = await f.store.save(item());
  const move = async (payload) =>
    f.request("nodes/parts/movements", "POST", {
      revision: node.revision,
      ...payload,
    });
  const transfer = {
    operationId: "move-one",
    kind: "transfer",
    from: "drawer",
    to: "desk",
    quantity: 2,
  };
  const response = await move(transfer);
  assert.equal(response.status, 200);
  node = await response.json();
  assert.deepEqual(
    node.stock.placements.map((p) => p.quantity),
    [1, 4],
  );
  assert.equal((await move(transfer)).status, 200);
  assert.equal((await f.store.read()).nodes[0].stock.movements.length, 1);
  assert.equal((await move({ ...transfer, quantity: 1 })).status, 409);
  assert.equal(
    (await move({ ...transfer, operationId: "too-many", quantity: 99 })).status,
    409,
  );
  const loan = await move({
    operationId: "loan-one",
    kind: "loan",
    from: "desk",
    borrower: "Alex",
    quantity: 3,
  });
  assert.equal(loan.status, 200);
  node = await loan.json();
  assert.equal(itemQuantity(node), 2);
  assert.equal(node.stock.loans[0].quantity, 3);
  const returned = await move({
    operationId: "return-one",
    kind: "return",
    loanId: "loan-one",
    to: "drawer",
    quantity: 2,
  });
  assert.equal(returned.status, 200);
  node = await returned.json();
  assert.equal(itemQuantity(node), 4);
  assert.equal(node.stock.loans[0].quantity, 1);
  assert.equal(
    (
      await move({
        operationId: "return-too-many",
        kind: "return",
        loanId: "loan-one",
        to: "drawer",
        quantity: 2,
      })
    ).status,
    400,
  );
  assert.equal((await f.store.read()).nodes[0].stock.movements.length, 3);
});
