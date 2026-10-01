import fs from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Network } from "lucide-react";
import { Resvg } from "@resvg/resvg-js";

// Use the same Lucide Network geometry, colors and rounded tile as the UI.
const mark = renderToStaticMarkup(
  createElement(Network, {
    x: 24,
    y: 24,
    width: 80,
    height: 80,
    color: "#a7e87b",
    strokeWidth: 1.8,
  }),
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="1" y="1" width="126" height="126" rx="30" fill="#263522" stroke="#456036" stroke-width="2"/>${mark}</svg>`;
await fs.mkdir("public", { recursive: true });
await fs.writeFile("public/app-logo.svg", svg + "\n");
const png = new Resvg(svg, { fitTo: { mode: "width", value: 256 } })
  .render()
  .asPng();
await fs.writeFile("icon.png", png);
await fs.writeFile("logo.png", png);
console.log("Generated matching app, icon and logo assets.");
