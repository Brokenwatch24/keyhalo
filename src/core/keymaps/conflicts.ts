import type { KeyAction, KeyBinding, KeymapPack, Layout } from "@/core/types";
import { comboFromBinding, comboFromKeys, comboId, comboLabel, isValidTrigger, keyLabel, type Combo } from "./codes";

export type ConflictKind =
  | "appShortcut" // binding overrides one of the app's own shortcuts (legend)
  | "duplicate" // two bindings with the same trigger in the same layer
  | "osReserved" // Windows reserves the combo (cannot or should not be remapped)
  | "missingKey" // the trigger key does not exist on the current keyboard
  | "fnOnly" // the trigger key only exists behind Fn on the current keyboard
  | "invalidKey" // not a KeyboardEvent.code name
  | "unknownLayer"; // a layer action points to a layer the pack does not define

export interface Conflict {
  kind: ConflictKind;
  severity: "error" | "warning" | "info";
  /** Layer id ("" = base layer). */
  layer: string;
  binding: KeyBinding;
  /** Display label of the trigger, e.g. "Ctrl+Shift+P". */
  combo: string;
  /** i18n key: `keymaps.conflicts.<kind>` (params below). */
  messageKey: string;
  params: Record<string, string>;
  /** English fallback message. */
  message: string;
  /** i18n key of a suggestion, if any (`keymaps.suggestions.*`). */
  suggestionKey?: string;
}

/** Windows combos that are reserved by the OS. `error` = cannot be intercepted at all. */
export const OS_RESERVED: { keys: string[]; label: string; severity: "error" | "warning" }[] = [
  { keys: ["ControlLeft", "AltLeft", "Delete"], label: "Security options", severity: "error" },
  { keys: ["MetaLeft", "KeyL"], label: "Lock PC", severity: "error" },
  { keys: ["ControlLeft", "ShiftLeft", "Escape"], label: "Task Manager", severity: "warning" },
  { keys: ["AltLeft", "Tab"], label: "Switch windows", severity: "warning" },
  { keys: ["AltLeft", "ShiftLeft", "Tab"], label: "Switch windows (back)", severity: "warning" },
  { keys: ["AltLeft", "Escape"], label: "Cycle windows", severity: "warning" },
  { keys: ["AltLeft", "F4"], label: "Close window", severity: "warning" },
  { keys: ["ControlLeft", "Escape"], label: "Start menu", severity: "warning" },
  { keys: ["MetaLeft", "KeyD"], label: "Show desktop", severity: "warning" },
  { keys: ["MetaLeft", "Tab"], label: "Task view", severity: "warning" },
  { keys: ["MetaLeft", "KeyE"], label: "File Explorer", severity: "warning" },
  { keys: ["MetaLeft", "KeyR"], label: "Run", severity: "warning" },
  { keys: ["MetaLeft", "KeyX"], label: "Quick Link menu", severity: "warning" },
  { keys: ["MetaLeft", "KeyI"], label: "Settings", severity: "warning" },
  { keys: ["MetaLeft", "KeyG"], label: "Game Bar", severity: "warning" },
  { keys: ["MetaLeft", "KeyV"], label: "Clipboard history", severity: "warning" },
  { keys: ["MetaLeft", "ShiftLeft", "KeyS"], label: "Snipping Tool", severity: "warning" },
  { keys: ["MetaLeft", "Period"], label: "Emoji panel", severity: "warning" },
  { keys: ["MetaLeft", "KeyA"], label: "Quick settings", severity: "warning" },
  { keys: ["MetaLeft", "KeyN"], label: "Notifications", severity: "warning" },
  { keys: ["MetaLeft", "KeyS"], label: "Search", severity: "warning" },
  { keys: ["MetaLeft", "KeyM"], label: "Minimise all", severity: "warning" },
  { keys: ["MetaLeft", "AltLeft", "KeyR"], label: "Game Bar recording", severity: "warning" },
];

const RESERVED = new Map(OS_RESERVED.map((r) => [comboId(comboFromKeys(r.keys)!), r]));

const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "PrintScreen", "ScrollLock", "Pause"]);

export interface ConflictOptions {
  /** Layout of the current keyboard (from `layoutOf(primaryKeyboard(...))`). */
  layout?: Layout;
  /** Name of the keyboard, used in messages. */
  keyboardName?: string;
}

function collectLayerRefs(a: KeyAction, out: string[]) {
  if (a.type === "layer") out.push(a.layer);
  if (a.type === "tapHold") {
    collectLayerRefs(a.tap, out);
    collectLayerRefs(a.hold, out);
  }
}

/**
 * Find problems in a keymap pack: overridden app shortcuts, duplicates, OS-reserved combos,
 * keys missing on the current keyboard (e.g. F-row/arrows on 60% boards) and broken layer refs.
 */
export function findConflicts(pack: KeymapPack, opts: ConflictOptions = {}): Conflict[] {
  const out: Conflict[] = [];
  const legends = new Map<string, string>();
  for (const l of pack.legends) {
    const c = comboFromKeys(l.keys);
    if (c) legends.set(comboId(c), l.label);
  }
  const layerIds = new Set((pack.layers ?? []).map((l) => l.id));
  const layoutCodes = opts.layout ? new Set(opts.layout.keys.map((k) => k.code)) : null;
  const fnTargets = new Map<string, string>();
  for (const [base, target] of Object.entries(opts.layout?.fnLayer ?? {})) fnTargets.set(target, base);
  const kb = opts.keyboardName ?? opts.layout?.name ?? "this keyboard";

  const push = (
    kind: ConflictKind,
    severity: Conflict["severity"],
    layer: string,
    binding: KeyBinding,
    combo: Combo,
    message: string,
    params: Record<string, string> = {},
    suggestionKey?: string,
  ) => {
    out.push({ kind, severity, layer, binding, combo: comboLabel(combo), messageKey: `keymaps.conflicts.${kind}`, params: { combo: comboLabel(combo), ...params }, message, suggestionKey });
  };

  const groups: { layer: string; bindings: KeyBinding[] }[] = [
    { layer: "", bindings: pack.bindings },
    ...(pack.layers ?? []).map((l) => ({ layer: l.id, bindings: l.bindings })),
  ];

  for (const { layer, bindings } of groups) {
    const seen = new Map<string, KeyBinding>();
    for (const b of bindings) {
      const combo = comboFromBinding(b);
      const id = comboId(combo);
      const label = comboLabel(combo);

      if (!isValidTrigger(b.key)) {
        push("invalidKey", "error", layer, b, combo, `"${b.key}" is not a valid key code.`, { key: b.key });
        continue;
      }
      if (seen.has(id)) {
        push("duplicate", "error", layer, b, combo, `${label} is bound more than once${layer ? ` in layer "${layer}"` : ""}.`, { layer });
      } else seen.set(id, b);

      // Layer bindings only fire while the layer is active, so they never shadow app shortcuts.
      if (!layer && legends.has(id) && b.action.type !== "disabled") {
        push("appShortcut", "warning", layer, b, combo, `${label} replaces the app's own shortcut "${legends.get(id)}".`, { shortcut: legends.get(id)! });
      }
      if (!layer) {
        const reserved = RESERVED.get(id);
        if (reserved) push("osReserved", reserved.severity, layer, b, combo, `${label} is reserved by Windows (${reserved.label})${reserved.severity === "error" ? " and cannot be remapped" : ""}.`, { what: reserved.label });
      }
      const refs: string[] = [];
      collectLayerRefs(b.action, refs);
      for (const r of refs) {
        if (!layerIds.has(r)) push("unknownLayer", "error", layer, b, combo, `Layer "${r}" does not exist in this pack.`, { layer: r });
      }
      if (layoutCodes && !b.key.startsWith("Mouse") && b.key !== "Fn" && !layoutCodes.has(b.key)) {
        const base = fnTargets.get(b.key);
        if (base) {
          push("fnOnly", "info", layer, b, combo, `${keyLabel(b.key)} is only reachable with Fn+${keyLabel(base)} on ${kb}.`, { base: keyLabel(base), keyboard: kb });
        } else {
          const fnRow = /^F\d+$/.test(b.key);
          const suggestion = fnRow || NAV_KEYS.has(b.key) ? "keymaps.suggestions.useLayer" : undefined;
          push("missingKey", "warning", layer, b, combo, `${keyLabel(b.key)} does not exist on ${kb}.${suggestion ? " Bind it on a layer (e.g. hold CapsLock) or the Fn layer instead." : ""}`, { key: keyLabel(b.key), keyboard: kb }, suggestion);
        }
      }
    }
  }
  return out;
}

/** True when the layout looks like a 60% board (no F-row and no arrow keys). */
export function isCompactLayout(layout: Layout): boolean {
  const codes = new Set(layout.keys.map((k) => k.code));
  return !codes.has("F1") && !codes.has("ArrowUp");
}
