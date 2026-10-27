import { create } from "zustand";
import type { InputStats } from "@/core/types";
import { backend } from "@/core/backend";
import { loadJson, saveJson } from "@/core/state/persist";
import { dayKey, emptyStats } from "./metrics";
import { seedDay } from "./seed";

export interface LifetimeStats {
  keys: number;
  clicks: number;
  mouseMeters: number;
  peakWpm: number;
  /** First day counted (yyyy-mm-dd). */
  since: string;
}

export interface BatterySample {
  /** ms epoch */
  t: number;
  uid: string;
  name: string;
  percent: number;
  charging: boolean;
}

export interface LiveSample {
  t: number;
  wpm: number;
  apm: number;
}

export interface StatsState {
  /** Today's counters (updated ~4×/s while input stats are on). */
  today: InputStats;
  /** Loaded past days keyed by yyyy-mm-dd (see loadHistory). */
  history: Record<string, InputStats>;
  lifetime: LifetimeStats;
  /** Live words / actions per minute (rolling 10 s). */
  wpm: number;
  apm: number;
  /** Last 60 s of live samples (1 per second) for charts. */
  series: LiveSample[];
  /** Battery history (last 7 days, one sample per device every 5 min). */
  battery: BatterySample[];
  /** True while counting (settings.inputStats). */
  active: boolean;
  /** Lazily load the last `days` days (oldest → newest, today included). */
  loadHistory(days?: number): Promise<InputStats[]>;
  /** Battery samples of one device, oldest first. */
  batteryOf(uid: string): BatterySample[];
  /** Delete every stats file (today, history, lifetime, battery). */
  clearAll(): Promise<void>;
}

export const emptyLifetime = (): LifetimeStats => ({ keys: 0, clicks: 0, mouseMeters: 0, peakWpm: 0, since: dayKey() });

export const useStats = create<StatsState>((set, get) => ({
  today: emptyStats(dayKey()),
  history: {},
  lifetime: emptyLifetime(),
  wpm: 0,
  apm: 0,
  series: [],
  battery: [],
  active: false,

  async loadHistory(days = 14) {
    const out: InputStats[] = [];
    const history = { ...get().history };
    const now = new Date();
    for (let i = days - 1; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = dayKey(d);
      if (!history[key]) {
        const saved = await loadJson<InputStats>(`stats/${key}.json`);
        history[key] = saved ?? (backend.kind === "mock" ? seedDay(key) : emptyStats(key));
      }
      out.push(history[key]);
    }
    out.push(get().today);
    set({ history });
    return out;
  },

  batteryOf: (uid) => get().battery.filter((b) => b.uid === uid),

  async clearAll() {
    const names = await backend.storageList("stats").catch(() => [] as string[]);
    await Promise.all(names.map((n) => backend.storageDelete(`stats/${n}`).catch(() => {})));
    set({ today: emptyStats(dayKey()), history: {}, lifetime: emptyLifetime(), battery: [], series: [] });
    await saveJson("stats/lifetime.json", get().lifetime).catch(() => {});
    clearHooks.forEach((h) => h());
  },
}));

/** Internal: lets the engine reset its working copies when the user clears stats. */
export const clearHooks = new Set<() => void>();
