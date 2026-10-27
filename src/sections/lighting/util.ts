import { useMemo } from "react";
import { create } from "zustand";
import type { CSSProperties } from "react";
import type { ConnectedDevice, DeviceDefinition, EffectMeta, Layout, LightingLayer } from "@/core/types";
import { useDevices, layoutOf, getTemplate } from "@/core/devices";
import { VIRTUAL_KEYBOARD, VIRTUAL_MOUSE } from "@/core/lighting";
import { useT } from "@/i18n";

// ---------------------------------------------------------------------------
// Studio state (page-local): selected layer, key selection, effect picker
// ---------------------------------------------------------------------------

export type PickerState = { mode: "add" } | { mode: "replace"; layerId: string } | null;

interface StudioState {
  selectedLayer: string | null;
  keys: Set<string>;
  picker: PickerState;
  selectLayer(id: string | null): void;
  setKeys(keys: Iterable<string>): void;
  openPicker(p: PickerState): void;
}

export const useStudio = create<StudioState>((set) => ({
  selectedLayer: null,
  keys: new Set(),
  picker: null,
  selectLayer: (id) => set({ selectedLayer: id }),
  setKeys: (keys) => set({ keys: new Set(keys) }),
  openPicker: (picker) => set({ picker }),
}));

// ---------------------------------------------------------------------------
// i18n helpers (effect metadata ships in English; Spanish lives in lighting.json)
// ---------------------------------------------------------------------------

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Translate `key`, falling back to `fallback` when the dictionary has no entry. */
export function tx(t: TFn, key: string, fallback: string, vars?: Record<string, string | number>) {
  const s = t(key, vars);
  return s === key ? fallback : s;
}

/** "{n} keys" / "1 key": uses `<key>_one` when n is 1 and the dictionary has it. */
export function plural(t: TFn, key: string, n: number) {
  return n === 1 ? tx(t, `${key}_one`, t(key, { n }), { n }) : t(key, { n });
}

const fxKey = (id: string) => id.replace(/[.:]/g, "_");

export function useFx() {
  const t = useT();
  return useMemo(
    () => ({
      t,
      name: (meta: EffectMeta | undefined, id?: string) => (meta ? tx(t, `lighting.fx.${fxKey(meta.id)}.name`, meta.name) : (id ?? "?")),
      desc: (meta: EffectMeta | undefined) => (meta?.description ? tx(t, `lighting.fx.${fxKey(meta.id)}.description`, meta.description) : ""),
      /** Param / option labels are translated by their English text. */
      label: (text: string) => (/^[^.]{1,48}$/.test(text) ? tx(t, `lighting.labels.${text}`, text) : text),
    }),
    [t],
  );
}

// ---------------------------------------------------------------------------
// Effect categories
// ---------------------------------------------------------------------------

export const CATEGORIES = ["basic", "ambient", "reactive", "audio", "widget", "community"] as const;
export type Category = (typeof CATEGORIES)[number];

export function categoryOf(meta: EffectMeta | undefined): Category {
  if (!meta) return "ambient";
  if (meta.source === "community") return "community";
  const tags = meta.tags ?? [];
  if (meta.id.startsWith("widget:") || tags.includes("widget")) return "widget";
  if (tags.includes("audio")) return "audio";
  if (meta.reactive || tags.includes("reactive")) return "reactive";
  if (tags.includes("basic")) return "basic";
  return "ambient";
}

/** Data a widget reads, and where the user configures it. */
export const WIDGET_SOURCES: Record<string, { signal: string; where: "integrations" | "devices" | "typing" | "keymaps" | "none" }> = {
  "widget:cpu": { signal: "cpu", where: "integrations" },
  "widget:gpu-temp": { signal: "gpu", where: "integrations" },
  "widget:ram": { signal: "ram", where: "integrations" },
  "widget:bambu": { signal: "bambu", where: "integrations" },
  "widget:claude": { signal: "claude", where: "integrations" },
  "widget:pomodoro": { signal: "pomodoro", where: "integrations" },
  "widget:game-health": { signal: "game", where: "integrations" },
  "widget:game-ammo": { signal: "game", where: "integrations" },
  "widget:notification": { signal: "notifications", where: "integrations" },
  "widget:mic": { signal: "mic", where: "integrations" },
  "widget:wpm": { signal: "wpm", where: "typing" },
  "widget:battery": { signal: "battery", where: "devices" },
  "widget:caps": { signal: "caps", where: "none" },
  "widget:layer": { signal: "layer", where: "keymaps" },
};

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

const RAINBOW = "conic-gradient(from 90deg, #ff004c, #ffb000, #c6ff00, #00ff9c, #00b3ff, #7b5cff, #ff2bd6, #ff004c)";
const FALLBACK_SWATCH: Record<string, string> = {
  spectrum: RAINBOW,
  plasma: "linear-gradient(135deg, #ff2bd6, #7b5cff 45%, #00e5ff)",
  fire: "linear-gradient(0deg, #ff2a00, #ff8a00 60%, #ffd000)",
  off: "#000",
  "audio-visualizer": "linear-gradient(90deg, #00e5ff, #7b5cff, #ff2bd6)",
  "widget:battery": "linear-gradient(90deg, #2bd67b 60%, #3a3a40 60%)",
  "widget:mic": "#ff3b30",
  "widget:claude": "#7b5cff",
  "widget:layer": "conic-gradient(#7b5cff, #00b3ff, #2bd67b, #7b5cff)",
  "widget:cpu": "linear-gradient(90deg, #2bd67b, #ffb000, #ff3b30)",
  "widget:ram": "linear-gradient(90deg, #2bd67b, #ffb000, #ff3b30)",
  "widget:gpu-temp": "linear-gradient(90deg, #00b3ff, #ffb000, #ff3b30)",
  "widget:game-health": "linear-gradient(90deg, #ff3b30, #ffb000, #2bd67b)",
};

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);

/** A small CSS background that summarises a layer's colours. */
export function layerSwatch(layer: LightingLayer, meta: EffectMeta | undefined): CSSProperties["background"] {
  const p: Record<string, unknown> = { ...defaults(meta), ...layer.params };
  if (p.rainbow === true) return RAINBOW;
  const colors = Object.entries(meta?.params ?? {})
    .filter(([k, d]) => d.type === "colors" && Array.isArray(p[k]) && k !== "background")
    .flatMap(([k]) => (p[k] as unknown[]).filter(isHex));
  if (colors.length > 1) return `linear-gradient(135deg, ${colors.join(", ")})`;
  if (colors.length === 1) return colors[0];
  const single = Object.entries(meta?.params ?? {}).find(([k, d]) => d.type === "color" && k !== "background" && isHex(p[k]));
  if (single) return p[single[0]] as string;
  if (FALLBACK_SWATCH[layer.effect]) return FALLBACK_SWATCH[layer.effect];
  if (meta?.source === "community" || layer.effect.startsWith("widget:")) return "linear-gradient(135deg, #52525b, #1c1c21)";
  return RAINBOW;
}

function defaults(meta: EffectMeta | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(meta?.params ?? {})) out[k] = d.default;
  return out;
}

// ---------------------------------------------------------------------------
// Desk: the devices drawn on the stage (connected, or the virtual preview desk)
// ---------------------------------------------------------------------------

export interface DeskDevice {
  uid: string;
  definition: DeviceDefinition;
  layout?: Layout;
  desk: { x: number; y: number };
  type: "keyboard" | "mouse" | "other";
  virtual: boolean;
}

let virtualKeyboardDef: DeviceDefinition | null = null;
export function virtualKeyboardDefinition(): DeviceDefinition {
  if (virtualKeyboardDef) return virtualKeyboardDef;
  const tpl = getTemplate("ansi-60");
  virtualKeyboardDef = {
    id: VIRTUAL_KEYBOARD,
    name: "Preview keyboard",
    vendor: "KeyHalo",
    type: "keyboard",
    match: [],
    driver: "razer",
    capabilities: { perKeyRgb: true },
    layouts: { [tpl.layout.id]: tpl.layout },
    defaultLayout: tpl.layout.id,
    size: tpl.size,
    status: "experimental",
  };
  return virtualKeyboardDef;
}

function typeOf(d: DeviceDefinition): DeskDevice["type"] {
  return d.type === "keyboard" ? "keyboard" : d.type === "mouse" ? "mouse" : "other";
}

/** Devices on the stage. Mirrors the engine: virtual 60 % board + mouse when nothing is connected. */
export function useDesk(): DeskDevice[] {
  const devices = useDevices((s) => s.devices);
  const definitions = useDevices((s) => s.definitions);
  return useMemo(() => {
    if (devices.length) {
      return devices.map((d: ConnectedDevice) => ({
        uid: d.uid,
        definition: d.definition,
        layout: layoutOf(d),
        desk: d.desk,
        type: typeOf(d.definition),
        virtual: false,
      }));
    }
    const kb = virtualKeyboardDefinition();
    const out: DeskDevice[] = [
      { uid: VIRTUAL_KEYBOARD, definition: kb, layout: Object.values(kb.layouts!)[0], desk: { x: 0, y: 0 }, type: "keyboard", virtual: true },
    ];
    const mouse = definitions.find((d) => d.type === "mouse" && d.status === "verified");
    if (mouse) out.push({ uid: VIRTUAL_MOUSE, definition: mouse, desk: { x: kb.size.w + 1.5, y: (kb.size.h - mouse.size.h) / 2 }, type: "mouse", virtual: true });
    return out;
  }, [devices, definitions]);
}

// ---------------------------------------------------------------------------
// Quick key selections
// ---------------------------------------------------------------------------

export const QUICK_SELECTIONS = ["all", "letters", "numbers", "wasd", "modifiers", "arrows"] as const;
export type QuickSelection = (typeof QUICK_SELECTIONS)[number];

const MODIFIER = /^(Shift|Control|Alt|Meta)(Left|Right)$|^(Fn|CapsLock|Tab|ContextMenu|Escape)$/;

export function quickSelection(kind: QuickSelection, desk: DeskDevice[]): string[] {
  const out = new Set<string>();
  for (const d of desk) {
    const keys = d.layout?.keys ?? [];
    const fn = d.layout?.fnLayer ?? {};
    for (const k of keys) {
      const c = k.code;
      if (
        (kind === "all") ||
        (kind === "letters" && /^Key[A-Z]$/.test(c)) ||
        (kind === "numbers" && /^Digit\d$/.test(c)) ||
        (kind === "wasd" && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(c)) ||
        (kind === "modifiers" && MODIFIER.test(c)) ||
        (kind === "arrows" && (c.startsWith("Arrow") || c === "Fn" || (fn[c] ?? "").startsWith("Arrow")))
      )
        out.add(c);
    }
    if (kind === "all") for (const l of d.definition.leds ?? []) out.add(l.id);
  }
  return [...out];
}

/** Read `?name=` from the search or the hash query (dev/screenshot switches). */
export function queryFlag(name: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch !== null) return fromSearch;
  const q = window.location.hash.split("?")[1];
  return q ? new URLSearchParams(q).get(name) : null;
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
