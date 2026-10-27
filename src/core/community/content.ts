/**
 * Lightweight runtime checks for community content (no ajv in the app bundle — the full JSON
 * Schema validation runs in CI). These guard the app against malformed or hostile files and
 * compute what the user must review before enabling something.
 */
import type { CatalogEntry, CatalogKind, DeviceDefinition, KeyAction, KeymapPack, Profile, TypingPack } from "../types";
import { KIND_INFO, MAX_CONTENT_SIZE } from "./constants";

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const HEX16 = /^0x[0-9a-fA-F]{4}$/;
export const COLOR = /^#[0-9a-fA-F]{6}$/;

export type RiskyActionType = "launch" | "macro" | "text" | "http";

export interface RiskyAction {
  type: RiskyActionType;
  /** Where in the pack, e.g. "bindings[3] F13" or "layers[0].bindings[1] KeyQ (hold)". */
  where: string;
  /** Human-readable detail: program path, text preview, URL. */
  detail: string;
}

/** A parsed community item ready to be installed (shown to the user first). */
export interface InstallPreview {
  kind: CatalogKind;
  id: string;
  name: string;
  /** Parsed JSON for most kinds; the module source (string) for effects. */
  data: unknown;
  /** Keymap actions that launch programs, type text or call URLs. */
  risky: RiskyAction[];
  /** True for community effects: they always run sandboxed (worker, no network, no DOM). */
  sandboxed: boolean;
  /** True when the UI must obtain explicit confirmation (`confirmRisky: true`) before installing. */
  requiresConfirmation: boolean;
  /** Where it came from. */
  origin: { type: "catalog" | "gist" | "url" | "paste" | "deeplink"; ref?: string };
  /** The catalog entry, when installed from the gallery. */
  entry?: CatalogEntry;
  version?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArr = Array.isArray;

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const FORBIDDEN_EFFECT_TOKENS: [RegExp, string][] = [
  [/\bfetch\b/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bimportScripts\b/, "importScripts"],
  [/\beval\b/, "eval"],
  [/\bFunction\s*\(/, "Function("],
  [/\brequire\s*\(/, "require("],
  [/\bimport\s*\(/, "import()"],
  [/^\s*import\s[^(]/m, "import"],
];

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Forbidden tokens found in an effect module (empty = ok). */
export function forbiddenEffectTokens(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN_EFFECT_TOKENS.filter(([re]) => re.test(code)).map(([, token]) => token);
}

/**
 * Best-effort extraction of `id` / `name` / `description` / `author` string literals from an
 * effect's `meta` without executing it (the app never runs community code outside the sandbox).
 */
export function effectMetaLite(source: string): { id?: string; name?: string; description?: string; author?: string } {
  const code = stripComments(source);
  const metaStart = code.search(/\bmeta\s*[:=]\s*\{/);
  const scope = metaStart >= 0 ? code.slice(metaStart, metaStart + 4000) : code;
  const pick = (key: string) => {
    const m = new RegExp(`["']?\\b${key}["']?\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(scope);
    return m ? m[2].replace(/\\(.)/g, "$1") : undefined;
  };
  return { id: pick("id"), name: pick("name"), description: pick("description"), author: pick("author") };
}

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

/** Problems found in a piece of content (empty array = acceptable). */
export function checkContent(kind: CatalogKind, data: unknown): string[] {
  const p: string[] = [];
  if (kind === "effect") {
    if (typeof data !== "string") return ["effect must be JavaScript source"];
    if (data.length > MAX_CONTENT_SIZE) p.push("file is too large");
    if (!/\bexport\s+default\b/.test(data)) p.push("missing `export default { meta, create }`");
    if (!/\bcreate\b/.test(data)) p.push("missing create(params)");
    for (const tok of forbiddenEffectTokens(data)) p.push(`forbidden token \`${tok}\``);
    const meta = effectMetaLite(data);
    if (!meta.id || !ID_PATTERN.test(meta.id)) p.push("meta.id is missing or invalid");
    if (!meta.name) p.push("meta.name is missing");
    return p;
  }
  if (!isObj(data)) return ["content must be a JSON object"];
  if (!isStr(data.id) || !ID_PATTERN.test(data.id)) p.push("id is missing or invalid (lowercase letters, digits, . _ -)");
  if (!isStr(data.name)) p.push("name is missing");
  switch (kind) {
    case "device": {
      const d = data as Partial<DeviceDefinition>;
      if (!isStr(d.vendor)) p.push("vendor is missing");
      if (!["keyboard", "mouse", "mousepad", "headset", "other"].includes(d.type as string)) p.push("type is invalid");
      if (!["razer", "lamparray", "openrgb"].includes(d.driver as string)) p.push("driver is invalid");
      if (!isArr(d.match) || !d.match.length) p.push("match must list at least one VID/PID");
      else d.match.forEach((m, i) => (!isObj(m) || !HEX16.test(String(m.vendorId)) || !HEX16.test(String(m.productId))) && p.push(`match[${i}] needs hex vendorId/productId like "0x1532"`));
      if (!isObj(d.capabilities)) p.push("capabilities is missing");
      if (!isObj(d.size) || !isNum(d.size.w) || !isNum(d.size.h)) p.push("size {w,h} is missing");
      if (!["verified", "community", "experimental"].includes(d.status as string)) p.push("status is invalid");
      if (d.layouts !== undefined) {
        if (!isObj(d.layouts)) p.push("layouts must be an object");
        else for (const [k, l] of Object.entries(d.layouts)) if (!isObj(l) || !isArr((l as { keys?: unknown }).keys)) p.push(`layouts.${k}.keys must be an array`);
      }
      break;
    }
    case "profile": {
      const pr = data as Partial<Profile>;
      const l = pr.lighting;
      if (!isObj(l)) p.push("lighting is missing");
      else {
        if (!isArr(l.layers)) p.push("lighting.layers must be an array");
        else l.layers.forEach((layer, i) => (!isObj(layer) || !isStr(layer.id) || !isStr(layer.effect)) && p.push(`lighting.layers[${i}] needs id and effect`));
        if (!isNum(l.brightness)) p.push("lighting.brightness must be a number");
        if (!isNum(l.fps)) p.push("lighting.fps must be a number");
      }
      break;
    }
    case "keymap": {
      const k = data as Partial<KeymapPack>;
      if (!isArr(k.apps)) p.push("apps must be an array");
      if (!isObj(k.categories)) p.push("categories must be an object");
      else for (const [c, col] of Object.entries(k.categories)) if (!COLOR.test(String(col))) p.push(`categories.${c} must be a #rrggbb colour`);
      if (!isArr(k.legends)) p.push("legends must be an array");
      if (!isArr(k.bindings)) p.push("bindings must be an array");
      else k.bindings.forEach((b, i) => (!isObj(b) || !isStr(b.key) || !isObj(b.action) || !isStr(b.action.type)) && p.push(`bindings[${i}] needs key and action`));
      if (k.layers !== undefined && !isArr(k.layers)) p.push("layers must be an array");
      break;
    }
    case "typing": {
      const tp = data as Partial<TypingPack>;
      if (!isStr(tp.language)) p.push("language is missing");
      if (!["words", "quotes", "code", "lessons"].includes(tp.kind as string)) p.push("kind is invalid");
      if (tp.kind === "words" ? !isArr(tp.words) || !tp.words.length : !isArr(tp.texts) || !tp.texts.length) p.push(tp.kind === "words" ? "words must be a non-empty array" : "texts must be a non-empty array");
      break;
    }
  }
  return p;
}

/** Guess the kind of a parsed item (used for gist / URL / pasted imports). */
export function detectKind(data: unknown, filename?: string): CatalogKind | null {
  const hint = filename?.toLowerCase() ?? "";
  if (typeof data === "string") return /\bexport\s+default\b/.test(data) ? "effect" : null;
  if (/\.js$/.test(hint)) return "effect";
  for (const kind of ["device", "profile", "keymap", "typing"] as const) {
    if (hint.includes(`keyhalo-${kind}-`) || hint.includes(`.${kind}.json`)) return kind;
  }
  if (!isObj(data)) return null;
  if (typeof data.$schema === "string") {
    const m = /(device|profile|keymap|typing)\.schema\.json/.exec(data.$schema);
    if (m) return m[1] as CatalogKind;
  }
  if (isArr(data.match) && "driver" in data) return "device";
  if (isObj(data.lighting)) return "profile";
  if (isArr(data.bindings) && isObj(data.categories)) return "keymap";
  if (isStr(data.language) && ["words", "quotes", "code", "lessons"].includes(data.kind as string)) return "typing";
  return null;
}

// ---------------------------------------------------------------------------
// Risky actions
// ---------------------------------------------------------------------------

const truncate = (s = "", n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Actions in a keymap pack that the user must review: launch, text, macro with text, http. */
export function riskyActions(pack: Pick<KeymapPack, "bindings" | "layers">): RiskyAction[] {
  const out: RiskyAction[] = [];
  const visit = (a: KeyAction | { type: "http"; method?: string; url?: string } | undefined, where: string) => {
    if (!a || typeof a !== "object") return;
    switch (a.type) {
      case "launch":
        out.push({ type: "launch", where, detail: [a.path, ...(a.args ?? [])].join(" ") });
        break;
      case "text":
        out.push({ type: "text", where, detail: truncate(a.text) });
        break;
      case "macro": {
        const text = (a.steps ?? []).flatMap((s) => (s.op === "text" ? [s.text] : [])).join("");
        if (text) out.push({ type: "macro", where, detail: truncate(text) });
        break;
      }
      case "http":
        out.push({ type: "http", where, detail: `${a.method ?? "GET"} ${a.url ?? ""}`.trim() });
        break;
      case "tapHold":
        visit(a.tap, `${where} (tap)`);
        visit(a.hold, `${where} (hold)`);
        break;
    }
  };
  (pack.bindings ?? []).forEach((b, i) => visit(b?.action, `bindings[${i}] ${b?.key ?? ""}`.trim()));
  (pack.layers ?? []).forEach((l, li) => (l?.bindings ?? []).forEach((b, i) => visit(b?.action, `layers[${li}].bindings[${i}] ${b?.key ?? ""}`.trim())));
  return out;
}

/**
 * Build an InstallPreview from raw text or parsed data. Throws a list of problems as an Error
 * with `details` (wrapped as CommunityError by callers).
 */
export function makePreview(
  kind: CatalogKind,
  data: unknown,
  origin: InstallPreview["origin"],
  entry?: CatalogEntry,
): { preview?: InstallPreview; problems: string[] } {
  const problems = checkContent(kind, data);
  if (problems.length) return { problems };
  let id: string;
  let name: string;
  let version: string | undefined;
  if (kind === "effect") {
    const meta = effectMetaLite(data as string);
    id = meta.id!;
    name = meta.name!;
  } else {
    const o = data as { id: string; name: string; version?: string };
    id = o.id;
    name = o.name;
    version = typeof o.version === "string" ? o.version : undefined;
  }
  if (entry && entry.id !== id) return { problems: [`id "${id}" does not match the catalog entry "${entry.id}"`] };
  const risky = kind === "keymap" ? riskyActions(data as KeymapPack) : [];
  return {
    problems: [],
    preview: { kind, id, name, data, risky, sandboxed: kind === "effect", requiresConfirmation: risky.length > 0, origin, entry, version },
  };
}

/** Repository path for an item: community/<folder>/[<vendor>/]<id>.<ext>. */
export function repoPathFor(kind: CatalogKind, id: string, data?: unknown): string {
  const info = KIND_INFO[kind];
  if (kind === "device" && isObj(data) && isStr(data.vendor)) return `community/${info.folder}/${slug(data.vendor)}/${id}${info.ext}`;
  return `community/${info.folder}/${id}${info.ext}`;
}

/** "Razer Inc." → "razer-inc" */
export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}

/** Serialise an item the way it is stored in the repository. */
export function serialize(kind: CatalogKind, data: unknown): string {
  if (kind === "effect") return String(data);
  const obj = isObj(data) ? data : {};
  const withSchema = obj.$schema ? obj : { $schema: `${kind === "device" ? "../" : ""}../schemas/${KIND_INFO[kind].schema}`, ...obj };
  return JSON.stringify(withSchema, null, 2) + "\n";
}
