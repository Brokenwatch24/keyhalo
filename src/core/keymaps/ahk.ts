import type { KeyAction, KeyBinding, KeymapPack, ModifierName } from "@/core/types";
import { isModifierCode } from "./codes";

/**
 * Export a keymap pack as an AutoHotkey v2 script (bonus exporter).
 *
 * App packs are wrapped in `#HotIf WinActive("ahk_exe …")`; layers use a global `khLayer`
 * variable (hold = while held, toggle = flip); tap-hold uses `KeyWait` with the tapping term.
 * KeyHalo-only actions (dpi, profile, mic mute) are exported as comments.
 */

const AHK_NAMES: Record<string, string> = {
  Escape: "Esc", Tab: "Tab", CapsLock: "CapsLock", Space: "Space", Enter: "Enter", Backspace: "Backspace", Delete: "Delete",
  Insert: "Insert", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn", ArrowUp: "Up", ArrowDown: "Down",
  ArrowLeft: "Left", ArrowRight: "Right", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: "`;", Quote: "'", Backquote: "``", Comma: ",", Period: ".", Slash: "/", PrintScreen: "PrintScreen",
  ScrollLock: "ScrollLock", Pause: "Pause", ContextMenu: "AppsKey", NumLock: "NumLock", NumpadAdd: "NumpadAdd",
  NumpadSubtract: "NumpadSub", NumpadMultiply: "NumpadMult", NumpadDivide: "NumpadDiv", NumpadDecimal: "NumpadDot",
  NumpadEnter: "NumpadEnter", ControlLeft: "LCtrl", ControlRight: "RCtrl", ShiftLeft: "LShift", ShiftRight: "RShift",
  AltLeft: "LAlt", AltRight: "RAlt", MetaLeft: "LWin", MetaRight: "RWin", MediaPlayPause: "Media_Play_Pause",
  MediaTrackNext: "Media_Next", MediaTrackPrevious: "Media_Prev", MediaStop: "Media_Stop", AudioVolumeUp: "Volume_Up",
  AudioVolumeDown: "Volume_Down", AudioVolumeMute: "Volume_Mute", Mouse4: "XButton1", Mouse5: "XButton2",
  Mouse1: "LButton", Mouse2: "RButton", Mouse3: "MButton",
};

export function ahkKey(code: string): string | null {
  if (AHK_NAMES[code]) return AHK_NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Numpad${m[1]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return null;
}

const HOTKEY_MOD: Record<ModifierName, string> = { Ctrl: "^", Shift: "+", Alt: "!", Meta: "#" };
const SEND_MOD: Record<string, string> = { ControlLeft: "^", ControlRight: "^", ShiftLeft: "+", ShiftRight: "+", AltLeft: "!", AltRight: "!", MetaLeft: "#", MetaRight: "#" };

const q = (s: string) => `"${s.replace(/`/g, "``").replace(/"/g, '`"')}"`;
const sendKey = (code: string) => `{${(ahkKey(code) ?? code).replace(/^`/, "")}}`;

function body(a: KeyAction, trigger: string, warn: (w: string) => void): string[] {
  switch (a.type) {
    case "key": {
      const mods = a.keys.filter(isModifierCode).map((k) => SEND_MOD[k]).join("");
      const main = a.keys.filter((k) => !isModifierCode(k));
      if (!main.length) return [`Send ${q(a.keys.map((k) => sendKey(k)).join(""))}`];
      return [`Send ${q(mods + main.map(sendKey).join(""))}`];
    }
    case "text":
      return [`SendText ${q(a.text)}`];
    case "macro":
      return a.steps.map((s) => {
        if (s.op === "delay") return `Sleep ${Math.round(s.ms)}`;
        if (s.op === "text") return `SendText ${q(s.text)}`;
        const k = (ahkKey(s.key) ?? s.key).replace(/^`/, "");
        return s.op === "tap" ? `Send ${q(`{${k}}`)}` : `Send ${q(`{${k} ${s.op}}`)}`;
      });
    case "launch":
      return [`Run ${q([a.path, ...(a.args ?? [])].map((p) => (p.includes(" ") ? `"${p}"` : p)).join(" "))}`];
    case "layer":
      return a.mode === "toggle"
        ? [`global khLayer`, `khLayer := (khLayer = ${q(a.layer)}) ? "" : ${q(a.layer)}`]
        : [`global khLayer`, `khLayer := ${q(a.layer)}`, `KeyWait ${q(trigger)}`, `khLayer := ""`];
    case "tapHold": {
      const secs = ((a.termMs ?? 200) / 1000).toFixed(2);
      return [
        `if KeyWait(${q(trigger)}, "T${secs}") {`,
        ...body(a.tap, trigger, warn).map((l) => `    ${l}`),
        `} else {`,
        ...body(a.hold, trigger, warn).map((l) => `    ${l}`),
        `}`,
      ];
    }
    case "mouse":
      return [`Click ${q({ left: "Left", right: "Right", middle: "Middle", back: "X1", forward: "X2" }[a.button])}`];
    case "media": {
      const m = { playPause: "Media_Play_Pause", next: "Media_Next", prev: "Media_Prev", volumeUp: "Volume_Up", volumeDown: "Volume_Down", mute: "Volume_Mute", micMute: "" }[a.command];
      if (!m) {
        warn("Mic mute is a KeyHalo action and was not exported.");
        return ["; mic mute: KeyHalo-only action"];
      }
      return [`Send ${q(`{${m}}`)}`];
    }
    case "dpi":
    case "profile":
      warn(`${a.type} actions only work inside KeyHalo.`);
      return [`; ${a.type}: KeyHalo-only action`];
    case "disabled":
      return ["return"];
  }
}

export function exportAutoHotkey(pack: KeymapPack): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (w: string) => warnings.includes(w) || warnings.push(w);
  const lines: string[] = [
    "#Requires AutoHotkey v2.0",
    "#SingleInstance Force",
    `; ${pack.name} — exported from KeyHalo`,
    "; Review every Run/Send line before running this script.",
    'global khLayer := ""',
    "",
  ];
  let appCond = "";
  if (pack.apps.length) {
    pack.apps.forEach((a) => lines.push(`GroupAdd "khApps", ${q(`ahk_exe ${a}`)}`));
    lines.push("");
    appCond = `WinActive("ahk_group khApps")`;
  }
  const emit = (bindings: KeyBinding[], layer: string) => {
    const conds = [appCond, layer ? `khLayer = ${q(layer)}` : ""].filter(Boolean);
    lines.push(conds.length ? `#HotIf ${conds.join(" && ")}` : "#HotIf");
    for (const b of bindings) {
      const k = ahkKey(b.key);
      if (!k) {
        warn(`Key ${b.key} has no AutoHotkey name and was skipped.`);
        continue;
      }
      const hk = (b.with ?? []).map((m) => HOTKEY_MOD[m]).join("") + k;
      const trigger = k.replace(/^`/, "");
      if (b.label) lines.push(`; ${b.label}`);
      lines.push(`*${hk}:: {`, ...body(b.action, trigger, warn).map((l) => `    ${l}`), "}");
    }
    lines.push("");
  };
  emit(pack.bindings, "");
  for (const l of pack.layers ?? []) emit(l.bindings, l.id);
  lines.push("#HotIf");
  return { text: lines.join("\n") + "\n", warnings };
}
