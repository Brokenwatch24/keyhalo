/** Headless Microsoft Edge (or Chrome) screenshots — no Puppeteer/Playwright dependency. */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CANDIDATES = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function findBrowser() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("Microsoft Edge or Chrome not found. Set EDGE_PATH to the browser executable.");
  return found;
}

/**
 * Capture `url` into `out` (PNG) at width×height.
 * Uses a throw-away profile so it never touches (or waits for) a running browser.
 */
export function screenshot({ url, out, width = 1440, height = 900, budget = 6000, browser = findBrowser(), timeoutMs = 60_000, lang = "en-US" }) {
  const file = resolve(out);
  mkdirSync(dirname(file), { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "keyhalo-edge-"));
  const args = [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--force-device-scale-factor=1",
    `--lang=${lang}`,
    `--accept-lang=${lang}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${file}`,
    url,
  ];
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    execFile(browser, args, { timeout: timeoutMs, windowsHide: true }, (err) => {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        /* Edge may still hold a lock for a moment; it's in %TEMP% anyway */
      }
      const ok = existsSync(file) && statSync(file).mtimeMs >= started - 1000;
      if (!ok) return reject(err ?? new Error(`no screenshot written for ${url}`));
      resolvePromise(file);
    });
  });
}
