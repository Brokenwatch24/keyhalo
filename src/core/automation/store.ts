import { create } from "zustand";
import type { Rule } from "@/core/types";
import { loadJson, saveJsonDebounced } from "@/core/state/persist";
import { exampleRules } from "./examples";
import { riskyRuleActions, validateRule } from "./validate";

export interface RunLogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  /** ms epoch */
  at: number;
  /** What fired it (English summary of the trigger or "manual test"). */
  reason: string;
  manual: boolean;
  ok: boolean;
  error?: string;
}

export interface RuleImportResult {
  ok: boolean;
  rules: Rule[];
  errors: string[];
  /** http / mqttPublish actions the user should review (imported rules are added disabled). */
  risky: ReturnType<typeof riskyRuleActions>;
}

export interface RulesState {
  rules: Rule[];
  /** Last 50 firings, newest first. */
  log: RunLogEntry[];
  loaded: boolean;
  hydrate(): Promise<void>;
  /** Add a rule (id generated when missing). Returns the stored rule. */
  add(rule: Omit<Rule, "id"> & { id?: string }): Rule;
  update(id: string, patch: Partial<Omit<Rule, "id">>): void;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  duplicate(id: string): Rule | null;
  /** Import a rule or an array of rules (JSON). Imported rules are disabled until the user enables them. */
  importRules(json: string | unknown): RuleImportResult;
  /** Export some (default all) rules as JSON. */
  exportRules(ids?: string[]): string;
  /** Fire a rule's actions now (ignores enabled/cooldown). */
  testRule(id: string): Promise<RunLogEntry | null>;
  clearLog(): void;
  /** Internal: append to the run log. */
  pushLog(entry: Omit<RunLogEntry, "id">): RunLogEntry;
}

const FILE = "rules.json";
const newId = () => `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Runner = (rule: Rule, reason: string, manual: boolean) => Promise<RunLogEntry>;
let runner: Runner | null = null;
/** Set by the engine (init.ts) so the store can run rules without an import cycle. */
export function setRuleRunner(r: Runner) {
  runner = r;
}

export const useRules = create<RulesState>((set, get) => {
  const persist = () => saveJsonDebounced(FILE, { version: 1, rules: get().rules });
  const setRules = (rules: Rule[]) => {
    set({ rules });
    persist();
  };
  return {
    rules: [],
    log: [],
    loaded: false,

    async hydrate() {
      const saved = await loadJson<{ version?: number; rules?: Rule[] } | Rule[]>(FILE);
      const list = Array.isArray(saved) ? saved : saved?.rules;
      if (!list) {
        set({ rules: exampleRules(), loaded: true });
        persist();
        return;
      }
      set({ rules: list.filter((r) => validateRule(r).length === 0), loaded: true });
    },

    add(rule) {
      const r: Rule = { ...rule, id: rule.id && !get().rules.some((x) => x.id === rule.id) ? rule.id : newId() } as Rule;
      setRules([...get().rules, r]);
      return r;
    },
    update(id, patch) {
      setRules(get().rules.map((r) => (r.id === id ? { ...r, ...patch, id } : r)));
    },
    remove(id) {
      setRules(get().rules.filter((r) => r.id !== id));
    },
    setEnabled(id, enabled) {
      get().update(id, { enabled });
    },
    duplicate(id) {
      const src = get().rules.find((r) => r.id === id);
      if (!src) return null;
      return get().add({ ...JSON.parse(JSON.stringify(src)), id: undefined, name: `${src.name} (copy)`, enabled: false });
    },

    importRules(json) {
      let value: unknown = json;
      if (typeof json === "string") {
        try {
          value = JSON.parse(json);
        } catch (e) {
          return { ok: false, rules: [], errors: [`Invalid JSON: ${(e as Error).message}`], risky: [] };
        }
      }
      const raw = Array.isArray(value) ? value : (value as { rules?: unknown[] })?.rules ?? [value];
      const errors: string[] = [];
      const valid: Rule[] = [];
      raw.forEach((r, i) => {
        const candidate = { id: newId(), ...(r as object) };
        const errs = validateRule(candidate);
        if (errs.length) errors.push(...errs.map((e) => `#${i + 1}: ${e}`));
        else valid.push(candidate as Rule);
      });
      if (errors.length) return { ok: false, rules: [], errors, risky: [] };
      const added = valid.map((r) => get().add({ ...r, enabled: false }));
      return { ok: true, rules: added, errors: [], risky: riskyRuleActions(added) };
    },
    exportRules(ids) {
      const rules = ids ? get().rules.filter((r) => ids.includes(r.id)) : get().rules;
      return JSON.stringify({ version: 1, rules }, null, 2) + "\n";
    },

    async testRule(id) {
      const rule = get().rules.find((r) => r.id === id);
      if (!rule || !runner) return null;
      return runner(rule, "manual test", true);
    },
    clearLog() {
      set({ log: [] });
    },
    pushLog(entry) {
      const e: RunLogEntry = { ...entry, id: `${entry.at}-${Math.random().toString(36).slice(2, 6)}` };
      set({ log: [e, ...get().log].slice(0, 50) });
      return e;
    },
  };
});
