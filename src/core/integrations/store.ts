import { create } from "zustand";
import { loadJson, saveJsonDebounced } from "@/core/state/persist";
import { DEFAULT_INTEGRATIONS, mergeConfig, type IntegrationId, type IntegrationsConfig } from "./config";

export type IntegrationState = "idle" | "connecting" | "connected" | "error";

export interface IntegrationStatus {
  state: IntegrationState;
  /** Human message (English) or detail from the backend. */
  message?: string;
  since: number;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface IntegrationsState {
  config: IntegrationsConfig;
  status: Partial<Record<IntegrationId, IntegrationStatus>>;
  loaded: boolean;
  hydrate(): Promise<void>;
  /** Patch one integration's config (persisted, applied immediately). */
  update<K extends keyof IntegrationsConfig>(id: K, patch: Partial<IntegrationsConfig[K]>): void;
  setStatus(id: IntegrationId, state: IntegrationState, message?: string): void;
  /** Run the integration's connection test, if it has one. */
  test(id: IntegrationId): Promise<TestResult>;
}

const tests = new Map<IntegrationId, () => Promise<TestResult>>();

/** Modules register their `test()` here. */
export function registerTest(id: IntegrationId, fn: () => Promise<TestResult>) {
  tests.set(id, fn);
}

export const useIntegrations = create<IntegrationsState>((set, get) => ({
  config: mergeConfig(null),
  status: {},
  loaded: false,

  async hydrate() {
    const saved = await loadJson<Partial<IntegrationsConfig>>("integrations.json");
    set({ config: mergeConfig(saved), loaded: true });
  },

  update(id, patch) {
    const config = { ...get().config, [id]: { ...get().config[id], ...patch } };
    set({ config });
    saveJsonDebounced("integrations.json", config);
  },

  setStatus(id, state, message) {
    const cur = get().status[id];
    if (cur && cur.state === state && cur.message === message) return;
    set({ status: { ...get().status, [id]: { state, message, since: Date.now() } } });
  },

  async test(id) {
    const fn = tests.get(id);
    if (!fn) return { ok: true, message: "Nothing to test" };
    try {
      return await fn();
    } catch (e) {
      return { ok: false, message: String((e as Error)?.message ?? e) };
    }
  },
}));

export { DEFAULT_INTEGRATIONS };

/** Subscribe to one integration's config; calls `apply` now and on every change. */
export function watchConfig<K extends keyof IntegrationsConfig>(id: K, apply: (cfg: IntegrationsConfig[K]) => void): () => void {
  apply(useIntegrations.getState().config[id]);
  return useIntegrations.subscribe((s, p) => {
    if (s.config[id] !== p.config[id]) apply(s.config[id]);
  });
}
