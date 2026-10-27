import type { CatalogKind, HardwareEffect, KeyAction } from "../types";
import type { HudPayload } from "../backend/api";

/**
 * In-app command/event bus. Features talk to each other through these messages instead of
 * importing each other's internals, so each feature can evolve independently.
 *
 * Owners (who handles each message):
 *  - devices/lighting: "profile:apply", "dpi:*", "lighting:*", "device:effect"
 *  - keymaps: "keymaps:*"
 *  - app shell: "hud"
 *  - integrations: "notify" (flash + HUD)
 */
export interface BusEvents {
  // Profiles & lighting
  "profile:apply": { id: string; reason?: "user" | "app" | "rule" | "api" | "tray" | "hotkey" };
  "profile:applied": { id: string; name: string };
  "lighting:flash": { keys?: string[]; color: string; times?: number; durationMs?: number };
  "lighting:brightness": { value: number };
  "lighting:effect": { effect: string; params?: Record<string, unknown> };
  "device:effect": { uid?: string; effect: HardwareEffect };

  // Mouse
  "dpi:set": { value: number; uid?: string };
  "dpi:cycle": { direction?: 1 | -1 };
  "dpi:sniper": { active: boolean; value?: number };

  // Keymaps
  "keymaps:setEnabled": { ids: string[] };
  "keymaps:pause": { paused: boolean };
  "keymaps:action": { packId: string; key: string; action: KeyAction };

  // Shell
  hud: HudPayload;
  notify: { text: string; color?: string; keys?: string[] };

  // Community
  "community:installed": { kind: CatalogKind; id: string; data: unknown };
  "community:removed": { kind: CatalogKind; id: string };
}

type Handler<T> = (payload: T) => void;
const handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

export const bus = {
  on<E extends keyof BusEvents>(event: E, handler: Handler<BusEvents[E]>): () => void {
    let set = handlers.get(event);
    if (!set) handlers.set(event, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  },
  emit<E extends keyof BusEvents>(event: E, payload: BusEvents[E]) {
    handlers.get(event)?.forEach((h) => {
      try {
        (h as Handler<BusEvents[E]>)(payload);
      } catch (e) {
        console.error(`[bus] handler for ${event} failed`, e);
      }
    });
  },
};
