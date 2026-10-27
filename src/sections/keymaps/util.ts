import { useEffect } from "react";
import type { KeyAction, KeyBinding, KeymapPack, ModifierName } from "@/core/types";
import { comboFromKeys, keyLabel, sortMods } from "@/core/keymaps";
import { toast } from "@/ui";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const clonePack = (p: KeymapPack): KeymapPack => JSON.parse(JSON.stringify(p)) as KeymapPack;

/** First letter (or digit) of a pack/app name, for the rounded app-icon placeholder. */
export function initialOf(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return (m?.[0] ?? "?").toUpperCase();
}

export function slugify(s: string, fallback = "pack"): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || fallback
  );
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Display parts for a trigger: ["Ctrl", "Shift", "P"]. */
export function bindingParts(b: Pick<KeyBinding, "key" | "with">): string[] {
  return [...sortMods(b.with ?? []).map((m) => (m === "Meta" ? "Win" : m)), keyLabel(b.key)];
}

/** Display parts for a legend / chord key list. */
export function keysParts(keys: string[]): string[] {
  const c = comboFromKeys(keys);
  if (!c) return [];
  return [...c.mods.map((m) => (m === "Meta" ? "Win" : m)), keyLabel(c.key)];
}

export const modsLabel = (mods: ModifierName[]) => mods.map((m) => (m === "Meta" ? "Win" : m)).join("+");

export async function copyText(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(okMessage);
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a user-picked file as text. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

/** `?theme=light|dark` forces a theme while the page is open (README screenshots). */
export function useThemeQuery() {
  useEffect(() => {
    const fromSearch = new URLSearchParams(window.location.search).get("theme");
    const q = window.location.hash.split("?")[1];
    const theme = fromSearch ?? (q ? new URLSearchParams(q).get("theme") : null);
    if (theme !== "light" && theme !== "dark") return;
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (prev) root.setAttribute("data-theme", prev);
      else root.removeAttribute("data-theme");
    };
  }, []);
}

/** Short human summary of a key action, e.g. "Ctrl+Z", "Macro · 4 steps", "Hold layer Nav". */
export function actionSummary(t: Translate, a: KeyAction, layerName?: (id: string) => string, profileName?: (id: string) => string): string {
  switch (a.type) {
    case "key":
      return a.keys.length ? keysParts(a.keys).join("+") : "—";
    case "text":
      return `“${a.text.length > 28 ? a.text.slice(0, 27) + "…" : a.text}”`;
    case "macro":
      return t(a.steps.length === 1 ? "keymaps.ui.summary.macroOne" : "keymaps.ui.summary.macro", { n: a.steps.length });
    case "launch": {
      const base = a.path.split(/[\\/]/).pop() || a.path;
      return t("keymaps.ui.summary.launch", { app: base || "—" });
    }
    case "layer":
      return t(a.mode === "hold" ? "keymaps.ui.summary.layerHold" : "keymaps.ui.summary.layerToggle", { layer: layerName?.(a.layer) ?? a.layer });
    case "tapHold":
      return `${actionSummary(t, a.tap, layerName, profileName)} · ${actionSummary(t, a.hold, layerName, profileName)}`;
    case "mouse":
      return t(`keymaps.ui.mouse.${a.button}`);
    case "dpi":
      return a.mode === "cycle"
        ? t("keymaps.ui.summary.dpiCycle")
        : t(a.mode === "sniper" ? "keymaps.ui.summary.dpiSniper" : "keymaps.ui.summary.dpiSet", { dpi: a.value ?? "—" });
    case "profile":
      return t("keymaps.ui.summary.profile", {
        profile: profileName?.(a.profileId) ?? a.profileId,
      });
    case "media":
      return t(`keymaps.ui.media.${a.command}`);
    case "disabled":
      return t("keymaps.ui.actions.disabled");
  }
}

export const ACTION_TYPES: KeyAction["type"][] = ["key", "text", "macro", "launch", "layer", "tapHold", "mouse", "dpi", "profile", "media", "disabled"];
