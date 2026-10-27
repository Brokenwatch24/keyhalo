import { create } from "zustand";
import type { ConnectedDevice, DeviceDefinition, HardwareEffect, Layout, MouseSettings } from "../types";

/**
 * Device manager store — PUBLIC CONTRACT used by every other feature.
 * Implementation is owned by the devices feature; keep these names and signatures stable.
 */
export interface DeviceLiveState {
  effect?: HardwareEffect;
  brightness?: number; // 0..1
  mouse?: MouseSettings;
  battery?: { percent: number; charging: boolean };
}

export interface DevicesState {
  /** Devices connected right now (recognised and probed). */
  devices: ConnectedDevice[];
  /** Every known definition: bundled (community/devices) + installed from the gallery. */
  definitions: DeviceDefinition[];
  live: Record<string, DeviceLiveState>;
  scanning: boolean;
  scan(): Promise<void>;
  setEffect(uid: string, effect: HardwareEffect, store?: boolean): Promise<void>;
  setBrightness(uid: string, value: number, store?: boolean): Promise<void>;
  setMouseSettings(uid: string, patch: Partial<MouseSettings>): Promise<void>;
  restoreSnapshot(uid: string): Promise<void>;
  /** Write the current lighting as a hardware effect to onboard memory. */
  saveToOnboard(uid: string, effect: HardwareEffect): Promise<void>;
  setDesk(uid: string, pos: { x: number; y: number }): void;
  setLayout(uid: string, layoutId: string): void;
  addDefinition(def: DeviceDefinition): void;
}

const notReady = async () => {
  throw new Error("Device manager not initialised");
};

export const useDevices = create<DevicesState>(() => ({
  devices: [],
  definitions: [],
  live: {},
  scanning: false,
  scan: notReady,
  setEffect: notReady,
  setBrightness: notReady,
  setMouseSettings: notReady,
  restoreSnapshot: notReady,
  saveToOnboard: notReady,
  setDesk: () => {},
  setLayout: () => {},
  addDefinition: () => {},
}));

/** First connected keyboard, if any. */
export function primaryKeyboard(devices: ConnectedDevice[]): ConnectedDevice | undefined {
  return devices.find((d) => d.definition.type === "keyboard");
}

/** First connected mouse, if any. */
export function primaryMouse(devices: ConnectedDevice[]): ConnectedDevice | undefined {
  return devices.find((d) => d.definition.type === "mouse");
}

/** The active layout of a keyboard. */
export function layoutOf(device: ConnectedDevice): Layout | undefined {
  const layouts = device.definition.layouts ?? {};
  return layouts[device.layoutId ?? device.definition.defaultLayout ?? ""] ?? Object.values(layouts)[0];
}
