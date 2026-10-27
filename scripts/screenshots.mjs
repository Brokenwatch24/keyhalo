#!/usr/bin/env node
/**
 * Capture app screenshots for the README and website from a running dev server
 * (`npm run dev` → browser demo with simulated devices).
 *
 * Usage:
 *   node scripts/screenshots.mjs [--url http://localhost:1420] [--routes lighting,typing]
 *                                [--themes dark,light] [--out docs/screenshots] [--budget 6000] [--lang en-US] [--optimize]
 *
 * Output: docs/screenshots/<route>-<theme>.png at 1440×900, captured with headless Edge.
 * The theme is forced with the app's `?theme=` query param (not persisted).
 * --optimize runs `oxipng` (lossless) or `pngquant` if one is on PATH.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, screenshot } from "./lib/edge.mjs";
import { ROOT } from "./lib/community.mjs";

/** name → hash route */
export const ROUTES = {
  dashboard: "dashboard",
  devices: "devices",
  lighting: "lighting",
  performance: "performance",
  keymaps: "keymaps",
  typing: "typing",
  "typing-results": "typing?demoResult=1",
  testbench: "testbench",
  automations: "automations",
  integrations: "integrations",
  community: "community",
  settings: "settings",
};

export function routeUrl(base, route, theme) {
  const u = new URL(base);
  u.searchParams.set("theme", theme);
  u.hash = `#/${ROUTES[route] ?? route}`;
  return u.toString();
}

function parseArgs(argv) {
  const o = { lang: "en-US", url: "http://localhost:1420/", routes: Object.keys(ROUTES), themes: ["dark", "light"], out: join(ROOT, "docs", "screenshots"), budget: 6000, optimize: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") o.url = argv[++i];
    else if (a === "--routes") o.routes = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--themes") o.themes = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--budget") o.budget = Number(argv[++i]);
    else if (a === "--optimize") o.optimize = true;
    else if (a === "--lang") o.lang = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function optimizer() {
  for (const [cmd, args] of [
    ["oxipng", (f) => ["-o", "3", "--strip", "safe", "-q", f]],
    ["pngquant", (f) => ["--force", "--skip-if-larger", "--quality=80-95", "--ext", ".png", f]],
  ]) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "ignore" });
      return { cmd, args };
    } catch {
      /* not installed */
    }
  }
  return null;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const browser = findBrowser();
  try {
    const res = await fetch(o.url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`✖ Dev server not reachable at ${o.url} (${e.message}). Start it with \`npm run dev\`.`);
    process.exitCode = 1;
    return;
  }
  const opt = o.optimize ? optimizer() : null;
  if (o.optimize && !opt) console.warn("⚠ --optimize: neither oxipng nor pngquant found on PATH; skipping");
  let failed = 0;
  for (const route of o.routes) {
    for (const theme of o.themes) {
      const out = join(o.out, `${route}-${theme}.png`);
      const url = routeUrl(o.url, route, theme);
      try {
        await screenshot({ url, out, budget: o.budget, browser, lang: o.lang });
        if (opt) execFileSync(opt.cmd, opt.args(out), { stdio: "ignore" });
        console.log(`✔ ${route}-${theme}.png  ${(statSync(out).size / 1024).toFixed(0)} KB`);
      } catch (e) {
        failed++;
        console.error(`✖ ${route}-${theme}: ${e.message}`);
      }
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
