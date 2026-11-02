import { create } from "zustand";
import { backend } from "@/core/backend";
import { setClaudeState } from "@/core/integrations/claude";
import { useSettings } from "@/core/state/settings";
import { bus } from "@/core/util/bus";
import { applyHook, claudeSummary, folderName, freeSlot, isTerminal, type AgentKind, type AgentSession } from "./sessions";

export * from "./sessions";

/** Live coding-agent sessions (Claude Code, Codex). Kept in memory: windows don't survive a restart. */
export const useAgents = create<{ sessions: AgentSession[] }>(() => ({ sessions: [] }));

const set = (sessions: AgentSession[]) => useAgents.setState({ sessions });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const AGENT_COLORS: Record<AgentKind, string> = { claude: "#ff7a00", codex: "#3ccf4e" };
export const agentName = (k: AgentKind) => (k === "claude" ? "Claude" : "Codex");

/**
 * The folder for a new agent: the folder of the File Explorer window in front, else `fallback`
 * (empty = Windows Terminal's default, your user folder).
 */
export async function currentFolder(fallback: string): Promise<string> {
  const fg = await backend.foregroundApp().catch(() => null);
  if (fg?.hwnd && fg.process.toLowerCase() === "explorer.exe") {
    const dir = await backend.explorerFolder(fg.hwnd).catch(() => null);
    if (dir) return dir;
  }
  return fallback;
}

/** Open Claude Code or Codex in a new Windows Terminal window and give it a pad. */
export async function launchAgent(kind: AgentKind, cwd: string, slot?: number): Promise<void> {
  const before = new Set((await backend.windows().catch(() => [])).map((w) => w.hwnd));
  const now = Date.now();
  const sessions = useAgents.getState().sessions;
  const s: AgentSession = {
    key: `${kind}-new-${now.toString(36)}`,
    kind,
    cwd,
    state: "starting",
    seen: true,
    slot: slot ?? freeSlot(sessions),
    startedAt: now,
    updatedAt: now,
  };
  if (s.slot < 0) throw new Error("All 64 pads are in use");
  set([...sessions, s]);
  // A new window (-w new) so each session has its own window to come back to.
  await backend.launch("wt.exe", ["-w", "new", ...(cwd ? ["-d", cwd] : []), "powershell", "-NoExit", "-Command", kind]);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const w = (await backend.windows().catch(() => [])).find((x) => x.hwnd && !before.has(x.hwnd) && isTerminal(x.process));
    if (w) {
      set(useAgents.getState().sessions.map((x) => (x.key === s.key ? { ...x, hwnd: w.hwnd } : x)));
      return;
    }
  }
}

/** Bring a session's window to the front and show what it needs. */
export async function openAgent(key: string): Promise<void> {
  const s = useAgents.getState().sessions.find((x) => x.key === key);
  if (!s) return;
  let ok = s.hwnd ? await backend.focusHwnd(s.hwnd).catch(() => false) : false;
  if (!ok) {
    // No handle yet (session started outside KeyHalo): any terminal whose title names the agent.
    const wins = await backend.windows().catch(() => []);
    const re = s.kind === "claude" ? /^[✳✶✻✽✢·◐-◓⠀-⣿*]\s|claude/i : /codex/i;
    const w = wins.find((x) => isTerminal(x.process) && re.test(x.title));
    if (w) ok = await backend.focusWindow(w.pid, w.title).catch(() => false);
  }
  set(useAgents.getState().sessions.map((x) => (x.key === key ? { ...x, seen: true } : x)));
  const title = `${agentName(s.kind)} · ${folderName(s.cwd || "~")}`;
  bus.emit("hud", { title, value: s.message || (ok ? undefined : "Window not found"), icon: "info", color: AGENT_COLORS[s.kind], durationMs: s.message ? 4000 : 1400 });
}

export function forgetAgent(key: string) {
  set(useAgents.getState().sessions.filter((x) => x.key !== key));
}

let started = false;

export async function startAgents() {
  if (started) return;
  started = true;
  await backend.on("agent-hook", async ({ agent, payload }) => {
    const fg = agent === "claude" ? await backend.foregroundApp().catch(() => null) : null;
    set(applyHook(useAgents.getState().sessions, agent, payload, Date.now(), fg));
  });

  // Claude widgets and HUD follow the most urgent Claude session.
  let last: string | null = null;
  useAgents.subscribe((s) => {
    const sum = claudeSummary(s.sessions);
    if (sum && sum !== last) setClaudeState(sum);
    last = sum;
  });

  // Drop sessions whose window was closed.
  setInterval(async () => {
    const sessions = useAgents.getState().sessions;
    if (!sessions.some((s) => s.hwnd)) return;
    const alive = new Set((await backend.windows().catch(() => null))?.map((w) => w.hwnd) ?? sessions.map((s) => s.hwnd));
    const next = useAgents.getState().sessions.filter((s) => !s.hwnd || alive.has(s.hwnd));
    if (next.length !== useAgents.getState().sessions.length) set(next);
  }, 3000);

  // Hooks from KeyHalo 1.1 only sent one global state: upgrade them once connected.
  const api = useSettings.getState().settings.api;
  backend
    .claudeHooks("status", api.port)
    .then((st) => (st.outdated ? backend.claudeHooks("install", api.port, api.token) : null))
    .catch(() => {});
}
