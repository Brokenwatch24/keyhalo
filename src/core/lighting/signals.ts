import { create } from "zustand";
import type { RGB } from "../types";

/**
 * Live data that lighting widgets render. Producers (integrations, stats, typing, keymaps)
 * write here; the lighting engine reads it every frame. Keep values small and serialisable.
 */
export interface Signals {
  cpu?: { load: number; temp?: number };
  gpu?: { load: number; temp: number; vramPct: number };
  ram?: { pct: number };
  /** Battery per device uid, 0..100. */
  battery: Record<string, { percent: number; charging: boolean }>;
  /** Bambu printer: progress 0..100, state = gcode_state (RUNNING, FINISH, FAILED…). */
  bambu?: { progress: number; state: string; remainingMin?: number; layer?: number; totalLayers?: number };
  claude?: { state: "idle" | "working" | "waiting" | "done" | "error"; since: number };
  micMuted?: boolean;
  capsLock?: boolean;
  /** Active keymap layer name (null = base). */
  layer?: string | null;
  pomodoro?: { phase: "focus" | "break" | "idle"; remainingMs: number; totalMs: number };
  wpm?: number;
  apm?: number;
  /** Audio spectrum, 0..1 per band. */
  audio?: { bands: number[]; level: number };
  /**
   * Live game state from official game APIs (integrations/games). health/armor/mana are 0..100,
   * ammo is the clip ratio 0..1, flashed/burning are 0..1, phase is the round/game phase.
   */
  game?: { game: "cs2" | "dota2" | "lol"; health?: number; armor?: number; ammo?: number; mana?: number; dead?: boolean; bomb?: "planted" | "defused" | "exploded" | null; flashed?: number; burning?: number; phase?: string };
  /**
   * Full-keyboard overlays drawn above every layer, highest priority first:
   * typing trainer guidance, shortcut cheat-sheet, wizard LED mapping.
   * Keys not in the map fall through to the scene below unless `exclusive` is set.
   */
  overlays: Record<string, { priority: number; colors: Record<string, RGB>; exclusive?: boolean }>;
}

interface SignalsState extends Signals {
  set: (patch: Partial<Signals>) => void;
  setOverlay: (id: string, overlay: Signals["overlays"][string] | null) => void;
}

export const useSignals = create<SignalsState>((set) => ({
  battery: {},
  overlays: {},
  set: (patch) => set(patch),
  setOverlay: (id, overlay) =>
    set((s) => {
      const overlays = { ...s.overlays };
      if (overlay) overlays[id] = overlay;
      else delete overlays[id];
      return { overlays };
    }),
}));
