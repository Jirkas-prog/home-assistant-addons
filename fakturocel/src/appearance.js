import { appearanceValue, palettes, luminance, contrast } from './appearance-model.js';
let current = appearanceValue();
const preferred = matchMedia('(prefers-color-scheme: dark)');
export const interfaceScale = () => current.scale / 100;
function viewport() {
  document.documentElement.style.setProperty('--ui-vh', innerHeight / interfaceScale() / 100 + 'px');
  document.documentElement.style.setProperty('--ui-vw', innerWidth / interfaceScale() / 100 + 'px');
  document.documentElement.dataset.layout = innerWidth / interfaceScale() <= 700 ? 'mobile' : innerWidth / interfaceScale() <= 1100 ? 'medium' : 'wide';
}
export function applyAppearance(value) {
  current = appearanceValue(value);
  const theme = current.theme === 'system' ? preferred.matches ? 'dark' : 'light' : current.theme;
  const colors = theme === 'custom' ? current.colors : palettes[theme];
  const root = document.documentElement;
  root.dataset.theme = luminance(colors.background) < .2 ? 'dark' : 'light';
  root.dataset.density = current.density;
  for (const [name, color] of Object.entries(colors)) root.style.setProperty('--ui-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), color);
  root.style.setProperty('--ui-on-accent', contrast(colors.accent, '#ffffff') >= contrast(colors.accent, '#102027') ? '#ffffff' : '#102027');
  root.style.setProperty('--ui-link', contrast(colors.accent, colors.surface) >= 4.5 ? colors.accent : colors.text);
  root.style.setProperty('--ui-font-size', current.fontSize + 'px');
  root.style.setProperty('--ui-small-size', current.smallTextSize + 'px');
  root.style.setProperty('--ui-logo-size', current.logoSize + 'px');
  root.style.setProperty('--ui-font', {
    noto: "Noto, 'Segoe UI', sans-serif",
    system: "system-ui, sans-serif",
    liberation: "Liberation, Arial, sans-serif"
  }[current.font]);
  document.body.style.zoom = String(interfaceScale());
  viewport();
  return current;
}
addEventListener('resize', viewport);
preferred.addEventListener('change', () => applyAppearance(current));
