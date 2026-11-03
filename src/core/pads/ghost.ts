import type { PadButtonId } from "./types";

/**
 * The Launchpad S sometimes "ghosts": pressing one button also reports other buttons of the
 * same row within a millisecond or so (seen live: Map → the two pads next to it, one of them
 * Mute). People don't press two buttons of one row within a few tens of milliseconds, so:
 *  - a press on a row that already had a different press within `windowMs` is dropped (and so
 *    is its release);
 *  - grid presses wait `holdbackMs` before they count: if the row's round button (or a top
 *    button, for the top row) comes in meanwhile, the round button wins and the pad is dropped.
 * Only for the device: the on-screen board doesn't ghost.
 */
export interface GhostOptions {
  holdbackMs?: number;
  windowMs?: number;
  now?: () => number;
}

type Emit = (id: PadButtonId, down: boolean) => void;

/** The matrix row a button is scanned on: grid row y and right button y share one; the top row is its own. */
function rowOf(id: PadButtonId): string | null {
  const m = /^([gtr]):(\d)(?:,(\d))?$/.exec(id);
  if (!m) return null;
  if (m[1] === "t") return "t";
  return m[1] === "g" ? m[3] : m[2];
}

export function createGhostFilter(emit: Emit, opts: GhostOptions = {}) {
  const holdbackMs = opts.holdbackMs ?? 30;
  const windowMs = opts.windowMs ?? 80;
  const now = opts.now ?? (() => performance.now());
  const last = new Map<string, { id: PadButtonId; t: number }>();
  const dropped = new Set<PadButtonId>();
  const pending = new Map<PadButtonId, { row: string; released: boolean; timer: ReturnType<typeof setTimeout> }>();

  return function input(id: PadButtonId, down: boolean) {
    const row = rowOf(id);
    if (row === null) return emit(id, down);

    if (!down) {
      if (dropped.delete(id)) return;
      const p = pending.get(id);
      if (p) p.released = true;
      else emit(id, false);
      return;
    }

    const t = now();
    let cancelled = false;
    if (!id.startsWith("g:")) {
      // A round button beats the pads of its row that came in with it.
      for (const [pid, p] of pending) {
        if (p.row !== row) continue;
        clearTimeout(p.timer);
        pending.delete(pid);
        if (!p.released) dropped.add(pid);
        cancelled = true;
      }
    }
    const prev = last.get(row);
    if (!cancelled && prev && prev.id !== id && t - prev.t < windowMs) {
      dropped.add(id);
      return;
    }
    last.set(row, { id, t });
    if (!id.startsWith("g:")) return emit(id, true);

    const p = {
      row,
      released: false,
      timer: setTimeout(() => {
        pending.delete(id);
        emit(id, true);
        if (p.released) emit(id, false);
      }, holdbackMs),
    };
    pending.set(id, p);
  };
}
