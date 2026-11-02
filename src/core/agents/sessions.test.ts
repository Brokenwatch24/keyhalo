import { describe, expect, it } from "vitest";
import { applyHook, claudeSummary, syncLive, type AgentSession, type LiveClaude } from "./sessions";

const claude = (event: string, extra: Record<string, unknown> = {}) => ({ session_id: "s1", cwd: "D:/dev/keyhalo", hook_event_name: event, ...extra });

describe("agent sessions", () => {
  it("follows a Claude session through its hooks", () => {
    const fg = { process: "WindowsTerminal.exe", hwnd: 42 };
    let s: AgentSession[] = applyHook([], "claude", claude("SessionStart"), 1, null);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "claude", state: "idle", slot: 0, cwd: "D:/dev/keyhalo" });
    s = applyHook(s, "claude", claude("UserPromptSubmit"), 2, fg);
    expect(s[0]).toMatchObject({ state: "working", hwnd: 42 });
    s = applyHook(s, "claude", claude("PermissionRequest", { tool_name: "Bash" }), 3, null);
    expect(s[0]).toMatchObject({ state: "waiting", message: "Permission: Bash", seen: false });
    expect(claudeSummary(s)).toBe("waiting");
    s = applyHook(s, "claude", claude("Stop"), 4, null);
    expect(s[0]).toMatchObject({ state: "done", seen: false });
    s = applyHook(s, "claude", claude("SessionEnd"), 5, null);
    expect(s).toHaveLength(0);
  });

  it("adopts a pad-launched session from the same folder and keeps its pad and window", () => {
    const pending: AgentSession = { key: "claude-new", kind: "claude", cwd: "d:/dev/keyhalo/", hwnd: 7, state: "starting", seen: true, slot: 12, startedAt: 1000, updatedAt: 1000 };
    const s = applyHook([pending], "claude", claude("SessionStart"), 2000, null);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: "claude-new", id: "s1", slot: 12, hwnd: 7, state: "idle" });
  });

  it("marks a Codex thread as done with its last message", () => {
    const s = applyHook([], "codex", { type: "agent-turn-complete", "thread-id": "t9", cwd: "C:/x", "last-assistant-message": "All   tests pass." }, 1, null);
    expect(s[0]).toMatchObject({ kind: "codex", id: "t9", state: "done", message: "All tests pass.", seen: false });
    // Other notify types are ignored.
    expect(applyHook(s, "codex", { type: "something-else", "thread-id": "t9" }, 2, null)).toBe(s);
  });

  it("gives each new session the first free pad", () => {
    let s = applyHook([], "claude", claude("SessionStart"), 1, null);
    s = applyHook(s, "claude", { ...claude("SessionStart"), session_id: "s2" }, 2, null);
    s = applyHook(s, "codex", { type: "agent-turn-complete", "thread-id": "t1", cwd: "" }, 3, null);
    expect(s.map((x) => x.slot)).toEqual([0, 1, 2]);
  });

  it("finds running Claude sessions without hooks, follows busy/idle and drops ended ones", () => {
    const live = (status: string, at: number, extra: Partial<LiveClaude> = {}): LiveClaude => ({ pid: 50, sessionId: "c1", cwd: "D:\proj\app", status, startedAt: 10, statusUpdatedAt: at, host: "Cursor.exe", hwnd: 9, title: "Reporte", ...extra });
    let s = syncLive([], [live("idle", 100)], 1000);
    expect(s[0]).toMatchObject({ key: "claude-c1", id: "c1", pid: 50, state: "idle", seen: true, slot: 0, hwnd: 9, host: "Cursor.exe", title: "Reporte" });
    s = syncLive(s, [live("busy", 200)], 1000);
    expect(s[0]).toMatchObject({ state: "working" });
    // A hook said it needs you: a later "busy" doesn't hide that.
    s = applyHook(s, "claude", { session_id: "c1", hook_event_name: "PermissionRequest", tool_name: "Bash" }, 300, null);
    s = syncLive(s, [live("busy", 250)], 1000);
    expect(s[0]).toMatchObject({ state: "waiting" });
    s = applyHook(s, "claude", { session_id: "c1", hook_event_name: "PreToolUse" }, 400, null);
    s = syncLive(s, [live("idle", 500)], 1000);
    expect(s[0]).toMatchObject({ state: "done", seen: false });
    // /clear starts a new session id in the same process: same pad.
    s = syncLive(s, [live("idle", 600, { sessionId: "c2" })], 1000);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: "c2", slot: 0 });
    s = syncLive(s, [], 1000);
    expect(s).toHaveLength(0);
  });
});
