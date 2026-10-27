import type {
  Backend,
  BackendEvents,
  HidDeviceInfo,
  HttpRequest,
  HudPayload,
  MqttConnectOptions,
  PointerSettings,
  RemapConfig,
  Unlisten,
} from "./api";
import type { MacroStep } from "../types";

/**
 * Simulated HID device for the browser demo. Device drivers register simulators that
 * speak their protocol (see src/core/devices/sim) so the whole app runs without hardware.
 */
export interface HidSimulator {
  infos: HidDeviceInfo[];
  sendFeature(path: string, data: number[]): void;
  getFeature(path: string, reportId: number, length: number): number[];
}

/** Simulated MQTT broker hook (e.g. a fake Bambu printer). */
export interface MqttSimulator {
  matches(options: MqttConnectOptions): boolean;
  start(id: string, emit: (topic: string, payload: string) => void): () => void;
  publish?(topic: string, payload: string): void;
}

type Handler = (payload: unknown) => void;

const hidSims: HidSimulator[] = [];
const mqttSims: MqttSimulator[] = [];
const handlers = new Map<string, Set<Handler>>();

export function registerHidSimulator(sim: HidSimulator) {
  hidSims.push(sim);
}

export function registerMqttSimulator(sim: MqttSimulator) {
  mqttSims.push(sim);
}

/** Emit a backend event from mock code (simulators, demo scripts). */
export function emitMock<E extends keyof BackendEvents>(event: E, payload: BackendEvents[E]) {
  handlers.get(event)?.forEach((h) => h(payload));
}

const STORAGE_PREFIX = "keyhalo:";

function simFor(path: string) {
  const sim = hidSims.find((s) => s.infos.some((i) => i.path === path));
  if (!sim) throw new Error(`HID device not found: ${path}`);
  return sim;
}

export class MockBackend implements Backend {
  readonly kind = "mock" as const;
  private listening = false;
  private pointer: PointerSettings = { speed: 10, enhancePrecision: false };
  private micMutedState = false;
  private mqttStops = new Map<string, () => void>();
  private audioTimer?: number;
  private apiState: unknown = null;

  constructor() {
    if (typeof window === "undefined") return;
    // Forward real browser key events so typing, reactive lighting and stats work in the demo.
    window.addEventListener("keydown", (e) => {
      if (this.listening && !e.repeat) emitMock("input-key", { code: e.code, down: true, t: performance.now() });
    });
    window.addEventListener("keyup", (e) => {
      if (this.listening) emitMock("input-key", { code: e.code, down: false, t: performance.now() });
    });
    let last: { x: number; y: number } | null = null;
    let dist = 0;
    let clicks = 0;
    window.addEventListener("mousemove", (e) => {
      if (last) dist += Math.hypot(e.screenX - last.x, e.screenY - last.y);
      last = { x: e.screenX, y: e.screenY };
    });
    window.addEventListener("mousedown", () => clicks++);
    window.setInterval(() => {
      if (!this.listening || (dist === 0 && clicks === 0)) return;
      emitMock("input-mouse", { distance: dist, clicks, t: performance.now() });
      dist = 0;
      clicks = 0;
    }, 250);
  }

  // HID ---------------------------------------------------------------------
  async hidEnumerate(vendorIds?: number[]) {
    const all = hidSims.flatMap((s) => s.infos);
    return vendorIds?.length ? all.filter((i) => vendorIds.includes(i.vendorId)) : all;
  }
  async hidSendFeature(path: string, data: number[]) {
    simFor(path).sendFeature(path, data);
  }
  async hidGetFeature(path: string, reportId: number, length: number) {
    return simFor(path).getFeature(path, reportId, length);
  }
  async hidWrite() {}
  async hidRead() {
    return [];
  }
  async hidClose() {}

  // LampArray ---------------------------------------------------------------
  async lampArrayList() {
    return [];
  }
  async lampArraySetColors() {}

  // TCP ---------------------------------------------------------------------
  async tcpConnect(): Promise<string> {
    throw new Error("TCP is not available in the browser demo");
  }
  async tcpSend() {}
  async tcpRecv(): Promise<number[]> {
    throw new Error("TCP is not available in the browser demo");
  }
  async tcpClose() {}

  // MQTT --------------------------------------------------------------------
  async mqttConnect(options: MqttConnectOptions) {
    const sim = mqttSims.find((s) => s.matches(options));
    if (!sim) {
      emitMock("mqtt-status", { id: options.id, connected: false, error: "No broker in demo mode" });
      throw new Error("No MQTT broker in demo mode");
    }
    const stop = sim.start(options.id, (topic, payload) => emitMock("mqtt-message", { id: options.id, topic, payload }));
    this.mqttStops.set(options.id, stop);
    emitMock("mqtt-status", { id: options.id, connected: true });
  }
  async mqttSubscribe() {}
  async mqttPublish(_id: string, topic: string, payload: string) {
    mqttSims.forEach((s) => s.publish?.(topic, payload));
  }
  async mqttDisconnect(id: string) {
    this.mqttStops.get(id)?.();
    this.mqttStops.delete(id);
    emitMock("mqtt-status", { id, connected: false });
  }

  // HTTP --------------------------------------------------------------------
  async httpRequest(request: HttpRequest) {
    const res = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, body: await res.text() };
  }

  // System ------------------------------------------------------------------
  async foregroundApp() {
    return { process: "Code.exe", title: "keyhalo — Visual Studio Code", pid: 4242 };
  }
  async processes() {
    return ["explorer.exe", "Code.exe", "Discord.exe", "chrome.exe"];
  }
  async windows() {
    return [
      { process: "Discord.exe", title: "(2) #general | KeyHalo - Discord", pid: 100 },
      { process: "chrome.exe", title: "KeyHalo — GitHub", pid: 101 },
    ];
  }
  async systemMetrics() {
    const t = Date.now() / 1000;
    return {
      cpuLoad: 18 + 12 * Math.sin(t / 7) + 6 * Math.sin(t / 2.3),
      cpuTemp: 52 + 6 * Math.sin(t / 11),
      ramUsedMb: 14_200 + 400 * Math.sin(t / 13),
      ramTotalMb: 32_768,
      gpu: {
        name: "NVIDIA GeForce RTX 3070 Ti",
        load: 34 + 20 * Math.sin(t / 5),
        temp: 58 + 5 * Math.sin(t / 9),
        vramUsedMb: 3_100 + 300 * Math.sin(t / 6),
        vramTotalMb: 8_192,
      },
    };
  }
  async pointerGet() {
    return { ...this.pointer };
  }
  async pointerSet(settings: PointerSettings) {
    this.pointer = { ...settings };
  }
  async micMuted() {
    return this.micMutedState;
  }
  async setMicMuted(muted: boolean) {
    this.micMutedState = muted;
  }
  async openPath(path: string) {
    window.open(path, "_blank", "noopener");
  }
  async findSteamGame() {
    return null;
  }
  async writeFile() {}

  // Input -------------------------------------------------------------------
  async inputSetListening(enabled: boolean) {
    this.listening = enabled;
  }
  async remapConfigure(_config: RemapConfig) {}
  async inputSend(_steps: MacroStep[]) {}

  // Audio -------------------------------------------------------------------
  async audioSetListening(enabled: boolean) {
    window.clearInterval(this.audioTimer);
    if (!enabled) return;
    this.audioTimer = window.setInterval(() => {
      const t = performance.now() / 1000;
      const beat = Math.max(0, Math.sin(t * Math.PI * 2 * 2)) ** 4;
      const bands = Array.from({ length: 16 }, (_, i) =>
        Math.min(1, Math.max(0, (1 - i / 18) * (0.35 + 0.65 * beat) * (0.7 + 0.3 * Math.sin(t * 3 + i)))),
      );
      emitMock("audio-bands", { bands, level: bands.reduce((a, b) => a + b, 0) / bands.length });
    }, 33);
  }

  // API ---------------------------------------------------------------------
  async apiConfigure() {}
  async apiSetState(state: unknown) {
    this.apiState = state;
  }

  // Storage -----------------------------------------------------------------
  async storageRead(name: string) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + name);
    } catch {
      return null;
    }
  }
  async storageWrite(name: string, contents: string) {
    try {
      localStorage.setItem(STORAGE_PREFIX + name, contents);
    } catch {
      /* storage unavailable (private window) — demo keeps working in memory */
    }
  }
  async storageList(dir: string) {
    const prefix = `${STORAGE_PREFIX}${dir.replace(/\/$/, "")}/`;
    const out: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
    } catch {
      /* ignore */
    }
    return out;
  }
  async storageDelete(name: string) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + name);
    } catch {
      /* ignore */
    }
  }

  // Shell -------------------------------------------------------------------
  async traySetProfiles() {}
  async hudShow(payload: HudPayload) {
    window.dispatchEvent(new CustomEvent<HudPayload>("keyhalo-hud", { detail: payload }));
  }
  async appVersion() {
    return "1.0.0-demo";
  }
  async appSetCloseToTray() {}

  async on<E extends keyof BackendEvents>(event: E, handler: (payload: BackendEvents[E]) => void): Promise<Unlisten> {
    let set = handlers.get(event);
    if (!set) handlers.set(event, (set = new Set()));
    const h = handler as Handler;
    set.add(h);
    return () => set!.delete(h);
  }

  /** Exposed for debugging in the demo console. */
  get debugApiState() {
    return this.apiState;
  }
}
