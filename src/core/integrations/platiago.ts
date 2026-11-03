import { create } from "zustand";
import { backend, isTauri } from "@/core/backend";

/**
 * Platia GO (desktop app): background Claude Code / Codex tasks you start from the device, the
 * phone or another computer, with approvals; and the synced to-dos (the same list as the iPhone
 * and the device). KeyHalo talks to its loopback API with the token it saves on this PC.
 */
export type PgoStatus = "running" | "waiting_approval" | "waiting_you" | "done" | "failed" | "cancelled";

export interface PgoApproval {
  id: string;
  title: string;
  detail: string;
  tool: string;
  what?: string;
  can_allow_for_task?: boolean;
}

export interface PgoTask {
  task_id: string;
  engine: "claude" | "codex";
  title: string;
  cwd: string;
  status: PgoStatus;
  activity: string;
  output_tail: string;
  result?: string;
  pending_approval?: PgoApproval;
  started_at: string;
  ended_at?: string;
  node_name: string;
}

export interface PgoTodo {
  id: string;
  title: string;
  done: boolean;
  due?: string;
  due_text?: string;
  source?: string;
  created_at: string;
}

export const usePlatiaGo = create<{ installed: boolean | null }>(() => ({ installed: null }));

let cache: { at: number; cfg: { port: number; token: string } | null } | null = null;

export async function platiaConfig() {
  if (cache && Date.now() - cache.at < 60_000) return cache.cfg;
  const cfg = isTauri ? await backend.platiaConfig().catch(() => null) : null;
  cache = { at: Date.now(), cfg };
  if (usePlatiaGo.getState().installed !== !!cfg) usePlatiaGo.setState({ installed: !!cfg });
  return cfg;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = await platiaConfig();
  if (!c) throw new Error("Platia GO isn't installed (or is older than 0.9.2)");
  const r = await backend.httpRequest({
    method,
    url: `http://127.0.0.1:${c.port}${path}`,
    headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 6000,
  });
  let data: unknown = {};
  try {
    data = r.body ? JSON.parse(r.body) : {};
  } catch {
    // not JSON
  }
  if (r.status >= 400) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `Platia GO: HTTP ${r.status}`);
  return data as T;
}

export const pgo = {
  tasks: async () => (await call<{ tasks: PgoTask[] }>("GET", "/v1/tasks")).tasks ?? [],
  /** Approve (once, or for the whole task when it allows it) or deny what a task is waiting for. */
  answer: (taskId: string, approvalId: string, allow: boolean, scope: "once" | "task" = "once") =>
    call<{ ok: boolean }>("POST", `/v1/tasks/${taskId}/approval`, { approval_id: approvalId, allow, scope }),
  cancel: (taskId: string) => call<{ ok: boolean }>("POST", `/v1/tasks/${taskId}/cancel`, {}),
  todos: async () => (await call<{ todos: PgoTodo[] }>("GET", "/v1/todos")).todos ?? [],
  addTodo: (title: string) => call<PgoTodo>("POST", "/v1/todos", { title, source: "KeyHalo" }),
  setDone: (id: string, done: boolean) => call<PgoTodo>("POST", `/v1/todos/${encodeURIComponent(id)}`, { done }),
};
