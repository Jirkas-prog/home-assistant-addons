import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail } from "../shared/schema.js";
import { MAP_LAYOUTS } from "../shared/map-layouts.js";

const invalid = "Invalid map positions. Restore or repair map-positions.json.";
const slots = new Set(
  MAP_LAYOUTS.flatMap((name) => [`${name}:2`, `${name}:3`]),
);
const revision = (views) =>
  createHash("sha256").update(JSON.stringify(views)).digest("hex");
function validatePositions(value) {
  if (
    !Array.isArray(value) ||
    value.length > 100_000 ||
    value.some(
      (p) =>
        !p ||
        typeof p.id !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(p.id) ||
        ![p.x, p.y, p.z].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 1e12,
        ),
    ) ||
    new Set(value.map((p) => p.id)).size !== value.length
  )
    fail(invalid);
  return value
    .map(({ id, x, y, z }) => ({ id, x, y, z }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}
export class MapPositions {
  constructor(directory) {
    this.file = path.join(directory, "map-positions.json");
  }
  async read() {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128_000_000)
        fail(invalid);
      const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (this.cached?.stamp === stamp) return this.cached.value;
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        raw?.schema !== 1 ||
        !raw.views ||
        typeof raw.views !== "object" ||
        Array.isArray(raw.views) ||
        Object.keys(raw.views).some((key) => !slots.has(key))
      )
        fail(invalid);
      const views = Object.fromEntries(
        Object.entries(raw.views)
          .sort()
          .map(([key, positions]) => [key, validatePositions(positions)]),
      );
      const value = { views, revision: revision(views) };
      this.cached = { stamp, value };
      return value;
    } catch (error) {
      if (error.code === "ENOENT") {
        this.cached = null;
        return { views: {}, revision: revision({}) };
      }
      if (error instanceof SyntaxError) fail(invalid);
      throw error;
    }
  }
  async save(slot, positions, expected) {
    if (!slots.has(slot)) fail("Unknown map layout.");
    const next = positions === null ? null : validatePositions(positions);
    const current = await this.read();
    // A retry after losing the successful response is safe and idempotent.
    if (JSON.stringify(current.views[slot] ?? null) === JSON.stringify(next))
      return current;
    if (expected !== current.revision)
      fail(
        "Map positions changed elsewhere. Retry to save your arrangement.",
        409,
      );
    const views = { ...current.views };
    if (next === null) delete views[slot];
    else views[slot] = next;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ schema: 1, views }), {
        flag: "wx",
        flush: true,
      });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    this.cached = null;
    return this.read();
  }
}
