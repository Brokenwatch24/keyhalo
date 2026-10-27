#!/usr/bin/env node
/**
 * Validate KeyHalo community content against community/schemas plus extra checks
 * (unique ids, file name == id, key codes, risky keymap actions, effect sandbox rules…).
 *
 * Usage:
 *   node scripts/validate-community.mjs                         # validate everything
 *   node scripts/validate-community.mjs --changed a.json b.js   # only these files (PR checks)
 *   node scripts/validate-community.mjs --summary-md out.md     # also write a Markdown summary
 *   node scripts/validate-community.mjs --json                  # machine-readable output
 *   node scripts/validate-community.mjs --strict                # warnings fail too
 *
 * Exit code: 0 = ok, 1 = errors found (or warnings with --strict), 2 = bad usage.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCommunity, KINDS, ROOT } from "./lib/community.mjs";

const MARKER = "<!-- keyhalo-community-validation -->";

export function parseArgs(argv) {
  const opts = { changed: null, summaryMd: null, json: false, strict: false, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--changed") {
      opts.changed = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.changed.push(...argv[++i].split(/[\s,]+/).filter(Boolean));
    } else if (a === "--summary-md") opts.summaryMd = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c(31), yellow = c(33), green = c(32), dim = c(2), bold = c(1);

export function formatConsole(report) {
  const lines = [];
  const byKind = {};
  for (const r of report.results) (byKind[r.kind] ??= []).push(r);
  for (const [kind, def] of Object.entries(KINDS)) {
    const items = byKind[kind];
    if (!items?.length) continue;
    lines.push(bold(`${def.label}s (${items.length})`));
    for (const r of items) {
      const mark = r.errors.length ? red("✖") : r.warnings.length ? yellow("⚠") : green("✔");
      lines.push(`  ${mark} ${r.rel}${r.id ? dim(`  ${r.id}`) : ""}`);
      for (const e of r.errors) lines.push(`      ${red("error")}   ${e}`);
      for (const w of r.warnings) lines.push(`      ${yellow("warning")} ${w}`);
    }
    lines.push("");
  }
  for (const n of report.notes) lines.push(`  ${n.level === "error" ? red("✖") : yellow("⚠")} ${n.rel}: ${n.text}`);
  if (report.notes.length) lines.push("");
  const files = report.results.length;
  const summary = `${files} file${files === 1 ? "" : "s"} checked · ${report.errorCount} error${report.errorCount === 1 ? "" : "s"} · ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}`;
  lines.push(report.errorCount ? red(bold(`✖ ${summary}`)) : report.warningCount ? yellow(bold(`⚠ ${summary}`)) : green(bold(`✔ ${summary}`)));
  return lines.join("\n");
}

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/</g, "&lt;");

export function formatMarkdown(report) {
  const out = [MARKER, "## 🧩 Community content check", ""];
  if (!report.results.length && !report.notes.length) {
    out.push("No community content files changed.");
    return out.join("\n");
  }
  out.push(
    report.errorCount
      ? `❌ **${report.errorCount} error(s)** and ${report.warningCount} warning(s) — please fix the errors before merging.`
      : report.warningCount
        ? `⚠️ Passed with **${report.warningCount} warning(s)**. Maintainers will review them.`
        : "✅ All checks passed. Thanks for contributing!",
    "",
    "| | File | Kind | Id | Notes |",
    "|---|---|---|---|---|",
  );
  for (const r of report.results) {
    const icon = r.errors.length ? "❌" : r.warnings.length ? "⚠️" : "✅";
    const notes = r.errors.length || r.warnings.length ? `${r.errors.length} error(s), ${r.warnings.length} warning(s)` : "ok";
    out.push(`| ${icon} | \`${esc(r.rel)}\` | ${r.kind} | ${r.id ? `\`${esc(r.id)}\`` : "—"} | ${notes} |`);
  }
  const detailed = report.results.filter((r) => r.errors.length || r.warnings.length);
  if (detailed.length || report.notes.length) out.push("", "### Details", "");
  for (const r of detailed) {
    out.push(`<details${r.errors.length ? " open" : ""}><summary><code>${esc(r.rel)}</code></summary>`, "");
    for (const e of r.errors) out.push(`- ❌ ${esc(e)}`);
    for (const w of r.warnings) out.push(`- ⚠️ ${esc(w)}`);
    out.push("", "</details>");
  }
  for (const n of report.notes) out.push(`- ${n.level === "error" ? "❌" : "⚠️"} \`${esc(n.rel)}\`: ${esc(n.text)}`);
  const risky = report.results.filter((r) => r.risky?.length);
  if (risky.length) {
    out.push("", "> [!IMPORTANT]", "> This PR contains keymap actions that launch programs, type text or call URLs. A maintainer must review them; the app also asks users to confirm before enabling them.");
  }
  out.push("", "<sub>Generated by <code>scripts/validate-community.mjs</code>. Run <code>npm run community:validate</code> locally.</sub>");
  return out.join("\n");
}

export function run(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (opts.help) {
    console.log("Usage: node scripts/validate-community.mjs [--changed <files…>] [--summary-md <file>] [--json] [--strict]");
    return 0;
  }
  const report = validateCommunity({ root: opts.root, only: opts.changed ?? undefined });
  if (opts.json) {
    console.log(JSON.stringify({ ...report, results: report.results.map(({ data: _d, file: _f, ...r }) => r) }, null, 2));
  } else {
    console.log(formatConsole(report));
  }
  if (opts.summaryMd) writeFileSync(opts.summaryMd, formatMarkdown(report) + "\n");
  const failed = report.errorCount > 0 || (opts.strict && report.warningCount > 0);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
