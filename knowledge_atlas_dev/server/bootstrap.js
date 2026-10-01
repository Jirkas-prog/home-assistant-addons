import { release } from "../shared/release.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./index.js";
import { initializeLibrary } from "./initialize.js";
import { recoverRestore } from "./backups.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = process.env.DATA_DIR || path.join(root, "data");
await recoverRestore(directory);
await initializeLibrary(directory);
const { app } = await createApp({ directory });
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8099);
const server = app.listen(port, host, () =>
  console.log(`${release.name} ${release.version} ready at http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
