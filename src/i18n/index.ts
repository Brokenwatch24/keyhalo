import { useSettings } from "@/core/state/settings";

/**
 * Tiny i18n: dictionaries live in src/i18n/<lang>/<namespace>.json and are addressed as
 * t("<namespace>.<path>"). Each feature owns its own namespace file, so features never
 * edit each other's strings. Missing Spanish strings fall back to English.
 */
type Dict = { [k: string]: string | Dict };

const modules = import.meta.glob<Dict>("./*/*.json", { eager: true, import: "default" });
const dicts: Record<string, Dict> = {};
for (const [path, dict] of Object.entries(modules)) {
  const m = /^\.\/(\w+)\/([\w-]+)\.json$/.exec(path);
  if (!m) continue;
  (dicts[m[1]] ??= {})[m[2]] = dict;
}

export type Lang = "en" | "es";

function lookup(lang: string, key: string): string | undefined {
  let node: string | Dict | undefined = dicts[lang];
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = lookup(lang, key) ?? lookup("en", key) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Non-reactive translate using the current language (for toasts, services). */
export function t(key: string, vars?: Record<string, string | number>) {
  return translate(useSettings.getState().settings.language, key, vars);
}

/** Reactive translate hook for components. */
export function useT() {
  const lang = useSettings((s) => s.settings.language);
  return (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
