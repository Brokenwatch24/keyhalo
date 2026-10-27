#!/usr/bin/env node
/**
 * Build community/index.json (CatalogIndex) from every item in community/, and refresh the
 * supported-devices table in README.md (between <!-- devices:start --> / <!-- devices:end -->).
 *
 * Usage:
 *   node scripts/build-index.mjs            # write community/index.json + README.md
 *   node scripts/build-index.mjs --check    # exit 1 if either file is out of date (no writes)
 *   node scripts/build-index.mjs --stdout   # print the index instead of writing it
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, devicesMarkdownTable, replaceBetweenMarkers, ROOT } from "./lib/community.mjs";

export function run(argv = process.argv.slice(2), root = ROOT) {
  const check = argv.includes("--check");
  const stdout = argv.includes("--stdout");
  const { index, skipped } = buildIndex({ root });
  const json = JSON.stringify(index, null, 2) + "\n";

  for (const s of skipped) console.warn(`⚠ skipped ${s.rel}: ${s.reason}`);
  if (stdout) {
    process.stdout.write(json);
    return 0;
  }

  let stale = false;
  const indexPath = join(root, "community", "index.json");
  const prev = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (prev !== json) {
    stale = true;
    if (!check) writeFileSync(indexPath, json);
  }

  const readmePath = join(root, "README.md");
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8");
    const next = replaceBetweenMarkers(readme, "devices", devicesMarkdownTable(root));
    if (next === null) console.warn("⚠ README.md has no <!-- devices:start --> / <!-- devices:end --> markers; table not refreshed");
    else if (next !== readme) {
      stale = true;
      if (!check) writeFileSync(readmePath, next);
    }
  }

  const counts = index.entries.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ") || "no entries";
  if (check) {
    console.log(stale ? "✖ community/index.json or README.md is out of date — run `npm run community:index`" : `✔ index up to date (${summary})`);
    return stale ? 1 : 0;
  }
  console.log(`✔ community/index.json ${stale ? "updated" : "unchanged"} — ${index.entries.length} entries (${summary})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
