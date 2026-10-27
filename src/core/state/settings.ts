import { create } from "zustand";
import type { Settings } from "@/core/types";
import { loadJson, saveJsonDebounced } from "./persist";

export const DEFAULT_SETTINGS: Settings = {
  language: typeof navigator !== "undefined" && navigator.language?.startsWith("es") ? "es" : "en",
  theme: "system",
  colorVision: "normal",
  reduceFlashing: false,
  safeMode: false,
  startWithWindows: false,
  minimizeToTray: true,
  checkUpdates: true,
  remapEnabled: true,
  remapPauseApps: ["RainbowSix.exe", "RainbowSix_BE.exe", "RainbowSix_Vulkan.exe", "VALORANT-Win64-Shipping.exe", "FortniteClient-Win64-Shipping.exe", "r5apex.exe", "EscapeFromTarkov.exe"],
  inputStats: true,
  api: { enabled: true, port: 27463, token: "" },
  github: {},
  autoSwitchProfiles: true,
  hud: { enabled: true, position: "bottom", durationMs: 1400 },
  cheatsheet: true,
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
  hydrate: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveJsonDebounced("settings.json", settings);
  },
  hydrate: async () => {
    const saved = await loadJson<Partial<Settings>>("settings.json");
    set({ settings: { ...DEFAULT_SETTINGS, ...saved }, loaded: true });
  },
}));

/** Apply theme to <html data-theme>. */
export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
