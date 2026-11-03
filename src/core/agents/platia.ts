import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { pgo, type PgoTask } from "@/core/integrations/platiago";
import { freeSlot, type AgentSession, type AgentState } from "./sessions";

/**
 * Platia GO's background tasks as pads on the Agents page (yellow): they breathe while they work
 * and blink when one waits for your approval. On a waiting pad: tap approves once, double tap
 * denies, hold approves for the whole task (when the task allows it).
 */
export const PLATIA_COLOR = "#ffe14d";
/** Finished tasks stay on their pad this long. */
const KEEP_MS = 30 * 60_000;

const ACTIVE = new Set(["running", "waiting_approval", "waiting_you"]);

function stateOf(x: PgoTask): { state: AgentState; message?: string } {
  const a = x.pending_approval;
  switch (x.status) {
    case "running":
      return { state: "working", message: x.activity || undefined };
    case "waiting_approval":
      return { state: "waiting", message: a ? [a.title, a.what].filter(Boolean).join(": ") : x.activity };
    case "waiting_you":
      return { state: "done", message: x.activity || undefined };
    case "failed":
      return { state: "done", message: `✕ ${(x.result || x.activity || "").slice(0, 160)}` };
    default:
      return { state: "done", message: (x.result || x.output_tail || "").replace(/\s+/g, " ").trim().slice(-160) || undefined };
  }
}

/** Merge Platia GO's task list into the sessions: one pad per task, kept while active or recently done. */
export function mergePlatiaTasks(sessions: AgentSession[], tasks: PgoTask[], now: number): AgentSession[] {
  const shown = tasks.filter((x) => ACTIVE.has(x.status) || (x.status !== "cancelled" && x.ended_at && now - Date.parse(x.ended_at) < KEEP_MS));
  const keys = new Set(shown.map((x) => `pgo-${x.task_id}`));
  let out = sessions.filter((s) => s.via !== "platia" || keys.has(s.key));
  for (const x of shown) {
    const key = `pgo-${x.task_id}`;
    const { state, message } = stateOf(x);
    const approval = x.pending_approval ? { id: x.pending_approval.id, canTask: !!x.pending_approval.can_allow_for_task } : undefined;
    const s = out.find((o) => o.key === key);
    if (!s) {
      const slot = freeSlot(out);
      if (slot < 0) break;
      out = [...out, { key, id: x.task_id, via: "platia", kind: x.engine, cwd: x.cwd, title: x.title, state, message, approval, seen: state === "working", slot, startedAt: Date.parse(x.started_at) || now, updatedAt: now }];
      continue;
    }
    const changed = s.state !== state || s.approval?.id !== approval?.id;
    out = out.map((o) => (o === s ? { ...o, title: x.title, cwd: x.cwd, state, message, approval, seen: changed ? state === "working" : o.seen, updatedAt: changed ? now : o.updatedAt } : o));
  }
  return out;
}

const DOUBLE_TAP_MS = 320;
const HOLD_MS = 600;
let tap: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
let hold: { key: string; timer: ReturnType<typeof setTimeout>; fired: boolean } | null = null;

function hud(title: string, value?: string, color = PLATIA_COLOR, durationMs = 1600) {
  bus.emit("hud", { title, value, icon: "info", color, durationMs });
}

async function answer(s: AgentSession, allow: boolean, scope: "once" | "task") {
  if (!s.approval) return;
  try {
    await pgo.answer(s.id!, s.approval.id, allow, scope);
    hud(allow ? (scope === "task" ? t("pads.platia.allowedTask") : t("pads.platia.allowed")) : t("pads.platia.denied"), s.message, allow ? "#3ccf4e" : "#ff3b30");
  } catch (e) {
    hud(t("pads.platia.failed"), String((e as Error)?.message ?? e), "#ff3b30", 3000);
  }
}

/** A Platia GO pad was pressed or released on the Agents page. */
export function platiaInput(s: AgentSession, down: boolean, markSeen: (key: string) => void) {
  if (s.state !== "waiting" || !s.approval) {
    if (down) {
      markSeen(s.key);
      hud(s.title || "Platia GO", s.message || t(`pads.agents.states.${s.state}`));
    }
    return;
  }
  if (down) {
    hold = {
      key: s.key,
      fired: false,
      timer: setTimeout(() => {
        if (!hold) return;
        hold.fired = true;
        markSeen(s.key);
        void answer(s, true, s.approval?.canTask ? "task" : "once");
      }, HOLD_MS),
    };
    return;
  }
  const h = hold;
  hold = null;
  if (h) clearTimeout(h.timer);
  if (!h || h.fired) return;
  if (tap?.key === s.key) {
    clearTimeout(tap.timer);
    tap = null;
    markSeen(s.key);
    void answer(s, false, "once");
    return;
  }
  if (tap) clearTimeout(tap.timer);
  tap = {
    key: s.key,
    timer: setTimeout(() => {
      tap = null;
      markSeen(s.key);
      void answer(s, true, "once");
    }, DOUBLE_TAP_MS),
  };
}
