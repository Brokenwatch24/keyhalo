/**
 * Coding-agent sessions (Claude Code, Codex) tracked from their hooks, one per pad on the
 * Agents page. Pure functions here; wiring in ./index.ts.
 *
 * Claude Code hooks post Claude's own JSON: `session_id`, `cwd`, `hook_event_name`, and
 * `message` (Notification) or `tool_name` (PermissionRequest). Codex's `notify` posts
 * `{ type: "agent-turn-complete", "thread-id", cwd, "last-assistant-message" }`.
 */

export type AgentKind = "claude" | "codex";
/** starting: opened from a pad, no hook yet · idle: waiting for a first prompt · working ·
 * waiting: needs you (permission, question) · done: finished its turn, your move. */
export type AgentState = "starting" | "idle" | "working" | "waiting" | "done";

export interface AgentSession {
  /** Local key (stable for the pad). */
  key: string;
  /** Claude session_id / Codex thread-id, once a hook has arrived. */
  id?: string;
  kind: AgentKind;
  cwd: string;
  /** Terminal window handle, when known. */
  hwnd?: number;
  /** Claude Code's process, once seen in its session list. */
  pid?: number;
  /** App hosting the terminal (WindowsTerminal.exe, Cursor.exe…), when known. */
  host?: string;
  /** Its name (/rename) or Claude's automatic title. */
  title?: string;
  state: AgentState;
  /** What it needs or its last message. */
  message?: string;
  /** You looked at it since its last change (stops the blinking). */
  seen: boolean;
  /** Pad slot 0..63 (row by row). */
  slot: number;
  startedAt: number;
  updatedAt: number;
}

export const SLOTS = 64;
/** A pad-launched session adopts the first hook from the same folder within this window. */
const ADOPT_MS = 5 * 60_000;

export const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

export const folderName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** What a session is called: its title, else its folder. */
export const sessionName = (s: Pick<AgentSession, "title" | "cwd">) => s.title || folderName(s.cwd || "~");

export function freeSlot(sessions: AgentSession[]): number {
  const used = new Set(sessions.map((s) => s.slot));
  for (let i = 0; i < SLOTS; i++) if (!used.has(i)) return i;
  return -1;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function claudeUpdate(event: string, payload: Record<string, unknown>): { state?: AgentState; message?: string; end?: boolean } {
  switch (event) {
    case "SessionStart":
      return { state: "idle" };
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return { state: "working", message: "" };
    case "PermissionRequest": {
      const tool = str(payload.tool_name);
      return { state: "waiting", message: tool ? `Permission: ${tool}` : "Needs your permission" };
    }
    case "Notification":
      return { state: "waiting", message: str(payload.message) || "Needs you" };
    case "Stop":
      return { state: "done" };
    case "SessionEnd":
      return { end: true };
    default:
      return {};
  }
}

const TERMINALS = ["windowsterminal.exe", "openconsole.exe", "conhost.exe", "cursor.exe", "code.exe", "wezterm-gui.exe", "alacritty.exe", "warp.exe"];
export const isTerminal = (process: string) => TERMINALS.includes(process.toLowerCase());

/**
 * Apply one hook payload. `foreground` is the focused window right now: when you submit a prompt
 * your terminal is in front, so a session without a window takes it then.
 */
export function applyHook(
  sessions: AgentSession[],
  agent: AgentKind,
  payload: Record<string, unknown>,
  now: number,
  foreground?: { process: string; hwnd?: number } | null,
): AgentSession[] {
  let id: string;
  let cwd: string;
  let upd: { state?: AgentState; message?: string; end?: boolean };
  let event = "";
  if (agent === "claude") {
    id = str(payload.session_id);
    cwd = str(payload.cwd);
    event = str(payload.hook_event_name);
    upd = claudeUpdate(event, payload);
  } else {
    if (str(payload.type) && str(payload.type) !== "agent-turn-complete") return sessions;
    id = str(payload["thread-id"]) || str(payload.thread_id) || str(payload.session_id);
    cwd = str(payload.cwd);
    const last = str(payload["last-assistant-message"]) || str(payload.last_assistant_message);
    upd = { state: "done", message: last.replace(/\s+/g, " ").trim().slice(0, 160) };
  }
  if (!id) return sessions;

  let s = sessions.find((x) => x.kind === agent && x.id === id);
  if (!s) {
    // A session opened from a pad: same agent and folder, no id yet.
    s = sessions
      .filter((x) => x.kind === agent && !x.id && now - x.startedAt < ADOPT_MS && (!cwd || !x.cwd || normPath(x.cwd) === normPath(cwd)))
      .sort((a, b) => a.startedAt - b.startedAt)[0];
  }
  if (upd.end) return s ? sessions.filter((x) => x !== s) : sessions;
  if (!s) {
    const slot = freeSlot(sessions);
    if (slot < 0) return sessions;
    s = { key: `${agent}-${id}`, kind: agent, cwd, state: "idle", seen: true, slot, startedAt: now, updatedAt: now };
    sessions = [...sessions, s];
  }
  const next: AgentSession = { ...s, id, cwd: cwd || s.cwd, updatedAt: now };
  if (upd.state && upd.state !== s.state) {
    next.state = upd.state;
    next.seen = upd.state === "working" || upd.state === "idle";
  }
  if (upd.message !== undefined) next.message = upd.message || undefined;
  if (!next.hwnd && foreground?.hwnd && isTerminal(foreground.process) && (event === "UserPromptSubmit" || event === "SessionStart")) next.hwnd = foreground.hwnd;
  return sessions.map((x) => (x === s ? next : x));
}

/** One running Claude Code session, from its own list in ~/.claude/sessions. */
export interface LiveClaude {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string;
  startedAt: number;
  statusUpdatedAt: number;
  host: string | null;
  hwnd: number | null;
  title: string | null;
}

/**
 * Merge Claude Code's list of running sessions: adds sessions no hook has reported yet (started
 * before KeyHalo, in Cursor, with old hooks…), follows busy → idle, and drops sessions that ended.
 * Hooks stay the finer source: a status only applies when it is newer than the last hook.
 */
export function syncLive(sessions: AgentSession[], live: LiveClaude[], now: number): AgentSession[] {
  const pids = new Set(live.map((l) => l.pid));
  let out = sessions.filter((s) => !(s.kind === "claude" && s.pid && !pids.has(s.pid)));
  for (const l of live) {
    let s =
      out.find((x) => x.kind === "claude" && x.id === l.sessionId) ??
      out.find((x) => x.kind === "claude" && x.pid === l.pid) ??
      out
        .filter((x) => x.kind === "claude" && !x.id && now - x.startedAt < ADOPT_MS && (!x.cwd || normPath(x.cwd) === normPath(l.cwd)))
        .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!s) {
      const slot = freeSlot(out);
      if (slot < 0) break;
      const state: AgentState = l.status === "busy" ? "working" : "idle";
      out = [...out, { key: `claude-${l.sessionId}`, id: l.sessionId, pid: l.pid, kind: "claude", cwd: l.cwd, state, seen: true, slot, startedAt: l.startedAt || now, updatedAt: l.statusUpdatedAt || now, ...(l.hwnd ? { hwnd: l.hwnd } : {}), ...(l.host ? { host: l.host } : {}), ...(l.title ? { title: l.title } : {}) }];
      continue;
    }
    const next: AgentSession = { ...s, id: l.sessionId, pid: l.pid, cwd: s.cwd || l.cwd, hwnd: s.hwnd ?? l.hwnd ?? undefined, host: s.host ?? l.host ?? undefined, title: l.title ?? s.title };
    if (l.statusUpdatedAt > s.updatedAt) {
      if (l.status === "busy" && s.state !== "working" && s.state !== "waiting") Object.assign(next, { state: "working", seen: true, message: undefined });
      else if (l.status === "idle" && s.state === "working") Object.assign(next, { state: "done", seen: false });
      else if (l.status === "idle" && s.state === "starting") next.state = "idle";
      next.updatedAt = l.statusUpdatedAt;
    }
    out = out.map((x) => (x === s ? next : x));
  }
  return out;
}

/** The most urgent Claude state across sessions (for the single-key Claude widgets). */
export function claudeSummary(sessions: AgentSession[]): "idle" | "working" | "waiting" | "done" | null {
  const claude = sessions.filter((s) => s.kind === "claude");
  if (!claude.length) return null;
  if (claude.some((s) => s.state === "waiting" && !s.seen)) return "waiting";
  if (claude.some((s) => s.state === "working")) return "working";
  if (claude.some((s) => s.state === "done" && !s.seen)) return "done";
  return "idle";
}
