import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeLibrary } from "../server/initialize.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await initializeLibrary(
  process.env.DATA_DIR || path.join(root, "data"),
  path.join(root, "seed"),
);
console.log("Sample library ready. Existing records were preserved.");
