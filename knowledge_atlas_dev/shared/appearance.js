export const DEFAULT_APPEARANCE = "sage";

export const APPEARANCES = {
  classic: {
    scheme: "dark",
    shape: "classic",
    canvas: "#11151c",
    surface: "#171c23",
    raised: "#232c36",
    field: "#12161d",
    line: "#303744",
    strong: "#647385",
    text: "#e7ebf2",
    secondary: "#c7d0df",
    muted: "#8993a4",
    accent: "#b0ef88",
    onAccent: "#1c2c17",
    warm: "#a7e87b",
    sidebar: "#14181f",
  },
  sage: {
    scheme: "dark",
    shape: "organic",
    canvas: "#222e29",
    surface: "#2c3a32",
    raised: "#36473b",
    field: "#24312b",
    line: "#4b5e50",
    strong: "#758b72",
    text: "#f1f5e9",
    secondary: "#d0dac7",
    muted: "#b2c1ac",
    accent: "#d2f879",
    onAccent: "#243218",
    warm: "#e9bd87",
    sidebar: "#2d3b30",
  },
  paper: {
    scheme: "light",
    shape: "editorial",
    canvas: "#f1eee6",
    surface: "#fffdf7",
    raised: "#e8e4d9",
    field: "#fffefa",
    line: "#d0cdc2",
    strong: "#828779",
    text: "#292e29",
    secondary: "#454f42",
    muted: "#61675c",
    accent: "#52653f",
    onAccent: "#ffffff",
    warm: "#bd8753",
    sidebar: "#e8e4d8",
  },
  graphite: {
    scheme: "dark",
    shape: "precise",
    canvas: "#181b24",
    surface: "#222632",
    raised: "#2e3443",
    field: "#1c202a",
    line: "#414958",
    strong: "#77839c",
    text: "#f0f2f9",
    secondary: "#d0d6e7",
    muted: "#adb7cb",
    accent: "#b9b2ff",
    onAccent: "#262039",
    warm: "#84cbe2",
    sidebar: "#1f2330",
  },
  tide: {
    scheme: "light",
    shape: "organic",
    canvas: "#eaf3f6",
    surface: "#f8fdff",
    raised: "#dcebf0",
    field: "#ffffff",
    line: "#bbd0d9",
    strong: "#688fa0",
    text: "#173744",
    secondary: "#355361",
    muted: "#506d79",
    accent: "#096c82",
    onAccent: "#ffffff",
    warm: "#e2a967",
    sidebar: "#dcecf0",
  },
};

export const appearanceId = (value) =>
  typeof value === "string" && Object.hasOwn(APPEARANCES, value)
    ? value
    : DEFAULT_APPEARANCE;

export function appearanceVariables(value) {
  const p = APPEARANCES[appearanceId(value)];
  return {
    "--canvas": p.canvas,
    "--surface": p.surface,
    "--surface-raised": p.raised,
    "--field": p.field,
    "--line": p.line,
    "--line-strong": p.strong,
    "--text": p.text,
    "--text-secondary": p.secondary,
    "--muted": p.muted,
    "--accent": p.accent,
    "--on-accent": p.onAccent,
    "--warm": p.warm,
    "--accent-soft": `${p.accent}18`,
    "--sidebar": p.sidebar,
    "--control-radius":
      p.shape === "precise" ? "6px" : p.shape === "editorial" ? "8px" : "11px",
    "--panel-radius":
      p.shape === "precise"
        ? "10px"
        : p.shape === "editorial"
          ? "12px"
          : "20px",
    "--card-radius":
      p.shape === "precise" ? "8px" : p.shape === "editorial" ? "10px" : "16px",
  };
}
