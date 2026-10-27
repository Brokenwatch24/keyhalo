import type { HudPayload } from "@/core/backend";
import { bus } from "@/core/util/bus";

/** Show the on-screen HUD (rendered by the app shell, which respects settings.hud). */
export function hud(payload: HudPayload) {
  bus.emit("hud", payload);
}

/** Flash keys (empty/undefined = whole keyboard). */
export function flash(color: string, keys?: string[], times = 2, durationMs?: number) {
  bus.emit("lighting:flash", { color, keys: keys?.length ? keys : undefined, times, durationMs });
}

/** A user-visible notification: flash + HUD. Used by the API, rules and notification watchers. */
export function notifyUser(text: string, color = "#ffffff", keys?: string[], opts: { flash?: boolean; hud?: boolean; title?: string } = {}) {
  if (opts.flash !== false) flash(color, keys, 2);
  if (opts.hud !== false) hud({ title: opts.title ?? text, value: opts.title ? text : undefined, color, icon: "info", durationMs: 2600 });
}
