import { describe, expect, it, vi } from "vitest";
import { mergePlatiaTasks, platiaInput } from "./platia";
import { pgo, type PgoTask } from "@/core/integrations/platiago";
import { fromPlatia } from "@/core/pads/hubTasks";

const task = (id: string, status: PgoTask["status"], extra: Partial<PgoTask> = {}): PgoTask => ({
  task_id: id, engine: "claude", title: `Task ${id}`, cwd: "D:/p", status, activity: "", output_tail: "", started_at: "2026-11-02T10:00:00Z", node_name: "pc", ...extra,
});

describe("Platia GO tasks on the Agents page", () => {
  it("adds active and recently finished tasks, follows their state and drops old ones", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    let s = mergePlatiaTasks([], [task("a", "running"), task("b", "done", { ended_at: "2026-11-02T08:00:00Z" }), task("c", "cancelled")], now);
    expect(s.map((x) => [x.key, x.state, x.via])).toEqual([["pgo-a", "working", "platia"]]);
    s = mergePlatiaTasks(s, [task("a", "waiting_approval", { pending_approval: { id: "ap1", title: "Run command", detail: "", tool: "Bash", what: "npm test", can_allow_for_task: true } })], now);
    expect(s[0]).toMatchObject({ state: "waiting", message: "Run command: npm test", approval: { id: "ap1", canTask: true }, seen: false });
    s = mergePlatiaTasks(s, [task("a", "done", { ended_at: "2026-11-02T11:59:00Z", result: "All tests pass" })], now);
    expect(s[0]).toMatchObject({ state: "done", message: "All tests pass", seen: false });
    expect(mergePlatiaTasks(s, [], now)).toHaveLength(0);
  });

  it("tap approves, double tap denies, hold approves for the task", async () => {
    vi.useFakeTimers();
    const answer = vi.spyOn(pgo, "answer").mockResolvedValue({ ok: true });
    const s = mergePlatiaTasks([], [task("a", "waiting_approval", { pending_approval: { id: "ap1", title: "Edit", detail: "", tool: "Edit", can_allow_for_task: true } })], Date.now())[0];
    const seen = vi.fn();
    platiaInput(s, true, seen);
    platiaInput(s, false, seen);
    await vi.advanceTimersByTimeAsync(400);
    expect(answer).toHaveBeenLastCalledWith("a", "ap1", true, "once");
    platiaInput(s, true, seen);
    platiaInput(s, false, seen);
    platiaInput(s, true, seen);
    platiaInput(s, false, seen);
    await vi.advanceTimersByTimeAsync(400);
    expect(answer).toHaveBeenLastCalledWith("a", "ap1", false, "once");
    platiaInput(s, true, seen);
    await vi.advanceTimersByTimeAsync(700);
    platiaInput(s, false, seen);
    expect(answer).toHaveBeenLastCalledWith("a", "ap1", true, "task");
    expect(answer).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("shows Platia GO to-dos like HILO's", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(fromPlatia({ id: "todo-1", title: "Llamar a Ana", done: false, due: "2026-11-03T09:00:00Z", created_at: "" }, now)).toMatchObject({ kind: "Platia GO", overdue: true, origin: "platia" });
    expect(fromPlatia({ id: "todo-2", title: "Deck", done: false, due_text: "viernes", created_at: "" }, now)).toMatchObject({ due: "viernes", overdue: false });
  });
});
