import type { Rule, Trigger } from "@/core/types";

/**
 * Pure trigger evaluation. Event sources (focus changes, a minute clock, battery, idle time,
 * metrics, MQTT, API, games, hotkeys) feed `EngineEvent`s; `TriggerEvaluator` decides which
 * rules fire, keeping the small amount of per-rule memory needed for "once per crossing",
 * "sustained for 10 s" and "once per minute" semantics.
 */
export type EngineEvent =
  | { type: "focus"; process: string }
  | { type: "launch"; process: string }
  | { type: "time"; now: Date }
  | { type: "battery"; uid: string; definitionId?: string; name?: string; percent: number }
  | { type: "idle"; idleMs: number }
  | { type: "cpu"; percent: number; t: number }
  | { type: "gpuTemp"; celsius: number; t: number }
  | { type: "mqtt"; topic: string; payload: string }
  | { type: "api"; event: string }
  | { type: "game"; game: string; event: string }
  | { type: "hotkey"; accelerator: string }
  | { type: "notification"; app: string; text: string };

/** Which event type feeds each trigger type. */
export const TRIGGER_EVENT: Record<Trigger["type"], EngineEvent["type"]> = {
  appFocus: "focus",
  appLaunch: "launch",
  time: "time",
  batteryBelow: "battery",
  idle: "idle",
  cpuAbove: "cpu",
  gpuTempAbove: "gpuTemp",
  mqtt: "mqtt",
  api: "api",
  game: "game",
  hotkey: "hotkey",
  notification: "notification",
};

export const SUSTAIN_MS = 10_000;
/** Battery must rise this many points above the threshold to re-arm. */
export const BATTERY_HYSTERESIS = 2;

const normProc = (p: string) => {
  const s = p.trim().toLowerCase();
  return s.endsWith(".exe") ? s : `${s}.exe`;
};

export function processMatches(pattern: string, process: string): boolean {
  if (!pattern.trim()) return false;
  return normProc(pattern) === normProc(process);
}

/** "HH:MM" + optional weekdays (0 = Sunday … 6 = Saturday). */
export function timeMatches(trigger: { at: string; days?: number[] }, now: Date): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(trigger.at.trim());
  if (!m) return false;
  if (Number(m[1]) !== now.getHours() || Number(m[2]) !== now.getMinutes()) return false;
  return !trigger.days?.length || trigger.days.includes(now.getDay());
}

export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= t.length) return false;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** Payload match: empty = any, "/regex/flags" = regular expression, otherwise substring (case-insensitive). */
export function payloadMatches(match: string | undefined, payload: string): boolean {
  if (!match) return true;
  const re = /^\/(.+)\/([gimsuy]*)$/.exec(match);
  if (re) {
    try {
      return new RegExp(re[1], re[2].replace("g", "")).test(payload);
    } catch {
      return false;
    }
  }
  return payload.toLowerCase().includes(match.toLowerCase());
}

/** Case-insensitive "contains"; an empty needle matches anything. */
export function includesCi(haystack: string, needle: string | undefined): boolean {
  const n = needle?.trim().toLocaleLowerCase();
  return !n || haystack.toLocaleLowerCase().includes(n);
}

export function normalizeAccelerator(a: string): string {
  const alias: Record<string, string> = { control: "ctrl", cmdorctrl: "ctrl", commandorcontrol: "ctrl", option: "alt", super: "meta", win: "meta", cmd: "meta", command: "meta" };
  const parts = a
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => alias[p] ?? p);
  const mods = ["ctrl", "shift", "alt", "meta"].filter((m) => parts.includes(m));
  const rest = parts.filter((p) => !mods.includes(p));
  return [...mods, ...rest].join("+");
}

interface Memory {
  armed?: Record<string, boolean>;
  since?: number | null;
  fired?: boolean;
  lastMinute?: string;
}

export class TriggerEvaluator {
  private mem = new Map<string, Memory>();

  private m(id: string): Memory {
    let v = this.mem.get(id);
    if (!v) this.mem.set(id, (v = {}));
    return v;
  }

  /** Forget memory (after a rule is edited / disabled). */
  reset(ruleId?: string) {
    if (ruleId) this.mem.delete(ruleId);
    else this.mem.clear();
  }

  /** True when `rule` should fire for `ev` (does not check `enabled` or cooldowns). */
  evaluate(rule: Rule, ev: EngineEvent): boolean {
    const tr = rule.trigger;
    if (TRIGGER_EVENT[tr.type] !== ev.type) return false;
    const mem = this.m(rule.id);
    switch (tr.type) {
      case "appFocus":
        return ev.type === "focus" && processMatches(tr.process, ev.process);
      case "appLaunch":
        return ev.type === "launch" && processMatches(tr.process, ev.process);
      case "time": {
        if (ev.type !== "time" || !timeMatches(tr, ev.now)) return false;
        const key = `${ev.now.toDateString()} ${tr.at}`;
        if (mem.lastMinute === key) return false;
        mem.lastMinute = key;
        return true;
      }
      case "batteryBelow": {
        if (ev.type !== "battery") return false;
        if (tr.device) {
          const d = tr.device.toLowerCase();
          const ok = ev.uid.toLowerCase() === d || ev.definitionId?.toLowerCase() === d || Boolean(ev.name?.toLowerCase().includes(d));
          if (!ok) return false;
        }
        mem.armed ??= {};
        const armed = mem.armed[ev.uid] ?? true;
        if (ev.percent < tr.percent && armed) {
          mem.armed[ev.uid] = false;
          return true;
        }
        if (ev.percent >= tr.percent + BATTERY_HYSTERESIS) mem.armed[ev.uid] = true;
        return false;
      }
      case "idle": {
        if (ev.type !== "idle") return false;
        const limit = tr.minutes * 60_000;
        if (ev.idleMs < limit) {
          mem.fired = false;
          return false;
        }
        if (mem.fired) return false;
        mem.fired = true;
        return true;
      }
      case "cpuAbove":
      case "gpuTempAbove": {
        const value = ev.type === "cpu" ? ev.percent : ev.type === "gpuTemp" ? ev.celsius : NaN;
        const t = ev.type === "cpu" || ev.type === "gpuTemp" ? ev.t : 0;
        const limit = tr.type === "cpuAbove" ? tr.percent : tr.celsius;
        if (!(value > limit)) {
          mem.since = null;
          mem.fired = false;
          return false;
        }
        mem.since ??= t;
        if (mem.fired || t - mem.since < SUSTAIN_MS) return false;
        mem.fired = true;
        return true;
      }
      case "mqtt":
        return ev.type === "mqtt" && topicMatches(tr.topic, ev.topic) && payloadMatches(tr.match, ev.payload);
      case "api":
        return ev.type === "api" && ev.event.toLowerCase() === tr.event.trim().toLowerCase();
      case "game":
        return ev.type === "game" && ev.game === tr.game && ev.event === tr.event;
      case "hotkey":
        return ev.type === "hotkey" && normalizeAccelerator(ev.accelerator) === normalizeAccelerator(tr.accelerator);
      case "notification":
        return ev.type === "notification" && includesCi(ev.app, tr.app) && includesCi(ev.text, tr.contains);
    }
  }
}

/** Short English description of a trigger (UI should prefer i18n `automation.triggers.*`). */
export function describeTrigger(tr: Trigger): string {
  switch (tr.type) {
    case "appFocus":
      return `${tr.process} focused`;
    case "appLaunch":
      return `${tr.process} launched`;
    case "time":
      return `at ${tr.at}${tr.days?.length ? ` on ${tr.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}` : ""}`;
    case "batteryBelow":
      return `battery below ${tr.percent}%${tr.device ? ` (${tr.device})` : ""}`;
    case "idle":
      return `idle for ${tr.minutes} min`;
    case "cpuAbove":
      return `CPU above ${tr.percent}% for 10 s`;
    case "gpuTempAbove":
      return `GPU above ${tr.celsius}°C for 10 s`;
    case "mqtt":
      return `MQTT ${tr.topic}${tr.match ? ` ~ ${tr.match}` : ""}`;
    case "api":
      return `API action "${tr.event}"`;
    case "game":
      return `${tr.game}: ${tr.event}`;
    case "hotkey":
      return `hotkey ${tr.accelerator}`;
    case "notification":
      return `notification${tr.app ? ` from ${tr.app}` : ""}${tr.contains ? ` containing "${tr.contains}"` : ""}`;
  }
}
