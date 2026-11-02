import { backend, type WindowInfo } from "@/core/backend";
import type { MacroStep } from "@/core/types";
import { toggleMic } from "@/core/integrations/mic";
import { clearNotifications } from "@/core/integrations/notifications";
import { bus } from "@/core/util/bus";
import { usePads } from "./store";
import type { PadAction } from "./types";

/** Terminals Claude Code usually runs in. */
const TERMINALS = ["windowsterminal.exe", "openconsole.exe", "conhost.exe", "cursor.exe", "code.exe", "wezterm-gui.exe", "alacritty.exe", "warp.exe"];
/** Claude Code sets the terminal title to "<spinner> <task>" (✳ ✶ ✻ ✽ ✢ · ◐◓◑◒ braille dots…). */
const CLAUDE_TITLE = /^[✳✶✻✽✢·◐-◓⠀-⣿*]\s|claude code/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lower = (s: string) => s.toLowerCase();

/** The window Claude Code runs in, if any. */
export function findClaudeWindow(windows: WindowInfo[]): WindowInfo | undefined {
  const terms = windows.filter((w) => TERMINALS.includes(lower(w.process)));
  return terms.find((w) => CLAUDE_TITLE.test(w.title));
}

async function focusProcess(process: string): Promise<boolean> {
  const p = lower(process.endsWith(".exe") ? process : `${process}.exe`);
  const w = (await backend.windows()).find((x) => lower(x.process) === p);
  return w ? backend.focusWindow(w.pid, w.title) : false;
}

const chord = (keys: string[]): MacroStep[] => [...keys.map((key) => ({ op: "down" as const, key })), ...[...keys].reverse().map((key) => ({ op: "up" as const, key }))];

export function terminalArgs(command: string, cwd?: string): string[] {
  return [...(cwd ? ["-d", cwd] : []), "powershell", "-NoExit", "-Command", command];
}

/** Run one pad action. Rejections are reported by the caller. */
export async function runPadAction(action: PadAction): Promise<void> {
  switch (action.type) {
    case "app":
      return backend.launch(action.path, action.args);
    case "url":
      return backend.openPath(action.url);
    case "terminal":
      return backend.launch("wt.exe", terminalArgs(action.command, action.cwd));
    case "claude": {
      const w = findClaudeWindow(await backend.windows());
      if (w && (await backend.focusWindow(w.pid, w.title))) return;
      return backend.launch("wt.exe", terminalArgs("claude", action.cwd));
    }
    case "focus":
      if (await focusProcess(action.process)) return;
      if (action.fallback) return runPadAction(action.fallback);
      return;
    case "keys":
      return backend.inputSend(chord(action.keys));
    case "appKeys": {
      const prev = await backend.foregroundApp();
      if (!(await focusProcess(action.process))) throw new Error(`${action.process} is not open`);
      await sleep(120);
      await backend.inputSend(chord(action.keys));
      await sleep(120);
      if (prev) await backend.focusWindow(prev.pid, prev.title).catch(() => false);
      return;
    }
    case "text":
      return backend.inputSend([{ op: "text", text: action.text }]);
    case "media": {
      const ok = await backend.mediaCommand(action.command).catch(() => false);
      if (!ok) {
        const key = { playPause: "MediaPlayPause", next: "MediaTrackNext", prev: "MediaTrackPrevious" }[action.command];
        await backend.inputSend([{ op: "tap", key }]);
      }
      return;
    }
    case "mic":
      return toggleMic();
    case "volume": {
      const apps = await backend.audioApps();
      const cur = apps.find((a) => lower(a.process) === lower(action.process));
      if (action.mute) return backend.audioAppSet(action.process, undefined, !(cur?.muted ?? false));
      if (action.step) return backend.audioAppSet(action.process, Math.max(0, Math.min(1, (cur?.volume ?? 0.5) + action.step)), false);
      return;
    }
    case "notificationsSeen":
      clearNotifications(action.ruleId);
      return;
    case "map":
      usePads.setState((s) => ({ mapVisible: !s.mapVisible }));
      return;
    case "page":
      usePads.getState().setPage(action.page);
      return;
    case "profile":
      bus.emit("profile:apply", { id: action.profileId, reason: "hotkey" });
      return;
  }
}

/** Short English description for tooltips and the pad map when a pad has no label. */
export function describePadAction(a: PadAction | undefined): string {
  if (!a) return "";
  switch (a.type) {
    case "app":
      return (a.args?.[0] ?? a.path).replace(/^shell:AppsFolder\\/, "").split(/[\\/!_]/)[0];
    case "url":
      return a.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    case "terminal":
      return a.command;
    case "claude":
      return "Claude Code";
    case "focus":
      return a.process.replace(/\.exe$/i, "");
    case "keys":
    case "appKeys":
      return a.keys.map((k) => k.replace(/^(Key|Digit)/, "").replace(/(Left|Right)$/, "")).join("+");
    case "text":
      return `“${a.text.slice(0, 12)}”`;
    case "media":
      return a.command;
    case "mic":
      return "Mic";
    case "volume":
      return a.mute ? "Mute" : `Vol ${a.step && a.step > 0 ? "+" : "−"}`;
    case "notificationsSeen":
      return "Seen";
    case "map":
      return "Map";
    case "page":
      return a.page;
    case "profile":
      return a.profileId;
  }
}
