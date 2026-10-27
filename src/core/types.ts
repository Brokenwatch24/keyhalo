/**
 * Shared domain types for KeyHalo.
 *
 * Everything a user can share (devices, profiles, keymap packs, effects, typing packs)
 * is plain JSON described here and validated by the JSON Schemas in /community/schemas.
 * Keys are always identified by their W3C `KeyboardEvent.code` name (e.g. "KeyA",
 * "Digit1", "ShiftLeft") so content is portable across keyboards and layouts.
 */

export type RGB = [number, number, number];
export type KeyCode = string;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export type DeviceType = "keyboard" | "mouse" | "mousepad" | "headset" | "other";
export type DriverId = "razer" | "lamparray" | "openrgb";
export type SupportStatus = "verified" | "community" | "experimental";

export interface HidMatch {
  /** Hex string, e.g. "0x1532" */
  vendorId: string;
  productId: string;
  /** USB interface number used for control transfers (feature reports). */
  interface?: number;
  usagePage?: string;
  usage?: string;
}

/** A physical key (or LED) on a device. Units are "keyboard units" (1u = one alpha key). */
export interface KeyDef {
  code: KeyCode;
  label: string;
  /** Secondary legend printed on the keycap (e.g. Fn-layer function). */
  sublabel?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** LED address for the driver: [row, col] for matrix devices, or a lamp index. */
  led?: [number, number] | number;
  /** Finger used in touch typing (0 = left pinky … 4 = left thumb, 5 = right thumb … 9 = right pinky). */
  finger?: number;
}

/** Non-key lighting zones (mouse logo, scroll wheel, underglow…). */
export interface LedDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Driver-specific LED address (Razer LED id, lamp index…). */
  led: number | [number, number];
}

export interface Layout {
  id: string;
  name: string;
  /** "ansi" | "iso" | "jis" | free text */
  standard: string;
  keys: KeyDef[];
  /** Keys reachable only through the Fn layer, mapped from the base key. */
  fnLayer?: Record<KeyCode, KeyCode>;
}

export interface DpiCapability {
  min: number;
  max: number;
  step: number;
  stages: number;
  independentXY: boolean;
}

export interface DeviceCapabilities {
  perKeyRgb?: boolean;
  zones?: boolean;
  hardwareEffects?: HardwareEffectType[];
  brightness?: boolean;
  onboardMemory?: boolean;
  dpi?: DpiCapability;
  pollingRates?: number[];
  battery?: boolean;
  idleSleep?: { min: number; max: number };
  lowBatteryThreshold?: { min: number; max: number };
}

export interface DeviceDefinition {
  $schema?: string;
  id: string;
  name: string;
  vendor: string;
  type: DeviceType;
  match: HidMatch[];
  driver: DriverId;
  /** Free-form options interpreted by the driver (e.g. Razer transaction id, matrix size). */
  driverOptions?: Record<string, unknown>;
  capabilities: DeviceCapabilities;
  /** Keyboard layouts, keyed by layout id. */
  layouts?: Record<string, Layout>;
  /** Maps a layout id reported by the hardware (e.g. "0x01") to a key of `layouts`. */
  layoutDetection?: Record<string, string>;
  defaultLayout?: string;
  leds?: LedDef[];
  /** Size of the device drawing in keyboard units. */
  size: { w: number; h: number };
  status: SupportStatus;
  testedBy?: string[];
  notes?: string;
  image?: string;
}

/** A device that is connected right now. */
export interface ConnectedDevice {
  /** Stable id: definition id + serial (or HID path hash). */
  uid: string;
  definition: DeviceDefinition;
  layoutId?: string;
  firmware?: string;
  serial?: string;
  /** Where the device sits on the virtual desk used for synced effects (keyboard units). */
  desk: { x: number; y: number };
  /** True if the hardware answered our probe. */
  online: boolean;
  /** Last error message, if a command failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Hardware effects & performance
// ---------------------------------------------------------------------------

export type HardwareEffectType =
  | "off"
  | "static"
  | "breathing"
  | "spectrum"
  | "wave"
  | "reactive"
  | "starlight"
  | "custom";

export interface HardwareEffect {
  type: HardwareEffectType;
  colors?: RGB[];
  /** 1 (slow) … 3 (fast) for wave/reactive/starlight */
  speed?: number;
  direction?: "left" | "right";
}

export interface DpiStage {
  x: number;
  y: number;
}

export interface MouseSettings {
  dpiStages: DpiStage[];
  activeStage: number;
  pollingRate: number;
  idleSleepSeconds?: number;
  lowBatteryThreshold?: number;
  /** Hold-to-slow "sniper" DPI. */
  sniperDpi?: number;
}

export interface DeviceSnapshot {
  /** Captured before KeyHalo writes anything, used by "Restore original". */
  effect?: HardwareEffect;
  brightness?: number;
  mouse?: MouseSettings;
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export type BlendMode = "normal" | "add" | "multiply" | "screen" | "max";

export type EffectParamDef =
  | { type: "number"; label: string; min: number; max: number; step?: number; default: number }
  | { type: "color"; label: string; default: string }
  | { type: "colors"; label: string; default: string[] }
  | { type: "boolean"; label: string; default: boolean }
  | { type: "select"; label: string; options: { value: string; label: string }[]; default: string };

export interface EffectMeta {
  id: string;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  /** "builtin" effects ship with the app; "community" effects run sandboxed in a worker. */
  source: "builtin" | "community";
  /** Reacts to key presses. */
  reactive?: boolean;
  params: Record<string, EffectParamDef>;
}

export interface LightingLayer {
  id: string;
  /** Effect id or widget id (widgets are prefixed "widget:"). */
  effect: string;
  params: Record<string, unknown>;
  blend: BlendMode;
  /** 0..1 */
  opacity: number;
  enabled: boolean;
  /** Restrict the layer to these keys (KeyCodes or LedDef ids). Empty = whole scene. */
  mask?: string[];
  /** Restrict to these device uids / definition ids. Empty = all devices. */
  devices?: string[];
}

export interface LightingScene {
  layers: LightingLayer[];
  /** 0..1 global brightness multiplier. */
  brightness: number;
  /** Frames per second pushed to devices. */
  fps: number;
}

// ---------------------------------------------------------------------------
// Keymaps (per-app remapping, macros, light legends)
// ---------------------------------------------------------------------------

export type ModifierName = "Ctrl" | "Shift" | "Alt" | "Meta";

export type KeyAction =
  | { type: "key"; keys: string[] } // chord, e.g. ["ControlLeft","KeyB"]
  | { type: "text"; text: string }
  | { type: "macro"; steps: MacroStep[] }
  | { type: "launch"; path: string; args?: string[] }
  | { type: "layer"; layer: string; mode: "hold" | "toggle" }
  | { type: "tapHold"; tap: KeyAction; hold: KeyAction; termMs?: number }
  | { type: "mouse"; button: "left" | "right" | "middle" | "back" | "forward" }
  | { type: "dpi"; mode: "sniper" | "cycle" | "set"; value?: number }
  | { type: "profile"; profileId: string }
  | { type: "media"; command: "playPause" | "next" | "prev" | "volumeUp" | "volumeDown" | "mute" | "micMute" }
  | { type: "disabled" };

export type MacroStep =
  | { op: "down"; key: KeyCode }
  | { op: "up"; key: KeyCode }
  | { op: "tap"; key: KeyCode }
  | { op: "delay"; ms: number }
  | { op: "text"; text: string };

export interface KeyBinding {
  /** Trigger key (KeyCode) or mouse button ("Mouse4", "Mouse5"). */
  key: string;
  /** Optional modifiers that must be held for the binding to fire. */
  with?: ModifierName[];
  action: KeyAction;
  /** Human description, shown in the cheat-sheet overlay. */
  label?: string;
  category?: string;
}

/** A light legend: what an app's built-in shortcut does (no remapping involved). */
export interface ShortcutLegend {
  keys: string[];
  label: string;
  category: string;
}

export interface KeymapLayer {
  id: string;
  name: string;
  bindings: KeyBinding[];
}

export interface KeymapPack {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  /** Process names this pack activates for ("Resolve.exe"). Empty = global. */
  apps: string[];
  /** Category → color shown on the keys. */
  categories: Record<string, string>;
  /** Built-in shortcuts of the app, lit by category. */
  legends: ShortcutLegend[];
  /** Base-layer remaps and macros. */
  bindings: KeyBinding[];
  layers?: KeymapLayer[];
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface Profile {
  $schema?: string;
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  tags?: string[];
  /** Device definition ids this profile was designed for (empty = any). */
  devices?: string[];
  lighting: LightingScene;
  /** Mouse settings keyed by device definition id. */
  mouse?: Record<string, MouseSettings>;
  /** Hardware effect saved to onboard memory when "Save to device" is used. */
  onboard?: Record<string, HardwareEffect>;
  /** Keymap pack ids enabled with this profile. */
  keymaps?: string[];
  /** Auto-activate when one of these processes is focused. */
  apps?: string[];
  /** Preview image (data URL or relative path) for the gallery. */
  preview?: string;
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type Trigger =
  | { type: "appFocus"; process: string }
  | { type: "appLaunch"; process: string }
  | { type: "time"; at: string; days?: number[] }
  | { type: "batteryBelow"; percent: number; device?: string }
  | { type: "idle"; minutes: number }
  | { type: "cpuAbove"; percent: number }
  | { type: "gpuTempAbove"; celsius: number }
  | { type: "mqtt"; topic: string; match?: string }
  | { type: "api"; event: string }
  | { type: "game"; game: "cs2" | "dota2" | "lol"; event: string }
  | { type: "hotkey"; accelerator: string };

export type RuleAction =
  | { type: "profile"; profileId: string }
  | { type: "flash"; keys?: string[]; color: string; times?: number }
  | { type: "notify"; text: string; color?: string }
  | { type: "dpi"; value: number }
  | { type: "brightness"; value: number }
  | { type: "mqttPublish"; topic: string; payload: string }
  | { type: "http"; method: string; url: string; body?: string }
  | { type: "pauseRemap"; paused: boolean };

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions: RuleAction[];
  /** Minimum seconds between firings. */
  cooldown?: number;
}

// ---------------------------------------------------------------------------
// Typing trainer
// ---------------------------------------------------------------------------

export interface TypingPack {
  $schema?: string;
  id: string;
  name: string;
  language: string;
  kind: "words" | "quotes" | "code" | "lessons";
  author?: string;
  description?: string;
  /** For "words": a frequency-ordered word list. */
  words?: string[];
  /** For "quotes"/"code"/"lessons": passages. */
  texts?: { text: string; source?: string }[];
}

export interface TypingResult {
  id: string;
  date: string;
  mode: string;
  language: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  chars: number;
  errors: number;
  /** Per-key stats for the heatmap. */
  keys: Record<KeyCode, { hits: number; misses: number; avgMs: number }>;
  /** Keystroke timeline for ghost races: [ms offset, correct?]. */
  replay?: [number, boolean][];
  text?: string;
}

// ---------------------------------------------------------------------------
// Settings & stats
// ---------------------------------------------------------------------------

export type ThemeMode = "system" | "light" | "dark";
export type ColorVision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

export interface Settings {
  language: "en" | "es";
  theme: ThemeMode;
  colorVision: ColorVision;
  /** Limits flashing to under 3 Hz and smooths strobe-like effects. */
  reduceFlashing: boolean;
  /** Never write to hardware (read-only diagnostics). */
  safeMode: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  checkUpdates: boolean;
  remapEnabled: boolean;
  /** Pause remapping/macros while these processes are focused (anti-cheat safety). */
  remapPauseApps: string[];
  inputStats: boolean;
  api: { enabled: boolean; port: number; token: string };
  github: { token?: string; user?: string; clientId?: string };
  activeProfileId?: string;
  autoSwitchProfiles: boolean;
  hud: { enabled: boolean; position: "top" | "bottom"; durationMs: number };
}

export interface InputStats {
  day: string;
  keys: number;
  clicks: number;
  /** Mouse travel in metres (estimated from pointer movement and DPI). */
  mouseMeters: number;
  perKey: Record<KeyCode, number>;
  peakWpm: number;
}

// ---------------------------------------------------------------------------
// Community catalog
// ---------------------------------------------------------------------------

export type CatalogKind = "device" | "profile" | "keymap" | "effect" | "typing";

export interface CatalogEntry {
  kind: CatalogKind;
  id: string;
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  /** Path inside the repository, e.g. "community/profiles/r6-ranked.json". */
  path: string;
  preview?: string;
  devices?: string[];
  apps?: string[];
  updated?: string;
  status?: SupportStatus;
}

export interface CatalogIndex {
  generated: string;
  repo: string;
  entries: CatalogEntry[];
}
