import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail } from "../shared/schema.js";

export const orderRevision = (ids) =>
  createHash("sha256").update(JSON.stringify(ids)).digest("hex");
export async function readOrder(directory) {
  const file = path.join(directory, "list-order.json");
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000_000)
      fail("The list order file must be a regular JSON file under 16 MB.");
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      value?.schema !== 1 ||
      !Array.isArray(value.ids) ||
      value.ids.length > 100_000 ||
      value.ids.some(
        (id) =>
          typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(id),
      ) ||
      new Set(value.ids).size !== value.ids.length
    )
      fail("Invalid list order. Restore or repair list-order.json.");
    return value.ids;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    if (error instanceof SyntaxError)
      fail("Invalid list order. Restore or repair list-order.json.");
    throw error;
  }
}

export async function writeOrder(directory, ids) {
  // Only one atomic file changes when every displayed position is renumbered.
  const file = path.join(directory, "list-order.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ schema: 1, ids }), {
      flag: "wx",
      flush: true,
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
