#!/usr/bin/env node
/**
 * Render docs/social-preview.png (1280×640) — the GitHub social preview and Open Graph image —
 * from an HTML template (logo, name, tagline, stylised keyboard with gradient lighting) using
 * headless Edge.
 *
 * Usage: node scripts/social-card.mjs [--out docs/social-preview.png] [--html-only]
 * Upload the PNG in GitHub → Settings → General → Social preview.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT } from "./lib/community.mjs";
import { screenshot } from "./lib/edge.mjs";
import { keyboardSvg, loadLayout } from "../site/keyboard.mjs";

export function socialCardHtml(root = ROOT) {
  const font = pathToFileURL(join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2")).href;
  const kb = keyboardSvg(loadLayout(root), { unit: 56, id: "kb", legends: true });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url("${font}") format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1280px; height: 640px; overflow: hidden; }
body { background: #09090b; color: #ededef; font-family: Inter, "Segoe UI", sans-serif; position: relative; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px); background-size: 40px 40px; mask-image: radial-gradient(ellipse at 30% 40%, #000 30%, transparent 75%); }
.copy { position: absolute; left: 84px; top: 92px; width: 640px; }
.brand { display: flex; align-items: center; gap: 18px; font-size: 44px; font-weight: 700; letter-spacing: -0.02em; }
.brand svg { width: 64px; height: 64px; }
h1 { font-size: 54px; line-height: 1.05; letter-spacing: -0.035em; font-weight: 700; margin-top: 44px; }
p { margin-top: 22px; font-size: 24px; line-height: 1.4; color: #a1a1aa; }
.chips { display: flex; gap: 10px; margin-top: 34px; }
.chip { font-size: 18px; font-weight: 550; color: #d4d4d8; border: 1px solid #2e2e33; background: #111113; border-radius: 999px; padding: 7px 16px; }
.kb { position: absolute; right: -120px; top: 150px; width: 760px; transform: perspective(1400px) rotateY(-16deg) rotateX(8deg); }
.rule { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: linear-gradient(90deg, #ff4d6d, #ffb703, #3ddc97, #22d3ee, #4c6fff, #b04dff); }
</style></head><body>
<div class="grid"></div>
<div class="kb">${kb}</div>
<div class="copy">
  <div class="brand"><svg viewBox="0 0 32 32"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".35" stop-color="#ffb703"/><stop offset=".65" stop-color="#3ddc97"/><stop offset="1" stop-color="#4c6fff"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="none" stroke="url(#h)" stroke-width="2.5"/><rect x="8.5" y="8.5" width="15" height="15" rx="4.5" fill="#ededef"/></svg>KeyHalo</div>
  <h1>Open-source RGB, macros &amp; DPI for keyboards and mice</h1>
  <p>Per-key lighting, per-app keymaps, DPI tuning and a typing trainer. A free Razer Synapse alternative for Windows.</p>
  <div class="chips"><span class="chip">Free &amp; MIT</span><span class="chip">No account</span><span class="chip">Windows 10 / 11</span></div>
</div>
<div class="rule"></div>
</body></html>`;
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const out = i >= 0 ? resolve(argv[i + 1]) : join(ROOT, "docs", "social-preview.png");
  const dir = mkdtempSync(join(tmpdir(), "keyhalo-card-"));
  const html = join(dir, "card.html");
  writeFileSync(html, socialCardHtml());
  if (argv.includes("--html-only")) {
    console.log(html);
    return;
  }
  await screenshot({ url: pathToFileURL(html).href, out, width: 1280, height: 640, budget: 3000 });
  console.log(`✔ ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  });
}
