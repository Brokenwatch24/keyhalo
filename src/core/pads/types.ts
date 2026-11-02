/**
 * Pad controllers (Launchpad S and friends): a board of pages, each mapping buttons to actions
 * and live colours. Button ids: "g:x,y" grid pad (0..7 from the top-left), "t:i" round button
 * on top, "r:i" round button on the right. Right-column buttons 1–7 pick the page; the 8th
 * ("Arm") shows the on-screen pad map: hold it to peek, tap it to keep the map open.
 */

export type PadButtonId = string;

export type PadAction =
  /** Start a program, or a Start-menu app with path "shell:AppsFolder\\<AppID>". */
  | { type: "app"; path: string; args?: string[] }
  | { type: "url"; url: string }
  /** Run a command in Windows Terminal (e.g. `claude`, `codex`) in a folder. */
  | { type: "terminal"; command: string; cwd?: string }
  /** Bring Claude Code's terminal to the front; open it in `cwd` when none is running. */
  | { type: "claude"; cwd?: string }
  /** Bring an app's window to the front; run `fallback` when it has no window. */
  | { type: "focus"; process: string; fallback?: PadAction }
  /** Key chord (KeyboardEvent.code names), e.g. ["ControlLeft", "ShiftLeft", "KeyS"]. */
  | { type: "keys"; keys: string[] }
  /** Focus an app, press a chord there, then return to the previous window (e.g. Spotify "like"). */
  | { type: "appKeys"; process: string; keys: string[] }
  | { type: "text"; text: string }
  | { type: "media"; command: "playPause" | "next" | "prev" }
  | { type: "mic" }
  | { type: "volume"; process: string; step?: number; mute?: boolean }
  /** Mark waiting notifications as seen (one rule, or all). */
  | { type: "notificationsSeen"; ruleId?: string }
  /** Talk to Broken (BrokenWatchHub): holds its key while the pad is held. */
  | { type: "broken" }
  /** Show / hide the on-screen pad map. */
  | { type: "map" }
  | { type: "page"; page: string }
  | { type: "profile"; profileId: string };

/** What drives a pad's colour live, instead of its fixed colour. */
export type PadState =
  | { type: "claude" }
  | { type: "mic" }
  | { type: "media" }
  /** Blinks while a notification matched by this rule is waiting (Integrations → Notifications). */
  | { type: "notification"; ruleId: string }
  /** Full colour while the process runs, dim otherwise. */
  | { type: "running"; process: string };

export interface PadDef {
  label?: string;
  /** Hex colour. The Launchpad S shows red/green mixes (red, orange, amber, yellow, green). */
  color: string;
  action?: PadAction;
  /** Long press (≥ 500 ms). */
  hold?: PadAction;
  state?: PadState;
}

export interface PadPage {
  id: string;
  name: string;
  color: string;
  /**
   * "mixer": the grid is a per-app volume mixer (columns = `mixer`), top buttons mute.
   * "agents": each pad is a live Claude Code / Codex session; an empty pad opens Claude (tap)
   * or Codex (double tap) in the folder you are browsing.
   * "windows": each pad is an open window (tap: front / minimise, hold: close); top buttons arrange.
   * "tasks": a checklist, one task per pad (tap: done / not done, hold: edit, empty pad: new task).
   * "app": the shortcuts of the app in front, from KeyHalo's shortcut packs.
   */
  kind: "grid" | "mixer" | "agents" | "windows" | "tasks" | "app";
  /** Switch to this page automatically while one of these processes is in front. */
  apps?: string[];
  pads: Record<PadButtonId, PadDef>;
  /** Mixer columns: process names, "master", or "" (auto: next app playing audio). */
  mixer?: string[];
  /** Tasks page: the checklist. */
  tasks?: PadTask[];
  /** Tasks page: "hub" = your BrokenWatchHub / HILO to-dos, "local" = this page's own list (default: hub when installed). */
  source?: "hub" | "local";
}

export interface PadTask {
  id: string;
  text: string;
  done: boolean;
  /** Pad 0..63, row by row. */
  slot: number;
}

export interface PadBoard {
  /** 2: Windows page, 3: Tasks page, 4: Broken pad, 5: App page (each added once to older boards). */
  version: number;
  /** Up to 7 pages (right round buttons 1–7); the 8th shows the pad map. */
  pages: PadPage[];
  /** MIDI port name; empty = the first port whose name contains "Launchpad". */
  port: string;
  /** While any of these processes runs, KeyHalo lets go of the device (Windows MIDI ports are exclusive). */
  releaseFor: string[];
  /** Global hotkey that toggles the on-screen pad map (Tauri accelerator, empty = none). */
  mapHotkey: string;
  /** Show the pad's name in the HUD when it runs (handy while learning the layout). */
  hud: boolean;
  /** Folder for new agents when no File Explorer window is in front (empty = your user folder). */
  agentFolder: string;
}

export type PadConnection =
  | { state: "searching" }
  | { state: "connected"; port: string }
  | { state: "released"; port: string; app: string }
  | { state: "busy"; port: string; message: string }
  | { state: "off" };

/** What the pad map overlay draws (also used by the Pads page). */
export interface PadMapPayload {
  page: string;
  pages: { name: string; color: string; active: boolean }[];
  buttons: Record<PadButtonId, { label?: string; color: string; b?: number }>;
  /** Shown as a list instead of the grid (tasks, sessions to resume): each row marks its pad. */
  list?: PadMapItem[];
  /** One line under the map (what the buttons do right now). */
  hint?: string;
}

export interface PadMapItem {
  button: PadButtonId;
  label: string;
  sub?: string;
  color: string;
  done?: boolean;
}
