import { useEffect } from "react";
import { backend, type SystemMetrics } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { registerTest, useIntegrations, watchConfig } from "./store";

/**
 * System monitor: polls `systemMetrics()` while at least one consumer needs it
 * (lighting widgets, dashboard, cpu/gpu automations) and publishes cpu/gpu/ram signals.
 */
let refs = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let enabled = true;
let intervalMs = 1000;
let last: SystemMetrics | null = null;
const listeners = new Set<(m: SystemMetrics) => void>();

async function poll() {
  try {
    const m = await backend.systemMetrics();
    last = m;
    useSignals.getState().set({
      cpu: { load: m.cpuLoad, temp: m.cpuTemp },
      gpu: m.gpu ? { load: m.gpu.load, temp: m.gpu.temp, vramPct: m.gpu.vramTotalMb ? (m.gpu.vramUsedMb / m.gpu.vramTotalMb) * 100 : 0 } : undefined,
      ram: { pct: m.ramTotalMb ? (m.ramUsedMb / m.ramTotalMb) * 100 : 0 },
    });
    listeners.forEach((l) => l(m));
    useIntegrations.getState().setStatus("system", "connected");
  } catch (e) {
    useIntegrations.getState().setStatus("system", "error", String((e as Error)?.message ?? e));
  }
}

function sync() {
  const want = enabled && refs > 0;
  if (want && !timer) {
    poll();
    timer = setInterval(poll, intervalMs);
  } else if (!want && timer) {
    clearInterval(timer);
    timer = undefined;
    useIntegrations.getState().setStatus("system", "idle");
  }
}

/** Start polling system metrics; call the returned function when you no longer need them. */
export function acquireSystemMetrics(): () => void {
  refs++;
  sync();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    refs = Math.max(0, refs - 1);
    sync();
  };
}

/** React hook: keep metrics flowing while mounted. Read values from `useSignals` (cpu/gpu/ram). */
export function useSystemMetrics(active = true) {
  useEffect(() => (active ? acquireSystemMetrics() : undefined), [active]);
}

/** Raw metric samples (used by automations for cpu/gpu triggers). */
export function onSystemMetrics(cb: (m: SystemMetrics) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function lastSystemMetrics(): SystemMetrics | null {
  return last;
}

export function startSystemMonitor() {
  registerTest("system", async () => {
    const m = await backend.systemMetrics();
    return { ok: true, message: `CPU ${Math.round(m.cpuLoad)}%${m.gpu ? ` · ${m.gpu.name} ${Math.round(m.gpu.temp)}°C` : ""}` };
  });
  watchConfig("system", (cfg) => {
    const changed = cfg.intervalMs !== intervalMs;
    enabled = cfg.enabled;
    intervalMs = Math.max(250, cfg.intervalMs || 1000);
    if (changed && timer) {
      clearInterval(timer);
      timer = undefined;
    }
    sync();
  });
}
