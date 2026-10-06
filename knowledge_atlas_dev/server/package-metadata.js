import fs from "node:fs/promises";
import path from "node:path";
import { fail } from "./store.js";
import { safePath } from "./documents.js";
import { digest, Settings } from "./settings.js";
import { taskDataPath, validateTaskData, TaskData } from "./task-data.js";
import { MapPositions, validateMapPositions } from "./map-positions.js";
import { readOrder } from "./record-order.js";
import { reconcileOrder, moveInOrder } from "../shared/record-list.js";
import { validateSelection } from "../shared/backup-selection.js";

export async function readPackageMetadata(directory, stage, manifest, config) {
  let selection = null;
  const files = manifest.files.filter(
    (f) => f.path.startsWith("library/") && taskDataPath(f.path.slice(8)),
  );
  if (manifest.files.some((f) => f.path === "library/selection.json")) {
    selection = JSON.parse(
      await fs.readFile(
        await safePath(stage, "library/selection.json"),
        "utf8",
      ),
    );
    if (
      selection?.schema !== 1 ||
      !Array.isArray(selection.contexts) ||
      selection.contexts.some(
        (id) => !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(id),
      ) ||
      !Array.isArray(selection.order) ||
      selection.order.some(
        (r) =>
          !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(r.id) ||
          !Number.isSafeInteger(r.position) ||
          r.position < 1 ||
          typeof r.fixed !== "boolean",
      )
    )
      fail("Invalid selected backup metadata.");
    validateSelection(selection.parts, fail);
    new Settings(directory, false).validate({
      ...config,
      locations: selection.locations,
    });
    if (selection.map)
      validateMapPositions({ schema: 1, views: selection.map });
  }
  const incoming = new TaskData(path.join(stage, "library"));
  const current = new TaskData(directory);
  const sidecars = [];
  for (const file of files) {
    const name = file.path.slice(8);
    const value = await incoming.read(name);
    validateTaskData(name, value);
    const previous = await current.read(name, null);
    sidecars.push({
      name,
      value,
      previous,
      recordId: name.split("/")[1].replace(/\.json$/, ""),
    });
  }
  const locations = [...config.locations];
  for (const location of selection?.locations || []) {
    const existing = locations.find((l) => l.id === location.id);
    if (existing && existing.kind !== location.kind)
      fail(
        "A package location has a different kind. Resolve the location before importing.",
        409,
      );
    if (!existing) locations.push(location);
  }
  const nextConfig = new Settings(directory, false).validate({
    ...config,
    locations,
  });
  const map = await new MapPositions(directory).read(),
    order = await readOrder(directory);
  return {
    selection,
    sidecars,
    config: nextConfig,
    map,
    order,
    revision: digest(
      JSON.stringify([
        sidecars.map((s) => [s.name, s.previous]),
        map.revision,
        order,
      ]),
    ),
  };
}

export async function metadataEntries(directory, selected) {
  const meta = selected.metadata;
  if (!meta) return [];
  const result = [];
  const accepted = new Set(
    selected.rows
      .filter(
        (r) =>
          r.status !== "conflict" ||
          selected.selected.some((s) => s.next.id === r.id),
      )
      .map((r) => r.id),
  );
  const add = async (name, value) => {
    const file = await safePath(directory, name);
    const old = await fs.readFile(file).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    const raw = JSON.stringify(value);
    if (old && digest(old) === digest(raw)) return;
    result.push({
      kind: "metadata",
      name,
      raw,
      before: old ? digest(old) : null,
      after: digest(raw),
    });
  };
  for (const sidecar of meta.sidecars) {
    if (!accepted.has(sidecar.recordId)) continue;
    let value = sidecar.value;
    if (sidecar.name.startsWith("comments/")) {
      const comments = new Map(
        (sidecar.previous?.entries || []).map((c) => [c.id, c]),
      );
      for (const c of value.entries) comments.set(c.id, c);
      value = { schema: 1, entries: [...comments.values()] };
    } else if (
      sidecar.previous &&
      JSON.stringify(sidecar.previous) !== JSON.stringify(value)
    )
      fail("An activity event with the same ID has different content.", 409);
    await add(sidecar.name, value);
  }
  if (meta.selection) {
    const { revision, ...config } = selected.config;
    await add("settings.json", config);
    const views = { ...meta.map.views };
    for (const [slot, points] of Object.entries(meta.selection.map || {})) {
      const merged = new Map((views[slot] || []).map((p) => [p.id, p]));
      for (const p of points)
        if (accepted.has(p.id) && !merged.has(p.id)) merged.set(p.id, p);
      views[slot] = [...merged.values()];
    }
    if (meta.selection.map)
      await add("map-positions.json", { schema: 1, views });
    const nodes = new Map(selected.current.nodes.map((n) => [n.id, n]));
    for (const s of selected.selected) nodes.set(s.next.id, s.next);
    // Existing positions win. Only new records receive the exported relative order.
    const currentIds = new Set(selected.current.nodes.map((n) => n.id));
    const fresh = (meta.selection.order || [])
      .filter((r) => !currentIds.has(r.id) && nodes.has(r.id))
      .sort((a, b) => a.position - b.position);
    let order = reconcileOrder([...nodes.values()], meta.order);
    for (const r of fresh.toReversed()) {
      let target = 1;
      while (Object.values(order.fixed).includes(target)) target++;
      order = moveInOrder(order, r.id, target, false);
    }
    for (const r of fresh.filter((r) => r.fixed)) {
      const position = order.ids.indexOf(r.id) + 1;
      if (!Object.values(order.fixed).includes(position))
        order = moveInOrder(order, r.id, position, true);
    }
    await add("list-order.json", { schema: 1, ...order });
  }
  return result;
}
