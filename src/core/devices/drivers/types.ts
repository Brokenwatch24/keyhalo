import type { HidDeviceInfo } from "@/core/backend/api";
import type { DeviceDefinition, DeviceSnapshot, DpiStage, DriverId, HardwareEffect, RGB } from "@/core/types";

/**
 * Driver contract. A driver turns a device definition + transport into a `DeviceHandle`.
 * Every capability method is optional: callers must check before calling
 * (e.g. `handle.setDpi?.(…)`).
 */

/** LED address as written in a definition (`KeyDef.led` / `LedDef.led`). */
export type LedAddress = number | [number, number];

export interface LedColor {
  led: LedAddress;
  color: RGB;
}

export interface DeviceInfo {
  firmware?: string;
  serial?: string;
  /** Layout id reported by the hardware, formatted as in `layoutDetection` (e.g. "0x01"). */
  layoutId?: string;
}

export interface DpiStages {
  stages: DpiStage[];
  /** 0-based index of the active stage. */
  active: number;
}

export interface DeviceHandle {
  readonly driver: DriverId;
  readonly definition: DeviceDefinition;
  /** Transport id: HID path, LampArray id, OpenRGB controller key. */
  readonly path: string;

  info(): Promise<DeviceInfo>;

  /** Push one frame of colours (by LED address). Coalesced and rate limited by the driver. */
  setFrame?(frame: LedColor[]): Promise<void>;

  getEffect?(): Promise<HardwareEffect | undefined>;
  setEffect?(effect: HardwareEffect, store: boolean): Promise<void>;
  /** 0..1 */
  getBrightness?(): Promise<number>;
  setBrightness?(value: number, store: boolean): Promise<void>;

  // Mouse -------------------------------------------------------------------
  getDpi?(): Promise<DpiStage>;
  setDpi?(dpi: DpiStage, store?: boolean): Promise<void>;
  getDpiStages?(): Promise<DpiStages>;
  setDpiStages?(stages: DpiStages): Promise<void>;
  getPollingRate?(): Promise<number>;
  setPollingRate?(hz: number): Promise<void>;
  /** 0..100 */
  getBattery?(): Promise<number>;
  getCharging?(): Promise<boolean>;
  getIdleSleep?(): Promise<number>;
  setIdleSleep?(seconds: number): Promise<void>;
  /** Percent 0..100. */
  getLowBatteryThreshold?(): Promise<number>;
  setLowBatteryThreshold?(percent: number): Promise<void>;
  setLogoColor?(color: RGB, store?: boolean): Promise<void>;

  /** Read everything restorable (called before the first write). */
  snapshot(): Promise<DeviceSnapshot>;
  restore(snapshot: DeviceSnapshot): Promise<void>;
  close(): Promise<void>;
}

/** Drivers that open HID devices matched by a definition (Razer). */
export interface HidDriver {
  readonly id: DriverId;
  /**
   * @param control the HID interface matched by the definition (feature reports go here)
   * @param all every HID interface of the same physical device
   */
  open(definition: DeviceDefinition, control: HidDeviceInfo, all: HidDeviceInfo[]): Promise<DeviceHandle>;
}

/** A device found by a self-enumerating driver (LampArray, OpenRGB). */
export interface DiscoveredDevice {
  /** Stable key for this physical device within the driver. */
  key: string;
  definition: DeviceDefinition;
  handle: DeviceHandle;
  vendorId?: number;
  productId?: number;
}

export class SafeModeError extends Error {
  constructor() {
    super("Safe mode is on: hardware writes are disabled");
    this.name = "SafeModeError";
  }
}

export class NotSupportedError extends Error {
  constructor(what: string) {
    super(`Not supported by this device: ${what}`);
    this.name = "NotSupportedError";
  }
}

/** Parse "0x1532" / "1532" / 5426 → number. */
export function parseHex(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = parseInt(v.trim().replace(/^0x/i, ""), 16);
  return Number.isFinite(n) ? n : undefined;
}

export function hex2(n: number) {
  return `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function hex4(n: number) {
  return `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serialises async jobs: each job starts after the previous one settled.
 * HID feature reports for one device must never interleave.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  run<T>(job: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.tail.then(job, job);
    this.tail = next.then(
      () => this.pending--,
      () => this.pending--,
    );
    return next;
  }

  get size() {
    return this.pending;
  }
}

/**
 * Coalescing frame pump: keeps only the newest frame, sends at most `fps` frames per second
 * and skips frames identical to the last one sent.
 */
export class FramePump<F> {
  private latest: F | null = null;
  private lastKey = "";
  private lastSent = 0;
  private running = false;
  private waiters: (() => void)[] = [];

  constructor(
    private send: (frame: F) => Promise<void>,
    private keyOf: (frame: F) => string,
    private fps = 30,
    private onError?: (e: unknown) => void,
  ) {}

  push(frame: F): Promise<void> {
    this.latest = frame;
    const p = new Promise<void>((r) => this.waiters.push(r));
    if (!this.running) void this.loop();
    return p;
  }

  /** Drop the queued frame and wait until the frame being sent (if any) is done. */
  async cancel(): Promise<void> {
    this.latest = null;
    while (this.running) await delay(2);
  }

  /** Forget the last frame so the next push is always sent (after a hardware effect change). */
  invalidate() {
    this.lastKey = "";
  }

  private async loop() {
    this.running = true;
    try {
      while (this.latest) {
        const frame = this.latest;
        this.latest = null;
        const key = this.keyOf(frame);
        if (key !== this.lastKey) {
          const wait = this.lastSent + 1000 / this.fps - Date.now();
          if (wait > 0) {
            await delay(wait);
            // A newer frame may have arrived while waiting: send that one instead.
            if (this.latest) continue;
          }
          try {
            await this.send(frame);
            this.lastKey = key;
          } catch (e) {
            this.onError?.(e);
          }
          this.lastSent = Date.now();
        }
      }
    } finally {
      this.running = false;
      const w = this.waiters;
      this.waiters = [];
      w.forEach((r) => r());
    }
  }
}
