import { create } from "zustand";
import { backend } from "@/core/backend";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { useKeymaps } from "@/core/keymaps";
import type { KeymapPack, MacroStep, ShortcutLegend } from "@/core/types";
import { grid, GRID, parseButton, top } from "./launchpad";
import type { PadButtonId, PadMapPayload } from "./types";

/**
 * App page: the shortcuts of the app you are working in, from KeyHalo's shortcut packs (the
 * same ones the keyboard lights up). Pads follow the app in front; each pad is one shortcut in its
 * category's colour, the top buttons show one category at a time.
 */
interface AppPageState {
  /** The app you are working in (KeyHalo itself doesn't count) and its window. */
  process: string | null;
  hwnd: number;
  /** Category shown alone (null = all). */
  filter: string | null;
}

export const useAppPage = create<AppPageState>(() => ({ process: null, hwnd: 0, filter: null }));

const lower = (s: string) => s.toLowerCase();

/** Follow the window in front; KeyHalo's own window keeps the app you were in. */
export function appForeground(process: string, hwnd: number) {
  if (!process || lower(process) === "keyhalo.exe") return;
  const cur = useAppPage.getState();
  if (cur.hwnd === hwnd && cur.process === process) return;
  useAppPage.setState({ process, hwnd, filter: lower(cur.process ?? "") === lower(process) ? cur.filter : null });
}

/** The pack for an app: an enabled one first, else any with its shortcuts. */
export function appPack(process: string | null): KeymapPack | null {
  if (!process) return null;
  const { packs, enabledIds } = useKeymaps.getState();
  const mine = packs.filter((p) => p.legends.length && p.apps.some((a) => lower(a) === lower(process)));
  return mine.find((p) => enabledIds.includes(p.id)) ?? mine[0] ?? null;
}

/** The shortcuts on the pads: by category, in the pack's order, one category when filtered. */
export function appShortcuts(pack: KeymapPack | null, filter: string | null): ShortcutLegend[] {
  if (!pack) return [];
  const cats = Object.keys(pack.categories);
  const order = (c: string) => (cats.includes(c) ? cats.indexOf(c) : cats.length);
  return pack.legends
    .filter((l) => !filter || l.category === filter)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => order(a.l.category) - order(b.l.category) || a.i - b.i)
    .map(({ l }) => l)
    .slice(0, GRID * GRID);
}

const categoryColor = (pack: KeymapPack, c: string) => pack.categories[c] ?? "#9aa5b1";
const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));
const categories = (pack: KeymapPack | null) => (pack ? Object.keys(pack.categories).slice(0, GRID) : []);

/** Press a shortcut in the app (bringing it back first if KeyHalo's window took the front). */
async function press(keys: string[]) {
  const { hwnd } = useAppPage.getState();
  const fg = await backend.foregroundApp().catch(() => null);
  if (hwnd && fg?.hwnd !== hwnd) await backend.focusHwnd(hwnd).catch(() => false);
  const mods = keys.slice(0, -1);
  const main = keys[keys.length - 1];
  const steps: MacroStep[] = [...mods.map((key) => ({ op: "down", key }) as MacroStep), { op: "tap", key: main }, ...[...mods].reverse().map((key) => ({ op: "up", key }) as MacroStep)];
  await backend.inputSend(steps).catch(() => {});
}

export function appLeds(dim: number): Map<PadButtonId, { hex: string; b: number }> {
  const out = new Map<PadButtonId, { hex: string; b: number }>();
  const { process, filter } = useAppPage.getState();
  const pack = appPack(process);
  if (!pack) return out;
  appShortcuts(pack, filter).forEach((l, i) => out.set(slotButton(i), { hex: categoryColor(pack, l.category), b: 1 }));
  categories(pack).forEach((c, i) => out.set(top(i), { hex: categoryColor(pack, c), b: filter === c ? 1 : dim }));
  return out;
}

const pretty = (k: string) => k.replace(/^Key|^Digit/, "").replace(/(Left|Right)$/, "").replace("Control", "Ctrl").replace("Arrow", "");

export function appMap(): Pick<PadMapPayload, "page" | "buttons" | "hint"> {
  const { process, filter } = useAppPage.getState();
  const pack = appPack(process);
  const app = (process ?? "").replace(/\.exe$/i, "");
  if (!pack) return { page: app || t("pads.app.title"), buttons: {}, hint: process ? t("pads.app.none", { app }) : t("pads.app.waiting") };
  const buttons: PadMapPayload["buttons"] = {};
  appShortcuts(pack, filter).forEach((l, i) => (buttons[slotButton(i)] = { label: l.label, color: categoryColor(pack, l.category) }));
  categories(pack).forEach((c, i) => (buttons[top(i)] = { label: c, color: categoryColor(pack, c), b: filter === c ? 1 : 0.4 }));
  return { page: `${pack.name}${filter ? ` · ${filter}` : ""}`, buttons, hint: t("pads.app.hint") };
}

/** Input on the App page. */
export function appInput(id: PadButtonId, down: boolean) {
  if (!down) return;
  const b = parseButton(id);
  if (!b) return;
  const { process, filter } = useAppPage.getState();
  const pack = appPack(process);
  if (!pack) {
    bus.emit("hud", { title: t("pads.app.title"), value: process ? t("pads.app.none", { app: process.replace(/\.exe$/i, "") }) : t("pads.app.waiting"), icon: "info", durationMs: 1800 });
    return;
  }
  if (b.kind === "t") {
    const c = categories(pack)[b.x];
    if (c) useAppPage.setState({ filter: filter === c ? null : c });
    return;
  }
  if (b.kind !== "g") return;
  const l = appShortcuts(pack, filter)[b.y * GRID + b.x];
  if (!l) return;
  void press(l.keys);
  bus.emit("hud", { title: l.label, value: l.keys.map(pretty).join(" + "), icon: "keyboard", color: categoryColor(pack, l.category), durationMs: 900 });
}
