import { backend } from "@/core/backend";
import { acquireInputListening } from "@/core/stats/input";
import { acquireSystemMetrics } from "@/core/integrations/system";
import type { Unlisten } from "@/core/backend/api";
import { acceptsFrames, pushFrame } from "@/core/devices/manager";
import { useDevices } from "@/core/devices/store";
import { getTemplate } from "@/core/devices/templates";
import { useSettings } from "@/core/state/settings";
import type { DeviceDefinition, RGB } from "@/core/types";
import type { LedColor } from "@/core/devices/drivers/types";
import { setColorVision, hex } from "./color";
import { Compositor, type Overlay } from "./compositor";
import { effectRegistry } from "./effects/registry";
import { buildGeometry, sourcesFromDevices, type GeometrySource, type SceneGeometry } from "./scene";
import { useSignals } from "./signals";
import { useLighting } from "./store";

const SYSTEM_WIDGETS = new Set(["widget:cpu", "widget:gpu-temp", "widget:ram"]);

/**
 * Lighting engine: runs the compositor at scene.fps, pushes frames to devices and feeds the
 * preview hooks. Pauses when no device is connected and nobody watches a preview.
 */

export const VIRTUAL_KEYBOARD = "virtual:keyboard";
export const VIRTUAL_MOUSE = "virtual:mouse";
const PREVIEW_FPS = 20;

export interface FlashRequest {
  keys?: string[];
  color: string | RGB;
  times?: number;
  durationMs?: number;
}

interface ActiveFlash {
  keys?: string[];
  color: RGB;
  start: number;
  period: number;
  times: number;
}

type FrameMap = Record<string, RGB>;

class LightingEngine {
  readonly compositor = new Compositor({
    onLayerError: (id, message) => {
      console.warn(`[lighting] layer ${id} disabled: ${message}`);
      useLighting.setState({ errors: { ...useLighting.getState().errors, [id]: message } });
    },
  });
  geometry: SceneGeometry = { keys: [], width: 0, height: 0, devices: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private t0 = Date.now();
  private lastT = 0;
  private lastPreview = 0;
  private flashes: ActiveFlash[] = [];
  private previews = new Map<string, FrameMap>();
  private previewListeners = new Map<string, Set<() => void>>();
  private unsubs: (() => void)[] = [];
  private audioOn = false;
  private audioUnlisten: Unlisten | null = null;
  private releaseInput: (() => void) | null = null;
  private releaseMetrics: (() => void) | null = null;
  private virtual = false;
  started = false;

  now() {
    return (Date.now() - this.t0) / 1000;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    setColorVision(useSettings.getState().settings.colorVision);
    this.rebuildGeometry();
    this.applyScene();
    this.unsubs.push(
      useDevices.subscribe((s, prev) => {
        if (s.devices !== prev.devices) this.rebuildGeometry();
      }),
      useLighting.subscribe((s, prev) => {
        if (s.scene !== prev.scene) this.applyScene();
      }),
      useSettings.subscribe((s, prev) => {
        if (s.settings.colorVision !== prev.settings.colorVision) setColorVision(s.settings.colorVision);
      }),
      effectRegistry.subscribe(() => this.applyScene(true)),
    );
    try {
      const off = await backend.on("input-key", (e) => this.compositor.keyEvent(e.code, e.down, this.now()));
      this.unsubs.push(off);
    } catch {
      /* ignore */
    }
    this.schedule();
  }

  stop() {
    this.unsubs.splice(0).forEach((u) => u());
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.setAudio(false);
    this.compositor.dispose();
    this.started = false;
  }

  // Geometry ----------------------------------------------------------------

  private virtualSources(): GeometrySource[] {
    const tpl = getTemplate("ansi-60");
    const keyboard: DeviceDefinition = {
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
    const mouseDef = useDevices.getState().definitions.find((d) => d.type === "mouse" && d.status === "verified");
    const sources: GeometrySource[] = [{ uid: VIRTUAL_KEYBOARD, definition: keyboard, layout: tpl.layout, desk: { x: 0, y: 0 } }];
    if (mouseDef) sources.push({ uid: VIRTUAL_MOUSE, definition: mouseDef, desk: { x: tpl.size.w + 1.5, y: (tpl.size.h - mouseDef.size.h) / 2 } });
    return sources;
  }

  rebuildGeometry() {
    const devices = useDevices.getState().devices;
    this.virtual = devices.length === 0;
    const sources = this.virtual ? this.virtualSources() : sourcesFromDevices(devices);
    this.geometry = buildGeometry(sources);
    this.compositor.setGeometry(this.geometry.keys, this.geometry.width, this.geometry.height);
    this.schedule();
  }

  // Scene -------------------------------------------------------------------

  private applyScene(force = false) {
    const scene = useLighting.getState().scene;
    if (force) this.compositor.setScene({ ...scene, layers: [] });
    this.compositor.setScene(scene);
    const metas = scene.layers.filter((l) => l.enabled).map((l) => effectRegistry.get(l.effect)?.meta);
    void this.setAudio(metas.some((m) => m?.tags?.includes("audio")));
    // Reactive effects need global key events; the hook is shared (ref-counted) with stats & keymaps.
    const reactive = metas.some((m) => m?.reactive);
    if (reactive && !this.releaseInput) this.releaseInput = acquireInputListening();
    if (!reactive && this.releaseInput) {
      this.releaseInput();
      this.releaseInput = null;
    }
    // CPU/GPU/RAM widgets need the system monitor running.
    const needsMetrics = scene.layers.some((l) => l.enabled && SYSTEM_WIDGETS.has(l.effect));
    if (needsMetrics && !this.releaseMetrics) this.releaseMetrics = acquireSystemMetrics();
    if (!needsMetrics && this.releaseMetrics) {
      this.releaseMetrics();
      this.releaseMetrics = null;
    }
    this.schedule();
  }

  private async setAudio(on: boolean) {
    if (on === this.audioOn) return;
    this.audioOn = on;
    try {
      if (on) {
        this.audioUnlisten = await backend.on("audio-bands", (a) => useSignals.getState().set({ audio: { bands: a.bands, level: a.level } }));
        await backend.audioSetListening(true);
      } else {
        this.audioUnlisten?.();
        this.audioUnlisten = null;
        await backend.audioSetListening(false);
        useSignals.getState().set({ audio: undefined });
      }
    } catch (e) {
      console.warn("[lighting] audio capture unavailable", e);
    }
  }

  // Flash -------------------------------------------------------------------

  flash(req: FlashRequest) {
    const times = Math.max(1, Math.min(10, Math.round(req.times ?? 3)));
    let period = (req.durationMs ?? times * 400) / times / 1000;
    // Photosensitivity: never faster than 2.5 Hz, and ≤ 1.4 Hz with "reduce flashing".
    period = Math.max(period, useSettings.getState().settings.reduceFlashing ? 0.7 : 0.4);
    this.flashes.push({ keys: req.keys?.length ? req.keys : undefined, color: hex(req.color), start: this.now(), period, times });
    this.schedule();
  }

  private flashOverlays(t: number): Overlay[] {
    this.flashes = this.flashes.filter((f) => t - f.start < f.period * f.times);
    return this.flashes.map((f, i) => {
      const phase = ((t - f.start) % f.period) / f.period;
      const ids = f.keys ?? [...new Set(this.geometry.keys.map((k) => k.id))];
      const colors: Record<string, RGB> = {};
      for (const id of ids) colors[id] = f.color;
      return { priority: 100_000 + i, colors, alpha: Math.sin(Math.PI * phase) ** 2 };
    });
  }

  // Loop --------------------------------------------------------------------

  private get hasWatchers() {
    for (const s of this.previewListeners.values()) if (s.size) return true;
    return false;
  }

  private get shouldRun() {
    return this.started && this.geometry.keys.length > 0 && (!this.virtual || this.hasWatchers);
  }

  private schedule() {
    if (this.timer || !this.started) return;
    if (!this.shouldRun) {
      if (useLighting.getState().running) useLighting.setState({ running: false });
      return;
    }
    if (!useLighting.getState().running) useLighting.setState({ running: true });
    const fps = useLighting.getState().scene.fps || 30;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
      this.schedule();
    }, 1000 / fps);
  }

  /** Render one frame now and push it to devices/previews (exposed for tests). */
  tick() {
    const t = this.now();
    const dt = this.lastT ? Math.min(0.25, t - this.lastT) : 1 / 30;
    this.lastT = t;
    const signals = useSignals.getState();
    const settings = useSettings.getState().settings;
    const overlays: Overlay[] = Object.values(signals.overlays ?? {}).map((o) => ({ priority: o.priority, colors: o.colors, exclusive: o.exclusive }));
    overlays.push(...this.flashOverlays(t));
    const frame = this.compositor.render(t, dt, signals, { overlays, reduceFlashing: settings.reduceFlashing });

    if (!this.virtual) {
      for (const slice of this.geometry.devices) {
        if (!acceptsFrames(slice.uid)) continue;
        const out: LedColor[] = [];
        slice.indices.forEach((i, j) => {
          const led = slice.leds[j];
          if (led === undefined) return;
          out.push({ led, color: [Math.round(frame[i * 3]), Math.round(frame[i * 3 + 1]), Math.round(frame[i * 3 + 2])] });
        });
        pushFrame(slice.uid, out);
      }
    }

    const nowMs = Date.now();
    if (this.hasWatchers && nowMs - this.lastPreview >= 1000 / PREVIEW_FPS) {
      this.lastPreview = nowMs;
      this.publishPreviews(frame);
    }
    return frame;
  }

  private publishPreviews(frame: Float32Array) {
    const all: FrameMap = {};
    for (const slice of this.geometry.devices) {
      const map: FrameMap = {};
      for (const i of slice.indices) {
        const c: RGB = [Math.round(frame[i * 3]), Math.round(frame[i * 3 + 1]), Math.round(frame[i * 3 + 2])];
        map[this.geometry.keys[i].id] = c;
        all[this.geometry.keys[i].id] ??= c;
      }
      this.previews.set(slice.uid, map);
    }
    this.previews.set("*", all);
    for (const [uid, set] of this.previewListeners) {
      if (!this.previews.has(uid)) this.previews.set(uid, {});
      set.forEach((l) => l());
    }
  }

  // Preview subscriptions ----------------------------------------------------

  subscribePreview(uid: string, listener: () => void): () => void {
    let set = this.previewListeners.get(uid);
    if (!set) this.previewListeners.set(uid, (set = new Set()));
    set.add(listener);
    this.schedule();
    return () => {
      set!.delete(listener);
    };
  }

  getPreview(uid: string): FrameMap {
    let p = this.previews.get(uid);
    if (!p) this.previews.set(uid, (p = {}));
    return p;
  }
}

export const engine = new LightingEngine();
