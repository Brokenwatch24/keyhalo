import { create } from "zustand";
import { backend, type WindowInfo } from "@/core/backend";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import type { MacroStep } from "@/core/types";
import { grid, GRID, parseButton } from "./launchpad";
import type { PadButtonId } from "./types";

/**
 * "Windows" page: each pad is one open window (it keeps its pad while it lives). Tap brings it to
 * the front (or minimises it when it already is), hold closes it like its X button. The top
 * buttons arrange windows.
 */
export interface OpenWindow {
  hwnd: number;
  process: string;
  title: string;
  slot: number;
}

export const useOpenWindows = create<{ windows: OpenWindow[]; front: number }>(() => ({ windows: [], front: 0 }));

/** The desktop itself, KeyHalo's overlays and the touch keyboard host aren't windows you switch to. */
function hidden(w: WindowInfo) {
  const p = w.process.toLowerCase();
  return (p === "explorer.exe" && w.title === "Program Manager") || (p === "keyhalo.exe" && w.title !== "KeyHalo") || p === "textinputhost.exe";
}

/** Keep every window on its pad while it lives; new windows take the first free pad. */
export function placeWindows(prev: OpenWindow[], wins: WindowInfo[]): OpenWindow[] {
  const live = wins.filter((w): w is WindowInfo & { hwnd: number } => !!w.hwnd && !hidden(w));
  const byHwnd = new Map(live.map((w) => [w.hwnd, w]));
  const kept = prev.filter((p) => byHwnd.has(p.hwnd)).map((p) => ({ ...p, title: byHwnd.get(p.hwnd)!.title }));
  const used = new Set(kept.map((p) => p.slot));
  const known = new Set(kept.map((p) => p.hwnd));
  let next = 0;
  for (const w of live) {
    if (known.has(w.hwnd)) continue;
    while (used.has(next)) next++;
    if (next >= GRID * GRID) break;
    used.add(next);
    kept.push({ hwnd: w.hwnd, process: w.process, title: w.title, slot: next });
  }
  return kept.sort((a, b) => a.slot - b.slot);
}

/** One colour per app (the Launchpad mixes red and green only). */
const PALETTE = ["#ff3b30", "#ff7a00", "#ffb000", "#ffe14d", "#a8e04d", "#3ccf4e"];
export function appColor(process: string): string {
  let h = 0;
  for (const c of process.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** "Page - Google Chrome" → "Page": the app is already told by the colour and the HUD. */
export function windowLabel(w: Pick<OpenWindow, "title" | "process">): string {
  const i = w.title.lastIndexOf(" - ");
  const short = i > 0 ? w.title.slice(0, i) : w.title;
  return short.trim() || w.process.replace(/\.exe$/i, "");
}

export const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));

let refreshing = false;
export async function refreshWindows() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [wins, fg] = await Promise.all([backend.windows(), backend.foregroundApp().catch(() => null)]);
    const windows = placeWindows(useOpenWindows.getState().windows, wins);
    const front = fg?.hwnd ?? 0;
    const cur = useOpenWindows.getState();
    const same = cur.front === front && cur.windows.length === windows.length && cur.windows.every((w, i) => w.hwnd === windows[i].hwnd && w.title === windows[i].title);
    if (!same) useOpenWindows.setState({ windows, front });
  } catch {
    // keep the last list
  } finally {
    refreshing = false;
  }
}

const win = (key: string): MacroStep[] => [{ op: "down", key: "MetaLeft" }, { op: "tap", key }, { op: "up", key: "MetaLeft" }];
const send = (steps: MacroStep[]) => void backend.inputSend(steps).catch(() => {});

/** Top buttons: ▲ ▼ ◀ ▶ Ses U1 U2 Mix. */
export const WINDOW_TOOLS: { key: string; color: string; run: () => void }[] = [
  { key: "tile", color: "#3ccf4e", run: () => void backend.tile(useOpenWindows.getState().windows.map((w) => w.hwnd)).catch(() => {}) },
  { key: "desktop", color: "#ffb000", run: () => send(win("KeyD")) },
  { key: "left", color: "#ffe14d", run: () => send(win("ArrowLeft")) },
  { key: "right", color: "#ffe14d", run: () => send(win("ArrowRight")) },
  { key: "maximize", color: "#a8e04d", run: () => send(win("ArrowUp")) },
  { key: "minimize", color: "#ff7a00", run: () => void backend.windowCmd(useOpenWindows.getState().front, "minimize").catch(() => {}) },
  { key: "taskView", color: "#a8e04d", run: () => send(win("Tab")) },
  // Tap: close the tab in front (Ctrl+W). Hold it and tap pads: close those windows.
  { key: "close", color: "#ff3b30", run: () => send([{ op: "down", key: "ControlLeft" }, { op: "tap", key: "KeyW" }, { op: "up", key: "ControlLeft" }]) },
];
export const CLOSE_TOOL = WINDOW_TOOLS.findIndex((x) => x.key === "close");

/** The close button is held: window pads close their window. */
let closing: { since: number; used: boolean } | null = null;
export const closeHeld = () => closing !== null;

export const toolName = (key: string) => t(`pads.windows.tools.${key}`);

const HOLD_MS = 600;
const holds = new Map<PadButtonId, ReturnType<typeof setTimeout>>();
const fired = new Set<PadButtonId>();

function hud(title: string, value?: string, color?: string) {
  bus.emit("hud", { title, value, icon: "info", color, durationMs: 1000 });
}

/** Input on the Windows page. */
export function windowInput(id: PadButtonId, down: boolean) {
  const b = parseButton(id);
  if (!b) return;
  if (b.kind === "t" && b.x === CLOSE_TOOL) {
    if (down) {
      closing = { since: Date.now(), used: false };
      return;
    }
    const tap = closing && !closing.used && Date.now() - closing.since < 400;
    closing = null;
    if (tap) {
      WINDOW_TOOLS[CLOSE_TOOL].run();
      hud(t("pads.windows.closedTab"), undefined, "#ff3b30");
      setTimeout(() => void refreshWindows(), 400);
    }
    return;
  }
  if (b.kind === "t") {
    const tool = WINDOW_TOOLS[b.x];
    if (down && tool) {
      tool.run();
      hud(toolName(tool.key));
      if (tool.key === "tile") setTimeout(() => void refreshWindows(), 300);
    }
    return;
  }
  if (b.kind !== "g") return;
  const w = useOpenWindows.getState().windows.find((x) => x.slot === b.y * GRID + b.x);
  if (!w) return;
  if (closing) {
    if (!down) return;
    closing.used = true;
    void backend.windowCmd(w.hwnd, "close").catch(() => {});
    hud(t("pads.windows.closed"), windowLabel(w), appColor(w.process));
    setTimeout(() => void refreshWindows(), 500);
    return;
  }
  if (down) {
    fired.delete(id);
    holds.set(
      id,
      setTimeout(() => {
        fired.add(id);
        void backend.windowCmd(w.hwnd, "close").catch(() => {});
        hud(t("pads.windows.closed"), windowLabel(w), appColor(w.process));
        setTimeout(() => void refreshWindows(), 500);
      }, HOLD_MS),
    );
    return;
  }
  clearTimeout(holds.get(id));
  holds.delete(id);
  if (fired.has(id)) return;
  const inFront = useOpenWindows.getState().front === w.hwnd;
  void (inFront ? backend.windowCmd(w.hwnd, "minimize") : backend.focusHwnd(w.hwnd)).catch(() => {}).then(() => refreshWindows());
  if (!inFront) hud(w.process.replace(/\.exe$/i, ""), windowLabel(w), appColor(w.process));
}
