import type { KeyAction, KeymapPack, MacroStep, ModifierName } from "@/core/types";
import { isModifierCode } from "./codes";

/**
 * Export a keymap pack as a Kanata (https://github.com/jtroo/kanata) `.kbd` configuration.
 *
 * Mapping:
 *  - base bindings → `deflayer base`, pack layers → one `deflayer` each (unbound keys are `_`)
 *  - `tapHold` → `(tap-hold T T tap hold)`, `layer` hold → `(layer-while-held L)`,
 *    `layer` toggle → `(layer-switch L)` (+ the same key switches back to base inside L)
 *  - `key` chords → `C-S-a` style or `(multi …)`, `text`/`macro` → `(macro …)`
 *  - bindings with modifiers (`with`) → `(fork default action (lctl rctl …))`
 *
 * Limitations (reported as warnings): Kanata is global (pack `apps` are ignored); `launch`,
 * `dpi`, `profile` and mic-mute actions are KeyHalo-only and exported as `XX`; macro key
 * down/up of non-modifiers becomes a tap; non-ASCII text is skipped; mouse-button triggers
 * and `Fn` cannot be remapped; `with` requiring several modifiers matches any of them.
 */

const KEY_NAMES: Record<string, string> = {
  Escape: "esc", Tab: "tab", CapsLock: "caps", Space: "spc", Enter: "ret", Backspace: "bspc", Delete: "del",
  Insert: "ins", Home: "home", End: "end", PageUp: "pgup", PageDown: "pgdn",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "rght",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Backquote: "grv", Comma: ",", Period: ".", Slash: "/", IntlBackslash: "102d", IntlRo: "ro", IntlYen: "yen",
  PrintScreen: "prnt", ScrollLock: "slck", Pause: "pause", ContextMenu: "menu", NumLock: "nlck",
  NumpadAdd: "kp+", NumpadSubtract: "kp-", NumpadMultiply: "kp*", NumpadDivide: "kp/", NumpadDecimal: "kp.",
  NumpadEnter: "kprt", NumpadEqual: "kp=",
  ControlLeft: "lctl", ControlRight: "rctl", ShiftLeft: "lsft", ShiftRight: "rsft", AltLeft: "lalt", AltRight: "ralt",
  MetaLeft: "lmet", MetaRight: "rmet",
  MediaPlayPause: "pp", MediaTrackNext: "next", MediaTrackPrevious: "prev", MediaStop: "stop",
  AudioVolumeUp: "volu", AudioVolumeDown: "voldwn", AudioVolumeMute: "mute",
};

/** KeyboardEvent.code → Kanata key name (null when Kanata has no equivalent). */
export function kanataKey(code: string): string | null {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `kp${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code.toLowerCase();
  return null;
}

const MOD_PREFIX: Record<string, string> = {
  ControlLeft: "C-", ControlRight: "RC-", ShiftLeft: "S-", ShiftRight: "RS-", AltLeft: "A-", AltRight: "RA-", MetaLeft: "M-", MetaRight: "RM-",
};
const FORK_KEYS: Record<ModifierName, string> = { Ctrl: "lctl rctl", Shift: "lsft rsft", Alt: "lalt ralt", Meta: "lmet rmet" };

// US layout characters for text macros.
const SHIFTED: Record<string, string> = {
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  _: "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "grv",
};
const PLAIN: Record<string, string> = { " ": "spc", "\n": "ret", "\t": "tab", "`": "grv", "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\", ";": ";", "'": "'", ",": ",", ".": ".", "/": "/" };

export interface KanataExport {
  text: string;
  warnings: string[];
}

const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "layer";

export function exportKanata(pack: KeymapPack): KanataExport {
  const warnings: string[] = [];
  const warn = (w: string) => warnings.includes(w) || warnings.push(w);

  const layers = [{ id: "", name: "base", bindings: pack.bindings }, ...(pack.layers ?? []).map((l) => ({ id: l.id, name: l.name, bindings: l.bindings }))];
  const layerName = new Map<string, string>();
  const used = new Set<string>();
  for (const l of layers) {
    let n = l.id === "" ? "base" : sanitize(l.id);
    if (l.id !== "" && n === "base") n = "layer-base";
    while (used.has(n)) n += "_";
    used.add(n);
    layerName.set(l.id, n);
  }

  // defsrc: every trigger key in order of appearance.
  const src: string[] = [];
  for (const l of layers)
    for (const b of l.bindings) {
      if (b.key.startsWith("Mouse")) {
        warn(`Mouse button trigger ${b.key} is not exported (Kanata remaps keyboard keys).`);
        continue;
      }
      if (b.key === "Fn") {
        warn("The Fn key is handled by the keyboard firmware and cannot be remapped.");
        continue;
      }
      if (!kanataKey(b.key)) {
        warn(`Key ${b.key} has no Kanata name and was skipped.`);
        continue;
      }
      if (!src.includes(b.key)) src.push(b.key);
    }

  const textMacro = (text: string, prefix = ""): string[] => {
    const out: string[] = [];
    for (const ch of text) {
      if (/^[a-z0-9]$/.test(ch)) out.push(prefix + ch);
      else if (/^[A-Z]$/.test(ch)) out.push(`${prefix.includes("S-") ? prefix : `S-${prefix}`}${ch.toLowerCase()}`);
      else if (PLAIN[ch]) out.push(prefix + PLAIN[ch]);
      else if (SHIFTED[ch]) out.push(`S-${prefix.replace("S-", "")}${SHIFTED[ch]}`);
      else warn(`Character "${ch}" cannot be typed by a Kanata macro and was skipped.`);
    }
    return out;
  };

  const chord = (keys: string[]): string => {
    const mods = keys.filter(isModifierCode);
    const main = keys.filter((k) => !isModifierCode(k));
    const names = main.map((k) => kanataKey(k));
    if (names.some((n) => !n)) {
      warn(`Chord ${keys.join("+")} contains keys Kanata cannot send.`);
      return "XX";
    }
    if (main.length === 0) {
      const ms = mods.map((m) => kanataKey(m)!);
      return ms.length === 1 ? ms[0] : `(multi ${ms.join(" ")})`;
    }
    const prefix = mods.map((m) => MOD_PREFIX[m]).join("");
    if (main.length === 1) return prefix + names[0];
    return `(multi ${[...mods.map((m) => kanataKey(m)!), ...(names as string[])].join(" ")})`;
  };

  const macro = (steps: MacroStep[]): string => {
    const held: string[] = [];
    const out: string[] = [];
    for (const s of steps) {
      if (s.op === "delay") out.push(String(Math.max(0, Math.round(s.ms))));
      else if (s.op === "text") out.push(...textMacro(s.text, held.map((h) => MOD_PREFIX[h]).join("")));
      else if (isModifierCode(s.key)) {
        if (s.op === "down" && !held.includes(s.key)) held.push(s.key);
        else if (s.op === "up") held.splice(held.indexOf(s.key) >>> 0, 1);
        else if (s.op === "tap") out.push(kanataKey(s.key)!);
      } else {
        if (s.op === "up") continue;
        if (s.op === "down") warn("Macro key-down of a non-modifier key is exported as a tap.");
        const k = kanataKey(s.key);
        if (k) out.push(held.map((h) => MOD_PREFIX[h]).join("") + k);
        else warn(`Macro key ${s.key} has no Kanata name and was skipped.`);
      }
    }
    return out.length ? `(macro ${out.join(" ")})` : "XX";
  };

  const expr = (a: KeyAction): string => {
    switch (a.type) {
      case "key":
        return chord(a.keys);
      case "text": {
        const keys = textMacro(a.text);
        return keys.length ? `(macro ${keys.join(" ")})` : "XX";
      }
      case "macro":
        return macro(a.steps);
      case "launch":
        warn("Launch actions are not exported (Kanata's cmd action requires danger-enable-cmd).");
        return "XX";
      case "layer": {
        const target = layerName.get(a.layer);
        if (!target) {
          warn(`Layer "${a.layer}" does not exist.`);
          return "XX";
        }
        return a.mode === "hold" ? `(layer-while-held ${target})` : `(layer-switch ${target})`;
      }
      case "tapHold": {
        const t = a.termMs ?? 200;
        return `(tap-hold ${t} ${t} ${expr(a.tap)} ${expr(a.hold)})`;
      }
      case "mouse":
        return { left: "mlft", right: "mrgt", middle: "mmid", back: "mbck", forward: "mfwd" }[a.button];
      case "media": {
        const m = { playPause: "pp", next: "next", prev: "prev", volumeUp: "volu", volumeDown: "voldwn", mute: "mute", micMute: "" }[a.command];
        if (!m) warn("Mic mute is a KeyHalo action and is exported as XX.");
        return m || "XX";
      }
      case "dpi":
      case "profile":
        warn(`${a.type === "dpi" ? "DPI" : "Profile"} actions only work inside KeyHalo and are exported as XX.`);
        return "XX";
      case "disabled":
        return "XX";
    }
  };

  // Toggle layers: the key that switched into a layer switches back to base inside it.
  const toggleBack = new Map<string, Set<string>>();
  for (const l of layers)
    for (const b of l.bindings) {
      const acts = b.action.type === "tapHold" ? [b.action.tap, b.action.hold] : [b.action];
      for (const a of acts)
        if (a.type === "layer" && a.mode === "toggle") {
          if (!toggleBack.has(a.layer)) toggleBack.set(a.layer, new Set());
          toggleBack.get(a.layer)!.add(b.key);
        }
    }

  const aliases: [string, string][] = [];
  const aliasFor = (layer: string, key: string, e: string) => {
    if (!e.includes("(")) return e;
    const name = `${layer}-${sanitize(kanataKey(key) ?? key).replace(/^-|-$/g, "") || "k"}`;
    let unique = name;
    let i = 2;
    while (aliases.some(([n]) => n === unique)) unique = `${name}${i++}`;
    aliases.push([unique, e]);
    return `@${unique}`;
  };

  const deflayers: string[] = [];
  for (const l of layers) {
    const lname = layerName.get(l.id)!;
    const cells = src.map((code) => {
      const forKey = l.bindings.filter((b) => b.key === code);
      const plain = forKey.find((b) => !b.with?.length);
      let e = plain ? expr(plain.action) : l.id === "" ? kanataKey(code)! : toggleBack.get(l.id)?.has(code) ? "(layer-switch base)" : "_";
      for (const cond of forKey.filter((b) => b.with?.length)) {
        if (cond.with!.length > 1) warn(`${cond.with!.join("+")}+${code}: Kanata's fork matches any of the modifiers, not all.`);
        warn("Bindings with modifiers are exported with fork; the held modifier stays pressed while the action is sent.");
        const keys = cond.with!.map((m) => FORK_KEYS[m]).join(" ");
        e = `(fork ${e} ${expr(cond.action)} (${keys}))`;
      }
      return aliasFor(lname, code, e);
    });
    deflayers.push(`(deflayer ${lname}\n  ${cells.join(" ") || ""}\n)`);
  }

  if (pack.apps.length) warn(`Kanata has no per-app layers: this config applies globally (pack was for ${pack.apps.join(", ")}).`);
  if (src.length === 0) warn("The pack has no remaps; the exported config does nothing.");

  const header = [
    `;; ${pack.name} — exported from KeyHalo${pack.version ? ` (v${pack.version})` : ""}`,
    pack.description ? `;; ${pack.description}` : null,
    pack.apps.length ? `;; Original apps: ${pack.apps.join(", ")} (Kanata applies it globally)` : null,
    ...warnings.map((w) => `;; NOTE: ${w}`),
    ";; Docs: https://github.com/jtroo/kanata/blob/main/docs/config.adoc",
  ].filter(Boolean);

  const parts = [
    header.join("\n"),
    "(defcfg\n  process-unmapped-keys yes\n)",
    `(defsrc\n  ${src.map((c) => kanataKey(c)).join(" ")}\n)`,
    aliases.length ? `(defalias\n${aliases.map(([n, e]) => `  ${n} ${e}`).join("\n")}\n)` : null,
    ...deflayers,
  ].filter(Boolean);
  return { text: `${parts.join("\n\n")}\n`, warnings };
}
