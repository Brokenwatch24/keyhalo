import { backend } from "@/core/backend";
import type { HidDeviceInfo } from "@/core/backend/api";
import { useSettings } from "@/core/state/settings";
import type { DeviceDefinition, DeviceSnapshot, DpiStage, HardwareEffect, MouseSettings, RGB } from "@/core/types";
import {
  FramePump,
  NotSupportedError,
  SafeModeError,
  SerialQueue,
  delay,
  hex2,
  parseHex,
  type DeviceHandle,
  type DeviceInfo,
  type DpiStages,
  type HidDriver,
  type LedColor,
} from "./types";
import {
  LED,
  STATUS,
  buildFeature,
  cmd,
  decodeAscii,
  decodeDpiStages,
  decodeEffect,
  lowBatteryToPercent,
  parseReport,
  percentToLowBattery,
  pollingHz,
  DEFAULT_WAVE,
  type Command,
  type RazerReport,
  type WaveDirections,
} from "./razer-protocol";

/**
 * Razer driver (keyboards + mice speaking the 90-byte feature-report protocol).
 *
 * driverOptions understood (all optional):
 *  - transactionId: "0x1F" | number — tried first; fallbacks 0x1F, 0x3F, 0xFF.
 *  - matrix: { rows, cols } — per-key custom frames (extended matrix, class 0x0F).
 *  - led: main LED id for effects/brightness ("0x05" backlight for keyboards, "0x04" logo for mice).
 *  - frameMode: "matrix" (row uploads) | "led" (static colour per LedDef id). Default: matrix if `matrix` set.
 *  - responseDelayMs: wait between SetFeature and GetFeature (default 4, wireless 20).
 *  - maxFps: custom-frame rate limit (default 30).
 *  - customEveryFrame: re-select the custom effect after each frame upload (default true).
 *  - waveDirections: { left, right } wave direction bytes (default { left: 1, right: 2 }).
 *  - wireless: true for dongle devices (longer response delay).
 */
export interface RazerOptions {
  transactionId?: number;
  matrix?: { rows: number; cols: number };
  led: number;
  frameMode: "matrix" | "led";
  responseDelayMs: number;
  maxFps: number;
  customEveryFrame: boolean;
  wave: WaveDirections;
}

export const TRANSACTION_FALLBACKS = [0x1f, 0x3f, 0xff];

function waveOption(v: unknown): WaveDirections {
  const o = v as { left?: unknown; right?: unknown } | undefined;
  const left = parseHex(o?.left);
  const right = parseHex(o?.right);
  return left !== undefined && right !== undefined ? { left, right } : DEFAULT_WAVE;
}

export function razerOptions(def: DeviceDefinition): RazerOptions {
  const o = def.driverOptions ?? {};
  const matrix = o.matrix as { rows?: number; cols?: number } | undefined;
  const hasMatrix = !!matrix?.rows && !!matrix?.cols;
  const wireless = o.wireless === true;
  return {
    transactionId: parseHex(o.transactionId),
    matrix: hasMatrix ? { rows: Number(matrix!.rows), cols: Number(matrix!.cols) } : undefined,
    led: parseHex(o.led) ?? (def.type === "keyboard" ? LED.BACKLIGHT : LED.LOGO),
    frameMode: o.frameMode === "led" || o.frameMode === "matrix" ? o.frameMode : hasMatrix ? "matrix" : "led",
    responseDelayMs: typeof o.responseDelayMs === "number" ? o.responseDelayMs : wireless ? 20 : 4,
    maxFps: typeof o.maxFps === "number" ? o.maxFps : 30,
    customEveryFrame: o.customEveryFrame !== false,
    wave: waveOption(o.waveDirections),
  };
}

const isWrite = (c: Command) => (c.cmdId & 0x80) === 0;

/** One queue per HID path, shared by every handle opened on it. */
const queues = new Map<string, SerialQueue>();

export class RazerHandle implements DeviceHandle {
  readonly driver = "razer" as const;
  readonly opts: RazerOptions;
  /** Transaction id that answered last; undefined until the first successful command. */
  transactionId?: number;
  private perCommand = new Map<number, number>();
  private queue: SerialQueue;
  private pump: FramePump<LedColor[]>;
  private rowCache = new Map<number, string>();
  private ledCache = new Map<number, string>();
  private customActive = false;

  constructor(
    readonly definition: DeviceDefinition,
    readonly path: string,
  ) {
    this.opts = razerOptions(definition);
    let q = queues.get(path);
    if (!q) queues.set(path, (q = new SerialQueue()));
    this.queue = q;
    this.pump = new FramePump(
      (f) => this.sendFrame(f),
      // Include the address: wizard frames light a single LED with the same colour each time.
      (f) => f.map((c) => `${c.led}=${c.color.join(",")}`).join(";"),
      this.opts.maxFps,
      (e) => {
        if (!(e instanceof SafeModeError)) console.warn(`[razer] frame failed on ${definition.name}`, e);
      },
    );
  }

  // Transport ---------------------------------------------------------------

  /** Send one command and return the device's answer (serialised per device). */
  transact(c: Command): Promise<RazerReport> {
    return this.queue.run(() => this.transactNow(c));
  }

  private async transactNow(c: Command): Promise<RazerReport> {
    if (isWrite(c) && useSettings.getState().settings.safeMode) throw new SafeModeError();
    // The id that answered last goes first. Some firmwares want a different id for a few
    // commands (OpenRazer sends DA V2 Pro DPI stages / power settings with 0xFF), so every
    // command may fall back to the other ids without changing the device's main id.
    const key = (c.cmdClass << 8) | c.cmdId;
    const candidates = [
      ...new Set(
        [this.perCommand.get(key), this.transactionId, this.opts.transactionId, ...TRANSACTION_FALLBACKS].filter(
          (v): v is number => v !== undefined,
        ),
      ),
    ];
    let lastError: Error = new Error("No answer from device");
    for (const tid of candidates) {
      try {
        const rep = await this.exchange(c, tid);
        if (this.transactionId === undefined) this.transactionId = tid;
        else if (tid !== this.transactionId) this.perCommand.set(key, tid);
        return rep;
      } catch (e) {
        if (e instanceof NotSupportedError) throw e;
        lastError = e as Error;
      }
    }
    throw lastError;
  }

  private async exchange(c: Command, tid: number): Promise<RazerReport> {
    const wait = this.opts.responseDelayMs;
    for (let send = 0; send < 3; send++) {
      await backend.hidSendFeature(this.path, buildFeature({ ...c, transactionId: tid }));
      // Busy → poll the answer again (without re-sending) with growing delays.
      for (let poll = 0; poll < 6; poll++) {
        await delay(wait * (poll + 1));
        const rep = parseReport(await backend.hidGetFeature(this.path, 0x00, 91));
        if (rep.status === STATUS.BUSY || rep.status === STATUS.NEW) continue;
        if (rep.cmdClass !== c.cmdClass || rep.cmdId !== c.cmdId) continue; // stale answer
        if (rep.transactionId !== tid) throw new Error(`Transaction id ${hex2(tid)} not answered`);
        if (rep.status === STATUS.OK) return rep;
        if (rep.status === STATUS.NOT_SUPPORTED) throw new NotSupportedError(`command ${hex2(c.cmdClass)}/${hex2(c.cmdId)}`);
        if (rep.status === STATUS.TIMEOUT) throw new Error("Device did not answer (asleep or out of range)");
        throw new Error(`Command ${hex2(c.cmdClass)}/${hex2(c.cmdId)} failed (status ${hex2(rep.status)})`);
      }
    }
    throw new Error(`Device busy (command ${hex2(c.cmdClass)}/${hex2(c.cmdId)})`);
  }

  // Info --------------------------------------------------------------------

  async info(): Promise<DeviceInfo> {
    const out: DeviceInfo = {};
    const fw = await this.transact(cmd.firmware());
    out.firmware = `${fw.args[0]}.${String(fw.args[1]).padStart(2, "0")}`;
    try {
      const s = await this.transact(cmd.serial());
      const serial = decodeAscii(s.args, 22);
      if (serial) out.serial = serial;
    } catch {
      /* some devices do not report a serial */
    }
    if (this.definition.type === "keyboard") {
      try {
        const l = await this.transact(cmd.layout());
        out.layoutId = hex2(l.args[0]);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  // Lighting ----------------------------------------------------------------

  async getEffect(): Promise<HardwareEffect | undefined> {
    const r = await this.transact(cmd.getEffect(this.opts.led));
    return decodeEffect(r.args, this.opts.wave);
  }

  async setEffect(effect: HardwareEffect, store: boolean): Promise<void> {
    // A frame sent after this effect would switch the device back to custom mode.
    if (effect.type !== "custom") await this.pump.cancel();
    this.customActive = effect.type === "custom";
    this.rowCache.clear();
    this.ledCache.clear();
    this.pump.invalidate();
    await this.transact(cmd.setEffect(this.opts.led, effect, store, this.opts.wave));
  }

  async getBrightness(): Promise<number> {
    const r = await this.transact(cmd.getBrightness(this.opts.led));
    return r.args[2] / 255;
  }

  async setBrightness(value: number, store: boolean): Promise<void> {
    await this.transact(cmd.setBrightness(this.opts.led, value * 255, store));
  }

  async setLogoColor(color: RGB, store = false): Promise<void> {
    await this.transact(cmd.setEffect(LED.LOGO, { type: "static", colors: [color] }, store));
  }

  setFrame(frame: LedColor[]): Promise<void> {
    if (useSettings.getState().settings.safeMode) return Promise.resolve();
    return this.pump.push(frame);
  }

  private async sendFrame(frame: LedColor[]) {
    if (this.opts.frameMode === "matrix" && this.opts.matrix) {
      const { rows, cols } = this.opts.matrix;
      const grid: RGB[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => [0, 0, 0] as RGB));
      for (const { led, color } of frame) {
        if (!Array.isArray(led)) continue;
        const [r, c] = led;
        if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = color;
      }
      let changed = false;
      for (let r = 0; r < rows; r++) {
        const key = grid[r].map((c) => c.join(",")).join(";");
        if (this.rowCache.get(r) === key) continue;
        await this.transact(cmd.customRow(r, 0, grid[r]));
        this.rowCache.set(r, key);
        changed = true;
      }
      if (changed && (this.opts.customEveryFrame || !this.customActive)) {
        await this.transact(cmd.setEffect(LED.ZERO, { type: "custom" }, false));
        this.customActive = true;
      }
      return;
    }
    // Zone devices (mice): one static colour per LED id.
    for (const { led, color } of frame) {
      if (Array.isArray(led)) continue;
      const key = color.join(",");
      if (this.ledCache.get(led) === key) continue;
      await this.transact(cmd.setEffect(led, { type: "static", colors: [color] }, false));
      this.ledCache.set(led, key);
    }
  }

  // Mouse -------------------------------------------------------------------

  async getDpi(): Promise<DpiStage> {
    const r = await this.transact(cmd.getDpi());
    return { x: (r.args[1] << 8) | r.args[2], y: (r.args[3] << 8) | r.args[4] };
  }

  async setDpi(dpi: DpiStage, store = false): Promise<void> {
    const cap = this.definition.capabilities.dpi;
    const clampDpi = (v: number) => Math.max(cap?.min ?? 100, Math.min(cap?.max ?? 30000, Math.round(v)));
    await this.transact(cmd.setDpi(clampDpi(dpi.x), clampDpi(dpi.y), store));
  }

  async getDpiStages(): Promise<DpiStages> {
    const r = await this.transact(cmd.getDpiStages());
    return decodeDpiStages(r.args);
  }

  async setDpiStages(s: DpiStages): Promise<void> {
    const max = this.definition.capabilities.dpi?.stages ?? 5;
    await this.transact(cmd.setDpiStages(s.stages.slice(0, max), s.active));
  }

  async getPollingRate(): Promise<number> {
    const r = await this.transact(cmd.getPolling());
    return pollingHz(r.args[0]);
  }

  async setPollingRate(hz: number): Promise<void> {
    await this.transact(cmd.setPolling(hz));
  }

  async getBattery(): Promise<number> {
    const r = await this.transact(cmd.getBattery());
    return Math.round((r.args[1] / 255) * 100);
  }

  async getCharging(): Promise<boolean> {
    const r = await this.transact(cmd.getCharging());
    return r.args[1] === 1;
  }

  async getIdleSleep(): Promise<number> {
    const r = await this.transact(cmd.getIdle());
    return (r.args[0] << 8) | r.args[1];
  }

  async setIdleSleep(seconds: number): Promise<void> {
    await this.transact(cmd.setIdle(seconds));
  }

  async getLowBatteryThreshold(): Promise<number> {
    const r = await this.transact(cmd.getLowBattery());
    return lowBatteryToPercent(r.args[0]);
  }

  async setLowBatteryThreshold(percent: number): Promise<void> {
    await this.transact(cmd.setLowBattery(percentToLowBattery(percent)));
  }

  // Snapshot ----------------------------------------------------------------

  async snapshot(): Promise<DeviceSnapshot> {
    const snap: DeviceSnapshot = { capturedAt: new Date().toISOString() };
    const caps = this.definition.capabilities;
    const tryGet = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch {
        return undefined;
      }
    };
    snap.effect = await tryGet(() => this.getEffect());
    if (caps.brightness !== false) snap.brightness = await tryGet(() => this.getBrightness());
    if (this.definition.type === "mouse" && caps.dpi) {
      const stages = await tryGet(() => this.getDpiStages());
      const dpi = await tryGet(() => this.getDpi());
      const mouse: MouseSettings = {
        dpiStages: stages?.stages.length ? stages.stages : dpi ? [dpi] : [],
        activeStage: stages?.active ?? 0,
        pollingRate: (await tryGet(() => this.getPollingRate())) ?? 1000,
      };
      if (caps.idleSleep) mouse.idleSleepSeconds = await tryGet(() => this.getIdleSleep());
      if (caps.lowBatteryThreshold) mouse.lowBatteryThreshold = await tryGet(() => this.getLowBatteryThreshold());
      snap.mouse = mouse;
    }
    return snap;
  }

  async restore(s: DeviceSnapshot): Promise<void> {
    if (s.effect && s.effect.type !== "custom") await this.setEffect(s.effect, true);
    if (s.brightness !== undefined) await this.setBrightness(s.brightness, true);
    if (s.mouse) {
      if (s.mouse.dpiStages.length) {
        await this.setDpiStages({ stages: s.mouse.dpiStages, active: s.mouse.activeStage });
        const active = s.mouse.dpiStages[s.mouse.activeStage] ?? s.mouse.dpiStages[0];
        await this.setDpi(active, true);
      }
      if (s.mouse.pollingRate) await this.setPollingRate(s.mouse.pollingRate);
      if (s.mouse.idleSleepSeconds) await this.setIdleSleep(s.mouse.idleSleepSeconds);
      if (s.mouse.lowBatteryThreshold) await this.setLowBatteryThreshold(s.mouse.lowBatteryThreshold);
    }
  }

  async close(): Promise<void> {
    await this.queue.run(() => backend.hidClose(this.path).catch(() => {}));
  }
}

export const razerDriver: HidDriver = {
  id: "razer",
  async open(definition: DeviceDefinition, control: HidDeviceInfo) {
    return new RazerHandle(definition, control.path);
  },
};

/**
 * Wizard helper: does the HID interface at `path` speak the Razer protocol?
 * Read-only (firmware + serial). Returns null when nothing answers.
 */
export async function probeRazer(path: string): Promise<{ firmware: string; serial?: string; transactionId: number } | null> {
  const def: DeviceDefinition = {
    id: "probe",
    name: "Probe",
    vendor: "Razer",
    type: "other",
    match: [],
    driver: "razer",
    capabilities: {},
    size: { w: 1, h: 1 },
    status: "experimental",
  };
  const h = new RazerHandle(def, path);
  try {
    const info = await h.info();
    return { firmware: info.firmware ?? "?", serial: info.serial, transactionId: h.transactionId ?? 0 };
  } catch {
    return null;
  }
}
