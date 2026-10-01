import fs from "node:fs/promises";
import path from "node:path";
import { fail } from "../shared/schema.js";

export async function historyDirectory(root, ...parts) {
  let cursor = path.resolve(root);
  for (const part of parts) {
    if (!part || part.includes("/") || part.includes("\\") || part === "..")
      fail("Invalid history path.");
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail("The history directory must be a regular directory.", 403);
    } else await fs.mkdir(cursor);
  }
  return cursor;
}
