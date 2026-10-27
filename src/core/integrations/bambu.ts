import { backend } from "@/core/backend";
import { registerMqttSimulator } from "@/core/backend/mock";
import { useSignals } from "@/core/lighting/signals";
import { t } from "@/i18n";
import type { BambuConfig } from "./config";
import { flash, hud } from "./feedback";
import { registerTest, useIntegrations, watchConfig } from "./store";

/**
 * Bambu Lab printers over LAN MQTT (port 8883, TLS with a self-signed cert, user "bblp",
 * password = LAN access code). Reports on `device/<serial>/report` are *partial* — each message
 * only carries changed fields — so we merge them into a running state.
 */

export interface BambuState {
  /** 0..100 */
  progress: number;
  /** gcode_state: IDLE | PREPARE | RUNNING | PAUSE | FINISH | FAILED | SLICING … */
  state: string;
  remainingMin?: number;
  layer?: number;
  totalLayers?: number;
  job?: string;
}

export const EMPTY_BAMBU: BambuState = { progress: 0, state: "IDLE" };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Merge one MQTT report payload into the running printer state. Unknown payloads are ignored. */
export function mergeBambuReport(prev: BambuState, payload: string | unknown): BambuState {
  let data: unknown = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      return prev;
    }
  }
  const p = (data as { print?: Record<string, unknown> })?.print;
  if (!p || typeof p !== "object") return prev;
  const next = { ...prev };
  const pct = num(p.mc_percent);
  if (pct !== undefined) next.progress = Math.max(0, Math.min(100, pct));
  if (typeof p.gcode_state === "string" && p.gcode_state) next.state = p.gcode_state.toUpperCase();
  const rem = num(p.mc_remaining_time);
  if (rem !== undefined) next.remainingMin = rem;
  const layer = num(p.layer_num);
  if (layer !== undefined) next.layer = layer;
  const total = num(p.total_layer_num);
  if (total !== undefined) next.totalLayers = total;
  if (typeof p.subtask_name === "string" && p.subtask_name) next.job = p.subtask_name;
  return next;
}

const CONN = "bambu";
let cfg: BambuConfig | null = null;
let state: BambuState = EMPTY_BAMBU;
let connected = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let retryMs = 5_000;
let generation = 0;

function publish() {
  useSignals.getState().set({
    bambu: { progress: state.progress, state: state.state, remainingMin: state.remainingMin, layer: state.layer, totalLayers: state.totalLayers },
  });
}

function onTransition(prev: string, next: string) {
  if (!cfg || prev === next) return;
  if (next === "FINISH" && prev !== "IDLE") {
    if (cfg.flashOnFinish) flash("#7ee0a1", undefined, 3);
    if (cfg.hud) hud({ title: t("integrations.bambu.finished"), value: state.job, icon: "info", color: "#7ee0a1", progress: 1, durationMs: 4000 });
  } else if (next === "FAILED") {
    if (cfg.flashOnFinish) flash("#ff6b6b", undefined, 4);
    if (cfg.hud) hud({ title: t("integrations.bambu.failed"), value: state.job, icon: "info", color: "#ff6b6b", durationMs: 5000 });
  } else if (next === "RUNNING" && (prev === "PREPARE" || prev === "IDLE" || prev === "FINISH") && cfg.hud) {
    hud({ title: t("integrations.bambu.started"), value: state.job, icon: "info", color: "#5aa9ff" });
  }
}

async function connect(gen: number) {
  if (!cfg?.enabled || !cfg.host || !cfg.serial || !cfg.accessCode) {
    useIntegrations.getState().setStatus("bambu", "idle", cfg?.enabled ? "Host, serial and access code are required" : undefined);
    return;
  }
  const status = useIntegrations.getState().setStatus;
  status("bambu", "connecting");
  try {
    await backend.mqttConnect({ id: CONN, host: cfg.host, port: cfg.port || 8883, username: "bblp", password: cfg.accessCode, tls: true, insecure: true, clientId: `keyhalo-${Math.random().toString(16).slice(2, 8)}` });
    if (gen !== generation) return;
    await backend.mqttSubscribe(CONN, `device/${cfg.serial}/report`);
    await backend.mqttPublish(CONN, `device/${cfg.serial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));
    connected = true;
    retryMs = 5_000;
    status("bambu", "connected");
  } catch (e) {
    if (gen !== generation) return;
    status("bambu", "error", String((e as Error)?.message ?? e));
    scheduleRetry(gen);
  }
}

function scheduleRetry(gen: number) {
  clearTimeout(retry);
  retry = setTimeout(() => gen === generation && connect(gen), retryMs);
  retryMs = Math.min(retryMs * 2, 120_000);
}

async function disconnect() {
  clearTimeout(retry);
  if (connected) await backend.mqttDisconnect(CONN).catch(() => {});
  connected = false;
}

export async function startBambu() {
  if (backend.kind === "mock") registerDemoPrinter();

  await backend.on("mqtt-message", (m) => {
    if (m.id !== CONN || !cfg) return;
    if (!m.topic.endsWith("/report")) return;
    const prev = state.state;
    state = mergeBambuReport(state, m.payload);
    publish();
    onTransition(prev, state.state);
  });
  await backend.on("mqtt-status", (s) => {
    if (s.id !== CONN) return;
    if (!s.connected && connected && cfg?.enabled) {
      connected = false;
      useIntegrations.getState().setStatus("bambu", "error", s.error ?? "Disconnected");
      scheduleRetry(generation);
    }
  });

  registerTest("bambu", async () => {
    const c = useIntegrations.getState().config.bambu;
    if (!c.host || !c.serial || !c.accessCode) return { ok: false, message: "Host, serial and access code are required" };
    if (connected && cfg?.host === c.host) return { ok: true, message: `Connected · ${state.state} ${Math.round(state.progress)}%` };
    const id = "bambu-test";
    try {
      await backend.mqttConnect({ id, host: c.host, port: c.port || 8883, username: "bblp", password: c.accessCode, tls: true, insecure: true });
      await backend.mqttDisconnect(id).catch(() => {});
      return { ok: true, message: "Printer reachable" };
    } catch (e) {
      return { ok: false, message: String((e as Error)?.message ?? e) };
    }
  });

  watchConfig("bambu", (next) => {
    const reconnect = !cfg || next.enabled !== cfg.enabled || next.host !== cfg.host || next.port !== cfg.port || next.serial !== cfg.serial || next.accessCode !== cfg.accessCode;
    cfg = next;
    if (!reconnect) return;
    const gen = ++generation;
    disconnect().then(() => {
      if (!next.enabled) {
        state = EMPTY_BAMBU;
        useSignals.getState().set({ bambu: undefined });
        useIntegrations.getState().setStatus("bambu", "idle");
        return;
      }
      connect(gen);
    });
  });
}

/** Defaults used in the browser demo so the dashboard shows a print in progress. */
export const DEMO_PRINTER = { host: "192.168.1.42", serial: "01P00DEMO000001", accessCode: "12345678" };

let demoRegistered = false;
/** Browser demo: a fake printer that prints a ~4-minute job in a loop. */
function registerDemoPrinter() {
  if (demoRegistered) return;
  demoRegistered = true;
  registerMqttSimulator({
    matches: (o) => o.id === CONN || o.id === "bambu-test",
    start(_id, emit) {
      const serial = useIntegrations.getState().config.bambu.serial || DEMO_PRINTER.serial;
      const topic = `device/${serial}/report`;
      const total = 240;
      let pct = 37;
      let phase: "RUNNING" | "FINISH" = "RUNNING";
      let idle = 0;
      const send = (print: Record<string, unknown>) => emit(topic, JSON.stringify({ print: { command: "push_status", ...print } }));
      send({ gcode_state: "RUNNING", mc_percent: pct, mc_remaining_time: Math.round(((100 - pct) / 100) * 240), layer_num: Math.round(total * (pct / 100)), total_layer_num: total, subtask_name: "keyhalo-keycap-set" });
      const timer = setInterval(() => {
        if (phase === "RUNNING") {
          pct += 1;
          if (pct >= 100) {
            phase = "FINISH";
            send({ gcode_state: "FINISH", mc_percent: 100, mc_remaining_time: 0, layer_num: total });
          } else send({ mc_percent: pct, mc_remaining_time: Math.round(((100 - pct) / 100) * 240), layer_num: Math.round(total * (pct / 100)) });
        } else if (++idle > 8) {
          idle = 0;
          pct = 0;
          phase = "RUNNING";
          send({ gcode_state: "RUNNING", mc_percent: 0, mc_remaining_time: 240, layer_num: 1, total_layer_num: total });
        }
      }, 2_500);
      return () => clearInterval(timer);
    },
  });
}
