import type { LightingLayer, LightingScene, RGB } from "@/core/types";
import { resolveParams, type EffectContext, type EffectHelpers, type EffectInstance, type KeyEventInfo, type SceneKey } from "./api";
import { blendChannel, clamp, hex, hsv, lerp, mix, statusColor } from "./color";
import { effectRegistry } from "./effects/registry";
import { noise2D } from "./noise";
import type { Signals } from "./signals";

/**
 * Scene compositor: evaluates layers bottom → top with blend modes, opacity, masks and device
 * filters, then overlays, global brightness and optional anti-flash smoothing.
 * Pure (no timers, no I/O): the engine drives it, tests and previews instantiate their own.
 */

export interface Overlay {
  priority: number;
  /** Colours by key code / LED id. */
  colors: Record<string, RGB>;
  /** Hide everything below that the overlay does not colour. */
  exclusive?: boolean;
  /** 0..1, default 1. */
  alpha?: number;
}

export interface RenderOptions {
  overlays?: Overlay[];
  /** Low-pass luminance changes so nothing flashes faster than ~3 Hz. */
  reduceFlashing?: boolean;
}

interface LayerState {
  layer: LightingLayer;
  key: string;
  inst: EffectInstance | null;
  params: Record<string, unknown>;
  region: SceneKey[];
  inRegion: Uint8Array;
  masked: boolean;
  rgb: Float32Array;
  alpha: Float32Array;
  errors: number;
  disabled?: string;
}

export const HELPERS: EffectHelpers = { hsv, mix, noise2D, hex, clamp, lerp, statusColor };

const EVENT_WINDOW_S = 3;
/** Anti-flash time constant: attenuates luminance changes above ~1–3 Hz. */
const SMOOTH_TAU_S = 0.12;

export class Compositor {
  keys: SceneKey[] = [];
  width = 0;
  height = 0;
  scene: LightingScene = { layers: [], brightness: 1, fps: 30 };
  readonly pressed = new Set<string>();
  private events: KeyEventInfo[] = [];
  private byId = new Map<string, number[]>();
  private states: LayerState[] = [];
  private prev: Float32Array | null = null;

  constructor(
    private opts: {
      /** Called when a layer is disabled after repeated errors (or its sandbox shut it down). */
      onLayerError?: (layerId: string, message: string) => void;
      /** Override effect creation (tests). */
      createEffect?: (layer: LightingLayer, params: Record<string, unknown>, onDisable: (r: string) => void) => EffectInstance | null;
    } = {},
  ) {}

  setGeometry(keys: SceneKey[], width: number, height: number) {
    this.keys = keys;
    this.width = width;
    this.height = height;
    this.byId.clear();
    for (const k of keys) {
      const l = this.byId.get(k.id);
      if (l) l.push(k.index);
      else this.byId.set(k.id, [k.index]);
    }
    this.prev = null;
    // Instances keep their state; only regions/buffers are rebuilt.
    for (const s of this.states) this.prepareRegion(s);
  }

  setScene(scene: LightingScene) {
    this.scene = scene;
    const next: LayerState[] = [];
    const old = new Map(this.states.map((s) => [s.layer.id, s]));
    for (const layer of scene.layers) {
      const key = `${layer.effect}|${JSON.stringify(layer.params ?? {})}`;
      const prev = old.get(layer.id);
      if (prev && prev.key === key) {
        old.delete(layer.id);
        prev.layer = layer;
        this.prepareRegion(prev);
        next.push(prev);
        continue;
      }
      const s: LayerState = {
        layer,
        key,
        inst: null,
        params: {},
        region: [],
        inRegion: new Uint8Array(0),
        masked: false,
        rgb: new Float32Array(0),
        alpha: new Float32Array(0),
        errors: 0,
      };
      this.instantiate(s);
      this.prepareRegion(s);
      next.push(s);
    }
    for (const s of old.values()) s.inst?.dispose?.();
    this.states = next;
  }

  private instantiate(s: LayerState) {
    const reg = effectRegistry.get(s.layer.effect);
    if (!reg && !this.opts.createEffect) {
      s.disabled = `Unknown effect "${s.layer.effect}"`;
      return;
    }
    s.params = reg ? resolveParams(reg.meta, s.layer.params) : { ...s.layer.params };
    const onDisable = (reason: string) => {
      s.disabled = reason;
      s.inst = null;
      this.opts.onLayerError?.(s.layer.id, reason);
    };
    try {
      s.inst = this.opts.createEffect ? this.opts.createEffect(s.layer, s.params, onDisable) : reg!.create(s.params, onDisable);
    } catch (e) {
      s.disabled = e instanceof Error ? e.message : String(e);
      this.opts.onLayerError?.(s.layer.id, s.disabled);
    }
  }

  private prepareRegion(s: LayerState) {
    const mask = s.layer.mask?.length ? new Set(s.layer.mask) : null;
    const devs = s.layer.devices?.length ? new Set(s.layer.devices) : null;
    s.masked = !!mask;
    s.region = mask || devs ? this.keys.filter((k) => (!mask || mask.has(k.id)) && (!devs || devs.has(k.device) || devs.has(k.definition))) : this.keys;
    s.inRegion = new Uint8Array(this.keys.length);
    for (const k of s.region) s.inRegion[k.index] = 1;
    s.rgb = new Float32Array(this.keys.length * 3);
    s.alpha = new Float32Array(this.keys.length);
  }

  /** Feed a key press/release (engine clock seconds). */
  keyEvent(id: string, down: boolean, t: number) {
    if (down) this.pressed.add(id);
    else this.pressed.delete(id);
    const k = this.byId.get(id);
    const key = k ? this.keys[k[0]] : undefined;
    const ev: KeyEventInfo = { id, x: key?.x ?? -10, y: key?.y ?? -10, t, down };
    this.events.push(ev);
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
    for (const s of this.states) {
      if (!s.inst?.onKey || s.disabled || !s.layer.enabled) continue;
      try {
        s.inst.onKey(ev);
      } catch {
        /* counted on frame errors */
      }
    }
  }

  /** Wait for sandboxed layers to deliver their latest frame (previews). */
  async flush() {
    await Promise.all(this.states.map((s) => s.inst?.flush?.()));
  }

  /** Render one frame. Returns RGB floats (0..255), 3 per scene key. */
  render(t: number, dt: number, signals: Readonly<Omit<Signals, "overlays">>, opts: RenderOptions = {}): Float32Array {
    const n = this.keys.length;
    const out = new Float32Array(n * 3);
    const cutoff = t - EVENT_WINDOW_S;
    if (this.events.length && this.events[0].t < cutoff) this.events = this.events.filter((e) => e.t >= cutoff);

    for (const s of this.states) {
      if (!s.layer.enabled || s.disabled || !s.inst || s.layer.opacity <= 0) continue;
      s.rgb.fill(0);
      s.alpha.fill(0);
      const ctx = this.context(s, t, dt, signals);
      try {
        s.inst.frame(ctx);
        s.errors = Math.max(0, s.errors - 1);
      } catch (e) {
        if (++s.errors >= 10) {
          s.disabled = e instanceof Error ? e.message : String(e);
          s.inst.dispose?.();
          s.inst = null;
          this.opts.onLayerError?.(s.layer.id, s.disabled);
        }
        continue;
      }
      const mode = s.layer.blend;
      const op = clamp(s.layer.opacity);
      for (let i = 0; i < n; i++) {
        const a = s.alpha[i] * op;
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const base = out[i * 3 + c];
          out[i * 3 + c] = base + (blendChannel(mode, base, s.rgb[i * 3 + c]) - base) * a;
        }
      }
    }

    // Overlays: lowest priority first so the highest ends on top.
    const overlays = [...(opts.overlays ?? [])].sort((a, b) => a.priority - b.priority);
    for (const o of overlays) {
      const a = clamp(o.alpha ?? 1);
      if (o.exclusive) for (let i = 0; i < out.length; i++) out[i] *= 1 - a;
      for (const [id, c] of Object.entries(o.colors)) {
        for (const i of this.byId.get(id) ?? []) {
          for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = lerp(out[i * 3 + ch], c[ch], a);
        }
      }
    }

    const b = clamp(this.scene.brightness ?? 1);
    for (let i = 0; i < out.length; i++) out[i] = clamp(out[i] * b, 0, 255);

    if (opts.reduceFlashing && this.prev && this.prev.length === out.length && dt > 0) {
      const k = 1 - Math.exp(-dt / SMOOTH_TAU_S);
      for (let i = 0; i < out.length; i++) out[i] = this.prev[i] + (out[i] - this.prev[i]) * k;
    }
    this.prev = out.slice();
    return out;
  }

  private context(s: LayerState, t: number, dt: number, signals: Readonly<Omit<Signals, "overlays">>): EffectContext {
    const { rgb, alpha, inRegion } = s;
    const setAt = (i: number, c: RGB, a = 1) => {
      if (i < 0 || i >= inRegion.length || !inRegion[i]) return;
      rgb[i * 3] = c[0];
      rgb[i * 3 + 1] = c[1];
      rgb[i * 3 + 2] = c[2];
      alpha[i] = a >= 1 ? 1 : a <= 0 ? 0 : a;
    };
    return {
      ...HELPERS,
      t,
      dt,
      width: this.width,
      height: this.height,
      keys: this.keys,
      region: s.region,
      masked: s.masked,
      pressed: this.pressed,
      events: this.events,
      signals,
      params: s.params,
      setAt,
      set: (id, c, a) => {
        for (const i of this.byId.get(id) ?? []) setAt(i, c, a);
      },
      fill: (c, a) => {
        for (const k of s.region) setAt(k.index, c, a);
      },
    };
  }

  /** Layers disabled because of errors (id → reason). */
  get errors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of this.states) if (s.disabled) out[s.layer.id] = s.disabled;
    return out;
  }

  dispose() {
    for (const s of this.states) s.inst?.dispose?.();
    this.states = [];
  }
}
