import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip);
const compressedAssets = {
  name: "compressed-assets",
  async closeBundle() {
    for (const name of await fs.readdir("dist/assets")) {
      if (!/\.(js|css)$/.test(name)) continue;
      const file = `dist/assets/${name}`;
      await fs.writeFile(
        `${file}.gz`,
        await compress(await fs.readFile(file), { level: 9 }),
      );
    }
  },
};
const pdfAssets = {
  name: "pdf-assets",
  async closeBundle() {
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"])
      await fs.cp(`node_modules/pdfjs-dist/${dir}`, `dist/pdf-assets/${dir}`, {
        recursive: true,
      });
  },
  configureServer(server) {
    server.middlewares.use("/pdf-assets", async (req, res, next) => {
      const { default: serveStatic } = await import("serve-static");
      serveStatic("node_modules/pdfjs-dist")(req, res, next);
    });
  },
};
export default defineConfig({
  plugins: [react(), pdfAssets, compressedAssets],
  base: "./",
  server: { proxy: { "/api": "http://127.0.0.1:8099" } },
  build: { chunkSizeWarningLimit: 1800 },
});
