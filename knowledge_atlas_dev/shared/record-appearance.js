export const RECORD_COLORS = [
  "#a7e87b",
  "#73c8ed",
  "#c3a0f3",
  "#f1bb73",
  "#f090b2",
  "#93a9fd",
];

// Pick once when creating a draft, never when rendering or rebuilding the map.
export function randomRecordColor(random = Math.random) {
  const hue = random() * 12;
  const channel = (offset) => {
    const k = (offset + hue) % 12;
    const value = 0.69 - 0.22 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export const validMapSize = (value) =>
  Number.isFinite(value) && value >= 0.5 && value <= 3;
export const recordMapSize = (node) =>
  validMapSize(node.mapSize) ? node.mapSize : 1;
