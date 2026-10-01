import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
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
  plugins: [react(), pdfAssets],
  base: "./",
  server: { proxy: { "/api": "http://127.0.0.1:8099" } },
  build: { chunkSizeWarningLimit: 1800 },
});
