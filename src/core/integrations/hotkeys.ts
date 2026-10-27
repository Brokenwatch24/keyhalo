import { isTauri } from "@/core/backend";

/**
 * Global hotkeys through `@tauri-apps/plugin-global-shortcut` (desktop app only; a no-op in the
 * browser demo). Several callers may register the same accelerator; the plugin registration is
 * shared and removed when the last caller unregisters.
 */
type Cb = () => void;
const callbacks = new Map<string, Set<Cb>>();

const norm = (accel: string) =>
  accel
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("+");

/** Register `accelerator` (e.g. "Ctrl+Shift+M"). Resolves to an unregister function. */
export async function registerHotkey(accelerator: string, cb: Cb): Promise<() => void> {
  const accel = norm(accelerator);
  if (!accel || !isTauri) return () => {};
  let set = callbacks.get(accel);
  if (!set) {
    set = new Set();
    callbacks.set(accel, set);
    try {
      const gs = await import("@tauri-apps/plugin-global-shortcut");
      await gs.register(accel, (e) => {
        if (e.state === "Pressed") callbacks.get(accel)?.forEach((f) => f());
      });
    } catch (e) {
      callbacks.delete(accel);
      throw e;
    }
  }
  set.add(cb);
  return () => {
    const s = callbacks.get(accel);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      callbacks.delete(accel);
      import("@tauri-apps/plugin-global-shortcut").then((gs) => gs.unregister(accel)).catch(() => {});
    }
  };
}
