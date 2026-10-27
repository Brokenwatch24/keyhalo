import type { KeymapPack, ShortcutLegend } from "@/core/types";
import { CATEGORY_PALETTE, comboFromKeys, comboId, isValidKeyCode } from "./codes";

/**
 * Import VS Code `keybindings.json` (JSON with comments) as shortcut legends.
 *
 * Supported: single-stroke chords ("ctrl+shift+p"), scan-code syntax ("ctrl+[KeyP]"),
 * removal entries ("-command"). Not supported (reported in `skipped`): multi-stroke chords
 * ("ctrl+k ctrl+c") and keys we cannot map to a KeyboardEvent.code.
 */

/** Strip // and /* *\/ comments and trailing commas (string-aware). */
export function parseJsonc<T = unknown>(text: string): T {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas before } or ] (strings already preserved verbatim, so only structural commas match).
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out) as T;
}

const NAMED: Record<string, string> = {
  enter: "Enter", escape: "Escape", esc: "Escape", tab: "Tab", space: "Space", backspace: "Backspace",
  delete: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", capslock: "CapsLock",
  pausebreak: "Pause", numlock: "NumLock", scrolllock: "ScrollLock", printscreen: "PrintScreen", contextmenu: "ContextMenu",
  "`": "Backquote", "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash",
  ";": "Semicolon", "'": "Quote", ",": "Comma", ".": "Period", "/": "Slash",
  oem_1: "Semicolon", oem_plus: "Equal", oem_comma: "Comma", oem_minus: "Minus", oem_period: "Period",
  oem_2: "Slash", oem_3: "Backquote", oem_4: "BracketLeft", oem_5: "Backslash", oem_6: "BracketRight",
  oem_7: "Quote", oem_102: "IntlBackslash",
  numpad_add: "NumpadAdd", numpad_subtract: "NumpadSubtract", numpad_multiply: "NumpadMultiply",
  numpad_divide: "NumpadDivide", numpad_decimal: "NumpadDecimal", numpad_separator: "NumpadDecimal",
  audiovolumeup: "AudioVolumeUp", audiovolumedown: "AudioVolumeDown", audiovolumemute: "AudioVolumeMute",
  mediaplaypause: "MediaPlayPause", mediatracknext: "MediaTrackNext", mediatrackprevious: "MediaTrackPrevious", mediastop: "MediaStop",
};

const MOD: Record<string, string> = { ctrl: "ControlLeft", shift: "ShiftLeft", alt: "AltLeft", meta: "MetaLeft", win: "MetaLeft", cmd: "MetaLeft", super: "MetaLeft" };

/** Parse one VS Code key stroke ("ctrl+shift+p") into KeyboardEvent.code names, or null. */
export function parseVsCodeStroke(stroke: string): string[] | null {
  const parts = stroke.trim().split("+");
  // "ctrl++" → ["ctrl", "", ""] : the key is "+" (= Shift+Equal on US) — unsupported.
  if (parts.some((p) => p === "")) return null;
  const mods = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const raw = part.toLowerCase();
    if (MOD[raw]) {
      mods.add(MOD[raw]);
      continue;
    }
    if (key) return null;
    const scan = /^\[(\w+)\]$/.exec(part);
    if (scan) key = scan[1];
    else if (/^[a-z]$/.test(raw)) key = `Key${raw.toUpperCase()}`;
    else if (/^[0-9]$/.test(raw)) key = `Digit${raw}`;
    else if (/^f([1-9]|1\d|2[0-4])$/.test(raw)) key = raw.toUpperCase();
    else if (/^numpad[0-9]$/.test(raw)) key = `Numpad${raw.slice(6)}`;
    else if (NAMED[raw]) key = NAMED[raw];
    else return null;
  }
  if (!key || !isValidKeyCode(key)) return null;
  const order = ["ControlLeft", "ShiftLeft", "AltLeft", "MetaLeft"];
  return [...order.filter((m) => mods.has(m)), key];
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/^(workbench\.action\.debug|debug\.|editor\.debug)/, "Debug"],
  [/terminal/i, "Terminal"],
  [/^(git\.|scm\.|workbench\.view\.scm)/, "Git"],
  [/(find|search|replace)/i, "Search"],
  [/^(workbench\.action\.files|files\.|workbench\.action\.(new|save|close|open|revert))/, "File"],
  [/(cursor|goto|navigate|go[A-Z]|reveal|scroll|focus|quickOpen|showAllSymbols|gotoLine)/, "Navigation"],
  [/^(workbench\.view|workbench\.action\.(toggle|zoom|split|maximize|minimize|showCommands)|view\.)/, "View"],
  [/^(editor\.action|editor\.|undo|redo|default:type|deleteLeft|deleteRight|tab|outdent|cut|copy|paste)/, "Edit"],
];

/** Category for a VS Code command id. */
export function categoryForCommand(command: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(command)) return cat;
  return "Other";
}

/** "workbench.action.showCommands" → "Show Commands". */
export function labelForCommand(command: string): string {
  const last = command.split(".").pop() ?? command;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface VsCodeImportResult {
  pack: KeymapPack;
  imported: number;
  removed: number;
  /** Entries that could not be mapped (multi-stroke chords, unknown keys). */
  skipped: { key: string; command: string; reason: "chord" | "unknownKey" | "invalid" }[];
}

interface VsEntry {
  key?: unknown;
  command?: unknown;
  when?: unknown;
}

export interface VsCodeImportOptions {
  /** Merge into this pack (e.g. the bundled VS Code pack): user entries replace same combos. */
  base?: KeymapPack;
  id?: string;
  name?: string;
}

/** Convert the text of a VS Code `keybindings.json` into a legend-only KeymapPack. */
export function importVsCodeKeybindings(text: string, opts: VsCodeImportOptions = {}): VsCodeImportResult {
  const data = parseJsonc<unknown>(text);
  if (!Array.isArray(data)) throw new Error("keybindings.json must contain an array");
  const legends = new Map<string, ShortcutLegend>();
  const categories: Record<string, string> = { ...(opts.base?.categories ?? {}) };
  for (const l of opts.base?.legends ?? []) {
    const c = comboFromKeys(l.keys);
    if (c) legends.set(comboId(c), { ...l, keys: [...l.keys] });
  }
  const skipped: VsCodeImportResult["skipped"] = [];
  let imported = 0;
  let removed = 0;

  for (const raw of data as VsEntry[]) {
    if (typeof raw?.key !== "string" || typeof raw?.command !== "string") {
      skipped.push({ key: String(raw?.key ?? ""), command: String(raw?.command ?? ""), reason: "invalid" });
      continue;
    }
    const strokes = raw.key.trim().split(/\s+/);
    if (strokes.length > 1) {
      skipped.push({ key: raw.key, command: raw.command, reason: "chord" });
      continue;
    }
    const keys = parseVsCodeStroke(strokes[0]);
    if (!keys) {
      skipped.push({ key: raw.key, command: raw.command, reason: "unknownKey" });
      continue;
    }
    const id = comboId(comboFromKeys(keys)!);
    if (raw.command.startsWith("-")) {
      const existing = legends.get(id);
      // Only remove if the removed command is what the legend describes (or the legend came from the same command).
      if (existing) {
        legends.delete(id);
        removed++;
      }
      continue;
    }
    const category = categoryForCommand(raw.command);
    if (!categories[category]) categories[category] = CATEGORY_PALETTE[Object.keys(categories).length % CATEGORY_PALETTE.length];
    legends.set(id, { keys, label: labelForCommand(raw.command), category });
    imported++;
  }

  const used = new Set([...legends.values()].map((l) => l.category));
  const pack: KeymapPack = {
    id: opts.id ?? (opts.base ? `${opts.base.id}-custom` : "vscode-custom"),
    name: opts.name ?? (opts.base ? `${opts.base.name} (my keybindings)` : "VS Code (my keybindings)"),
    description: "Imported from VS Code keybindings.json",
    version: "1.0.0",
    apps: opts.base?.apps ?? ["Code.exe"],
    categories: Object.fromEntries(Object.entries(categories).filter(([k]) => used.has(k))),
    legends: [...legends.values()],
    bindings: [],
    tags: ["vscode", "imported"],
  };
  return { pack, imported, removed, skipped };
}
