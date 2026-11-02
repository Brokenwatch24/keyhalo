import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { askText } from "@/core/prompt";
import { grid, GRID, parseButton, top } from "./launchpad";
import { usePads } from "./store";
import type { PadButtonId, PadMapPayload, PadPage, PadTask } from "./types";

/**
 * Tasks page: a checklist, one task per pad. Amber = to do, dim green = done. Tap toggles done,
 * hold edits (an empty text deletes), an empty pad asks for a new task. Top: ▲ new task in the
 * next free pad, ▼ clear the done ones.
 */
export const TASK_COLOR = "#ffb000";
export const DONE_COLOR = "#3ccf4e";
export const TASK_NEW = top(0);
export const TASK_CLEAR = top(1);

const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));
const tasksOf = (pageId: string) => usePads.getState().board.pages.find((p) => p.id === pageId)?.tasks ?? [];

export function setTasks(pageId: string, fn: (tasks: PadTask[]) => PadTask[]) {
  usePads.getState().updatePage(pageId, { tasks: fn(tasksOf(pageId)) });
}

export function freeTaskSlot(tasks: PadTask[]): number {
  const used = new Set(tasks.map((x) => x.slot));
  for (let i = 0; i < GRID * GRID; i++) if (!used.has(i)) return i;
  return -1;
}

export function addTask(pageId: string, text: string, slot?: number) {
  const s = slot ?? freeTaskSlot(tasksOf(pageId));
  if (!text.trim() || s < 0) return;
  setTasks(pageId, (ts) => [...ts.filter((x) => x.slot !== s), { id: Math.random().toString(36).slice(2, 10), text: text.trim(), done: false, slot: s }]);
}

export async function newTask(pageId: string, slot?: number) {
  const s = slot ?? freeTaskSlot(tasksOf(pageId));
  if (s < 0) return;
  const text = await askText({ title: t("pads.tasks.new"), placeholder: t("pads.tasks.placeholder") });
  if (text) addTask(pageId, text, s);
}

export async function editTask(pageId: string, task: PadTask) {
  const text = await askText({ title: t("pads.tasks.edit"), value: task.text, hint: t("pads.tasks.editHint") });
  if (text === null) return;
  setTasks(pageId, (ts) => (text.trim() ? ts.map((x) => (x.id === task.id ? { ...x, text: text.trim() } : x)) : ts.filter((x) => x.id !== task.id)));
}

export function taskLeds(page: PadPage, dim: number): Map<PadButtonId, { hex: string; b: number }> {
  const out = new Map<PadButtonId, { hex: string; b: number }>();
  const tasks = page.tasks ?? [];
  for (const x of tasks) out.set(slotButton(x.slot), x.done ? { hex: DONE_COLOR, b: dim } : { hex: TASK_COLOR, b: 1 });
  out.set(TASK_NEW, { hex: DONE_COLOR, b: dim });
  if (tasks.some((x) => x.done)) out.set(TASK_CLEAR, { hex: "#ff3b30", b: dim });
  return out;
}

export function taskMap(page: PadPage): Pick<PadMapPayload, "buttons" | "list" | "hint"> {
  const tasks = [...(page.tasks ?? [])].sort((a, b) => Number(a.done) - Number(b.done) || a.slot - b.slot);
  const buttons: PadMapPayload["buttons"] = {
    [TASK_NEW]: { label: t("pads.tasks.add"), color: DONE_COLOR },
    [TASK_CLEAR]: { label: t("pads.tasks.clearDone"), color: "#ff3b30" },
  };
  for (const x of tasks) buttons[slotButton(x.slot)] = { label: x.text, color: x.done ? DONE_COLOR : TASK_COLOR };
  return {
    buttons,
    list: tasks.map((x) => ({ button: slotButton(x.slot), label: x.text, color: x.done ? DONE_COLOR : TASK_COLOR, done: x.done })),
    hint: tasks.length ? t("pads.tasks.mapHint") : t("pads.tasks.mapEmpty"),
  };
}

const HOLD_MS = 600;
const holds = new Map<PadButtonId, ReturnType<typeof setTimeout>>();
const fired = new Set<PadButtonId>();

/** Input on a Tasks page. */
export function taskInput(page: PadPage, id: PadButtonId, down: boolean) {
  const b = parseButton(id);
  if (!b) return;
  if (b.kind === "t") {
    if (!down) return;
    if (id === TASK_NEW) void newTask(page.id);
    if (id === TASK_CLEAR) {
      const n = (page.tasks ?? []).filter((x) => x.done).length;
      setTasks(page.id, (ts) => ts.filter((x) => !x.done));
      if (n) bus.emit("hud", { title: t("pads.tasks.cleared", { n }), icon: "info", color: DONE_COLOR, durationMs: 1000 });
    }
    return;
  }
  if (b.kind !== "g") return;
  const slot = b.y * GRID + b.x;
  const task = (page.tasks ?? []).find((x) => x.slot === slot);
  if (down) {
    fired.delete(id);
    if (task)
      holds.set(
        id,
        setTimeout(() => {
          fired.add(id);
          void editTask(page.id, task);
        }, HOLD_MS),
      );
    return;
  }
  clearTimeout(holds.get(id));
  holds.delete(id);
  if (fired.has(id)) return;
  if (!task) {
    void newTask(page.id, slot);
    return;
  }
  setTasks(page.id, (ts) => ts.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)));
  bus.emit("hud", { title: task.done ? t("pads.tasks.pending") : `✓ ${t("pads.tasks.done")}`, value: task.text, icon: "info", color: task.done ? TASK_COLOR : DONE_COLOR, durationMs: 1000 });
}
