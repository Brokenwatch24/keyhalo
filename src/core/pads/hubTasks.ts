import { create } from "zustand";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { askText } from "@/core/prompt";
import { hub, hubConfig, useHub, type HubTask } from "@/core/integrations/hub";
import { pgo, platiaConfig, usePlatiaGo, type PgoTodo } from "@/core/integrations/platiago";
import { activePage } from "./store";
import { grid, GRID, parseButton, top } from "./launchpad";
import type { PadButtonId, PadMapPayload, PadPage } from "./types";

/**
 * Tasks page with your to-dos from BrokenWatchHub (kept by HILO, the same list as on the glasses)
 * and Platia GO (synced to the iPhone and the device), in one list.
 * Red = overdue, amber = has a date, lime = the rest. Tap marks it done (a few seconds to tap
 * again and undo, HILO has no "undo"), hold shows it in full, an empty pad writes a new one
 * (HILO reads the date from the text).
 */
export interface SlotTask extends HubTask {
  slot: number;
  /** Where it lives: marking it done goes back there. */
  origin: "hilo" | "platia";
}

type Origin = SlotTask["origin"];

interface HubTasksState {
  status: "idle" | "ok" | "error";
  error?: string;
  items: SlotTask[];
  /** Marked done, waiting out the undo window: id → when it is sent. */
  closing: Record<string, number>;
}

export const useHubTasks = create<HubTasksState>(() => ({ status: "idle", items: [], closing: {} }));

export const HUB_NEW = top(0);
export const HUB_REFRESH = top(1);
const UNDO_MS = 4000;
const OVERDUE = "#ff3b30";
const DATED = "#ffb000";
const PLAIN = "#a8e04d";
const DONE = "#3ccf4e";

/** A Tasks page shows your synced to-dos when set to, or by default when BrokenWatchHub or Platia GO is installed. */
export const isHubPage = (page: PadPage | undefined) =>
  page?.kind === "tasks" && (page.source === "hub" || (page.source === undefined && (useHub.getState().installed === true || usePlatiaGo.getState().installed === true)));

/** Where new to-dos go: the page's choice, else HILO when BrokenWatchHub is there, else Platia GO. */
export function newTasksTarget(page: PadPage | undefined): Origin {
  const hilo = useHub.getState().installed === true;
  const platia = usePlatiaGo.getState().installed === true;
  if (page?.newTasksTo === "platia" && platia) return "platia";
  if (page?.newTasksTo === "hilo" && hilo) return "hilo";
  return hilo ? "hilo" : "platia";
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

/** A Platia GO to-do in the same shape as HILO's. */
export function fromPlatia(x: PgoTodo, now = Date.now()): HubTask & { origin: Origin } {
  const at = x.due ? Date.parse(x.due) : NaN;
  return { id: x.id, kind: "Platia GO", title: x.title, full: x.title, who: null, due: Number.isFinite(at) ? day(x.due!) : (x.due_text ?? null), overdue: Number.isFinite(at) && at < now, conversationId: null, origin: "platia" };
}

const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));
export const hubColor = (x: HubTask) => (x.overdue ? OVERDUE : x.due ? DATED : PLAIN);

/** Each to-do keeps its pad while it is open; new ones take the free pads. */
export function placeHubTasks(prev: SlotTask[], list: (HubTask & { origin?: Origin })[]): SlotTask[] {
  const slots = new Map(prev.map((x) => [x.id, x.slot]));
  const used = new Set<number>();
  const out: SlotTask[] = [];
  for (const x of list) {
    const s = slots.get(x.id);
    if (s !== undefined && !used.has(s)) {
      used.add(s);
      out.push({ ...x, origin: x.origin ?? "hilo", slot: s });
    }
  }
  let next = 0;
  for (const x of list) {
    if (out.some((o) => o.id === x.id)) continue;
    while (used.has(next)) next++;
    if (next >= GRID * GRID) break;
    used.add(next);
    out.push({ ...x, origin: x.origin ?? "hilo", slot: next });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

let loading = false;
export async function refreshHubTasks() {
  if (loading) return;
  loading = true;
  try {
    const [hilo, platia] = await Promise.allSettled([
      hubConfig().then((c) => (c ? hub.tasks() : null)),
      platiaConfig().then((c) => (c ? pgo.todos() : null)),
    ]);
    const list: (HubTask & { origin: Origin })[] = [];
    if (hilo.status === "fulfilled" && Array.isArray(hilo.value)) list.push(...hilo.value.map((x) => ({ ...x, origin: "hilo" as const })));
    if (platia.status === "fulfilled" && Array.isArray(platia.value)) list.push(...platia.value.filter((x) => !x.done).map((x) => fromPlatia(x)));
    const failed = [hilo, platia].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length && !list.length) throw failed[0].reason;
    useHubTasks.setState({ status: "ok", error: failed.length ? String((failed[0].reason as Error)?.message ?? failed[0].reason) : undefined, items: placeHubTasks(useHubTasks.getState().items, list) });
  } catch (e) {
    useHubTasks.setState({ status: "error", error: String((e as Error)?.message ?? e) });
  } finally {
    loading = false;
  }
}

function hud(title: string, value?: string, color = DONE, durationMs = 1400) {
  bus.emit("hud", { title, value, icon: "info", color, durationMs });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tap a to-do: done after a few seconds, unless you tap it again. */
export function toggleHubTask(x: SlotTask) {
  const closing = { ...useHubTasks.getState().closing };
  if (closing[x.id]) {
    clearTimeout(timers.get(x.id));
    timers.delete(x.id);
    delete closing[x.id];
    useHubTasks.setState({ closing });
    hud(t("pads.hub.undone"), x.title, hubColor(x));
    return;
  }
  closing[x.id] = Date.now() + UNDO_MS;
  useHubTasks.setState({ closing });
  hud(`✓ ${t("pads.tasks.done")}`, `${x.title}\n${t("pads.hub.undoHint")}`, DONE, UNDO_MS);
  timers.set(
    x.id,
    setTimeout(async () => {
      timers.delete(x.id);
      try {
        if (x.origin === "platia") await pgo.setDone(x.id, true);
        else await hub.done(x.id);
      } catch (e) {
        hud(t("pads.hub.failed"), String((e as Error)?.message ?? e), OVERDUE, 3000);
      }
      const rest = { ...useHubTasks.getState().closing };
      delete rest[x.id];
      useHubTasks.setState({ closing: rest, items: useHubTasks.getState().items.filter((i) => i.id !== x.id) });
      void refreshHubTasks();
    }, UNDO_MS),
  );
}

export async function newHubTask(): Promise<void> {
  const text = await askText({ title: t("pads.tasks.new"), placeholder: t("pads.hub.placeholder"), hint: t("pads.hub.captureHint") });
  if (!text?.trim()) return;
  try {
    if (newTasksTarget(activePage()) === "platia") {
      const r = await pgo.addTodo(text.trim());
      hud(`+ ${r.title}`, "Platia GO", PLAIN);
    } else {
      const r = await hub.capture(text.trim());
      hud(`+ ${r.title}`, r.kind, PLAIN);
    }
    await refreshHubTasks();
  } catch (e) {
    hud(t("pads.hub.failed"), String((e as Error)?.message ?? e), OVERDUE, 3000);
  }
}

const details = (x: HubTask) => [x.kind, x.who, x.due].filter(Boolean).join(" · ");

export function hubLeds(dim: number, now = performance.now()): Map<PadButtonId, { hex: string; b: number }> {
  const out = new Map<PadButtonId, { hex: string; b: number }>();
  const { items, closing } = useHubTasks.getState();
  for (const x of items) out.set(slotButton(x.slot), closing[x.id] ? { hex: DONE, b: Math.floor(now / 250) % 2 ? 1 : 0.15 } : { hex: hubColor(x), b: 1 });
  out.set(HUB_NEW, { hex: DONE, b: dim });
  out.set(HUB_REFRESH, { hex: "#ffe14d", b: dim });
  return out;
}

export function hubMap(): Pick<PadMapPayload, "buttons" | "list" | "hint"> {
  const { items, closing, status, error } = useHubTasks.getState();
  const buttons: PadMapPayload["buttons"] = {
    [HUB_NEW]: { label: t("pads.tasks.add"), color: DONE },
    [HUB_REFRESH]: { label: t("pads.hub.refresh"), color: "#ffe14d" },
  };
  for (const x of items) buttons[slotButton(x.slot)] = { label: x.title, color: closing[x.id] ? DONE : hubColor(x) };
  return {
    buttons,
    list: items.map((x) => ({ button: slotButton(x.slot), label: x.title, sub: details(x), color: closing[x.id] ? DONE : hubColor(x), done: !!closing[x.id] })),
    hint: status === "error" ? t("pads.hub.error", { error: error ?? "" }) : items.length ? t("pads.hub.mapHint") : t("pads.hub.mapEmpty"),
  };
}

const HOLD_MS = 600;
const holds = new Map<PadButtonId, ReturnType<typeof setTimeout>>();
const fired = new Set<PadButtonId>();

/** Input on a Tasks page showing HILO's to-dos. */
export function hubInput(id: PadButtonId, down: boolean) {
  const b = parseButton(id);
  if (!b) return;
  if (b.kind === "t") {
    if (!down) return;
    if (id === HUB_NEW) void newHubTask();
    if (id === HUB_REFRESH) {
      hud(t("pads.hub.refreshing"), undefined, "#ffe14d", 800);
      void refreshHubTasks();
    }
    return;
  }
  if (b.kind !== "g") return;
  const x = useHubTasks.getState().items.find((i) => i.slot === b.y * GRID + b.x);
  if (down) {
    fired.delete(id);
    if (x)
      holds.set(
        id,
        setTimeout(() => {
          fired.add(id);
          hud(x.full || x.title, details(x), hubColor(x), 5000);
        }, HOLD_MS),
      );
    return;
  }
  clearTimeout(holds.get(id));
  holds.delete(id);
  if (fired.has(id)) return;
  if (x) toggleHubTask(x);
  else void newHubTask();
}
