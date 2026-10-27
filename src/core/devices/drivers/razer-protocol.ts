import type { HardwareEffect, RGB } from "@/core/types";

/**
 * Razer HID control protocol: packet layout, CRC and argument encoders/decoders.
 * Pure functions only (no I/O) so they can be unit-tested and shared with the simulator.
 * Protocol facts and their sources: docs/protocols/razer.md.
 */

export const REPORT_LEN = 90;
export const ARGS_LEN = 80;

export const STATUS = {
  NEW: 0x00,
  BUSY: 0x01,
  OK: 0x02,
  FAIL: 0x03,
  TIMEOUT: 0x04,
  NOT_SUPPORTED: 0x05,
} as const;

export const VARSTORE = 0x01;
export const NOSTORE = 0x00;

export const LED = {
  ZERO: 0x00,
  SCROLL_WHEEL: 0x01,
  BATTERY: 0x03,
  LOGO: 0x04,
  BACKLIGHT: 0x05,
} as const;

export const EFFECT_ID = {
  off: 0x00,
  static: 0x01,
  breathing: 0x02,
  spectrum: 0x03,
  wave: 0x04,
  reactive: 0x05,
  starlight: 0x07,
  custom: 0x08,
} as const;

export interface RazerReport {
  status: number;
  transactionId: number;
  remaining: number;
  protocolType: number;
  dataSize: number;
  cmdClass: number;
  cmdId: number;
  args: number[];
  crc: number;
}

/** XOR of bytes 2..87 of the 90-byte report. */
export function razerCrc(report: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 2; i < 88; i++) crc ^= report[i] & 0xff;
  return crc;
}

export interface PacketSpec {
  transactionId: number;
  cmdClass: number;
  cmdId: number;
  dataSize: number;
  args?: ArrayLike<number>;
  status?: number;
}

/** Build a 90-byte report (without the HID report-id byte). */
export function buildReport(spec: PacketSpec): number[] {
  const r = new Array<number>(REPORT_LEN).fill(0);
  r[0] = spec.status ?? STATUS.NEW;
  r[1] = spec.transactionId & 0xff;
  r[2] = 0;
  r[3] = 0;
  r[4] = 0;
  r[5] = spec.dataSize & 0xff;
  r[6] = spec.cmdClass & 0xff;
  r[7] = spec.cmdId & 0xff;
  const args = spec.args ?? [];
  if (args.length > ARGS_LEN) throw new Error(`Razer packet arguments too long (${args.length} > ${ARGS_LEN})`);
  for (let i = 0; i < args.length; i++) r[8 + i] = args[i] & 0xff;
  r[88] = razerCrc(r);
  return r;
}

/** Report prefixed with the HID report id 0x00, ready for hidSendFeature (91 bytes). */
export function buildFeature(spec: PacketSpec): number[] {
  return [0x00, ...buildReport(spec)];
}

/** Parse a 90-byte report, or a 91-byte buffer that starts with report id 0. */
export function parseReport(buf: ArrayLike<number>): RazerReport {
  const b = Array.from(buf);
  const r = b.length === REPORT_LEN + 1 ? b.slice(1) : b;
  if (r.length < REPORT_LEN) throw new Error(`Short Razer report (${r.length} bytes)`);
  return {
    status: r[0],
    transactionId: r[1],
    remaining: (r[2] << 8) | r[3],
    protocolType: r[4],
    dataSize: r[5],
    cmdClass: r[6],
    cmdId: r[7],
    args: r.slice(8, 88),
    crc: r[88],
  };
}

export function crcValid(buf: ArrayLike<number>): boolean {
  const b = Array.from(buf);
  const r = b.length === REPORT_LEN + 1 ? b.slice(1) : b;
  return razerCrc(r) === r[88];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface Command {
  cmdClass: number;
  cmdId: number;
  dataSize: number;
  args?: number[];
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const rgbBytes = (c: RGB) => [clamp8(c[0]), clamp8(c[1]), clamp8(c[2])];

export const cmd = {
  firmware: (): Command => ({ cmdClass: 0x00, cmdId: 0x81, dataSize: 0x02 }),
  serial: (): Command => ({ cmdClass: 0x00, cmdId: 0x82, dataSize: 0x16 }),
  layout: (): Command => ({ cmdClass: 0x00, cmdId: 0x86, dataSize: 0x02 }),
  getDeviceMode: (): Command => ({ cmdClass: 0x00, cmdId: 0x84, dataSize: 0x02 }),
  setDeviceMode: (mode: number): Command => ({ cmdClass: 0x00, cmdId: 0x04, dataSize: 0x02, args: [mode, 0] }),
  getPolling: (): Command => ({ cmdClass: 0x00, cmdId: 0x85, dataSize: 0x01 }),
  setPolling: (hz: number): Command => ({ cmdClass: 0x00, cmdId: 0x05, dataSize: 0x01, args: [pollingByte(hz)] }),

  getDpi: (): Command => ({ cmdClass: 0x04, cmdId: 0x85, dataSize: 0x07, args: [NOSTORE] }),
  setDpi: (x: number, y: number, store: boolean): Command => ({
    cmdClass: 0x04,
    cmdId: 0x05,
    dataSize: 0x07,
    args: [store ? VARSTORE : NOSTORE, (x >> 8) & 0xff, x & 0xff, (y >> 8) & 0xff, y & 0xff, 0, 0],
  }),
  getDpiStages: (): Command => ({ cmdClass: 0x04, cmdId: 0x86, dataSize: 0x26, args: [VARSTORE] }),
  setDpiStages: (stages: { x: number; y: number }[], active: number): Command => {
    const list = stages.slice(0, 5);
    const args = [VARSTORE, Math.max(1, Math.min(list.length, active + 1)), list.length];
    list.forEach((s, i) => args.push(i, (s.x >> 8) & 0xff, s.x & 0xff, (s.y >> 8) & 0xff, s.y & 0xff, 0, 0));
    return { cmdClass: 0x04, cmdId: 0x06, dataSize: 0x26, args };
  },

  getBattery: (): Command => ({ cmdClass: 0x07, cmdId: 0x80, dataSize: 0x02 }),
  getCharging: (): Command => ({ cmdClass: 0x07, cmdId: 0x84, dataSize: 0x02 }),
  getIdle: (): Command => ({ cmdClass: 0x07, cmdId: 0x83, dataSize: 0x02 }),
  setIdle: (seconds: number): Command => {
    const s = Math.max(60, Math.min(900, Math.round(seconds)));
    return { cmdClass: 0x07, cmdId: 0x03, dataSize: 0x02, args: [(s >> 8) & 0xff, s & 0xff] };
  },
  getLowBattery: (): Command => ({ cmdClass: 0x07, cmdId: 0x81, dataSize: 0x01 }),
  setLowBattery: (raw: number): Command => ({
    cmdClass: 0x07,
    cmdId: 0x01,
    dataSize: 0x01,
    args: [Math.max(0x0c, Math.min(0x3f, Math.round(raw)))],
  }),

  getBrightness: (led: number): Command => ({ cmdClass: 0x0f, cmdId: 0x84, dataSize: 0x03, args: [VARSTORE, led] }),
  setBrightness: (led: number, value: number, store: boolean): Command => ({
    cmdClass: 0x0f,
    cmdId: 0x04,
    dataSize: 0x03,
    args: [store ? VARSTORE : NOSTORE, led, clamp8(value)],
  }),
  getEffect: (led: number): Command => ({ cmdClass: 0x0f, cmdId: 0x82, dataSize: 0x0c, args: [VARSTORE, led] }),
  setEffect: (led: number, effect: HardwareEffect, store: boolean, wave?: WaveDirections): Command => encodeEffect(led, effect, store, wave),

  /** Upload one row of a custom frame (extended matrix). Colours from startCol..endCol inclusive. */
  customRow: (row: number, startCol: number, colors: RGB[]): Command => {
    const endCol = startCol + colors.length - 1;
    const args = [0x00, 0x00, row, startCol, endCol];
    for (const c of colors) args.push(...rgbBytes(c));
    return { cmdClass: 0x0f, cmdId: 0x03, dataSize: 5 + colors.length * 3, args };
  },
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** HardwareEffect speed 1 (slow) … 3 (fast) → protocol bytes. */
const WAVE_SPEED = [0x48, 0x28, 0x10];
const REACTIVE_SPEED = [0x03, 0x02, 0x01]; // reactive "speed" is the afterglow length: 1 short … 4 long
const STARLIGHT_SPEED = [0x03, 0x02, 0x01];

const speedIdx = (s?: number) => Math.max(1, Math.min(3, Math.round(s ?? 2))) - 1;

/** Wave direction bytes; differs per device family (Huntsman Mini uses 0/1, BlackWidow V3 1/2). */
export interface WaveDirections {
  left: number;
  right: number;
}
export const DEFAULT_WAVE: WaveDirections = { left: 0x01, right: 0x02 };

export function encodeEffect(led: number, effect: HardwareEffect, store: boolean, wave: WaveDirections = DEFAULT_WAVE): Command {
  const vs = effect.type === "custom" ? NOSTORE : store ? VARSTORE : NOSTORE;
  const colors = effect.colors ?? [];
  const head = [vs, led, EFFECT_ID[effect.type]];
  const C = 0x0f;
  const I = 0x02;
  switch (effect.type) {
    case "off":
    case "spectrum":
      return { cmdClass: C, cmdId: I, dataSize: 0x06, args: head };
    case "custom":
      return { cmdClass: C, cmdId: I, dataSize: 0x0c, args: [NOSTORE, LED.ZERO, EFFECT_ID.custom] };
    case "static":
      return { cmdClass: C, cmdId: I, dataSize: 0x09, args: [...head, 0x00, 0x00, 0x01, ...rgbBytes(colors[0] ?? [0, 255, 0])] };
    case "breathing":
      if (colors.length === 0) return { cmdClass: C, cmdId: I, dataSize: 0x06, args: [...head, 0x00] };
      if (colors.length === 1) return { cmdClass: C, cmdId: I, dataSize: 0x09, args: [...head, 0x01, 0x00, 0x01, ...rgbBytes(colors[0])] };
      return { cmdClass: C, cmdId: I, dataSize: 0x0c, args: [...head, 0x02, 0x00, 0x02, ...rgbBytes(colors[0]), ...rgbBytes(colors[1])] };
    case "wave":
      return { cmdClass: C, cmdId: I, dataSize: 0x06, args: [...head, effect.direction === "left" ? wave.left : wave.right, WAVE_SPEED[speedIdx(effect.speed)]] };
    case "reactive":
      return {
        cmdClass: C,
        cmdId: I,
        dataSize: 0x09,
        args: [...head, 0x00, REACTIVE_SPEED[speedIdx(effect.speed)], 0x01, ...rgbBytes(colors[0] ?? [0, 255, 0])],
      };
    case "starlight": {
      const sp = STARLIGHT_SPEED[speedIdx(effect.speed)];
      if (colors.length === 0) return { cmdClass: C, cmdId: I, dataSize: 0x06, args: [...head, 0x00, sp, 0x00] };
      if (colors.length === 1) return { cmdClass: C, cmdId: I, dataSize: 0x09, args: [...head, 0x00, sp, 0x01, ...rgbBytes(colors[0])] };
      return { cmdClass: C, cmdId: I, dataSize: 0x0c, args: [...head, 0x00, sp, 0x02, ...rgbBytes(colors[0]), ...rgbBytes(colors[1])] };
    }
  }
}

/** Decode the arguments of a get-effect reply (`[vs, led, id, p1, p2, count, colours…]`). */
export function decodeEffect(args: number[], wave: WaveDirections = DEFAULT_WAVE): HardwareEffect | undefined {
  const id = args[2];
  const colorsAt = (count: number, from = 6): RGB[] =>
    Array.from({ length: Math.min(count, 4) }, (_, i) => [args[from + i * 3], args[from + i * 3 + 1], args[from + i * 3 + 2]] as RGB);
  const fromSpeed = (table: number[], v: number) => {
    const i = table.indexOf(v);
    return i >= 0 ? i + 1 : 2;
  };
  switch (id) {
    case EFFECT_ID.off:
      return { type: "off" };
    case EFFECT_ID.static:
      return { type: "static", colors: colorsAt(1) };
    case EFFECT_ID.breathing:
      return { type: "breathing", colors: args[3] === 0 ? [] : colorsAt(args[5] || args[3]) };
    case EFFECT_ID.spectrum:
      return { type: "spectrum" };
    case EFFECT_ID.wave:
      return { type: "wave", direction: args[3] === wave.left ? "left" : "right", speed: fromSpeed(WAVE_SPEED, args[4]) };
    case EFFECT_ID.reactive:
      return { type: "reactive", speed: fromSpeed(REACTIVE_SPEED, args[4]), colors: colorsAt(1) };
    case EFFECT_ID.starlight:
      return { type: "starlight", speed: fromSpeed(STARLIGHT_SPEED, args[4]), colors: colorsAt(args[5]) };
    case EFFECT_ID.custom:
      return { type: "custom" };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Misc encoders
// ---------------------------------------------------------------------------

export function pollingByte(hz: number): number {
  if (hz >= 1000) return 0x01;
  if (hz >= 500) return 0x02;
  return 0x08;
}

export function pollingHz(byte: number): number {
  return byte === 0x01 ? 1000 : byte === 0x02 ? 500 : byte === 0x08 ? 125 : 0;
}

/** Low-battery threshold byte (0x0C…0x3F, a fraction of 255) ↔ percent. */
export const lowBatteryToPercent = (raw: number) => Math.round((raw / 255) * 100);
export const percentToLowBattery = (pct: number) => Math.max(0x0c, Math.min(0x3f, Math.round((pct / 100) * 255)));

export function decodeDpiStages(args: number[]): { active: number; stages: { x: number; y: number }[] } {
  const active = Math.max(0, args[1] - 1);
  const count = Math.min(5, args[2]);
  const stages: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const o = 3 + i * 7;
    stages.push({ x: (args[o + 1] << 8) | args[o + 2], y: (args[o + 3] << 8) | args[o + 4] });
  }
  return { active: Math.min(active, Math.max(0, stages.length - 1)), stages };
}

export function decodeAscii(args: number[], len: number): string {
  return String.fromCharCode(...args.slice(0, len).filter((b) => b >= 0x20 && b < 0x7f)).trim();
}
