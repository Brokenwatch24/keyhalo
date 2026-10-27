import { useEffect, type ReactNode } from "react";
import { Command, Keyboard, Mouse, Palette, Type, WandSparkles, type LucideIcon } from "lucide-react";
import { toast } from "@/ui";
import { t } from "@/i18n";
import { useSettings } from "@/core/state/settings";
import { REPO_URL } from "@/core/community";
import type { CatalogEntry, CatalogKind, SupportStatus } from "@/core/types";

/** Display order of kinds in the gallery ("Featured" sort) and the kind filter. */
export const KIND_ORDER: CatalogKind[] = ["profile", "effect", "keymap", "device", "typing"];

export const KIND_ICON: Record<CatalogKind, LucideIcon> = {
  profile: Palette,
  effect: WandSparkles,
  keymap: Command,
  device: Keyboard,
  typing: Type,
};

export function KindIcon({ kind, entry }: { kind: CatalogKind; entry?: Pick<CatalogEntry, "tags"> }) {
  if (kind === "device" && entry?.tags?.includes("mouse")) return <Mouse />;
  const Icon = KIND_ICON[kind];
  return <Icon />;
}

export const STATUS_TONE: Record<SupportStatus, "success" | "info" | "warning"> = {
  verified: "success",
  community: "info",
  experimental: "warning",
};

/** GitHub mark (lucide has no brand icons). */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export async function copyText(text: string, message = t("community.page.copied")) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(t("community.page.copyFailed"), "danger");
  }
}

/** "3 min ago" / "hace 3 min". */
export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const lang = useSettings.getState().settings.language;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const s = (then - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

export function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime()) || d.getTime() === 0) return "";
  return d.toLocaleDateString(useSettings.getState().settings.language, { year: "numeric", month: "short", day: "numeric" });
}

export const githubBlobUrl = (path: string) => `${REPO_URL}/blob/main/${path.replace(/^\/+/, "")}`;

/** Small labelled value used in detail views. */
export function Meta({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="community-meta">
      <div className="community-meta__label">{label}</div>
      <div className="community-meta__value">{children}</div>
    </div>
  );
}

/** Stable pleasant hue from a string (placeholder tints). */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * `?lang=en|es` (query string or after the hash) switches the UI language for this visit
 * without saving it — used for README screenshots, like the Typing page.
 */
export function useLangParam() {
  useEffect(() => {
    const q = window.location.hash.split("?")[1];
    const lang = new URLSearchParams(window.location.search).get("lang") ?? (q ? new URLSearchParams(q).get("lang") : null);
    if (lang === "en" || lang === "es") useSettings.setState((s) => ({ settings: { ...s.settings, language: lang } }));
  }, []);
}
