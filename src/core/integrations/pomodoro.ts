import { create } from "zustand";
import { useSignals } from "@/core/lighting/signals";
import { t } from "@/i18n";
import { flash, hud } from "./feedback";
import { useIntegrations } from "./store";

/** Pomodoro timer → `signals.pomodoro`, HUD + flash at phase changes. */
export type PomodoroPhase = "focus" | "break" | "idle";

export interface PomodoroState {
  phase: PomodoroPhase;
  /** ms epoch when the current phase ends (0 when idle). */
  endsAt: number;
  totalMs: number;
  /** Remaining ms while paused (null = running). */
  pausedRemaining: number | null;
  /** Completed focus sessions since start. */
  completed: number;
  /** Long break in progress. */
  long: boolean;
  start(opts?: { focusMin?: number; breakMin?: number }): void;
  stop(): void;
  /** Jump to the next phase now. */
  skip(): void;
  pause(): void;
  resume(): void;
  toggle(): void;
}

let timer: ReturnType<typeof setInterval> | undefined;
let overrides: { focusMin?: number; breakMin?: number } = {};

const cfg = () => useIntegrations.getState().config.pomodoro;
const minutes = (phase: "focus" | "break", long: boolean) =>
  phase === "focus" ? (overrides.focusMin ?? cfg().focusMin) : long ? cfg().longBreakMin : (overrides.breakMin ?? cfg().breakMin);

function publish() {
  const s = usePomodoro.getState();
  if (s.phase === "idle") {
    useSignals.getState().set({ pomodoro: undefined });
    return;
  }
  const remainingMs = s.pausedRemaining ?? Math.max(0, s.endsAt - Date.now());
  useSignals.getState().set({ pomodoro: { phase: s.phase, remainingMs, totalMs: s.totalMs } });
}

function announce(phase: "focus" | "break", long: boolean) {
  const c = cfg();
  const color = phase === "focus" ? "#ff8a65" : "#7ee0a1";
  if (c.flash) flash(color, undefined, 3);
  if (c.hud)
    hud({
      title: t(phase === "focus" ? "integrations.pomodoro.focus" : long ? "integrations.pomodoro.longBreak" : "integrations.pomodoro.break"),
      value: t("integrations.pomodoro.minutes", { min: minutes(phase, long) }),
      icon: "info",
      color,
      durationMs: 3000,
    });
}

function enter(phase: "focus" | "break", long = false) {
  const totalMs = minutes(phase, long) * 60_000;
  usePomodoro.setState({ phase, long, totalMs, endsAt: Date.now() + totalMs, pausedRemaining: null });
  announce(phase, long);
  publish();
}

function tick() {
  const s = usePomodoro.getState();
  if (s.phase === "idle" || s.pausedRemaining !== null) return publish();
  if (Date.now() < s.endsAt) return publish();
  if (s.phase === "focus") {
    const completed = s.completed + 1;
    usePomodoro.setState({ completed });
    const long = completed % Math.max(1, cfg().cyclesBeforeLong) === 0;
    if (cfg().autoContinue) enter("break", long);
    else idleWith("break");
  } else if (cfg().autoContinue) enter("focus");
  else idleWith("focus");
}

function idleWith(next: "focus" | "break") {
  usePomodoro.setState({ phase: "idle", endsAt: 0, pausedRemaining: null });
  hud({ title: t(next === "focus" ? "integrations.pomodoro.breakOver" : "integrations.pomodoro.focusOver"), icon: "info" });
  stopTimer();
  publish();
}

function stopTimer() {
  clearInterval(timer);
  timer = undefined;
}

export const usePomodoro = create<PomodoroState>((set, get) => ({
  phase: "idle",
  endsAt: 0,
  totalMs: 0,
  pausedRemaining: null,
  completed: 0,
  long: false,
  start(opts = {}) {
    overrides = { ...opts };
    set({ completed: 0 });
    enter("focus");
    stopTimer();
    timer = setInterval(tick, 250);
  },
  stop() {
    stopTimer();
    set({ phase: "idle", endsAt: 0, pausedRemaining: null, completed: 0 });
    publish();
  },
  skip() {
    const s = get();
    if (s.phase === "idle") return get().start();
    set({ endsAt: Date.now(), pausedRemaining: null });
    tick();
  },
  pause() {
    const s = get();
    if (s.phase === "idle" || s.pausedRemaining !== null) return;
    set({ pausedRemaining: Math.max(0, s.endsAt - Date.now()) });
    publish();
  },
  resume() {
    const s = get();
    if (s.pausedRemaining === null) return;
    set({ endsAt: Date.now() + s.pausedRemaining, pausedRemaining: null });
    publish();
  },
  toggle() {
    const s = get();
    if (s.phase === "idle") get().start();
    else if (s.pausedRemaining !== null) get().resume();
    else get().pause();
  },
}));

/** Handle API params: {action:"start"|"stop"|"skip"|"pause"|"resume"|"toggle", focusMin?, breakMin?} or {start:true}… */
export function pomodoroCommand(params: Record<string, unknown>) {
  const p = usePomodoro.getState();
  const action = typeof params.action === "string" ? params.action : (["start", "stop", "skip", "pause", "resume", "toggle"].find((k) => params[k]) ?? "start");
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : undefined);
  const opts = { focusMin: n(params.focusMin), breakMin: n(params.breakMin) };
  switch (action) {
    case "stop":
      return p.stop();
    case "skip":
      return p.skip();
    case "pause":
      return p.pause();
    case "resume":
      return p.resume();
    case "toggle":
      return p.toggle();
    default:
      return p.start(opts);
  }
}
