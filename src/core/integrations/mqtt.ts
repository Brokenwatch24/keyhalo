import { backend } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { useSignals } from "@/core/lighting/signals";
import { useDevices } from "@/core/devices/store";
import type { HomeAssistantConfig } from "./config";
import { activeProfile, onProfilesChanged, profileList, resolveProfile } from "./profiles";
import { registerTest, useIntegrations, watchConfig } from "./store";

/**
 * Generic MQTT broker connection (shared by Home Assistant and `mqtt` automations) plus
 * Home Assistant MQTT discovery: the keyboard appears as a `light` (on/off, brightness, RGB,
 * effect = profile names) with WPM / battery / Claude sensors.
 */
const CONN = "keyhalo-mqtt";

/** MQTT topic filter matching with `+` and `#` wildcards. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= t.length) return false;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** Sanitise a node id for topics / unique ids. */
export const nodeIdOf = (s: string) => (s || "pc").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "pc";

export function haTopics(cfg: Pick<HomeAssistantConfig, "baseTopic" | "nodeId" | "discoveryPrefix">) {
  const node = nodeIdOf(cfg.nodeId);
  const base = `${(cfg.baseTopic || "keyhalo").replace(/\/+$/, "")}/${node}`;
  const prefix = (cfg.discoveryPrefix || "homeassistant").replace(/\/+$/, "");
  return {
    node,
    state: `${base}/state`,
    availability: `${base}/availability`,
    lightState: `${base}/light/state`,
    lightSet: `${base}/light/set`,
    discoveryLight: `${prefix}/light/keyhalo_${node}/keyboard/config`,
    discoverySensor: (id: string) => `${prefix}/sensor/keyhalo_${node}/${id}/config`,
  };
}

/** Home Assistant discovery messages (topic → payload). */
export function haDiscovery(cfg: HomeAssistantConfig, effects: string[]): [string, string][] {
  const tp = haTopics(cfg);
  const device = { identifiers: [`keyhalo_${tp.node}`], name: `KeyHalo (${cfg.nodeId || "pc"})`, manufacturer: "KeyHalo", model: "Desk lighting", sw_version: "1" };
  const avail = { availability_topic: tp.availability };
  const light = {
    name: "Keyboard",
    unique_id: `keyhalo_${tp.node}_keyboard`,
    schema: "json",
    command_topic: tp.lightSet,
    state_topic: tp.lightState,
    brightness: true,
    supported_color_modes: ["rgb"],
    effect: true,
    effect_list: effects,
    device,
    ...avail,
  };
  const sensor = (id: string, name: string, tmpl: string, extra: Record<string, unknown> = {}) => [
    tp.discoverySensor(id),
    JSON.stringify({ name, unique_id: `keyhalo_${tp.node}_${id}`, state_topic: tp.state, value_template: tmpl, device, ...avail, ...extra }),
  ] as [string, string];
  return [
    [tp.discoveryLight, JSON.stringify(light)],
    sensor("wpm", "Typing speed", "{{ value_json.wpm }}", { unit_of_measurement: "WPM", state_class: "measurement", icon: "mdi:keyboard" }),
    sensor("apm", "Actions per minute", "{{ value_json.apm }}", { unit_of_measurement: "APM", state_class: "measurement", icon: "mdi:mouse" }),
    sensor("mouse_battery", "Mouse battery", "{{ value_json.mouse_battery }}", { unit_of_measurement: "%", device_class: "battery", state_class: "measurement" }),
    sensor("keyboard_battery", "Keyboard battery", "{{ value_json.keyboard_battery }}", { unit_of_measurement: "%", device_class: "battery", state_class: "measurement" }),
    sensor("profile", "Active profile", "{{ value_json.profile }}", { icon: "mdi:palette" }),
    sensor("claude", "Claude Code", "{{ value_json.claude }}", { icon: "mdi:robot" }),
  ];
}

export interface HaLightCommand {
  state?: "ON" | "OFF";
  brightness?: number;
  color?: { r: number; g: number; b: number };
  effect?: string;
}

const hex = (c: { r: number; g: number; b: number }) => `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

// --- shared connection ---------------------------------------------------------------------
let cfg: HomeAssistantConfig | null = null;
let connected = false;
let generation = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let retryMs = 5_000;
const subs = new Map<number, { filter: string; cb: (topic: string, payload: string) => void }>();
let subSeq = 0;
const brokerTopics = new Set<string>();

export function mqttConnected() {
  return connected;
}

/** Subscribe to a topic filter on the configured broker (kept across reconnects). */
export function mqttSubscribe(filter: string, cb: (topic: string, payload: string) => void): () => void {
  const id = ++subSeq;
  subs.set(id, { filter, cb });
  if (connected && !brokerTopics.has(filter)) {
    brokerTopics.add(filter);
    backend.mqttSubscribe(CONN, filter).catch(() => brokerTopics.delete(filter));
  }
  return () => subs.delete(id);
}

/** Publish on the configured broker (throws when not connected). */
export async function mqttPublish(topic: string, payload: string, retain = false) {
  if (!connected) throw new Error("MQTT broker not connected");
  await backend.mqttPublish(CONN, topic, payload, retain);
}

// --- Home Assistant state ----------------------------------------------------------------------
const light = { on: true, brightness: 255, color: { r: 255, g: 255, b: 255 }, effect: "" as string };
let lastState = "";
let lastStateAt = 0;

function stateJson(): string {
  const sig = useSignals.getState();
  const ds = useDevices.getState();
  const bat = (type: string) => {
    const d = ds.devices.find((x) => x.definition.type === type && ds.live[x.uid]?.battery);
    return d ? Math.round(ds.live[d.uid]!.battery!.percent) : null;
  };
  const prof = activeProfile();
  return JSON.stringify({
    profile: prof?.name ?? null,
    profile_id: prof?.id ?? null,
    wpm: sig.wpm ?? 0,
    apm: sig.apm ?? 0,
    mouse_battery: bat("mouse"),
    keyboard_battery: bat("keyboard"),
    claude: sig.claude?.state ?? "idle",
    mic_muted: sig.micMuted ?? null,
    bambu_progress: sig.bambu ? Math.round(sig.bambu.progress) : null,
  });
}

function lightStateJson() {
  const prof = activeProfile();
  return JSON.stringify({ state: light.on ? "ON" : "OFF", brightness: light.brightness, color_mode: "rgb", color: light.color, effect: light.effect || prof?.name || undefined });
}

async function publishState(force = false) {
  if (!connected || !cfg) return;
  const tp = haTopics(cfg);
  const s = stateJson();
  if (!force && s === lastState && Date.now() - lastStateAt < 10_000) return;
  lastState = s;
  lastStateAt = Date.now();
  await backend.mqttPublish(CONN, tp.state, s, true).catch(() => {});
}

async function publishDiscovery() {
  if (!connected || !cfg?.discovery) return;
  for (const [topic, payload] of haDiscovery(cfg, profileList().map((p) => p.name))) await backend.mqttPublish(CONN, topic, payload, true).catch(() => {});
}

function handleLightCommand(payload: string) {
  let cmd: HaLightCommand;
  try {
    cmd = JSON.parse(payload) as HaLightCommand;
  } catch {
    cmd = { state: payload.trim().toUpperCase() === "OFF" ? "OFF" : "ON" };
  }
  if (cmd.effect) {
    light.effect = cmd.effect;
    bus.emit("profile:apply", { id: resolveProfile(cmd.effect), reason: "api" });
  }
  if (typeof cmd.brightness === "number") light.brightness = Math.max(0, Math.min(255, cmd.brightness));
  if (cmd.color) {
    light.color = cmd.color;
    light.effect = "";
    bus.emit("lighting:effect", { effect: "static", params: { color: hex(cmd.color) } });
  }
  if (cmd.state === "OFF") light.on = false;
  else if (cmd.state === "ON") light.on = true;
  bus.emit("lighting:brightness", { value: light.on ? light.brightness / 255 : 0 });
  if (cfg) backend.mqttPublish(CONN, haTopics(cfg).lightState, lightStateJson(), true).catch(() => {});
}

async function connect(gen: number) {
  const status = useIntegrations.getState().setStatus;
  if (!cfg?.enabled || !cfg.host) {
    status("homeAssistant", "idle", cfg?.enabled ? "Broker host is required" : undefined);
    return;
  }
  status("homeAssistant", "connecting");
  try {
    await backend.mqttConnect({ id: CONN, host: cfg.host, port: cfg.port || (cfg.tls ? 8883 : 1883), username: cfg.username || undefined, password: cfg.password || undefined, tls: cfg.tls, clientId: `keyhalo-${nodeIdOf(cfg.nodeId)}` });
    if (gen !== generation) return;
    connected = true;
    retryMs = 5_000;
    brokerTopics.clear();
    const tp = haTopics(cfg);
    const filters = new Set([tp.lightSet, ...[...subs.values()].map((s) => s.filter)]);
    for (const f of filters) {
      await backend.mqttSubscribe(CONN, f);
      brokerTopics.add(f);
    }
    await backend.mqttPublish(CONN, tp.availability, "online", true);
    await publishDiscovery();
    await publishState(true);
    await backend.mqttPublish(CONN, tp.lightState, lightStateJson(), true).catch(() => {});
    status("homeAssistant", "connected");
  } catch (e) {
    if (gen !== generation) return;
    connected = false;
    status("homeAssistant", "error", String((e as Error)?.message ?? e));
    clearTimeout(retry);
    retry = setTimeout(() => gen === generation && connect(gen), retryMs);
    retryMs = Math.min(retryMs * 2, 120_000);
  }
}

async function disconnect(old: HomeAssistantConfig | null) {
  clearTimeout(retry);
  if (connected && old) {
    await backend.mqttPublish(CONN, haTopics(old).availability, "offline", true).catch(() => {});
    await backend.mqttDisconnect(CONN).catch(() => {});
  }
  connected = false;
}

export async function startMqtt() {
  await backend.on("mqtt-message", (m) => {
    if (m.id !== CONN) return;
    if (cfg && m.topic === haTopics(cfg).lightSet) handleLightCommand(m.payload);
    subs.forEach((s) => topicMatches(s.filter, m.topic) && s.cb(m.topic, m.payload));
  });
  await backend.on("mqtt-status", (s) => {
    if (s.id !== CONN || s.connected || !connected) return;
    connected = false;
    useIntegrations.getState().setStatus("homeAssistant", "error", s.error ?? "Disconnected");
    const gen = generation;
    clearTimeout(retry);
    retry = setTimeout(() => gen === generation && connect(gen), retryMs);
  });
  registerTest("homeAssistant", async () => {
    const c = useIntegrations.getState().config.homeAssistant;
    if (!c.host) return { ok: false, message: "Broker host is required" };
    if (connected) return { ok: true, message: "Connected" };
    const id = "keyhalo-mqtt-test";
    await backend.mqttConnect({ id, host: c.host, port: c.port, username: c.username || undefined, password: c.password || undefined, tls: c.tls });
    await backend.mqttDisconnect(id).catch(() => {});
    return { ok: true, message: "Broker reachable" };
  });
  onProfilesChanged(() => {
    publishDiscovery();
    publishState();
  });
  bus.on("profile:applied", () => {
    light.effect = "";
    if (connected && cfg) backend.mqttPublish(CONN, haTopics(cfg).lightState, lightStateJson(), true).catch(() => {});
  });
  setInterval(() => publishState(), 2_000);

  watchConfig("homeAssistant", (next) => {
    const prev = cfg;
    cfg = next;
    const reconnect = !prev || ["enabled", "host", "port", "username", "password", "tls", "nodeId", "baseTopic"].some((k) => prev[k as keyof HomeAssistantConfig] !== next[k as keyof HomeAssistantConfig]);
    if (!reconnect) {
      publishDiscovery();
      return;
    }
    const gen = ++generation;
    disconnect(prev).then(() => {
      if (!next.enabled) {
        useIntegrations.getState().setStatus("homeAssistant", "idle");
        return;
      }
      connect(gen);
    });
  });
}
