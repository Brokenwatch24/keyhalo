import { describe, expect, it } from "vitest";
import { applyHook, claudeSummary, type AgentSession } from "./sessions";

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
});
