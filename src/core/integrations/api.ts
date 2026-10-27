import { backend } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { useSettings } from "@/core/state/settings";
import { useSignals } from "@/core/lighting/signals";
import { useDevices } from "@/core/devices/store";
import { isClaudeState, setClaudeState } from "./claude";
import { notifyUser } from "./feedback";
import { pomodoroCommand } from "./pomodoro";
import { activeProfile, resolveProfile } from "./profiles";
import { useIntegrations } from "./store";

/**
 * Local REST/WebSocket API glue: configures the Rust server from `settings.api`, publishes the
 * status JSON (GET /api/v1/status) when it changes, and handles POST /api/v1/action.
 * `rule` and custom action names are handled by the automation engine.
 */
export const BUILTIN_API_ACTIONS = ["profile", "effect", "flash", "notify", "dpi", "brightness", "claude", "pomodoro"] as const;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : typeof v === "string" ? v.split(/[,\s]+/).filter(Boolean) : undefined);

/** Execute one API action. Returns false for unknown actions (left to automations). */
export function handleApiAction(action: string, params: Record<string, unknown> = {}): boolean {
  switch (action) {
    case "profile": {
      const id = str(params.id) ?? str(params.name);
      if (id) bus.emit("profile:apply", { id: resolveProfile(id), reason: "api" });
      return true;
    }
    case "effect": {
      const id = str(params.id) ?? str(params.effect);
      if (id) bus.emit("lighting:effect", { effect: id, params: (params.params as Record<string, unknown>) ?? undefined });
      return true;
    }
    case "flash":
      bus.emit("lighting:flash", { color: str(params.color) ?? "#ffffff", keys: keys(params.keys), times: num(params.times) ?? 2, durationMs: num(params.durationMs) });
      return true;
    case "notify":
      notifyUser(str(params.text) ?? "", str(params.color) ?? "#ffffff", keys(params.keys));
      return true;
    case "dpi": {
      const v = num(params.value);
      if (v) bus.emit("dpi:set", { value: v });
      return true;
    }
    case "brightness": {
      const v = num(params.value);
      if (v !== undefined) bus.emit("lighting:brightness", { value: Math.max(0, Math.min(1, v > 1 ? v / 100 : v)) });
      return true;
    }
    case "claude":
      if (isClaudeState(params.state)) setClaudeState(params.state);
      return true;
    case "pomodoro":
      pomodoroCommand(params);
      return true;
    default:
      return false;
  }
}

/** The JSON served at GET /api/v1/status. */
export function apiState(version: string) {
  const sig = useSignals.getState();
  const ds = useDevices.getState();
  return {
    version,
    activeProfile: activeProfile(),
    devices: ds.devices.map((d) => ({ name: d.definition.name, type: d.definition.type, battery: ds.live[d.uid]?.battery?.percent ?? null })),
    wpm: sig.wpm ?? 0,
    apm: sig.apm ?? 0,
    claude: sig.claude?.state ?? "idle",
    bambu: sig.bambu ?? null,
    micMuted: sig.micMuted ?? null,
    pomodoro: sig.pomodoro ?? null,
  };
}

export async function startApi() {
  const version = await backend.appVersion().catch(() => "dev");

  let lastCfg = "";
  const configure = () => {
    const { enabled, port, token } = useSettings.getState().settings.api;
    const key = `${enabled}|${port}|${token}`;
    if (key === lastCfg) return;
    lastCfg = key;
    backend
      .apiConfigure(enabled, port, token)
      .then(() => useIntegrations.getState().setStatus("api", enabled ? "connected" : "idle", enabled ? `127.0.0.1:${port}` : undefined))
      .catch((e) => {
        lastCfg = "";
        useIntegrations.getState().setStatus("api", "error", String((e as Error)?.message ?? e));
      });
  };
  configure();
  useSettings.subscribe((s, p) => s.settings.api !== p.settings.api && configure());

  let last = "";
  setInterval(() => {
    const json = JSON.stringify(apiState(version));
    if (json === last) return;
    last = json;
    backend.apiSetState(JSON.parse(json)).catch(() => (last = ""));
  }, 1000);

  await backend.on("api-action", ({ action, params }) => {
    try {
      handleApiAction(action, params ?? {});
    } catch (e) {
      console.warn(`[api] action ${action} failed`, e);
    }
  });
}
