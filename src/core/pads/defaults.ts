import { grid } from "./launchpad";
import type { PadAction, PadBoard, PadDef, PadPage } from "./types";

/** Category colours that read well on red/green LEDs. */
export const PAD_COLORS = {
  ai: "#ff7a00",
  app: "#ffb000",
  web: "#3ccf4e",
  system: "#ffe14d",
  media: "#3ccf4e",
  alert: "#ff3b30",
  page: "#ffb000",
} as const;

/** Launchpad S palette for pickers: what its red/green LEDs can show. */
export const PAD_PALETTE = ["#ff3b30", "#ff7a00", "#ffb000", "#ffe14d", "#c8e000", "#3ccf4e", "#8a3a1c", "#4a6a10"];

const pad = (label: string, color: string, action?: PadAction, extra: Partial<PadDef> = {}): PadDef => ({ label, color, action, ...extra });
const app = (path: string, args?: string[]): PadAction => ({ type: "app", path, args });
const store = (aumid: string): PadAction => ({ type: "app", path: "explorer.exe", args: [`shell:AppsFolder\\${aumid}`] });
const url = (u: string): PadAction => ({ type: "url", url: u });
const keys = (...k: string[]): PadAction => ({ type: "keys", keys: k });

function homePage(): PadPage {
  const pads: Record<string, PadDef> = {
    // Row 0 — AI & code
    [grid(0, 0)]: pad("Claude Code", PAD_COLORS.ai, { type: "claude" }, { state: { type: "claude" }, hold: { type: "terminal", command: "claude" } }),
    [grid(1, 0)]: pad("Codex", PAD_COLORS.ai, { type: "terminal", command: "codex" }),
    [grid(2, 0)]: pad("Claude app", PAD_COLORS.ai, store("Claude_pzs8sxrjxfjjc!Claude"), { state: { type: "running", process: "claude.exe" } }),
    [grid(3, 0)]: pad("Cursor", PAD_COLORS.app, { type: "focus", process: "Cursor.exe", fallback: store("com.todesktop.230313mzl4w4u92") }, { state: { type: "running", process: "Cursor.exe" } }),
    [grid(4, 0)]: pad("Terminal", PAD_COLORS.app, app("wt.exe")),
    [grid(5, 0)]: pad("Chrome", PAD_COLORS.app, { type: "focus", process: "chrome.exe", fallback: store("Chrome") }, { state: { type: "running", process: "chrome.exe" } }),
    [grid(6, 0)]: pad("Explorer", PAD_COLORS.app, app("explorer.exe")),
    [grid(7, 0)]: pad("KeyHalo", PAD_COLORS.app, { type: "focus", process: "keyhalo.exe" }),
    // Row 1 — web
    [grid(0, 1)]: pad("Gmail", PAD_COLORS.web, url("https://mail.google.com")),
    [grid(1, 1)]: pad("Calendar", PAD_COLORS.web, url("https://calendar.google.com")),
    [grid(2, 1)]: pad("Drive", PAD_COLORS.web, url("https://drive.google.com")),
    [grid(3, 1)]: pad("GitHub", PAD_COLORS.web, url("https://github.com")),
    [grid(4, 1)]: pad("claude.ai", PAD_COLORS.web, url("https://claude.ai")),
    [grid(5, 1)]: pad("ChatGPT", PAD_COLORS.web, url("https://chatgpt.com")),
    [grid(6, 1)]: pad("YouTube", PAD_COLORS.web, url("https://youtube.com")),
    [grid(7, 1)]: pad("WhatsApp Web", PAD_COLORS.web, url("https://web.whatsapp.com")),
    // Row 2 — messages (blink while a notification waits; press to open and mark as seen)
    [grid(0, 2)]: pad("Discord", "#ffb000", { type: "focus", process: "Discord.exe", fallback: store("com.squirrel.Discord.Discord") }, { state: { type: "notification", ruleId: "discord" } }),
    [grid(1, 2)]: pad("WhatsApp", "#3ccf4e", { type: "focus", process: "WhatsApp.exe", fallback: url("https://web.whatsapp.com") }, { state: { type: "notification", ruleId: "whatsapp" } }),
    [grid(2, 2)]: pad("Phone", "#ffe14d", { type: "focus", process: "PhoneExperienceHost.exe", fallback: store("Microsoft.YourPhone_8wekyb3d8bbwe!App") }, { state: { type: "notification", ruleId: "phone" } }),
    [grid(3, 2)]: pad("Telegram", "#c8e000", { type: "focus", process: "Telegram.exe" }, { state: { type: "notification", ruleId: "telegram" } }),
    [grid(7, 2)]: pad("Mark all seen", PAD_COLORS.system, { type: "notificationsSeen" }),
    // Row 6 — Windows
    [grid(0, 6)]: pad("Screenshot", PAD_COLORS.system, keys("MetaLeft", "ShiftLeft", "KeyS")),
    [grid(1, 6)]: pad("Clipboard", PAD_COLORS.system, keys("MetaLeft", "KeyV")),
    [grid(2, 6)]: pad("Emoji", PAD_COLORS.system, keys("MetaLeft", "Period")),
    [grid(3, 6)]: pad("Desktop", PAD_COLORS.system, keys("MetaLeft", "KeyD")),
    [grid(4, 6)]: pad("Task Manager", PAD_COLORS.system, keys("ControlLeft", "ShiftLeft", "Escape")),
    [grid(5, 6)]: pad("Settings", PAD_COLORS.system, url("ms-settings:")),
    [grid(6, 6)]: pad("Lock PC", PAD_COLORS.alert, app("rundll32.exe", ["user32.dll,LockWorkStation"])),
    [grid(7, 6)]: pad("Microphone", "#3ccf4e", { type: "mic" }, { state: { type: "mic" } }),
    // Row 7 — media & volume
    [grid(0, 7)]: pad("Previous", PAD_COLORS.media, { type: "media", command: "prev" }),
    [grid(1, 7)]: pad("Play / Pause", PAD_COLORS.media, { type: "media", command: "playPause" }, { state: { type: "media" } }),
    [grid(2, 7)]: pad("Next", PAD_COLORS.media, { type: "media", command: "next" }),
    [grid(4, 7)]: pad("Volume −", PAD_COLORS.system, { type: "volume", process: "master", step: -0.1 }),
    [grid(5, 7)]: pad("Volume +", PAD_COLORS.system, { type: "volume", process: "master", step: 0.1 }),
    [grid(6, 7)]: pad("Mute", PAD_COLORS.alert, { type: "volume", process: "master", mute: true }),
    [grid(7, 7)]: pad("Like (Spotify)", "#3ccf4e", { type: "appKeys", process: "Spotify.exe", keys: ["AltLeft", "ShiftLeft", "KeyB"] }),
  };
  return { id: "home", name: "Home", color: PAD_COLORS.page, kind: "grid", pads };
}

function mixerPage(): PadPage {
  return { id: "mixer", name: "Mixer", color: "#3ccf4e", kind: "mixer", pads: {}, mixer: ["master", "Spotify.exe", "Discord.exe", "chrome.exe", "", "", "", ""] };
}

function blankPage(): PadPage {
  return { id: "work", name: "Work", color: "#ff7a00", kind: "grid", pads: {} };
}

/** Processes that need the Launchpad for themselves (globs: * = anything). */
export const DEFAULT_RELEASE_FOR = ["Ableton Live*", "FL64.exe", "FL.exe", "Bitwig Studio.exe", "reaper.exe", "Studio One.exe", "Cubase*.exe", "Reason.exe", "Maschine 2.exe"];

export function defaultBoard(): PadBoard {
  return { version: 1, pages: [homePage(), mixerPage(), blankPage()], port: "", releaseFor: DEFAULT_RELEASE_FOR, mapHotkey: "", hud: true };
}
