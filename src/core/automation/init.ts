import type { Rule, Trigger } from "@/core/types";
import { backend } from "@/core/backend";
import { useDevices } from "@/core/devices/store";
import { acquireInputListening } from "@/core/stats/input";
import { acquireSystemMetrics, onSystemMetrics } from "@/core/integrations/system";
import { mqttSubscribe } from "@/core/integrations/mqtt";
import { onGameEvent } from "@/core/integrations/games";
import { registerHotkey } from "@/core/integrations/hotkeys";
import { bus } from "@/core/util/bus";
import { executeAction } from "./actions";
import { setRuleRunner, useRules, type RunLogEntry } from "./store";
import { describeTrigger, TriggerEvaluator, type EngineEvent } from "./triggers";

const evaluator = new TriggerEvaluator();
const lastFired = new Map<string, number>();

/** Run a rule's actions (respecting the cooldown unless manual) and log the result. */
async function runRule(rule: Rule, reason: string, manual: boolean): Promise<RunLogEntry> {
  const now = Date.now();
  lastFired.set(rule.id, now);
  let error: string | undefined;
  for (const a of rule.actions) {
    try {
      await executeAction(a);
    } catch (e) {
      error = `${a.type}: ${String((e as Error)?.message ?? e)}`;
    }
  }
  return useRules.getState().pushLog({ ruleId: rule.id, ruleName: rule.name, at: now, reason, manual, ok: !error, error });
}

/** Feed an event to the engine (exported for tests / the UI's simulator). */
export function dispatch(ev: EngineEvent) {
  for (const rule of useRules.getState().rules) {
    if (!rule.enabled) continue;
    if (!evaluator.evaluate(rule, ev)) continue;
    const last = lastFired.get(rule.id) ?? 0;
    if (rule.cooldown && Date.now() - last < rule.cooldown * 1000) continue;
    runRule(rule, describeTrigger(rule.trigger), false).catch((e) => console.warn("[automation] rule failed", e));
  }
}

/** Run an enabled rule by id or (case-insensitive) name — used by the API `rule` action. */
export function fireRuleByName(name: string): boolean {
  const n = name.trim().toLowerCase();
  const rule = useRules.getState().rules.find((r) => r.enabled && (r.id.toLowerCase() === n || r.name.trim().toLowerCase() === n));
  if (!rule) return false;
  runRule(rule, `API rule "${name}"`, false);
  return true;
}

let started = false;

/** Called once at startup (see src/core/init.ts). */
export async function init(): Promise<void> {
  if (started) return;
  started = true;
  setRuleRunner(runRule);
  await useRules.getState().hydrate();

  // --- Always-on cheap sources -----------------------------------------------------------------
  await backend.on("foreground-changed", (fg) => dispatch({ type: "focus", process: fg.process }));
  setInterval(() => dispatch({ type: "time", now: new Date() }), 15_000);
  await backend.on("api-action", ({ action, params }) => {
    if (action === "rule") {
      const name = typeof params?.name === "string" ? params.name : typeof params?.id === "string" ? params.id : "";
      if (name) fireRuleByName(name);
    }
    dispatch({ type: "api", event: action });
  });
  onGameEvent((game, event) => dispatch({ type: "game", game, event }));
  bus.on("notification:received", (n) => dispatch({ type: "notification", app: `${n.app}\n${n.appId}`, text: `${n.title}\n${n.body}` }));

  const batterySnapshot = () => {
    const ds = useDevices.getState();
    for (const d of ds.devices) {
      const b = ds.live[d.uid]?.battery;
      if (b && !b.charging) dispatch({ type: "battery", uid: d.uid, definitionId: d.definition.id, name: d.definition.name, percent: b.percent });
    }
  };
  useDevices.subscribe((s, p) => s.live !== p.live && batterySnapshot());

  // --- Sources that cost something: only while an enabled rule needs them -----------------------
  let lastInput = Date.now();
  let releaseInput: (() => void) | null = null;
  let unInput: (() => void)[] = [];
  let idleTimer: ReturnType<typeof setInterval> | undefined;

  let releaseMetrics: (() => void) | null = null;
  let unMetrics: (() => void) | null = null;

  let procTimer: ReturnType<typeof setInterval> | undefined;
  let knownProcs: Set<string> | null = null;

  let mqttUnsubs: (() => void)[] = [];
  let hotkeyUnsubs: (() => void)[] = [];
  let hotkeyGen = 0;

  const needs = (type: Trigger["type"]) => useRules.getState().rules.filter((r) => r.enabled && r.trigger.type === type);

  const sync = async () => {
    // Idle (needs the input hook to know when the user last did something).
    const idle = needs("idle").length > 0;
    if (idle && !releaseInput) {
      releaseInput = acquireInputListening();
      lastInput = Date.now();
      const bump = () => (lastInput = Date.now());
      unInput = [await backend.on("input-key", bump), await backend.on("input-mouse", bump)];
      idleTimer = setInterval(() => dispatch({ type: "idle", idleMs: Date.now() - lastInput }), 15_000);
    } else if (!idle && releaseInput) {
      releaseInput();
      releaseInput = null;
      unInput.forEach((u) => u());
      unInput = [];
      clearInterval(idleTimer);
    }

    // CPU / GPU temperature.
    const metrics = needs("cpuAbove").length + needs("gpuTempAbove").length > 0;
    if (metrics && !releaseMetrics) {
      releaseMetrics = acquireSystemMetrics();
      unMetrics = onSystemMetrics((m) => {
        const t = Date.now();
        dispatch({ type: "cpu", percent: m.cpuLoad, t });
        if (m.gpu) dispatch({ type: "gpuTemp", celsius: m.gpu.temp, t });
      });
    } else if (!metrics && releaseMetrics) {
      releaseMetrics();
      releaseMetrics = null;
      unMetrics?.();
      unMetrics = null;
    }

    // App launch: poll the process list every 3 s.
    const launch = needs("appLaunch").length > 0;
    if (launch && !procTimer) {
      knownProcs = null;
      const poll = async () => {
        const list = await backend.processes().catch(() => null);
        if (!list) return;
        const now = new Set(list.map((p) => p.toLowerCase()));
        if (knownProcs) for (const p of list) if (!knownProcs.has(p.toLowerCase())) dispatch({ type: "launch", process: p });
        knownProcs = now;
      };
      poll();
      procTimer = setInterval(poll, 3_000);
    } else if (!launch && procTimer) {
      clearInterval(procTimer);
      procTimer = undefined;
    }

    // MQTT topics on the configured broker.
    mqttUnsubs.forEach((u) => u());
    const topics = [...new Set(needs("mqtt").map((r) => (r.trigger as Extract<Trigger, { type: "mqtt" }>).topic))];
    mqttUnsubs = topics.map((topic) => mqttSubscribe(topic, (tp, payload) => dispatch({ type: "mqtt", topic: tp, payload })));

    // Global hotkeys (desktop app only).
    hotkeyUnsubs.forEach((u) => u());
    hotkeyUnsubs = [];
    const gen = ++hotkeyGen;
    const accels = [...new Set(needs("hotkey").map((r) => (r.trigger as Extract<Trigger, { type: "hotkey" }>).accelerator))];
    for (const accel of accels) {
      registerHotkey(accel, () => dispatch({ type: "hotkey", accelerator: accel }))
        .then((un) => (gen === hotkeyGen ? hotkeyUnsubs.push(un) : un()))
        .catch((e) => console.warn(`[automation] hotkey ${accel} unavailable`, e));
    }
  };

  useRules.subscribe((s, p) => {
    if (s.rules === p.rules) return;
    // Edited/disabled rules start with fresh memory.
    const before = new Map(p.rules.map((r) => [r.id, JSON.stringify(r)]));
    for (const r of s.rules) if (before.get(r.id) !== JSON.stringify(r)) evaluator.reset(r.id);
    sync().catch((e) => console.warn("[automation] sync failed", e));
  });
  await sync();
  batterySnapshot();
}
