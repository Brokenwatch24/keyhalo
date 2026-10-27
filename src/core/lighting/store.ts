import { create } from "zustand";
import type { LightingLayer, LightingScene } from "@/core/types";

/**
 * Lighting store: the scene the engine renders right now (normally the active profile's
 * scene; edits here are written back to the active user profile by profiles.ts).
 */

export const DEFAULT_SCENE: LightingScene = {
  layers: [
    {
      id: "base",
      effect: "wave",
      params: { speed: 0.35, wavelength: 22, direction: "right", rainbow: true },
      blend: "normal",
      opacity: 1,
      enabled: true,
    },
  ],
  brightness: 0.85,
  fps: 30,
};

let idSeq = 0;
export const newLayerId = () => `layer-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

export interface LightingState {
  scene: LightingScene;
  /** Layers disabled by the engine (id → reason), e.g. a community effect that crashed. */
  errors: Record<string, string>;
  /** True while the engine is rendering (devices or preview subscribers present). */
  running: boolean;
  setScene(scene: LightingScene): void;
  setLayers(layers: LightingLayer[]): void;
  /** Add a layer on top (or at `index`); returns its id. */
  addLayer(layer: Partial<LightingLayer> & { effect: string }, index?: number): string;
  updateLayer(id: string, patch: Partial<LightingLayer>): void;
  removeLayer(id: string): void;
  moveLayer(id: string, toIndex: number): void;
  setBrightness(value: number): void;
  setFps(fps: number): void;
}

export const useLighting = create<LightingState>((set, get) => ({
  scene: DEFAULT_SCENE,
  errors: {},
  running: false,
  setScene: (scene) => set({ scene: normaliseScene(scene), errors: {} }),
  setLayers: (layers) => set({ scene: { ...get().scene, layers } }),
  addLayer: (partial, index) => {
    const layer: LightingLayer = {
      id: partial.id ?? newLayerId(),
      effect: partial.effect,
      params: partial.params ?? {},
      blend: partial.blend ?? "normal",
      opacity: partial.opacity ?? 1,
      enabled: partial.enabled ?? true,
      ...(partial.mask ? { mask: partial.mask } : {}),
      ...(partial.devices ? { devices: partial.devices } : {}),
    };
    const layers = [...get().scene.layers];
    layers.splice(index ?? layers.length, 0, layer);
    set({ scene: { ...get().scene, layers } });
    return layer.id;
  },
  updateLayer: (id, patch) => {
    const errors = { ...get().errors };
    if (patch.effect || patch.params) delete errors[id];
    set({ scene: { ...get().scene, layers: get().scene.layers.map((l) => (l.id === id ? { ...l, ...patch, id } : l)) }, errors });
  },
  removeLayer: (id) => set({ scene: { ...get().scene, layers: get().scene.layers.filter((l) => l.id !== id) } }),
  moveLayer: (id, toIndex) => {
    const layers = [...get().scene.layers];
    const from = layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = layers.splice(from, 1);
    layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
    set({ scene: { ...get().scene, layers } });
  },
  setBrightness: (value) => set({ scene: { ...get().scene, brightness: Math.max(0, Math.min(1, value)) } }),
  setFps: (fps) => set({ scene: { ...get().scene, fps: Math.max(1, Math.min(60, Math.round(fps))) } }),
}));

/** Fill defaults and give every layer an id (community profiles may omit fields). */
export function normaliseScene(scene: Partial<LightingScene> | undefined): LightingScene {
  const layers = (scene?.layers ?? []).map((l, i) => ({
    id: l.id || `layer-${i}`,
    effect: l.effect || "off",
    params: l.params ?? {},
    blend: l.blend ?? "normal",
    opacity: typeof l.opacity === "number" ? l.opacity : 1,
    enabled: l.enabled !== false,
    ...(l.mask?.length ? { mask: l.mask } : {}),
    ...(l.devices?.length ? { devices: l.devices } : {}),
  }));
  return {
    layers,
    brightness: typeof scene?.brightness === "number" ? Math.max(0, Math.min(1, scene.brightness)) : 1,
    fps: typeof scene?.fps === "number" && scene.fps > 0 ? Math.min(60, scene.fps) : 30,
  };
}
