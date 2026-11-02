import { create } from "zustand";
import { backend, type RecentSession } from "@/core/backend";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";
import { AGENT_COLORS, folderName, freeSlot, launchAgent, useAgents } from "@/core/agents";
import { grid, GRID, parseButton, top } from "./launchpad";
import { usePads } from "./store";
import type { PadButtonId, PadMapPayload } from "./types";

/**
 * Resume on the Agents page: ◀ lists the recent Claude Code sessions on the pads (and the map),
 * you pick one, then the pad to open it on; it opens in its own folder with `claude --resume`.
 */
export const RESUME_BUTTON = top(2);
const MAX = 32;

type Resume = { step: null } | { step: "session"; items: RecentSession[] } | { step: "pad"; chosen: RecentSession };
export const useResume = create<Resume>(() => ({ step: null }));

const slotButton = (slot: number) => grid(slot % GRID, Math.floor(slot / GRID));
export const recentName = (r: RecentSession) => r.title || folderName(r.cwd);

/** The map was opened for the picker (and is closed again after it). */
let openedMap = false;

export async function startResume() {
  const live = new Set(useAgents.getState().sessions.map((s) => s.id));
  const recent = await backend.agentsRecent(MAX + live.size).catch(() => []);
  const items = recent.filter((r) => !live.has(r.sessionId)).slice(0, MAX);
  if (!items.length) {
    bus.emit("hud", { title: t("pads.agents.resume"), value: t("pads.agents.resumeNone"), icon: "info", color: AGENT_COLORS.claude, durationMs: 1500 });
    return;
  }
  useResume.setState({ step: "session", items });
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
  if (st.step === "session") st.items.forEach((_, i) => out.set(slotButton(i), { hex: AGENT_COLORS.claude, b: i < 8 ? 1 : 2 / 3 }));
  else {
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
  if (!b || b.kind !== "g" || id === RESUME_BUTTON) {
    endResume();
    return true;
  }
  const slot = b.y * GRID + b.x;
  if (st.step === "session") {
    const chosen = st.items[slot];
    if (!chosen) return true;
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
    st.items.forEach((r, i) => (buttons[slotButton(i)] = { label: recentName(r), color: AGENT_COLORS.claude }));
    return {
      page: t("pads.agents.resumePick"),
      buttons,
      list: st.items.map((r, i) => ({ button: slotButton(i), label: recentName(r), sub: `${folderName(r.cwd)} · ${ago(r.updatedAt)}`, color: AGENT_COLORS.claude })),
      hint: t("pads.agents.resumeHint"),
    };
  }
  const used = new Set(useAgents.getState().sessions.map((s) => s.slot));
  const buttons: PadMapPayload["buttons"] = { ...agentButtons, [RESUME_BUTTON]: { label: "✕", color: AGENT_COLORS.claude } };
  for (let i = 0; i < GRID * GRID; i++) if (!used.has(i)) buttons[slotButton(i)] = { label: "+", color: "#3ccf4e" };
  return { page: t("pads.agents.resumePad", { title: recentName(st.chosen) }), buttons, hint: t("pads.agents.resumePadHint") };
}

function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}
