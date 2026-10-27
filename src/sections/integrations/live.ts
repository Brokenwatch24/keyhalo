import { useEffect } from "react";
import { create } from "zustand";
import { backend, type SystemMetrics } from "@/core/backend";
import { onSystemMetrics, useIntegrations, handleGsi, setClaudeState, unreadCounts, UNREAD_APPS } from "@/core/integrations";
import { useSignals } from "@/core/lighting/signals";

// ---------------------------------------------------------------------------
// System metrics history (kept while the app runs, for sparklines)
// ---------------------------------------------------------------------------

const MAX = 90;

export interface MetricsHistory {
  last: SystemMetrics | null;
  cpu: number[];
  cpuTemp: number[];
  gpu: number[];
  gpuTemp: number[];
  ram: number[];
  vram: number[];
}

export const useMetricsHistory = create<MetricsHistory>(() => ({
  last: null,
  cpu: [],
  cpuTemp: [],
  gpu: [],
  gpuTemp: [],
  ram: [],
  vram: [],
}));

const push = (arr: number[], v: number | undefined) => (v === undefined || !Number.isFinite(v) ? arr : [...arr.slice(-(MAX - 1)), v]);

let wired = false;
/** Start recording metric samples (idempotent). Samples only arrive while something polls. */
export function wireMetricsHistory() {
  if (wired) return;
  wired = true;
  onSystemMetrics((m) => {
    const h = useMetricsHistory.getState();
    useMetricsHistory.setState({
      last: m,
      cpu: push(h.cpu, m.cpuLoad),
      cpuTemp: push(h.cpuTemp, m.cpuTemp),
      gpu: push(h.gpu, m.gpu?.load),
      gpuTemp: push(h.gpuTemp, m.gpu?.temp),
      ram: push(h.ram, m.ramTotalMb ? (m.ramUsedMb / m.ramTotalMb) * 100 : undefined),
      vram: push(h.vram, m.gpu?.vramTotalMb ? (m.gpu.vramUsedMb / m.gpu.vramTotalMb) * 100 : undefined),
    });
  });
}

// ---------------------------------------------------------------------------
// Unread badges detected right now (works even while the integration is off)
// ---------------------------------------------------------------------------

export const useUnreadNow = create<{ counts: Record<string, number> | null }>(() => ({ counts: null }));

export function useUnreadPolling(active = true) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const poll = async () => {
      try {
        const counts = unreadCounts(await backend.windows(), UNREAD_APPS);
        if (alive) useUnreadNow.setState({ counts });
      } catch {
        /* not available */
      }
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Browser demo: a little life for the panels that need hardware or a game
// ---------------------------------------------------------------------------

let demoStarted = false;

/** In the browser demo: set a Claude state and feed a simulated CS2 match while the page is open. */
export function useDemoLife() {
  useEffect(() => {
    if (backend.kind !== "mock") return;
    if (!demoStarted) {
      demoStarted = true;
      if (!useSignals.getState().claude && useIntegrations.getState().config.claude.enabled) setClaudeState("working");
    }
    let tick = 0;
    const feed = () => {
      const cfg = useIntegrations.getState().config.games;
      if (!cfg.enabled || !cfg.cs2) return;
      tick++;
      const cycle = tick % 40;
      const health = Math.max(35, 100 - Math.round(cycle * 2.2));
      const clip = 30 - (tick % 31);
      handleGsi("cs2", {
        provider: { steamid: "1" },
        map: { phase: "live" },
        round: { phase: cycle < 3 ? "freezetime" : "live" },
        player: {
          steamid: "1",
          state: {
            health,
            armor: Math.max(0, 100 - cycle * 2),
            flashed: 0,
            burning: 0,
          },
          weapons: {
            weapon_1: {
              name: "weapon_ak47",
              state: "active",
              ammo_clip: clip,
              ammo_clip_max: 30,
            },
          },
        },
      });
    };
    feed();
    const id = setInterval(feed, 1500);
    return () => clearInterval(id);
  }, []);
}
