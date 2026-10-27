/**
 * Shared helpers for the community tooling (validator, index builder, site builder).
 *
 * Everything here is plain Node (ESM) + ajv, so it runs in CI without a build step.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO = "Brokenwatch24/keyhalo";
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

/** Community content kinds: folder (relative to community/), schema and file extension. */
export const KINDS = {
  device: { folder: "devices", schema: "device.schema.json", ext: ".json", label: "Device" },
  profile: { folder: "profiles", schema: "profile.schema.json", ext: ".json", label: "Profile" },
  keymap: { folder: "keymaps", schema: "keymap.schema.json", ext: ".json", label: "Keymap pack" },
  effect: { folder: "effects", schema: "effect-meta.schema.json", ext: ".js", label: "Effect" },
  typing: { folder: "typing", schema: "typing.schema.json", ext: ".json", label: "Typing pack" },
};

export const PREVIEW_EXTS = [".png", ".svg", ".jpg", ".webp"];

/** Tokens that are never allowed in community effects (they run sandboxed, offline). */
export const FORBIDDEN_EFFECT_TOKENS = [
  { re: /\bfetch\b/, token: "fetch" },
  { re: /\bXMLHttpRequest\b/, token: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, token: "WebSocket" },
  { re: /\bEventSource\b/, token: "EventSource" },
  { re: /\bimportScripts\b/, token: "importScripts" },
  { re: /\beval\b/, token: "eval" },
  { re: /\bFunction\s*\(/, token: "Function(" },
  { re: /\brequire\s*\(/, token: "require(" },
  { re: /\bimport\s*\(/, token: "import()" },
  { re: /^\s*import\s[^(]/m, token: "import" },
];

/** Tokens that are suspicious in an effect (no access to them in the sandbox anyway). */
export const SUSPICIOUS_EFFECT_TOKENS = [
  { re: /\bglobalThis\b/, token: "globalThis" },
  { re: /\bself\b/, token: "self" },
  { re: /\bwindow\b/, token: "window" },
  { re: /\bdocument\b/, token: "document" },
  { re: /\blocalStorage\b/, token: "localStorage" },
  { re: /\bindexedDB\b/, token: "indexedDB" },
  { re: /\bnavigator\b/, token: "navigator" },
  { re: /\bpostMessage\b/, token: "postMessage" },
];

export const toPosix = (p) => p.split(sep).join("/");
export const repoPath = (abs, root = ROOT) => toPosix(relative(root, abs));

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Determine the kind of a community file from its path, or null (schemas, index, readme, images…). */
export function kindOf(file, root = ROOT) {
  const rel = repoPath(resolve(root, file), root);
  const m = /^community\/([^/]+)\/(.+)$/.exec(rel);
  if (!m) return null;
  for (const [kind, def] of Object.entries(KINDS)) {
    if (def.folder === m[1] && extname(m[2]).toLowerCase() === def.ext) return kind;
  }
  return null;
}

/** All content files under community/, grouped as [{ file (abs), kind }]. */
export function listContentFiles(root = ROOT) {
  const out = [];
  for (const [kind, def] of Object.entries(KINDS)) {
    for (const f of walk(join(root, "community", def.folder))) {
      if (extname(f).toLowerCase() === def.ext) out.push({ file: f, kind });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Every file inside the content folders (used to flag stray files). */
export function listAllFolderFiles(root = ROOT) {
  return Object.values(KINDS).flatMap((d) => walk(join(root, "community", d.folder)));
}

/** Sibling preview image `<id>.png|svg|…` (repo-relative path) if present. */
export function findPreview(file, id, root = ROOT) {
  for (const ext of PREVIEW_EXTS) {
    const p = join(dirname(file), id + ext);
    if (existsSync(p)) return repoPath(p, root);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

let cachedAjv;
export function getAjv(root = ROOT) {
  if (cachedAjv && cachedAjv.root === root) return cachedAjv.ajv;
  const ajv = new Ajv2020({ allErrors: true, discriminator: true, strict: false });
  addFormats(ajv);
  const dir = join(root, "community", "schemas");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(dir, name), "utf8")));
  }
  cachedAjv = { root, ajv };
  return ajv;
}

const SCHEMA_ID = (name) => `${RAW_BASE}/community/schemas/${name}`;

export function schemaValidator(schemaFile, root = ROOT) {
  const v = getAjv(root).getSchema(SCHEMA_ID(schemaFile));
  if (!v) throw new Error(`Schema not found: ${schemaFile}`);
  return v;
}

/** Turn ajv errors into short readable strings. Discriminated unions are reported once. */
export function formatAjvErrors(errors = []) {
  const seen = new Set();
  const out = [];
  for (const e of errors) {
    // Skip noisy "must match exactly one schema in oneOf" when a more specific error exists.
    if (e.keyword === "oneOf" && errors.some((o) => o !== e && o.instancePath.startsWith(e.instancePath) && o.keyword !== "oneOf")) continue;
    if (e.keyword === "anyOf" && errors.some((o) => o !== e && o.instancePath === e.instancePath && o.keyword === "pattern")) continue;
    if (e.keyword === "if") continue;
    const where = e.instancePath || "(root)";
    let msg = e.message ?? "is invalid";
    if (e.keyword === "additionalProperties") msg = `has unknown property "${e.params.additionalProperty}"`;
    else if (e.keyword === "enum") msg = `must be one of ${e.params.allowedValues.map((v) => JSON.stringify(v)).join(", ")}`;
    else if (e.keyword === "pattern" && /keyCode|bindingKey/.test(e.schemaPath)) msg = `is not a valid KeyboardEvent.code key name`;
    else if (e.keyword === "pattern" && /color/.test(e.schemaPath)) msg = `must be a #rrggbb colour`;
    else if (e.keyword === "pattern" && /hex16/.test(e.schemaPath)) msg = `must be a 4-digit hex string like "0x1532"`;
    else if (e.keyword === "pattern" && /\/id\//.test(e.schemaPath)) msg = `must be lowercase letters, digits, ".", "_" or "-"`;
    const line = `${where} ${msg}`;
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Remove comments (naively — good enough for token scanning; strings are kept). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * Evaluate an effect module in an isolated `node:vm` context with no globals and a timeout,
 * and return its exports as plain JSON-safe data ({ meta, hasCreate }).
 * The module must not import anything; `export default` and `export const` are rewritten.
 */
export function extractEffectModule(source, { timeout = 500 } = {}) {
  if (/^\s*import\s/m.test(source)) throw new Error("effects cannot import other modules");
  let code = source.replace(/^\s*export\s+default\s+/m, "__exports.default = ");
  const named = [];
  code = code.replace(/^(\s*)export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_m, ws, kw, name) => {
    named.push(name);
    return `${ws}${kw} ${name}`;
  });
  if (/^\s*export\s/m.test(code)) throw new Error("unsupported export syntax (use `export default { meta, create }`)");
  const epilogue = named.map((n) => `__exports[${JSON.stringify(n)}] = ${n};`).join("\n");
  const wrapped = `"use strict";\nconst __exports = {};\n${code}\n;${epilogue}\n(() => {\n  const mod = __exports.default ?? __exports;\n  const meta = mod && mod.meta !== undefined ? mod.meta : __exports.meta;\n  return JSON.stringify({ meta: meta === undefined ? null : meta, hasCreate: !!mod && typeof mod.create === "function" });\n})()`;
  // A context with no host globals: only the JS built-ins exist. Code generation from strings is disabled.
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const json = new vm.Script(wrapped, { filename: "effect.js" }).runInContext(context, { timeout });
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Risky actions (keymap packs)
// ---------------------------------------------------------------------------

/** Walk a KeyAction tree and report risky actions as human-readable strings. */
export function riskyActionsOf(pack) {
  const out = [];
  const visit = (action, where) => {
    if (!action || typeof action !== "object") return;
    switch (action.type) {
      case "launch":
        out.push({ type: "launch", where, detail: `launches "${action.path}"${action.args?.length ? ` ${action.args.join(" ")}` : ""}` });
        break;
      case "text":
        out.push({ type: "text", where, detail: `types text "${truncate(action.text)}"` });
        break;
      case "macro": {
        const texts = (action.steps ?? []).filter((s) => s.op === "text");
        if (texts.length) out.push({ type: "macro", where, detail: `macro types text "${truncate(texts.map((s) => s.text).join(""))}"` });
        break;
      }
      case "http":
        out.push({ type: "http", where, detail: `HTTP request ${action.method ?? ""} ${action.url ?? ""}`.trim() });
        break;
      case "tapHold":
        visit(action.tap, `${where} (tap)`);
        visit(action.hold, `${where} (hold)`);
        break;
    }
  };
  (pack.bindings ?? []).forEach((b, i) => visit(b?.action, `bindings[${i}] ${b?.key ?? ""}`.trim()));
  (pack.layers ?? []).forEach((l, li) => (l?.bindings ?? []).forEach((b, i) => visit(b?.action, `layers[${li}].bindings[${i}] ${b?.key ?? ""}`.trim())));
  return out;
}

const truncate = (s = "", n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate one content file. Returns { file, rel, kind, id, data, errors, warnings, risky }.
 * `context` carries cross-file knowledge (known device ids, keymap ids) for reference checks.
 */
export function validateFile(file, kind, { root = ROOT, context = {} } = {}) {
  const rel = repoPath(file, root);
  const result = { file, rel, kind, id: undefined, data: undefined, errors: [], warnings: [], risky: [] };
  const def = KINDS[kind];
  const stem = basename(file, extname(file));
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (e) {
    result.errors.push(`cannot read file: ${e.message}`);
    return result;
  }
  if (source.charCodeAt(0) === 0xfeff) result.warnings.push("file starts with a UTF-8 BOM; save it without BOM");
  source = source.replace(/^﻿/, "");

  let data;
  if (kind === "effect") {
    const scan = stripComments(source);
    for (const { re, token } of FORBIDDEN_EFFECT_TOKENS) if (re.test(scan)) result.errors.push(`forbidden token \`${token}\` (effects run offline in a sandbox)`);
    for (const { re, token } of SUSPICIOUS_EFFECT_TOKENS) if (re.test(scan)) result.warnings.push(`uses \`${token}\`, which is not available in the effect sandbox`);
    if (result.errors.length) return result;
    try {
      const mod = extractEffectModule(source);
      if (!mod.hasCreate) result.errors.push("default export must have a `create(params)` function");
      if (!mod.meta) {
        result.errors.push("default export must have a `meta` object");
        return result;
      }
      data = mod.meta;
    } catch (e) {
      result.errors.push(`could not evaluate module: ${e.message}`);
      return result;
    }
  } else {
    try {
      data = JSON.parse(source);
    } catch (e) {
      result.errors.push(`invalid JSON: ${e.message}`);
      return result;
    }
  }
  result.data = data;
  result.id = typeof data?.id === "string" ? data.id : undefined;

  const validate = schemaValidator(def.schema, root);
  if (!validate(data)) result.errors.push(...formatAjvErrors(validate.errors));

  // File name must equal id (devices may also be "<vendor>-<file>").
  if (result.id) {
    const vendorDir = basename(dirname(file));
    const ok = result.id === stem || (kind === "device" && result.id === `${vendorDir}-${stem}`);
    if (!ok) result.errors.push(`file name "${basename(file)}" must match id "${result.id}" (expected ${result.id}${def.ext})`);
  }
  if (kind !== "effect" && data && typeof data === "object" && !data.$schema) {
    result.warnings.push(`add "$schema" for editor validation (e.g. "${kind === "device" ? "../" : ""}../schemas/${def.schema}")`);
  }

  if (data && typeof data === "object") {
    const extra = EXTRA_CHECKS[kind];
    if (extra) extra(data, result, context);
  }
  return result;
}

const EXTRA_CHECKS = {
  device(d, r, ctx) {
    const layouts = d.layouts ?? {};
    const layoutIds = Object.keys(layouts);
    if (d.defaultLayout && !layouts[d.defaultLayout]) r.errors.push(`defaultLayout "${d.defaultLayout}" is not a key of layouts`);
    for (const [hw, id] of Object.entries(d.layoutDetection ?? {})) if (!layouts[id]) r.errors.push(`layoutDetection["${hw}"] points to unknown layout "${id}"`);
    for (const [key, l] of Object.entries(layouts)) {
      if (l && l.id && l.id !== key) r.warnings.push(`layouts["${key}"].id is "${l.id}" (should equal its key)`);
      const seen = new Map();
      for (const k of l?.keys ?? []) {
        if (!k?.code) continue;
        if (seen.has(k.code)) r.warnings.push(`layout "${key}": key ${k.code} appears more than once`);
        seen.set(k.code, true);
        if (d.size && typeof k.x === "number" && (k.x + (k.w ?? 1) > d.size.w + 0.01 || k.y + (k.h ?? 1) > d.size.h + 0.01)) {
          r.warnings.push(`layout "${key}": key ${k.code} lies outside size ${d.size.w}×${d.size.h}`);
        }
      }
      for (const [from, to] of Object.entries(l?.fnLayer ?? {})) if (!seen.has(from)) r.warnings.push(`layout "${key}": fnLayer base key ${from} (→ ${to}) is not on the layout`);
    }
    if (d.type === "keyboard" && layoutIds.length === 0) r.warnings.push("keyboard has no layouts; the app will draw a generic board");
    if (d.capabilities?.perKeyRgb && layoutIds.length && !Object.values(layouts).some((l) => (l?.keys ?? []).some((k) => k.led !== undefined))) {
      r.warnings.push("perKeyRgb is true but no key has a `led` address");
    }
    const dpi = d.capabilities?.dpi;
    if (dpi && dpi.min > dpi.max) r.errors.push(`capabilities.dpi.min (${dpi.min}) is greater than max (${dpi.max})`);
    for (const [i, m] of (d.match ?? []).entries()) {
      if (typeof m?.vendorId === "string" && /^0X/.test(m.vendorId)) r.warnings.push(`match[${i}].vendorId should use a lowercase "0x" prefix`);
    }
    if (d.status === "verified" && !(d.testedBy ?? []).length) r.warnings.push(`status "verified" should list who tested it in testedBy`);
    const leds = new Set();
    for (const l of d.leds ?? []) {
      if (leds.has(l.id)) r.errors.push(`leds: duplicate id "${l.id}"`);
      leds.add(l.id);
    }
    void ctx;
  },
  profile(p, r, ctx) {
    const ids = new Set();
    for (const l of p.lighting?.layers ?? []) {
      if (ids.has(l.id)) r.warnings.push(`lighting layer id "${l.id}" is used twice`);
      ids.add(l.id);
    }
    if (ctx.deviceIds) for (const d of p.devices ?? []) if (!ctx.deviceIds.has(d)) r.warnings.push(`devices: "${d}" is not a known device definition id`);
    if (ctx.deviceIds) for (const d of Object.keys(p.mouse ?? {})) if (!ctx.deviceIds.has(d)) r.warnings.push(`mouse: "${d}" is not a known device definition id`);
    if (ctx.keymapIds) for (const k of p.keymaps ?? []) if (!ctx.keymapIds.has(k)) r.warnings.push(`keymaps: "${k}" is not a known keymap pack id`);
    if (typeof p.preview === "string" && p.preview.startsWith("data:") && p.preview.length > 200_000) r.warnings.push("preview data URL is larger than ~150 KB; use a sibling <id>.png instead");
  },
  keymap(k, r) {
    const cats = new Set(Object.keys(k.categories ?? {}));
    for (const [i, l] of (k.legends ?? []).entries()) if (l?.category && !cats.has(l.category)) r.warnings.push(`legends[${i}] uses category "${l.category}" which has no colour in categories`);
    for (const [i, b] of (k.bindings ?? []).entries()) if (b?.category && !cats.has(b.category)) r.warnings.push(`bindings[${i}] uses category "${b.category}" which has no colour in categories`);
    const layerIds = new Set((k.layers ?? []).map((l) => l.id));
    const checkLayer = (a, where) => {
      if (!a) return;
      if (a.type === "layer" && !layerIds.has(a.layer)) r.errors.push(`${where}: layer "${a.layer}" is not defined in layers`);
      if (a.type === "tapHold") {
        checkLayer(a.tap, where);
        checkLayer(a.hold, where);
      }
    };
    (k.bindings ?? []).forEach((b, i) => checkLayer(b?.action, `bindings[${i}]`));
    (k.layers ?? []).forEach((l, li) => (l?.bindings ?? []).forEach((b, i) => checkLayer(b?.action, `layers[${li}].bindings[${i}]`)));
    const seen = new Set();
    for (const b of k.bindings ?? []) {
      const sig = `${[...(b?.with ?? [])].sort().join("+")}+${b?.key}`;
      if (seen.has(sig)) r.warnings.push(`binding ${sig.replace(/^\+/, "")} is defined twice`);
      seen.add(sig);
    }
    r.risky = riskyActionsOf(k);
    for (const x of r.risky) r.warnings.push(`risky action (${x.type}) at ${x.where}: ${x.detail} — users must review it before enabling`);
  },
  effect(m, r) {
    if (m.source === "builtin") r.errors.push(`meta.source must be "community" (or omitted) for community effects`);
    for (const [name, p] of Object.entries(m.params ?? {})) {
      if (p?.type === "number" && typeof p.min === "number" && typeof p.max === "number") {
        if (p.min > p.max) r.errors.push(`params.${name}: min is greater than max`);
        else if (typeof p.default === "number" && (p.default < p.min || p.default > p.max)) r.errors.push(`params.${name}: default ${p.default} is outside ${p.min}..${p.max}`);
      }
      if (p?.type === "select" && Array.isArray(p.options) && !p.options.some((o) => o.value === p.default)) r.errors.push(`params.${name}: default "${p.default}" is not one of the options`);
    }
  },
  typing(t, r) {
    if (Array.isArray(t.words)) {
      const dup = t.words.length - new Set(t.words).size;
      if (dup > 0) r.warnings.push(`words contains ${dup} duplicate entr${dup === 1 ? "y" : "ies"}`);
      if (t.words.length < 50 && t.kind === "words") r.warnings.push(`only ${t.words.length} words; packs work best with 200+`);
    }
    if (t.kind === "words" && t.texts) r.warnings.push(`"texts" is ignored for kind "words"`);
    if (t.kind !== "words" && t.words) r.warnings.push(`"words" is ignored for kind "${t.kind}"`);
  },
};

/**
 * Validate the community folder. With `only` (repo-relative or absolute paths), just those
 * files are validated, but cross-file checks (unique ids, references) still use everything.
 */
export function validateCommunity({ root = ROOT, only } = {}) {
  const all = listContentFiles(root);
  // Pass 1: read ids cheaply for cross-file checks.
  const idsByKind = {};
  for (const { file, kind } of all) {
    let id;
    try {
      id = kind === "effect" ? undefined : JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")).id;
    } catch {
      /* reported in pass 2 */
    }
    if (kind === "effect") id = basename(file, ".js");
    if (typeof id === "string") ((idsByKind[kind] ??= new Map()).get(id) ?? (idsByKind[kind].set(id, []), idsByKind[kind].get(id))).push(file);
  }
  const context = {
    deviceIds: new Set(idsByKind.device?.keys() ?? []),
    keymapIds: new Set(idsByKind.keymap?.keys() ?? []),
  };

  const notes = [];
  let targets = all;
  if (only) {
    const wanted = new Set(only.map((f) => resolve(root, f)));
    targets = all.filter((t) => wanted.has(t.file));
    for (const f of wanted) {
      const rel = repoPath(f, root);
      if (rel === "community/index.json") notes.push({ rel, level: "warning", text: "community/index.json is generated by CI; please don't edit it in pull requests" });
      else if (!existsSync(f)) continue; // deleted
      else if (!targets.some((t) => t.file === f) && /^community\/(devices|profiles|keymaps|effects|typing)\//.test(rel) && !PREVIEW_EXTS.includes(extname(f).toLowerCase())) {
        notes.push({ rel, level: "warning", text: `unexpected file type in a content folder (expected ${Object.values(KINDS).map((k) => k.ext).join(" / ")} or a preview image)` });
      }
    }
  } else {
    for (const f of listAllFolderFiles(root)) {
      const ext = extname(f).toLowerCase();
      if (kindOf(f, root) || PREVIEW_EXTS.includes(ext) || /readme\.md$/i.test(f)) continue;
      notes.push({ rel: repoPath(f, root), level: "warning", text: "unexpected file in a content folder" });
    }
  }

  const results = targets.map(({ file, kind }) => validateFile(file, kind, { root, context }));

  // Unique ids per kind.
  for (const r of results) {
    if (!r.id) continue;
    const effectiveId = r.kind === "effect" ? basename(r.file, ".js") : r.id;
    const files = idsByKind[r.kind]?.get(effectiveId) ?? [];
    const others = files.filter((f) => f !== r.file);
    if (others.length) r.errors.push(`duplicate ${r.kind} id "${r.id}" (also in ${others.map((f) => repoPath(f, root)).join(", ")})`);
  }
  // Preview images: size limits.
  for (const r of results) {
    if (!r.id) continue;
    const preview = findPreview(r.file, r.id, root);
    if (preview) {
      const size = statSync(join(root, preview)).size;
      if (size > 512 * 1024) r.warnings.push(`preview ${preview} is ${(size / 1024).toFixed(0)} KB; keep previews under 512 KB`);
    }
  }
  // Devices: duplicated VID/PID/interface across definitions.
  const matchOwners = new Map();
  for (const { file } of all.filter((a) => a.kind === "device")) {
    const data = safeJson(file);
    for (const m of data?.match ?? []) {
      const sig = `${String(m.vendorId).toLowerCase()}:${String(m.productId).toLowerCase()}:${m.interface ?? "*"}`;
      (matchOwners.get(sig) ?? (matchOwners.set(sig, []), matchOwners.get(sig))).push(file);
    }
  }
  for (const r of results.filter((x) => x.kind === "device")) {
    for (const m of r.data?.match ?? []) {
      const sig = `${String(m.vendorId).toLowerCase()}:${String(m.productId).toLowerCase()}:${m.interface ?? "*"}`;
      const others = (matchOwners.get(sig) ?? []).filter((f) => f !== r.file);
      if (others.length) r.warnings.push(`match ${m.vendorId}:${m.productId} is also claimed by ${others.map((f) => repoPath(f, root)).join(", ")}`);
    }
  }

  const errorCount = results.reduce((n, r) => n + r.errors.length, 0) + notes.filter((n) => n.level === "error").length;
  const warningCount = results.reduce((n, r) => n + r.warnings.length, 0) + notes.filter((n) => n.level === "warning").length;
  return { results, notes, errorCount, warningCount, ok: errorCount === 0 };
}

function safeJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Catalog index
// ---------------------------------------------------------------------------

/** Last commit date of a file (ISO), falling back to its mtime. */
export function lastUpdated(file, root = ROOT) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", repoPath(file, root)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) return new Date(out).toISOString();
  } catch {
    /* not a git checkout */
  }
  return statSync(file).mtime.toISOString();
}

const DRIVER_LABEL = { razer: "Razer HID", lamparray: "Windows Dynamic Lighting", openrgb: "OpenRGB bridge" };
export const driverLabel = (d) => DRIVER_LABEL[d] ?? d;

/** Build a CatalogEntry from parsed content. Returns null when the item has no id/name. */
export function catalogEntry(kind, data, file, { root = ROOT, updated } = {}) {
  if (!data || typeof data.id !== "string" || typeof data.name !== "string") return null;
  const e = { kind, id: data.id, name: data.name };
  const tags = new Set(Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : []);
  switch (kind) {
    case "device": {
      e.description = `${data.vendor} ${data.type} · ${driverLabel(data.driver)}`;
      if (Array.isArray(data.testedBy) && data.testedBy.length) e.author = data.testedBy.join(", ");
      [String(data.vendor).toLowerCase(), data.type, data.driver].filter(Boolean).forEach((t) => tags.add(t));
      e.devices = [data.id];
      if (data.status) e.status = data.status;
      break;
    }
    case "profile":
      if (data.description) e.description = data.description;
      if (data.author) e.author = data.author;
      if (Array.isArray(data.devices) && data.devices.length) e.devices = data.devices;
      if (Array.isArray(data.apps) && data.apps.length) e.apps = data.apps;
      break;
    case "keymap":
      if (data.description) e.description = data.description;
      if (data.author) e.author = data.author;
      if (Array.isArray(data.apps) && data.apps.length) e.apps = data.apps;
      if (riskyActionsOf(data).length) tags.add("macros");
      break;
    case "effect":
      if (data.description) e.description = data.description;
      if (data.author) e.author = data.author;
      if (data.reactive) tags.add("reactive");
      break;
    case "typing":
      e.description = data.description || `${data.kind} · ${data.language}`;
      if (data.author) e.author = data.author;
      [data.language, data.kind].filter(Boolean).forEach((t) => tags.add(t));
      break;
  }
  if (tags.size) e.tags = [...tags];
  e.path = repoPath(file, root);
  const preview = findPreview(file, data.id, root);
  if (preview) e.preview = preview;
  e.updated = updated ?? lastUpdated(file, root);
  return e;
}

/** Build the whole CatalogIndex from the community folder. */
export function buildIndex({ root = ROOT } = {}) {
  const entries = [];
  const skipped = [];
  for (const { file, kind } of listContentFiles(root)) {
    let data;
    try {
      data = kind === "effect" ? extractEffectModule(readFileSync(file, "utf8")).meta : safeJson(file);
    } catch (e) {
      skipped.push({ rel: repoPath(file, root), reason: e.message });
      continue;
    }
    const entry = catalogEntry(kind, data, file, { root });
    if (entry) entries.push(entry);
    else skipped.push({ rel: repoPath(file, root), reason: "missing id or name" });
  }
  const order = Object.keys(KINDS);
  entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id));
  // Deterministic: "generated" is the newest entry date, so rebuilding without changes is a no-op.
  const newest = entries.reduce((max, e) => (e.updated && e.updated > max ? e.updated : max), "");
  return { index: { generated: newest || new Date(0).toISOString(), repo: REPO, entries }, skipped };
}

/** Markdown table of device definitions (README + site). */
export function devicesMarkdownTable(root = ROOT) {
  const rows = listContentFiles(root)
    .filter((f) => f.kind === "device")
    .map((f) => safeJson(f.file))
    .filter((d) => d && d.id && d.name)
    .sort((a, b) => String(a.vendor).localeCompare(String(b.vendor)) || a.name.localeCompare(b.name));
  const lines = ["| Device | Type | Connection | USB ID | Status |", "|---|---|---|---|---|"];
  for (const d of rows) {
    const usb = (d.match ?? []).map((m) => `\`${String(m.vendorId).replace(/^0x/i, "")}:${String(m.productId).replace(/^0x/i, "")}\``);
    lines.push(`| ${d.name} | ${cap(d.type)} | ${driverLabel(d.driver)} | ${[...new Set(usb)].join(" ") || "—"} | ${STATUS_BADGE[d.status] ?? d.status ?? "—"} |`);
  }
  if (!rows.length) lines.push("| _No device definitions yet_ | | | | |");
  return lines.join("\n");
}

const STATUS_BADGE = { verified: "✅ Verified", community: "🧪 Community", experimental: "⚠️ Experimental" };
const cap = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

/** Replace the content between `<!-- name:start -->` and `<!-- name:end -->`. Returns null if markers are missing. */
export function replaceBetweenMarkers(text, name, content) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(text)) return null;
  return text.replace(re, (_m, a, b) => `${a}\n${content}\n${b}`);
}

export function readJsonSafe(file) {
  return safeJson(file);
}
