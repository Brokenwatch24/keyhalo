/**
 * Stylised keyboard with gradient per-key lighting, rendered as inline SVG.
 * Used by the website hero (scripts/build-site.mjs) and the social card (scripts/social-card.mjs).
 * Key positions come from a community device layout when available (Huntsman Mini by default).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PALETTE = ["#ff4d6d", "#ffb703", "#3ddc97", "#22d3ee", "#4c6fff", "#b04dff"];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Colour at t (0..1) along the palette. */
export function paletteAt(t, palette = PALETTE) {
  const x = Math.min(0.9999, Math.max(0, t)) * (palette.length - 1);
  const i = Math.floor(x);
  const a = hex(palette[i]);
  const b = hex(palette[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * (x - i)));
}

/** A 60% ANSI layout used when no community layout is available. */
function fallbackLayout() {
  const rows = [
    [["Esc"], ..."1234567890-=".split("").map((c) => [c]), ["⌫", 2]],
    [["Tab", 1.5], ..."QWERTYUIOP[]".split("").map((c) => [c]), ["\\", 1.5]],
    [["Caps", 1.75], ..."ASDFGHJKL;'".split("").map((c) => [c]), ["Enter", 2.25]],
    [["Shift", 2.25], ..."ZXCVBNM,./".split("").map((c) => [c]), ["Shift", 2.75]],
    [["Ctrl", 1.25], ["❖", 1.25], ["Alt", 1.25], ["", 6.25], ["Alt", 1.25], ["Fn", 1.25], ["☰", 1.25], ["Ctrl", 1.25]],
  ];
  const keys = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const [label, w = 1] of row) {
      keys.push({ label, x, y, w, h: 1 });
      x += w;
    }
  });
  return { keys, size: { w: 15, h: 5 } };
}

/** Load a keyboard layout from community/devices (first keyboard whose id matches `prefer`). */
export function loadLayout(root, prefer = "huntsman-mini") {
  const dir = join(root, "community", "devices");
  const files = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d, { withFileTypes: true })) n.isDirectory() ? walk(join(d, n.name)) : n.name.endsWith(".json") && files.push(join(d, n.name));
  };
  walk(dir);
  const defs = files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(f, "utf8"));
      } catch {
        return null;
      }
    })
    .filter((d) => d && d.type === "keyboard" && d.layouts && d.size);
  const def = defs.find((d) => d.id === prefer || d.id.endsWith(`-${prefer}`)) ?? defs.find((d) => d.size.w <= 16) ?? defs[0];
  if (!def) return fallbackLayout();
  const layout = def.layouts[def.defaultLayout] ?? Object.values(def.layouts)[0];
  if (!layout?.keys?.length) return fallbackLayout();
  return { keys: layout.keys.map((k) => ({ label: k.label ?? "", x: k.x, y: k.y, w: k.w ?? 1, h: k.h ?? 1 })), size: def.size, name: def.name };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Render the keyboard SVG.
 * @param {{ keys, size }} layout
 * @param {{ unit?: number, id?: string, legends?: boolean, title?: string, halo?: boolean }} opts
 */
export function keyboardSvg(layout, opts = {}) {
  const u = opts.unit ?? 56;
  const pad = u * 0.42;
  const gap = u * 0.1;
  const id = opts.id ?? "kb";
  const W = layout.size.w * u + pad * 2;
  const H = layout.size.h * u + pad * 2;
  const haloPad = opts.halo === false ? 0 : u * 1.4;
  const vbX = -haloPad;
  const vbY = -haloPad;
  const vbW = W + haloPad * 2;
  const vbH = H + haloPad * 2;
  const r = u * 0.14;
  const keys = layout.keys
    .map((k) => {
      const x = pad + k.x * u + gap / 2;
      const y = pad + k.y * u + gap / 2;
      const w = k.w * u - gap;
      const h = k.h * u - gap;
      const t = (k.x + k.w / 2 + k.y * 0.55) / (layout.size.w + layout.size.h * 0.55);
      const c = paletteAt(t);
      const label = opts.legends === false || !k.label ? "" : `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h * 0.36).toFixed(1)}" fill="${c}" font-size="${(u * (k.label.length > 3 ? 0.17 : 0.22)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(k.label)}</text>`;
      return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-opacity="0.55" stroke-width="${(u * 0.02).toFixed(2)}"/><rect x="${(x + u * 0.07).toFixed(1)}" y="${(y + u * 0.05).toFixed(1)}" width="${(w - u * 0.14).toFixed(1)}" height="${(h - u * 0.2).toFixed(1)}" rx="${(r * 0.8).toFixed(1)}" fill="#1f1f24"/>${label}</g>`;
    })
    .join("");
  const stops = PALETTE.map((c, i) => `<stop offset="${(i / (PALETTE.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(0)} ${vbY.toFixed(0)} ${vbW.toFixed(0)} ${vbH.toFixed(0)}" role="img" aria-labelledby="${id}-t" class="kb-svg">
<title id="${id}-t">${esc(opts.title ?? "Keyboard with per-key RGB lighting controlled by KeyHalo")}</title>
<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="0.35">${stops}</linearGradient>
<filter id="${id}-b" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="${(u * 0.55).toFixed(0)}"/></filter></defs>
${opts.halo === false ? "" : `<rect class="kb-halo" x="${(u * 0.3).toFixed(0)}" y="${(u * 0.4).toFixed(0)}" width="${(W - u * 0.6).toFixed(0)}" height="${(H - u * 0.5).toFixed(0)}" rx="${u * 0.4}" fill="url(#${id}-g)" filter="url(#${id}-b)" opacity="0.5"/>`}
<rect x="0" y="0" width="${W.toFixed(0)}" height="${H.toFixed(0)}" rx="${(u * 0.3).toFixed(0)}" fill="#0c0c0e" stroke="#26262b"/>
<g class="kb-keys" font-family="Inter, system-ui, sans-serif" font-weight="600">${keys}</g>
</svg>`;
}
