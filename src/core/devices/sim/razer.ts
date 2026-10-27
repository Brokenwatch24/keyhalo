import type { HidDeviceInfo } from "@/core/backend/api";
import type { HidSimulator } from "@/core/backend/mock";
import type { HardwareEffect, RGB } from "@/core/types";
import {
  EFFECT_ID,
  REPORT_LEN,
  STATUS,
  buildReport,
  crcValid,
  decodeEffect,
  encodeEffect,
  parseReport,
} from "../drivers/razer-protocol";

/**
 * HID-level simulators of the user's real desk: a Razer Huntsman Mini (US) and a
 * DeathAdder V2 Pro (wireless). They answer every command the Razer driver sends and keep
 * state, so the browser demo and tests exercise the real driver code path.
 */

interface SimState {
  firmware: [number, number];
  serial: string;
  layout: number;
  transactionIds: number[];
  effects: Map<number, HardwareEffect>;
  brightness: Map<number, number>;
  matrix?: RGB[][];
  dpi: { x: number; y: number };
  stages: { x: number; y: number }[];
  activeStage: number;
  polling: number;
  battery: number; // 0..255
  charging: boolean;
  idle: number;
  lowBattery: number;
  deviceMode: number;
  /** Number of commands handled (diagnostics / tests). */
  commands: number;
  lastFrameAt: number;
}

export class RazerSimDevice implements HidSimulator {
  readonly state: SimState;
  private reply = new Map<string, number[]>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    readonly infos: HidDeviceInfo[],
    readonly controlPath: string,
    init: Partial<SimState> & Pick<SimState, "firmware" | "serial" | "transactionIds">,
    private kind: "keyboard" | "mouse",
    matrix?: { rows: number; cols: number },
  ) {
    this.state = {
      layout: 0x01,
      effects: new Map(),
      brightness: new Map(),
      dpi: { x: 800, y: 800 },
      stages: [{ x: 800, y: 800 }],
      activeStage: 0,
      polling: 0x01,
      battery: 214,
      charging: false,
      idle: 300,
      lowBattery: 0x26,
      deviceMode: 0x00,
      commands: 0,
      lastFrameAt: 0,
      ...init,
    };
    if (matrix) this.state.matrix = Array.from({ length: matrix.rows }, () => Array.from({ length: matrix.cols }, () => [0, 0, 0] as RGB));
  }

  /** Slowly drain / charge the battery (mouse only). */
  startClock(intervalMs = 60_000) {
    if (this.kind !== "mouse" || this.timer) return;
    this.timer = setInterval(() => {
      const s = this.state;
      if (s.charging) {
        s.battery = Math.min(255, s.battery + 8);
        if (s.battery >= 255) s.charging = false;
      } else {
        s.battery = Math.max(0, s.battery - 1);
        if (s.battery < 40) s.charging = true;
      }
    }, intervalMs);
  }

  stopClock() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  sendFeature(path: string, data: number[]): void {
    const report = data.length === REPORT_LEN + 1 ? data.slice(1) : data;
    if (path !== this.controlPath) {
      // Non-control interfaces never answer.
      this.reply.set(path, new Array(REPORT_LEN).fill(0));
      return;
    }
    this.reply.set(path, this.handle(report));
  }

  getFeature(path: string, reportId: number, length: number): number[] {
    const r = this.reply.get(path) ?? new Array(REPORT_LEN).fill(0);
    const out = [reportId, ...r];
    return out.slice(0, length);
  }

  private handle(raw: number[]): number[] {
    const s = this.state;
    s.commands++;
    const req = parseReport(raw);
    const answer = (status: number, args: number[] = req.args) =>
      buildReport({ transactionId: req.transactionId, cmdClass: req.cmdClass, cmdId: req.cmdId, dataSize: req.dataSize, args, status });
    if (!crcValid(raw)) return answer(STATUS.FAIL);
    // Wrong transaction id: the real hardware stays silent; answer with a failure.
    if (!s.transactionIds.includes(req.transactionId)) return answer(STATUS.FAIL);

    const a = [...req.args];
    const key = (req.cmdClass << 8) | req.cmdId;
    const isMouse = this.kind === "mouse";
    switch (key) {
      case 0x0081: // firmware
        a[0] = s.firmware[0];
        a[1] = s.firmware[1];
        return answer(STATUS.OK, a);
      case 0x0082: // serial
        for (let i = 0; i < 22; i++) a[i] = i < s.serial.length ? s.serial.charCodeAt(i) : 0;
        return answer(STATUS.OK, a);
      case 0x0086: // layout
        if (isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[0] = s.layout;
        a[1] = 0;
        return answer(STATUS.OK, a);
      case 0x0084:
        a[0] = s.deviceMode;
        a[1] = 0;
        return answer(STATUS.OK, a);
      case 0x0004:
        s.deviceMode = a[0];
        return answer(STATUS.OK, a);
      case 0x0085:
        a[0] = s.polling;
        return answer(STATUS.OK, a);
      case 0x0005:
        if (![0x01, 0x02, 0x08].includes(a[0])) return answer(STATUS.FAIL);
        s.polling = a[0];
        return answer(STATUS.OK, a);

      // DPI -----------------------------------------------------------------
      case 0x0485:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[1] = s.dpi.x >> 8;
        a[2] = s.dpi.x & 0xff;
        a[3] = s.dpi.y >> 8;
        a[4] = s.dpi.y & 0xff;
        return answer(STATUS.OK, a);
      case 0x0405: {
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        const x = (a[1] << 8) | a[2];
        const y = (a[3] << 8) | a[4];
        if (x < 100 || x > 20000 || y < 100 || y > 20000) return answer(STATUS.FAIL);
        s.dpi = { x, y };
        return answer(STATUS.OK, a);
      }
      case 0x0486: {
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[1] = s.activeStage + 1;
        a[2] = s.stages.length;
        s.stages.forEach((st, i) => {
          const o = 3 + i * 7;
          a[o] = i + 1;
          a[o + 1] = st.x >> 8;
          a[o + 2] = st.x & 0xff;
          a[o + 3] = st.y >> 8;
          a[o + 4] = st.y & 0xff;
          a[o + 5] = 0;
          a[o + 6] = 0;
        });
        return answer(STATUS.OK, a);
      }
      case 0x0406: {
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        const count = Math.min(5, a[2]);
        if (count < 1) return answer(STATUS.FAIL);
        const stages = [];
        for (let i = 0; i < count; i++) {
          const o = 3 + i * 7;
          stages.push({ x: (a[o + 1] << 8) | a[o + 2], y: (a[o + 3] << 8) | a[o + 4] });
        }
        s.stages = stages;
        s.activeStage = Math.max(0, Math.min(count - 1, a[1] - 1));
        s.dpi = { ...stages[s.activeStage] };
        return answer(STATUS.OK, a);
      }

      // Power ---------------------------------------------------------------
      case 0x0780:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[0] = 0;
        a[1] = s.battery;
        return answer(STATUS.OK, a);
      case 0x0784:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[0] = 0;
        a[1] = s.charging ? 1 : 0;
        return answer(STATUS.OK, a);
      case 0x0783:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[0] = s.idle >> 8;
        a[1] = s.idle & 0xff;
        return answer(STATUS.OK, a);
      case 0x0703: {
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        const sec = (a[0] << 8) | a[1];
        if (sec < 60 || sec > 900) return answer(STATUS.FAIL);
        s.idle = sec;
        return answer(STATUS.OK, a);
      }
      case 0x0781:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        a[0] = s.lowBattery;
        return answer(STATUS.OK, a);
      case 0x0701:
        if (!isMouse) return answer(STATUS.NOT_SUPPORTED);
        s.lowBattery = Math.max(0x0c, Math.min(0x3f, a[0]));
        return answer(STATUS.OK, a);

      // Extended matrix lighting -------------------------------------------
      case 0x0f82: {
        const led = a[1];
        const eff = s.effects.get(led) ?? { type: "spectrum" };
        const enc = encodeEffect(led, eff, true).args ?? [];
        const out = new Array(80).fill(0);
        enc.forEach((v, i) => (out[i] = v));
        out[0] = a[0];
        // Replies always carry [vs, led, id, p1, p2, count, colours…]; spectrum/off carry count 0..1 like the hardware.
        if (eff.type === "spectrum") out[5] = 0x01;
        return answer(STATUS.OK, out);
      }
      case 0x0f02: {
        const led = a[1];
        if (a[2] === EFFECT_ID.custom) {
          for (const l of this.kind === "keyboard" ? [0x05] : [0x04]) s.effects.set(l, { type: "custom" });
          s.lastFrameAt = Date.now();
          return answer(STATUS.OK, a);
        }
        const eff = decodeEffect(a);
        if (!eff) return answer(STATUS.FAIL);
        s.effects.set(led === 0 ? (this.kind === "keyboard" ? 0x05 : 0x04) : led, eff);
        return answer(STATUS.OK, a);
      }
      case 0x0f84:
        a[2] = s.brightness.get(a[1]) ?? 0xff;
        return answer(STATUS.OK, a);
      case 0x0f04:
        s.brightness.set(a[1], a[2]);
        return answer(STATUS.OK, a);
      case 0x0f03: {
        if (!s.matrix) return answer(STATUS.NOT_SUPPORTED);
        const [, , row, start, end] = a;
        if (row >= s.matrix.length || end >= s.matrix[0].length || start > end) return answer(STATUS.FAIL);
        for (let c = start; c <= end; c++) {
          const o = 5 + (c - start) * 3;
          s.matrix[row][c] = [a[o], a[o + 1], a[o + 2]];
        }
        return answer(STATUS.OK, a);
      }
      default:
        return answer(STATUS.NOT_SUPPORTED);
    }
  }
}

const info = (vid: number, pid: number, iface: number, usagePage: number, usage: number, product: string, tag: string): HidDeviceInfo => ({
  path: `sim://${tag}/if${iface}${usagePage === 0x0c ? "-consumer" : ""}`,
  vendorId: vid,
  productId: pid,
  interfaceNumber: iface,
  usagePage,
  usage,
  product,
  manufacturer: "Razer",
});

export function createHuntsmanMiniSim(): RazerSimDevice {
  const P = "Razer Huntsman Mini";
  const infos = [
    info(0x1532, 0x0257, 0, 0x0001, 0x06, P, "huntsman-mini"),
    info(0x1532, 0x0257, 1, 0x0001, 0x06, P, "huntsman-mini"),
    info(0x1532, 0x0257, 1, 0x000c, 0x01, P, "huntsman-mini"),
    info(0x1532, 0x0257, 2, 0x0001, 0x02, P, "huntsman-mini"),
    info(0x1532, 0x0257, 3, 0x0059, 0x01, P, "huntsman-mini"),
    info(0x1532, 0x0257, 3, 0x000c, 0x01, P, "huntsman-mini"),
  ];
  const sim = new RazerSimDevice(
    infos,
    infos[3].path,
    { firmware: [1, 12], serial: "PM2104H0DEMO01", transactionIds: [0x1f, 0x3f], layout: 0x01 },
    "keyboard",
    { rows: 5, cols: 15 },
  );
  sim.state.effects.set(0x05, { type: "spectrum" });
  sim.state.brightness.set(0x05, 0xff);
  return sim;
}

export function createDeathAdderV2ProSim(wireless = true): RazerSimDevice {
  const P = "Razer DeathAdder V2 Pro";
  const pid = wireless ? 0x007d : 0x007c;
  const tag = wireless ? "deathadder-v2-pro-dongle" : "deathadder-v2-pro";
  const infos = [
    info(0x1532, pid, 0, 0x0001, 0x02, P, tag),
    info(0x1532, pid, 1, 0x0001, 0x06, P, tag),
    info(0x1532, pid, 2, 0x0001, 0x80, P, tag),
  ];
  const sim = new RazerSimDevice(
    infos,
    infos[0].path,
    {
      firmware: [2, 2],
      serial: "PM2052H0DEMO02",
      transactionIds: [0x3f],
      dpi: { x: 600, y: 600 },
      stages: [{ x: 600, y: 600 }],
      activeStage: 0,
      battery: 0xd6,
    },
    "mouse",
  );
  sim.state.effects.set(0x04, { type: "static", colors: [[0, 255, 0]] });
  sim.state.brightness.set(0x04, 0xff);
  return sim;
}

let registered = false;
export const simulators: { huntsman?: RazerSimDevice; deathadder?: RazerSimDevice } = {};

/** Register both simulators with the mock backend (no-op after the first call). */
export async function registerRazerSimulators() {
  if (registered) return simulators;
  registered = true;
  const { registerHidSimulator } = await import("@/core/backend/mock");
  simulators.huntsman = createHuntsmanMiniSim();
  simulators.deathadder = createDeathAdderV2ProSim(true);
  simulators.deathadder.startClock();
  registerHidSimulator(simulators.huntsman);
  registerHidSimulator(simulators.deathadder);
  return simulators;
}
