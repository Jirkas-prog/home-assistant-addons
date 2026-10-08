import {
  APPEARANCES,
  appearanceId,
  appearanceVariables,
} from "../shared/appearance.js";

// A per-space hint avoids switching another space's theme while its settings load.
const cacheKey = () => `atlas-appearance:${location.pathname}`;
export function readAppearance() {
  try {
    return appearanceId(localStorage.getItem(cacheKey()));
  } catch {
    return appearanceId();
  }
}
export function rememberAppearance(value) {
  try {
    localStorage.setItem(cacheKey(), appearanceId(value));
  } catch {}
}
export function applyAppearance(value) {
  const id = appearanceId(value),
    root = document.documentElement;
  root.dataset.appearance = id;
  root.dataset.scheme = APPEARANCES[id].scheme;
  root.style.colorScheme = APPEARANCES[id].scheme;
  for (const [name, color] of Object.entries(appearanceVariables(id)))
    root.style.setProperty(name, color);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", APPEARANCES[id].canvas);
}
