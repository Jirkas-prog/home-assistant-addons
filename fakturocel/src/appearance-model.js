export const palettes = {
  light: {
    background: '#f4f6f8',
    surface: '#ffffff',
    text: '#20353b',
    muted: '#526870',
    accent: '#117c6d',
    sidebar: '#102d35',
    sidebarText: '#d9e9ea'
  },
  dark: {
    background: '#111b22',
    surface: '#1c2b34',
    text: '#edf4f5',
    muted: '#b4c6ce',
    accent: '#53d8b7',
    sidebar: '#0b151b',
    sidebarText: '#e0edf1'
  }
};
export const defaultAppearance = () => ({
  theme: 'light',
  scale: 100,
  fontSize: 16,
  smallTextSize: 13,
  font: 'noto',
  density: 'comfortable',
  colors: {
    ...palettes.light
  },
  logoId: '',
  logoSize: 46,
  brandName: "Fakturocel",
  tagline: "Your documents. Your rules."
});
export const appearanceValue = value => ({
  ...defaultAppearance(),
  ...value,
  colors: {
    ...palettes.light,
    ...value?.colors
  }
});
export function luminance(hex) {
  const v = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
}
export function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export function contrastReport(colors) {
  const onAccent = contrast(colors.accent, '#ffffff') >= contrast(colors.accent, '#102027') ? '#ffffff' : '#102027';
  return [{
    key: 'textBackground',
    label: "Background text",
    ratio: contrast(colors.text, colors.background),
    minimum: 4.5
  }, {
    key: 'textSurface',
    label: "Text on cards",
    ratio: contrast(colors.text, colors.surface),
    minimum: 4.5
  }, {
    key: 'mutedBackground',
    label: "Additional background text",
    ratio: contrast(colors.muted, colors.background),
    minimum: 3
  }, {
    key: 'mutedSurface',
    label: "Additional text on cards",
    ratio: contrast(colors.muted, colors.surface),
    minimum: 3
  }, {
    key: 'sidebar',
    label: "Sidebar text",
    ratio: contrast(colors.sidebarText, colors.sidebar),
    minimum: 4.5
  }, {
    key: 'button',
    label: "Main button text",
    ratio: contrast(onAccent, colors.accent),
    minimum: 4.5
  }];
}
export function validateAppearance(value, media = []) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error("Invalid appearance setting.");
  const a = appearanceValue(value);
  if (!['light', 'dark', 'system', 'custom'].includes(a.theme) || !['noto', 'system', 'liberation'].includes(a.font) || !['comfortable', 'compact'].includes(a.density)) throw Error("Choose a supported theme, font and interface density.");
  for (const [key, min, max] of [['scale', 90, 150], ['fontSize', 14, 22], ['smallTextSize', 12, 18], ['logoSize', 32, 80]]) if (!Number.isFinite(+a[key]) || a[key] < min || a[key] > max) throw Error("The size of the interface, text or logo is outside the allowed range.");
  if (a.smallTextSize > a.fontSize) throw Error("Additional text must not be larger than the main text.");
  if (typeof a.brandName !== 'string' || !a.brandName.trim() || a.brandName.length > 80 || typeof a.tagline !== 'string' || a.tagline.length > 120) throw Error("The name of the application must be between 1 and 80 characters long and the subtitle a maximum of 120 characters long.");
  if (Object.values(a.colors).some(c => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c))) throw Error("Enter the colors as a valid six-digit color.");
  if (a.theme === 'custom' && contrastReport(a.colors).some(check => check.ratio < check.minimum)) throw Error("Some text has too little contrast. In the readability overview, problematic combinations are marked in red.");
  if (a.logoId && !media.some(m => m.id === a.logoId && ['image/png', 'image/jpeg'].includes(m.mime))) throw Error("Logo not available. Choose an image from the library or the original logo.");
}
