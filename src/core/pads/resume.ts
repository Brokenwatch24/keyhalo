import { create } from "zustand";
import { backend, type RecentSession } from "@/core/backend";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { AGENT_COLORS, folderName, freeSlot, launchAgent, openAgent, useAgents } from "@/core/agents";
import { grid, GRID, parseButton, top } from "./launchpad";
import { usePads } from "./store";
import type { PadButtonId, PadMapPayload } from "./types";

/**
 * Resume on the Agents page: ◀ lists the recent Claude Code sessions, 8 at a time on the top row
 * of pads (and on the map); ▲ / ▼ page through them. You pick one, then the pad to open it on; it
 * opens in its own folder with `claude --resume`.
 */
export const RESUME_BUTTON = top(2);
const PREV = top(0);
const NEXT = top(1);
const MAX = 64;
export const RESUME_PAGE = 8;

type Resume = { step: null } | { step: "session"; items: RecentSession[]; page: number } | { step: "pad"; chosen: RecentSession };
export const useResume = create<Resume>(() => ({ step: null }));

const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));
export const recentName = (r: Pick<RecentSession, "title" | "prompt" | "cwd">) => r.title || r.prompt || folderName(r.cwd);
/** The pad session of a recent one that is still open. */
const openSession = (r: RecentSession) => useAgents.getState().sessions.find((s) => s.id === r.sessionId);

/** The map was opened for the picker (and is closed again after it). */
let openedMap = false;

export async function startResume() {
  const items = await backend.agentsRecent(MAX).catch(() => []);
  if (!items.length) {
    bus.emit("hud", { title: t("pads.agents.resume"), value: t("pads.agents.resumeNone"), icon: "info", color: AGENT_COLORS.claude, durationMs: 1500 });
    return;
  }
  useResume.setState({ step: "session", items, page: 0 });
  if (!usePads.getState().mapVisible) {
    openedMap = true;
    usePads.setState({ mapVisible: true });
  }
}

export function endResume() {
  if (useResume.getState().step === null) return;
  useResume.setState({ step: null });
  if (openedMap) usePads.setState({ mapVisible: false });
  openedMap = false;
}

/** LEDs while picking (null when not picking). `agents` = the Agents page as usual. */
export function resumeLeds(now: number, agents: Map<PadButtonId, { hex: string; b: number }>, dim: number): Map<PadButtonId, { hex: string; b: number }> | null {
  const st = useResume.getState();
  if (st.step === null) return null;
  const blink = Math.floor(now / 400) % 2 ? 1 : 0.15;
  const out = new Map<PadButtonId, { hex: string; b: number }>();
  if (st.step === "session") {
    pageItems(st).forEach((r, x) => out.set(grid(x, 0), openSession(r) ? { hex: "#3ccf4e", b: 1 } : { hex: AGENT_COLORS.claude, b: 1 }));
    if (st.page > 0) out.set(PREV, { hex: "#ffe14d", b: 1 });
    if (st.page < pages(st) - 1) out.set(NEXT, { hex: "#ffe14d", b: 1 });
  } else {
    for (const [id, led] of agents) out.set(id, { ...led, b: Math.min(led.b, dim) });
    const used = new Set(useAgents.getState().sessions.map((s) => s.slot));
    for (let i = 0; i < GRID * GRID; i++) if (!used.has(i)) out.set(slotButton(i), { hex: "#3ccf4e", b: blink * dim });
  }
  out.set(RESUME_BUTTON, { hex: AGENT_COLORS.claude, b: blink });
  return out;
}

/** Input while picking; false when not picking (the Agents page handles it). */
export function resumeInput(id: PadButtonId, down: boolean): boolean {
  const st = useResume.getState();
  if (st.step === null) {
    if (down && id === RESUME_BUTTON) void startResume();
    return id === RESUME_BUTTON;
  }
  if (!down) return true;
  const b = parseButton(id);
  if (st.step === "session" && (id === PREV || id === NEXT)) {
    const page = Math.min(Math.max(st.page + (id === NEXT ? 1 : -1), 0), pages(st) - 1);
    useResume.setState({ ...st, page });
    return true;
  }
  if (!b || b.kind !== "g" || id === RESUME_BUTTON) {
    endResume();
    return true;
  }
  const slot = b.y * GRID + b.x;
  if (st.step === "session") {
    if (b.y !== 0) return true;
    const chosen = pageItems(st)[b.x];
    if (!chosen) return true;
    const open = openSession(chosen);
    if (open) {
      // Already open: go there instead of opening it twice.
      endResume();
      void openAgent(open.key).catch(() => {});
      return true;
    }
    useResume.setState({ step: "pad", chosen });
    bus.emit("hud", { title: recentName(chosen), value: t("pads.agents.resumeWhere"), icon: "info", color: AGENT_COLORS.claude, durationMs: 1500 });
    return true;
  }
  if (useAgents.getState().sessions.some((s) => s.slot === slot)) return true;
  const chosen = st.chosen;
  endResume();
  bus.emit("hud", { title: `↻ ${recentName(chosen)}`, value: folderName(chosen.cwd), icon: "info", color: AGENT_COLORS.claude, durationMs: 1500 });
  void launchAgent("claude", chosen.cwd, slot, { id: chosen.sessionId, title: chosen.title }).catch(() => {});
  return true;
}

/** Resume a session from the app (next free pad). */
export function resumeNow(r: RecentSession) {
  const slot = freeSlot(useAgents.getState().sessions);
  if (slot >= 0) void launchAgent("claude", r.cwd, slot, { id: r.sessionId, title: r.title }).catch(() => {});
}

/** The pad map while picking (null when not picking). */
export function resumeMap(agentButtons: PadMapPayload["buttons"]): Pick<PadMapPayload, "page" | "buttons" | "list" | "hint"> | null {
  const st = useResume.getState();
  if (st.step === null) return null;
  if (st.step === "session") {
    const buttons: PadMapPayload["buttons"] = { [RESUME_BUTTON]: { label: "✕", color: AGENT_COLORS.claude } };
    if (st.page > 0) buttons[PREV] = { label: "▲", color: "#ffe14d" };
    if (st.page < pages(st) - 1) buttons[NEXT] = { label: "▼", color: "#ffe14d" };
    const items = pageItems(st);
    items.forEach((r, x) => (buttons[grid(x, 0)] = { label: recentName(r), color: openSession(r) ? "#3ccf4e" : AGENT_COLORS.claude }));
    return {
      page: `${t("pads.agents.resumePick")}  ·  ${st.page + 1}/${pages(st)}`,
      buttons,
      list: items.map((r, x) => {
        const open = !!openSession(r);
        return { button: grid(x, 0), label: recentName(r), sub: `${open ? `● ${t("pads.agents.resumeOpen")} · ` : ""}${folderName(r.cwd)} · ${ago(r.updatedAt)}`, color: open ? "#3ccf4e" : AGENT_COLORS.claude };
      }),
      hint: t(pages(st) > 1 ? "pads.agents.resumeHintPages" : "pads.agents.resumeHint"),
    };
  }
  const used = new Set(useAgents.getState().sessions.map((s) => s.slot));
  const buttons: PadMapPayload["buttons"] = { ...agentButtons, [RESUME_BUTTON]: { label: "✕", color: AGENT_COLORS.claude } };
  for (let i = 0; i < GRID * GRID; i++) if (!used.has(i)) buttons[slotButton(i)] = { label: "+", color: "#3ccf4e" };
  return { page: t("pads.agents.resumePad", { title: recentName(st.chosen) }), buttons, hint: t("pads.agents.resumePadHint") };
}

type Picking = { items: RecentSession[]; page: number };
const pages = (st: Picking) => Math.max(1, Math.ceil(st.items.length / RESUME_PAGE));
const pageItems = (st: Picking) => st.items.slice(st.page * RESUME_PAGE, (st.page + 1) * RESUME_PAGE);

function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}
