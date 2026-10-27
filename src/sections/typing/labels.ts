import type { TypingResult } from "@/core/types";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** Human label for a run configuration: "Test · 30s · EN · punctuation". */
export function describeConfig(t: T, mode: string, config?: string, language?: string): string {
  const parts = [t(`typing.modes.${mode}`)];
  if (config?.startsWith("test:")) {
    const [, amount, lang, ...flags] = config.split(":");
    parts.push(amount.endsWith("s") ? amount : `${amount.slice(0, -1)} ${t("typing.options.words")}`);
    parts.push(lang.toUpperCase());
    if (flags.includes("p")) parts.push(t("typing.options.punctuation"));
    if (flags.includes("n")) parts.push(t("typing.options.numbers"));
  } else if (config && /^(code|shortcuts|fn|fnkeys):/.test(config)) {
    const extra = config.split(":").slice(1).join(":");
    if (extra && extra !== "all" && extra !== "default") parts.push(extra);
  } else if (language && mode !== "code" && mode !== "shortcuts") parts.push(language.toUpperCase());
  return parts.join(" · ");
}

export function resultLabel(t: T, r: TypingResult) {
  return describeConfig(t, r.mode, r.config, r.language);
}

export function formatDate(iso: string, lang: string, withTime = false) {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "es" ? "es" : "en", { month: "short", day: "numeric", year: withTime ? undefined : "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function pct(x: number, digits = 0) {
  return `${(x * 100).toFixed(digits)}%`;
}
