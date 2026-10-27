import type { KeyAction, KeyBinding, KeymapPack, MacroStep } from "@/core/types";
import { isValidKeyCode, isValidTrigger } from "./codes";

// ---------------------------------------------------------------------------
// Shape validation (for imported / installed packs)
// ---------------------------------------------------------------------------

const MODS = new Set(["Ctrl", "Shift", "Alt", "Meta"]);
const MEDIA = new Set(["playPause", "next", "prev", "volumeUp", "volumeDown", "mute", "micMute"]);
const MOUSE = new Set(["left", "right", "middle", "back", "forward"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function checkStep(s: unknown, path: string, errors: string[]) {
  if (!isObj(s)) return errors.push(`${path}: step must be an object`);
  const step = s as MacroStep;
  switch (step.op) {
    case "down":
    case "up":
    case "tap":
      if (!isValidKeyCode(step.key)) errors.push(`${path}: invalid key "${step.key}"`);
      break;
    case "delay":
      if (typeof step.ms !== "number" || step.ms < 0 || step.ms > 60_000) errors.push(`${path}: delay must be 0..60000 ms`);
      break;
    case "text":
      if (!isStr(step.text)) errors.push(`${path}: text must be a string`);
      break;
    default:
      errors.push(`${path}: unknown op "${String((s as { op?: unknown }).op)}"`);
  }
}

function checkAction(a: unknown, path: string, errors: string[], depth = 0) {
  if (!isObj(a)) return errors.push(`${path}: action must be an object`);
  const act = a as KeyAction;
  switch (act.type) {
    case "key":
      if (!Array.isArray(act.keys) || act.keys.length === 0) errors.push(`${path}: keys must be a non-empty array`);
      else act.keys.forEach((k) => isValidKeyCode(k) || errors.push(`${path}: invalid key "${k}"`));
      break;
    case "text":
      if (!isStr(act.text)) errors.push(`${path}: text must be a string`);
      break;
    case "macro":
      if (!Array.isArray(act.steps)) errors.push(`${path}: steps must be an array`);
      else act.steps.forEach((s, i) => checkStep(s, `${path}.steps[${i}]`, errors));
      break;
    case "launch":
      if (!isStr(act.path) || !act.path) errors.push(`${path}: path is required`);
      break;
    case "layer":
      if (!isStr(act.layer)) errors.push(`${path}: layer is required`);
      if (act.mode !== "hold" && act.mode !== "toggle") errors.push(`${path}: mode must be hold|toggle`);
      break;
    case "tapHold":
      if (depth > 1) errors.push(`${path}: nested tapHold is not supported`);
      checkAction(act.tap, `${path}.tap`, errors, depth + 1);
      checkAction(act.hold, `${path}.hold`, errors, depth + 1);
      break;
    case "mouse":
      if (!MOUSE.has(act.button)) errors.push(`${path}: invalid mouse button`);
      break;
    case "dpi":
      if (!["sniper", "cycle", "set"].includes(act.mode)) errors.push(`${path}: invalid dpi mode`);
      break;
    case "profile":
      if (!isStr(act.profileId)) errors.push(`${path}: profileId is required`);
      break;
    case "media":
      if (!MEDIA.has(act.command)) errors.push(`${path}: invalid media command`);
      break;
    case "disabled":
      break;
    default:
      errors.push(`${path}: unknown action type "${String((a as { type?: unknown }).type)}"`);
  }
}

function checkBinding(b: unknown, path: string, errors: string[]) {
  if (!isObj(b)) return errors.push(`${path}: binding must be an object`);
  const kb = b as unknown as KeyBinding;
  if (!isStr(kb.key) || !isValidTrigger(kb.key)) errors.push(`${path}: invalid trigger key "${String(kb.key)}"`);
  if (kb.with !== undefined && (!Array.isArray(kb.with) || kb.with.some((m) => !MODS.has(m)))) errors.push(`${path}: with must list Ctrl|Shift|Alt|Meta`);
  checkAction(kb.action, `${path}.action`, errors);
}

/** Validate an unknown value as a KeymapPack. Returns a list of human-readable errors (empty = valid). */
export function validatePack(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(value)) return ["Pack must be a JSON object"];
  const p = value as unknown as KeymapPack;
  if (!isStr(p.id) || !/^[a-z0-9][a-z0-9._-]*$/i.test(p.id)) errors.push("id must be a slug (letters, digits, - _ .)");
  if (!isStr(p.name) || !p.name.trim()) errors.push("name is required");
  if (!Array.isArray(p.apps) || p.apps.some((a) => !isStr(a))) errors.push("apps must be an array of process names");
  if (!isObj(p.categories) || Object.values(p.categories).some((c) => !isStr(c))) errors.push("categories must map names to colours");
  if (!Array.isArray(p.legends)) errors.push("legends must be an array");
  else
    p.legends.forEach((l, i) => {
      if (!isObj(l) || !Array.isArray(l.keys) || l.keys.length === 0) return errors.push(`legends[${i}]: keys must be a non-empty array`);
      l.keys.forEach((k) => isValidKeyCode(k) || errors.push(`legends[${i}]: invalid key "${k}"`));
      if (!isStr(l.label)) errors.push(`legends[${i}]: label is required`);
      if (!isStr(l.category) || (isObj(p.categories) && !(l.category in p.categories))) errors.push(`legends[${i}]: unknown category "${String(l.category)}"`);
    });
  if (!Array.isArray(p.bindings)) errors.push("bindings must be an array");
  else p.bindings.forEach((b, i) => checkBinding(b, `bindings[${i}]`, errors));
  if (p.layers !== undefined) {
    if (!Array.isArray(p.layers)) errors.push("layers must be an array");
    else
      p.layers.forEach((l, i) => {
        if (!isObj(l) || !isStr(l.id) || !Array.isArray(l.bindings)) return errors.push(`layers[${i}]: id and bindings are required`);
        l.bindings.forEach((b, j) => checkBinding(b, `layers[${i}].bindings[${j}]`, errors));
      });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Risk review
// ---------------------------------------------------------------------------

export type RiskKind = "launch" | "macro" | "text" | "http";

export interface RiskItem {
  kind: RiskKind;
  /** Layer id ("" = base). */
  layer: string;
  binding: KeyBinding;
  /** What will happen, e.g. the program path, the text or a macro summary. */
  detail: string;
}

function macroSummary(steps: MacroStep[]): string {
  return steps
    .map((s) => (s.op === "delay" ? `${s.ms}ms` : s.op === "text" ? JSON.stringify(s.text) : `${s.op} ${s.key}`))
    .join(", ")
    .slice(0, 240);
}

function riskOf(a: KeyAction, push: (kind: RiskKind, detail: string) => void) {
  switch (a.type) {
    case "launch":
      push("launch", [a.path, ...(a.args ?? [])].join(" "));
      break;
    case "macro":
      push("macro", macroSummary(a.steps));
      break;
    case "text":
      push("text", a.text.slice(0, 240));
      break;
    case "tapHold":
      riskOf(a.tap, push);
      riskOf(a.hold, push);
      break;
  }
  // Defensive: content from the internet may carry action types newer than this app.
  const t = (a as { type: string }).type;
  if (t === "http") push("http", String((a as unknown as { url?: string }).url ?? ""));
}

/**
 * Actions that need explicit user review before an imported pack is enabled
 * (programs launched, macros, typed text, network requests).
 */
export function riskyActions(pack: KeymapPack): RiskItem[] {
  const out: RiskItem[] = [];
  const scan = (layer: string, bindings: KeyBinding[]) =>
    bindings.forEach((binding) => riskOf(binding.action, (kind, detail) => out.push({ kind, layer, binding, detail })));
  scan("", pack.bindings ?? []);
  (pack.layers ?? []).forEach((l) => scan(l.id, l.bindings ?? []));
  return out;
}
