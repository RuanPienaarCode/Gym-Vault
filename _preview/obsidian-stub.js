/* Minimal `obsidian` stand-in for the nav harness. setIcon draws a plain
   square-viewBox SVG per name: the harness is checking LAYOUT (how the tabs
   divide the bar, how big the glyph box is), not lucide's artwork, and a
   24x24 stroke SVG occupies exactly what the real one does. */
const PATHS = {
  flame: 'M12 2s5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2 2-8 2-8z',
  dumbbell: 'M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12',
  'clipboard-list': 'M9 3h6v3H9zM6 6h12v15H6zM9 12h6M9 16h6',
  target: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  footprints: 'M5 20a2 2 0 0 0 4 0c0-3 1-4 1-7a3 3 0 0 0-6 0c0 3 1 4 1 7zM15 16a2 2 0 0 0 4 0c0-3 1-4 1-7a3 3 0 0 0-6 0c0 3 1 4 1 7z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 5v4h4M12 8v4l3 2',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  'share-2': 'M18 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 11l8-4M8 13l8 4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z',
};
export function setIcon(node, name) {
  const d = PATHS[name];
  if (!d) return; // same silent no-op the real setIcon has for an unknown name
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  node.append(svg);
}
export class Notice {}
export class Modal {}
export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Setting {}
export class TFile {}
export class TFolder {}
export const normalizePath = p => p;
export const requestUrl = () => {};
