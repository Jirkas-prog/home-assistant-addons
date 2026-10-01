import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export async function initializeLibrary(directory, seed) {
  await fs.mkdir(directory, { recursive: true });
  const marker = path.join(directory, ".initialized");
  if (await fs.stat(marker).catch(() => null)) return;
  const entries = await fs.readdir(directory);
  if (seed && !entries.some((file) => file.endsWith(".md"))) {
    for (const file of await fs.readdir(seed)) {
      if (file.endsWith(".md")) {
        await fs.copyFile(
          path.join(seed, file),
          path.join(directory, file),
          constants.COPYFILE_EXCL,
        );
      }
    }
  }
  await fs.writeFile(
    marker,
    JSON.stringify({
      schema: 1,
      initializedAt: new Date().toISOString(),
      languageSelectionRequired: entries.length === 0,
    }) + "\n",
    { flag: "wx" },
  );
}
