import { useCallback, useSyncExternalStore } from "react";
import type { EffectMeta, RGB } from "@/core/types";
import { effectRegistry } from "./effects/registry";
import { engine, type FlashRequest } from "./engine";

/**
 * Live colours of one device (`uid`), keyed by key code / LED id, refreshed at ~20 fps.
 * Pass "*" for the whole scene. With no device connected the engine renders a virtual
 * desk: use `VIRTUAL_KEYBOARD` / `VIRTUAL_MOUSE` uids (exported from ./engine).
 * Subscribing keeps the engine running even without hardware.
 */
export function useLightingFrame(uid: string | undefined): Record<string, RGB> {
  const id = uid ?? "*";
  const subscribe = useCallback((cb: () => void) => engine.subscribePreview(id, cb), [id]);
  const get = useCallback(() => engine.getPreview(id), [id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Every registered effect (re-renders when community effects are added/removed). */
export function useEffects(): EffectMeta[] {
  const version = useSyncExternalStore(
    (cb) => effectRegistry.subscribe(cb),
    () => effectRegistry.version,
    () => effectRegistry.version,
  );
  void version;
  return effectRegistry.list();
}

/** Flash keys (or everything) as a temporary overlay. Same as bus "lighting:flash". */
export function flash(req: FlashRequest) {
  engine.flash(req);
}
