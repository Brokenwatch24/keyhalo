import { create } from "zustand";
import type { KeyCode, TypingResult } from "../types";
import { loadJson, saveJsonDebounced } from "../state/persist";
import { initialAdaptive, updateAdaptive, unlockNext, type AdaptiveState } from "./adaptive";
import type { KeyLocale } from "./charmap";
import type { Lang } from "./generate";
import { dayKey, mergeKeys, slimResult, type KeyAgg, type TestSettings, type TypingMode } from "./progress";
import type { Keystroke } from "./session";

/**
 * Typing trainer store. History is loaded lazily the first time the section opens.
 * Files: typing/prefs.json, typing/history.json (last 500, slimmed), typing/progress.json
 * (personal bests with replays, daily time, aggregated key stats, adaptive progress).
 */

export interface TypingPrefs {
  mode: TypingMode;
  language: Lang;
  /** Physical layout used to attribute characters to keys ("auto" = from OS language). */
  locale: KeyLocale | "auto";
  test: TestSettings;
  stopOnError: boolean;
  lightKeyboard: boolean;
  fingerGuide: boolean;
  showKeyboard: boolean;
  targetWpm: number;
  ghost: boolean;
  codeLang: string;
  shortcutSource: string;
  customText: string;
}

export const DEFAULT_PREFS: TypingPrefs = {
  mode: "adaptive",
  language: typeof navigator !== "undefined" && navigator.language?.startsWith("es") ? "es" : "en",
  locale: "auto",
  test: { kind: "time", time: 30, words: 25, punctuation: false, numbers: false },
  stopOnError: false,
  lightKeyboard: true,
  fingerGuide: false,
  showKeyboard: true,
  targetWpm: 35,
  ghost: false,
  codeLang: "all",
  shortcutSource: "",
  customText: "",
};

export const HISTORY_LIMIT = 500;

interface Progress {
  bests: Record<string, TypingResult>;
  /** Day → ms practised. */
  daily: Record<string, number>;
  /** Language → key code → aggregate. */
  keys: Record<string, Record<KeyCode, KeyAgg>>;
  adaptive: Partial<Record<Lang, AdaptiveState>>;
}

interface TypingState extends Progress {
  loaded: boolean;
  prefs: TypingPrefs;
  history: TypingResult[];
  load(): Promise<void>;
  setPrefs(patch: Partial<TypingPrefs>): void;
  setTest(patch: Partial<TestSettings>): void;
  /** Store a finished run. Returns whether it is a new personal best and any unlocked letter. */
  record(result: TypingResult, opts: { configKey?: string; strokes?: Keystroke[] }): { best: boolean; previousBest?: number; unlocked?: string };
  adaptiveFor(lang: Lang): AdaptiveState;
  resetAdaptive(lang: Lang): void;
  unlockNext(lang: Lang): void;
  clearHistory(): void;
}

let loading: Promise<void> | null = null;

export const useTyping = create<TypingState>((set, get) => {
  const saveProgress = () => {
    const { bests, daily, keys, adaptive } = get();
    saveJsonDebounced("typing/progress.json", { bests, daily, keys, adaptive } satisfies Progress, 400);
  };
  return {
    loaded: false,
    prefs: DEFAULT_PREFS,
    history: [],
    bests: {},
    daily: {},
    keys: {},
    adaptive: {},

    load: () =>
      (loading ??= (async () => {
        const [prefs, history, progress] = await Promise.all([
          loadJson<Partial<TypingPrefs>>("typing/prefs.json"),
          loadJson<TypingResult[]>("typing/history.json"),
          loadJson<Partial<Progress>>("typing/progress.json"),
        ]);
        set({
          loaded: true,
          prefs: { ...DEFAULT_PREFS, ...prefs, test: { ...DEFAULT_PREFS.test, ...prefs?.test } },
          history: Array.isArray(history) ? history.slice(-HISTORY_LIMIT) : [],
          bests: progress?.bests ?? {},
          daily: progress?.daily ?? {},
          keys: progress?.keys ?? {},
          adaptive: progress?.adaptive ?? {},
        });
      })()),

    setPrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch };
      set({ prefs });
      saveJsonDebounced("typing/prefs.json", prefs);
    },
    setTest: (patch) => get().setPrefs({ test: { ...get().prefs.test, ...patch } }),

    record: (result, opts) => {
      const s = get();
      const history = [...s.history, slimResult(result)].slice(-HISTORY_LIMIT);
      const day = dayKey(new Date(result.date));
      const daily = { ...s.daily, [day]: (s.daily[day] ?? 0) + result.durationMs };
      const keys = { ...s.keys, [result.language]: mergeKeys(s.keys[result.language] ?? {}, result.keys) };
      let best = false;
      let previousBest: number | undefined;
      const bests = { ...s.bests };
      // A personal best needs a meaningful run: at least 90 % accuracy.
      if (opts.configKey && result.accuracy >= 0.9) {
        previousBest = bests[opts.configKey]?.wpm;
        if (previousBest === undefined || result.wpm > previousBest) {
          bests[opts.configKey] = result;
          best = true;
        }
      }
      let unlocked: string | undefined;
      const adaptive = { ...s.adaptive };
      if (result.mode === "adaptive" && opts.strokes && (result.language === "en" || result.language === "es")) {
        const lang = result.language as Lang;
        const r = updateAdaptive(adaptive[lang] ?? initialAdaptive(), opts.strokes, lang, s.prefs.targetWpm);
        adaptive[lang] = r.state;
        unlocked = r.unlocked;
      }
      set({ history, daily, keys, bests, adaptive });
      saveJsonDebounced("typing/history.json", history, 800);
      saveProgress();
      return { best, previousBest, unlocked };
    },

    adaptiveFor: (lang) => get().adaptive[lang] ?? initialAdaptive(),
    resetAdaptive: (lang) => {
      set({ adaptive: { ...get().adaptive, [lang]: initialAdaptive() } });
      saveProgress();
    },
    unlockNext: (lang) => {
      set({ adaptive: { ...get().adaptive, [lang]: unlockNext(get().adaptiveFor(lang), lang) } });
      saveProgress();
    },
    clearHistory: () => {
      set({ history: [], bests: {}, daily: {}, keys: {} });
      saveJsonDebounced("typing/history.json", [], 0);
      saveProgress();
    },
  };
});

export function resolveLocale(prefs: TypingPrefs): KeyLocale {
  if (prefs.locale !== "auto") return prefs.locale;
  const lang = typeof navigator !== "undefined" ? navigator.language : "en-US";
  if (prefs.language === "es" || /^es/i.test(lang)) return /^es-ES/i.test(lang) ? "es-ES" : /^es/i.test(lang) ? "es-LA" : "us";
  return "us";
}
