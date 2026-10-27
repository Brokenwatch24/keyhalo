import type { EffectMeta, RGB } from "@/core/types";
import type { Signals } from "./signals";
import type { StatusKind } from "./color";

/**
 * Effect API — the contract for built-in and community lighting effects.
 * Documented for contributors in docs/EFFECTS.md.
 *
 * Scene space is the virtual desk in keyboard units: every connected device sits at its desk
 * position, so an effect that sweeps along x crosses from the keyboard onto the mouse.
 */

/** One light in the scene: a key (id = KeyboardEvent.code) or a non-key LED (id = LedDef.id). */
export interface SceneKey {
  id: string;
  /** Centre of the key/LED in scene units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into the frame buffer (use with ctx.setAt). */
  index: number;
  kind: "key" | "led";
  /** Connected device uid and its definition id. */
  device: string;
  definition: string;
}

export interface KeyEventInfo {
  id: string;
  x: number;
  y: number;
  /** Seconds, same clock as ctx.t. */
  t: number;
  down: boolean;
}

export interface EffectHelpers {
  /** h in degrees, s/v 0..1 → [r,g,b] 0..255. */
  hsv(h: number, s?: number, v?: number): RGB;
  mix(a: RGB, b: RGB, t: number): RGB;
  /** Smooth noise, roughly -1..1. */
  noise2D(x: number, y: number): number;
  /** "#ff8800" → [255,136,0]. */
  hex(color: string | RGB): RGB;
  clamp(v: number, lo?: number, hi?: number): number;
  lerp(a: number, b: number, t: number): number;
  /** Colour-vision–safe status colour (respects the user's setting). */
  statusColor(kind: StatusKind): RGB;
}

export interface EffectContext extends EffectHelpers {
  /** Seconds since the layer started. */
  t: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Scene size in key units. */
  width: number;
  height: number;
  /** Every key and LED in the scene. */
  keys: SceneKey[];
  /** Keys this layer may draw (its mask / device filter applied). Equals `keys` when unmasked. */
  region: SceneKey[];
  /** True when the layer has a mask (widgets use `region` instead of their default keys). */
  masked: boolean;
  /** Ids of keys held down right now. */
  pressed: ReadonlySet<string>;
  /** Key events of the last 3 seconds, oldest first. */
  events: KeyEventInfo[];
  /** Read-only snapshot of live data (cpu, battery, audio, game…). */
  signals: Readonly<Omit<Signals, "overlays">>;
  /** Resolved parameters (defaults applied). */
  params: Record<string, unknown>;
  /** Colour every light with this id (alpha 0..1, default 1). Unset lights stay transparent. */
  set(id: string, rgb: RGB, alpha?: number): void;
  /** Colour one light by index. */
  setAt(index: number, rgb: RGB, alpha?: number): void;
  /** Colour every light of the region. */
  fill(rgb: RGB, alpha?: number): void;
}

export interface EffectInstance {
  frame(ctx: EffectContext): void;
  onKey?(event: KeyEventInfo): void;
  dispose?(): void;
  /** Sandboxed effects: resolves when the latest requested frame has arrived. */
  flush?(): Promise<void>;
}

export interface EffectModule {
  meta: EffectMeta;
  create(params: Record<string, unknown>): EffectInstance;
}

/** Apply the defaults declared in `meta.params` to user params. */
export function resolveParams(meta: EffectMeta, params: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(meta.params)) out[k] = params[k] !== undefined ? params[k] : def.default;
  for (const [k, v] of Object.entries(params)) if (!(k in out)) out[k] = v;
  return out;
}
