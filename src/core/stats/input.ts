import { useEffect } from "react";
import { backend } from "@/core/backend";

/**
 * Ref-counted access to the global input hook (`input-key` / `input-mouse` events).
 *
 * The Rust input hook only emits events while at least one consumer needs them
 * (stats, the shortcut cheat-sheet, idle automations, reactive lighting, the typing trainer…).
 * Every consumer calls `acquireInputListening()` and keeps the returned release function;
 * the hook is switched off when the last consumer releases it.
 *
 * Privacy: events are only used for counts, live WPM/APM and reactive lighting — never stored as text.
 */
let refs = 0;
let applied: boolean | null = null;
let pending: Promise<void> = Promise.resolve();

function sync() {
  const want = refs > 0;
  if (applied === want) return;
  applied = want;
  pending = pending
    .then(() => backend.inputSetListening(want))
    .catch((e) => {
      console.warn("[input] could not toggle input listening", e);
      applied = null;
    });
}

/** Start receiving global input events; call the returned function to release. Idempotent release. */
export function acquireInputListening(): () => void {
  refs++;
  sync();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    sync();
  };
}

/** Number of active consumers (for diagnostics). */
export function inputListeners(): number {
  return refs;
}

/** React hook: keep input listening on while the component is mounted (and `active` is true). */
export function useInputListening(active = true) {
  useEffect(() => (active ? acquireInputListening() : undefined), [active]);
}
