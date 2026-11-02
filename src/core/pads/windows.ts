import { create } from "zustand";
import { backend, type TabInfo, type WindowInfo } from "@/core/backend";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import type { MacroStep } from "@/core/types";
import { grid, GRID, parseButton, top } from "./launchpad";
import { usePads } from "./store";
import type { PadButtonId, PadMapPayload } from "./types";

/**
 * "Windows" page: each pad is one open window (it keeps its pad while it lives). Tap brings it to
 * the front (or minimises it when it already is), hold shows its tabs on the pads (Chrome,
 * Terminal…). The top buttons arrange windows; the last one closes tabs and windows.
 */
export interface OpenWindow {
  hwnd: number;
  process: string;
  title: string;
  slot: number;
}

/** Tabs mode: one window's tabs on the pads (null = the windows). */
export interface WindowTabs {
  hwnd: number;
  process: string;
  title: string;
  items: TabInfo[];
}

export const useOpenWindows = create<{ windows: OpenWindow[]; front: number; tabs: WindowTabs | null }>(() => ({ windows: [], front: 0, tabs: null }));

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
    const tabs = useOpenWindows.getState().tabs;
    if (tabs) {
      if (!windows.some((w) => w.hwnd === tabs.hwnd)) closeTabs();
      else {
        const items = await backend.tabs(tabs.hwnd).catch(() => tabs.items);
        const cur = useOpenWindows.getState().tabs;
        if (cur?.hwnd === tabs.hwnd && JSON.stringify(cur.items) !== JSON.stringify(items)) useOpenWindows.setState({ tabs: { ...cur, items } });
      }
    }
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
        void openTabs(w);
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

// ---------------------------------------------------------------------------
// Tabs mode
// ---------------------------------------------------------------------------

const PREV_TAB = top(0);
const NEXT_TAB = top(1);
const BACK = top(2);
const TAB_ROWS = 10;

/** Chrome adds hover-card details to tab names ("…: Memory usage: 654 MB"): drop them. */
export function tabName(name: string): string {
  let s = name.trim();
  for (;;) {
    const next = s.replace(/:\s*(?:(?:uso de memoria|memory usage)[^:]*|reproducci[oó]n de audio|playing audio|audio playing|silenciad[oa]|muted|tab muted|[^:]*\b[KMG]B)\s*$/i, "").trim();
    if (next === s) return s;
    s = next;
  }
}

/** The map was opened for tabs mode (and is closed again after it). */
let tabsOpenedMap = false;

export async function openTabs(w: OpenWindow) {
  void backend.focusHwnd(w.hwnd).catch(() => {});
  const items = await backend.tabs(w.hwnd).catch(() => []);
  if (items.length < 2) {
    hud(windowLabel(w), t("pads.windows.noTabs"), appColor(w.process));
    return;
  }
  useOpenWindows.setState({ tabs: { hwnd: w.hwnd, process: w.process, title: w.title, items } });
  if (!usePads.getState().mapVisible) {
    tabsOpenedMap = true;
    usePads.setState({ mapVisible: true });
  }
}

export function closeTabs() {
  if (!useOpenWindows.getState().tabs) return;
  useOpenWindows.setState({ tabs: null });
  if (tabsOpenedMap) usePads.setState({ mapVisible: false });
  tabsOpenedMap = false;
}

const keys = (...k: string[]): MacroStep[] => [...k.slice(0, -1).map((key) => ({ op: "down", key }) as MacroStep), { op: "tap", key: k[k.length - 1] }, ...k.slice(0, -1).reverse().map((key) => ({ op: "up", key }) as MacroStep)];

/** Input in tabs mode: a pad switches to its tab, ▲ ▼ previous / next, ◀ back, close closes the tab. */
export function tabsInput(id: PadButtonId, down: boolean) {
  const tabs = useOpenWindows.getState().tabs;
  if (!tabs || !down) return;
  const b = parseButton(id);
  if (!b) return;
  const later = () => setTimeout(() => void refreshWindows(), 250);
  const inWindow = async (steps: MacroStep[]) => {
    await backend.focusHwnd(tabs.hwnd).catch(() => false);
    await backend.inputSend(steps).catch(() => {});
    later();
  };
  if (b.kind === "t") {
    if (id === BACK) closeTabs();
    else if (id === PREV_TAB) void inWindow(keys("ControlLeft", "ShiftLeft", "Tab"));
    else if (id === NEXT_TAB) void inWindow(keys("ControlLeft", "Tab"));
    else if (b.x === CLOSE_TOOL) {
      void inWindow(keys("ControlLeft", "KeyW"));
      hud(t("pads.windows.closedTab"), undefined, "#ff3b30");
    }
    return;
  }
  if (b.kind !== "g") return;
  const i = b.y * GRID + b.x;
  const tab = tabs.items[i];
  if (!tab) return;
  // Optimistic: light the chosen tab at once.
  useOpenWindows.setState({ tabs: { ...tabs, items: tabs.items.map((x, j) => ({ ...x, selected: j === i })) } });
  void backend
    .focusHwnd(tabs.hwnd)
    .catch(() => false)
    .then(() => backend.tabSelect(tabs.hwnd, i))
    .catch(() => false)
    .then(later);
  hud(tabName(tab.name), undefined, appColor(tabs.process));
}

export function tabsLeds(dim: number): Map<PadButtonId, { hex: string; b: number }> | null {
  const tabs = useOpenWindows.getState().tabs;
  if (!tabs) return null;
  const out = new Map<PadButtonId, { hex: string; b: number }>();
  const color = appColor(tabs.process);
  tabs.items.forEach((x, i) => out.set(slotButton(i), { hex: x.selected ? "#ffe14d" : color, b: x.selected ? 1 : dim }));
  out.set(PREV_TAB, { hex: "#ffe14d", b: dim });
  out.set(NEXT_TAB, { hex: "#ffe14d", b: dim });
  out.set(BACK, { hex: "#ff7a00", b: 1 });
  out.set(top(CLOSE_TOOL), { hex: "#ff3b30", b: dim });
  return out;
}

export function tabsMap(): Pick<PadMapPayload, "page" | "buttons" | "list" | "hint"> | null {
  const tabs = useOpenWindows.getState().tabs;
  if (!tabs) return null;
  const color = appColor(tabs.process);
  const buttons: PadMapPayload["buttons"] = {
    [PREV_TAB]: { label: "▲", color: "#ffe14d" },
    [NEXT_TAB]: { label: "▼", color: "#ffe14d" },
    [BACK]: { label: t("pads.windows.back"), color: "#ff7a00" },
    [top(CLOSE_TOOL)]: { label: t("pads.windows.closeTab"), color: "#ff3b30" },
  };
  tabs.items.forEach((x, i) => (buttons[slotButton(i)] = { label: tabName(x.name), color: x.selected ? "#ffe14d" : color }));
  // Rows around the tab you are on.
  const sel = Math.max(0, tabs.items.findIndex((x) => x.selected));
  const start = Math.max(0, Math.min(sel - 4, tabs.items.length - TAB_ROWS));
  const list = tabs.items.slice(start, start + TAB_ROWS).map((x, k) => ({
    button: slotButton(start + k),
    label: tabName(x.name),
    color: x.selected ? "#ffe14d" : color,
    ...(x.selected ? { sub: t("pads.windows.current") } : {}),
  }));
  return {
    page: `${tabs.process.replace(/\.exe$/i, "")} · ${t("pads.windows.tabCount", { n: tabs.items.length })}`,
    buttons,
    list,
    hint: t("pads.windows.tabsHint"),
  };
}
