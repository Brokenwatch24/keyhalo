import { backend } from "@/core/backend";
import type { HidDeviceInfo } from "@/core/backend/api";
import { useSignals } from "@/core/lighting/signals";
import { loadJson, saveJson, saveJsonDebounced } from "@/core/state/persist";
import type { ConnectedDevice, DeviceDefinition, DeviceSnapshot, DpiStage, HardwareEffect, MouseSettings } from "@/core/types";
import { bus } from "@/core/util/bus";
import { t } from "@/i18n";
import {
  bundledDefinitions,
  groupHid,
  installedDefinitions,
  isDefinition,
  matchDefinition,
  mergeDefinitions,
  saveInstalledDefinition,
} from "./definitions";
import { discoverLampArrays } from "./drivers/lamparray";
import { discoverOpenRgb } from "./drivers/openrgb";
import { razerDriver } from "./drivers/razer";
import { NotSupportedError, SafeModeError, parseHex, type DeviceHandle, type DiscoveredDevice, type HidDriver, type LedColor } from "./drivers/types";
import { primaryMouse, useDevices, type DeviceLiveState } from "./store";

/**
 * Device manager: scanning, matching, probing, snapshots, live state, mouse helpers and
 * the bus handlers for DPI / hardware effects. Implements the `useDevices` contract.
 */

const HID_DRIVERS: Record<string, HidDriver> = { razer: razerDriver };

interface Entry {
  uid: string;
  /** Transport key: "hid:<control path>" or the discovered device key. */
  key: string;
  handle: DeviceHandle;
  vendorId?: number;
  productId?: number;
}

interface Prefs {
  desk?: { x: number; y: number };
  layoutId?: string;
  sniperDpi?: number;
}

const entries = new Map<string, Entry>();
let prefs: Record<string, Prefs> = {};
let scanPromise: Promise<void> | null = null;
/** Per-device frames that replace the lighting engine output (wizard LED mapping). */
const overrides = new Map<string, LedColor[]>();

const PREFS_FILE = "devices/prefs.json";
const snapshotFile = (uid: string) => `snapshots/${uid.replace(/[^\w.-]+/g, "_")}.json`;

// ---------------------------------------------------------------------------
// Accessors for other core modules (lighting engine, wizard)
// ---------------------------------------------------------------------------

export function getHandle(uid: string): DeviceHandle | undefined {
  return entries.get(uid)?.handle;
}

export function getDevice(uid: string): ConnectedDevice | undefined {
  return useDevices.getState().devices.find((d) => d.uid === uid);
}

/** True when the lighting engine may stream frames to this device. */
export function acceptsFrames(uid: string): boolean {
  const live = useDevices.getState().live[uid];
  return live?.mode !== "hardware" && !!entries.get(uid)?.handle.setFrame;
}

/** Push a lighting frame (no-op for devices showing a hardware effect or under a wizard override). */
export function pushFrame(uid: string, frame: LedColor[]): void {
  const e = entries.get(uid);
  if (!e?.handle.setFrame) return;
  const override = overrides.get(uid);
  if (override) {
    void e.handle.setFrame(override).catch(() => {});
    return;
  }
  if (!acceptsFrames(uid)) return;
  void e.handle.setFrame(frame).catch((err) => reportError(uid, err));
}

/** Wizard: show `frame` on the device instead of the lighting engine output (null = release). */
export function setFrameOverride(uid: string, frame: LedColor[] | null) {
  if (frame) overrides.set(uid, frame);
  else overrides.delete(uid);
  const h = entries.get(uid)?.handle;
  if (frame && h?.setFrame) void h.setFrame(frame).catch(() => {});
}

/** Return devices (all when uid is omitted) to software (engine-driven) lighting. */
export function setSoftwareMode(uid?: string) {
  const live = { ...useDevices.getState().live };
  for (const id of uid ? [uid] : Object.keys(live)) if (live[id]) live[id] = { ...live[id], mode: "software" };
  useDevices.setState({ live });
}

/** `${vendorId}:${productId}` of every device driven by a native (HID) driver. */
export function nativeIds(): Set<string> {
  const s = new Set<string>();
  for (const e of entries.values()) if (e.key.startsWith("hid:") && e.vendorId !== undefined) s.add(`${e.vendorId}:${e.productId}`);
  return s;
}

function reportError(uid: string, err: unknown) {
  if (err instanceof SafeModeError) return;
  const message = err instanceof Error ? err.message : String(err);
  const devices = useDevices.getState().devices.map((d) => (d.uid === uid ? { ...d, error: message } : d));
  useDevices.setState({ devices });
}

function patchLive(uid: string, patch: Partial<DeviceLiveState>) {
  const live = useDevices.getState().live;
  useDevices.setState({ live: { ...live, [uid]: { ...live[uid], ...patch } } });
}

function patchDevice(uid: string, patch: Partial<ConnectedDevice>) {
  useDevices.setState({ devices: useDevices.getState().devices.map((d) => (d.uid === uid ? { ...d, ...patch } : d)) });
}

function savePrefs() {
  saveJsonDebounced(PREFS_FILE, prefs);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function defaultDesk(def: DeviceDefinition, devices: ConnectedDevice[]): { x: number; y: number } {
  const keyboards = devices.filter((d) => d.definition.type === "keyboard");
  const kbRight = keyboards.reduce((m, d) => Math.max(m, d.desk.x + d.definition.size.w), 0);
  const kbHeight = keyboards.reduce((m, d) => Math.max(m, d.definition.size.h), 5);
  if (def.type === "keyboard") return { x: kbRight === 0 ? 0 : kbRight + 1, y: 0 };
  if (def.type === "mouse") {
    const mice = devices.filter((d) => d.definition.type === "mouse").length;
    return { x: (kbRight || 15) + 1.5 + mice * 3, y: Math.max(0, +((kbHeight - def.size.h) / 2).toFixed(2)) };
  }
  const others = devices.filter((d) => d.definition.type !== "keyboard" && d.definition.type !== "mouse");
  return { x: others.reduce((m, d) => Math.max(m, d.desk.x + d.definition.size.w + 1), 0), y: kbHeight + 1.5 };
}

function shortHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function connect(definition: DeviceDefinition, handle: DeviceHandle, key: string, ids: { vendorId?: number; productId?: number }) {
  let info: Awaited<ReturnType<DeviceHandle["info"]>> = {};
  let online = true;
  let error: string | undefined;
  try {
    info = await handle.info();
  } catch (e) {
    online = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const uid = `${definition.id}:${info.serial || shortHash(key)}`;
  if (entries.has(uid)) {
    // Same physical device through a second transport (e.g. wired + dongle): keep the first one.
    return;
  }
  entries.set(uid, { uid, key, handle, ...ids });

  const state = useDevices.getState();
  const p = prefs[uid] ?? {};
  const hwLayout = info.layoutId ? definition.layoutDetection?.[info.layoutId] : undefined;
  const layouts = definition.layouts ?? {};
  const layoutId = [p.layoutId, hwLayout, definition.defaultLayout, Object.keys(layouts)[0]].find((l) => l && layouts[l.split("@")[0]]);
  const device: ConnectedDevice = {
    uid,
    definition,
    layoutId,
    firmware: info.firmware,
    serial: info.serial,
    desk: p.desk ?? defaultDesk(definition, state.devices),
    online,
    error,
  };

  // Snapshot before KeyHalo writes anything (only the first time we ever see this device).
  let current: DeviceSnapshot | null = null;
  if (online) {
    try {
      current = await handle.snapshot();
      const stored = await loadJson<DeviceSnapshot>(snapshotFile(uid));
      if (!stored) await saveJson(snapshotFile(uid), current);
    } catch (e) {
      console.warn(`[devices] snapshot failed for ${definition.name}`, e);
    }
  }
  const live: DeviceLiveState = {
    effect: current?.effect,
    brightness: current?.brightness,
    mouse: current?.mouse ? { ...current.mouse, sniperDpi: p.sniperDpi ?? current.mouse.sniperDpi } : undefined,
    dpi: current?.mouse?.dpiStages[current.mouse.activeStage],
    mode: "software",
  };
  useDevices.setState({
    devices: [...useDevices.getState().devices, device],
    live: { ...useDevices.getState().live, [uid]: live },
  });
  if (handle.getBattery) void pollBattery(uid);
}

async function disconnect(uid: string) {
  const e = entries.get(uid);
  entries.delete(uid);
  overrides.delete(uid);
  if (e) await e.handle.close().catch(() => {});
  const live = { ...useDevices.getState().live };
  delete live[uid];
  useDevices.setState({ devices: useDevices.getState().devices.filter((d) => d.uid !== uid), live });
  const battery = { ...useSignals.getState().battery };
  if (battery[uid]) {
    delete battery[uid];
    useSignals.getState().set({ battery });
  }
}

async function doScan() {
  useDevices.setState({ scanning: true });
  try {
    const definitions = useDevices.getState().definitions;
    let infos: HidDeviceInfo[] = [];
    try {
      infos = await backend.hidEnumerate();
    } catch (e) {
      console.warn("[devices] HID enumerate failed", e);
    }
    const seen = new Set<string>();
    const keyToUid = new Map([...entries.values()].map((e) => [e.key, e.uid]));

    for (const group of groupHid(infos)) {
      const match = matchDefinition(definitions, group);
      if (!match) continue;
      const key = `hid:${match.control.path}`;
      const existing = keyToUid.get(key);
      if (existing) {
        seen.add(existing);
        continue;
      }
      const driver = HID_DRIVERS[match.definition.driver];
      if (!driver) continue;
      try {
        const handle = await driver.open(match.definition, match.control, group);
        await connect(match.definition, handle, key, { vendorId: match.control.vendorId, productId: match.control.productId });
      } catch (e) {
        console.warn(`[devices] could not open ${match.definition.name}`, e);
      }
      const uid = [...entries.values()].find((x) => x.key === key)?.uid;
      if (uid) seen.add(uid);
    }

    // Devices with native drivers win over LampArray / OpenRGB duplicates.
    const native = nativeIds();
    for (const g of groupHid(infos)) if (matchDefinition(definitions, g)) native.add(`${g[0].vendorId}:${g[0].productId}`);
    const discovered: DiscoveredDevice[] = [...(await discoverLampArrays(definitions, native)), ...(await discoverOpenRgb(native))];
    for (const d of discovered) {
      const existing = keyToUid.get(d.key);
      if (existing) {
        seen.add(existing);
        continue;
      }
      await connect(d.definition, d.handle, d.key, { vendorId: d.vendorId, productId: d.productId });
      const uid = [...entries.values()].find((x) => x.key === d.key)?.uid;
      if (uid) seen.add(uid);
    }

    for (const uid of [...entries.keys()]) if (!seen.has(uid)) await disconnect(uid);
  } finally {
    useDevices.setState({ scanning: false });
  }
}

export function scan(): Promise<void> {
  if (!scanPromise) scanPromise = doScan().finally(() => (scanPromise = null));
  return scanPromise;
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

async function pollBattery(uid: string) {
  const h = entries.get(uid)?.handle;
  if (!h?.getBattery) return;
  try {
    const percent = await h.getBattery();
    const charging = (await h.getCharging?.().catch(() => false)) ?? false;
    patchLive(uid, { battery: { percent, charging } });
    useSignals.getState().set({ battery: { ...useSignals.getState().battery, [uid]: { percent, charging } } });
  } catch {
    /* asleep / out of range: keep the last value */
  }
}

// ---------------------------------------------------------------------------
// Actions (DevicesState implementation)
// ---------------------------------------------------------------------------

function need(uid: string): DeviceHandle {
  const h = entries.get(uid)?.handle;
  if (!h) throw new Error(t("devices.errors.notConnected"));
  return h;
}

async function guarded<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    patchDevice(uid, { error: undefined });
    return r;
  } catch (e) {
    reportError(uid, e);
    throw e;
  }
}

export async function setEffect(uid: string, effect: HardwareEffect, store = false) {
  const h = need(uid);
  if (!h.setEffect) throw new NotSupportedError("hardware effects");
  const prevMode = useDevices.getState().live[uid]?.mode;
  // Stop engine frames first, so none lands after the hardware effect.
  if (effect.type !== "custom") patchLive(uid, { mode: "hardware" });
  try {
    await guarded(uid, () => h.setEffect!(effect, store));
  } catch (e) {
    patchLive(uid, { mode: prevMode });
    throw e;
  }
  patchLive(uid, { effect, mode: effect.type === "custom" ? "software" : "hardware" });
}

export async function setBrightness(uid: string, value: number, store = false) {
  const h = need(uid);
  if (!h.setBrightness) throw new NotSupportedError("brightness");
  const v = Math.max(0, Math.min(1, value));
  await guarded(uid, () => h.setBrightness!(v, store));
  patchLive(uid, { brightness: v });
}

export async function setMouseSettings(uid: string, patch: Partial<MouseSettings>) {
  const h = need(uid);
  const prev = useDevices.getState().live[uid]?.mouse ?? { dpiStages: [], activeStage: 0, pollingRate: 1000 };
  const next: MouseSettings = { ...prev, ...patch };
  await guarded(uid, async () => {
    if ((patch.dpiStages || patch.activeStage !== undefined) && next.dpiStages.length) {
      next.activeStage = Math.max(0, Math.min(next.dpiStages.length - 1, next.activeStage));
      await h.setDpiStages?.({ stages: next.dpiStages, active: next.activeStage });
      await h.setDpi?.(next.dpiStages[next.activeStage]);
    }
    if (patch.pollingRate !== undefined && patch.pollingRate !== prev.pollingRate) await h.setPollingRate?.(patch.pollingRate);
    if (patch.idleSleepSeconds !== undefined) await h.setIdleSleep?.(patch.idleSleepSeconds);
    if (patch.lowBatteryThreshold !== undefined) await h.setLowBatteryThreshold?.(patch.lowBatteryThreshold);
  });
  if (patch.sniperDpi !== undefined) {
    prefs[uid] = { ...prefs[uid], sniperDpi: patch.sniperDpi };
    savePrefs();
  }
  const dpi = next.dpiStages[next.activeStage];
  patchLive(uid, { mouse: next, ...(dpi ? { dpi } : {}) });
}

export async function restoreSnapshot(uid: string) {
  const h = need(uid);
  const snap = await loadJson<DeviceSnapshot>(snapshotFile(uid));
  if (!snap) throw new Error(t("devices.errors.noSnapshot"));
  await guarded(uid, () => h.restore(snap));
  patchLive(uid, {
    effect: snap.effect,
    brightness: snap.brightness,
    mouse: snap.mouse ?? useDevices.getState().live[uid]?.mouse,
    mode: snap.effect && snap.effect.type !== "custom" ? "hardware" : "software",
  });
}

/**
 * Hand every device back to its own onboard lighting (the effect captured in its snapshot),
 * so nothing stays frozen on KeyHalo's last frame after the app quits.
 */
export async function handBackToHardware() {
  await Promise.all(
    [...entries.keys()].map(async (uid) => {
      if (!entries.get(uid)?.handle.setEffect) return;
      const snap = await loadJson<DeviceSnapshot>(snapshotFile(uid));
      const effect: HardwareEffect = snap?.effect && snap.effect.type !== "custom" ? snap.effect : { type: "spectrum" };
      try {
        await setEffect(uid, effect, false);
        if (snap?.brightness !== undefined) await setBrightness(uid, snap.brightness, false);
      } catch (e) {
        console.warn("[devices] could not hand back lighting", uid, e);
      }
    }),
  );
}

export async function saveToOnboard(uid: string, effect: HardwareEffect) {
  await setEffect(uid, effect, true);
}

export function setDesk(uid: string, pos: { x: number; y: number }) {
  prefs[uid] = { ...prefs[uid], desk: { x: pos.x, y: pos.y } };
  savePrefs();
  patchDevice(uid, { desk: { x: pos.x, y: pos.y } });
}

export function setLayout(uid: string, layoutId: string) {
  prefs[uid] = { ...prefs[uid], layoutId };
  savePrefs();
  patchDevice(uid, { layoutId });
}

export function addDefinition(def: DeviceDefinition) {
  if (!isDefinition(def)) return;
  useDevices.setState({ definitions: mergeDefinitions(useDevices.getState().definitions, [def]) });
  void saveInstalledDefinition(def).catch((e) => console.warn("[devices] could not save definition", e));
  void scan();
}

// ---------------------------------------------------------------------------
// DPI helpers (bus)
// ---------------------------------------------------------------------------

function targetMouse(uid?: string) {
  const devices = useDevices.getState().devices;
  return uid ? devices.find((d) => d.uid === uid) : primaryMouse(devices.filter((d) => entries.get(d.uid)?.handle.setDpi));
}

function dpiHud(uid: string, dpi: DpiStage, title = t("devices.hud.dpi")) {
  const max = getDevice(uid)?.definition.capabilities.dpi?.max ?? 20000;
  bus.emit("hud", { title, value: `${dpi.x} DPI`, progress: Math.min(1, dpi.x / max), icon: "dpi" });
}

export async function setDpi(value: number, uid?: string) {
  const m = targetMouse(uid);
  if (!m) return;
  const h = need(m.uid);
  const dpi = { x: Math.round(value), y: Math.round(value) };
  await guarded(m.uid, () => h.setDpi!(dpi));
  patchLive(m.uid, { dpi });
  dpiHud(m.uid, dpi);
}

export async function cycleDpi(direction: 1 | -1 = 1, uid?: string) {
  const m = targetMouse(uid);
  if (!m) return;
  const mouse = useDevices.getState().live[m.uid]?.mouse;
  if (!mouse?.dpiStages.length) return;
  const n = mouse.dpiStages.length;
  const activeStage = (((mouse.activeStage + direction) % n) + n) % n;
  await setMouseSettings(m.uid, { activeStage });
  dpiHud(m.uid, mouse.dpiStages[activeStage], t("devices.hud.dpiStage", { stage: activeStage + 1, count: n }));
}

const sniperRestore = new Map<string, DpiStage>();

export async function sniper(active: boolean, value?: number, uid?: string) {
  const m = targetMouse(uid);
  if (!m) return;
  const h = need(m.uid);
  const live = useDevices.getState().live[m.uid];
  if (active) {
    if (sniperRestore.has(m.uid)) return;
    const current = live?.dpi ?? live?.mouse?.dpiStages[live.mouse.activeStage] ?? (await h.getDpi?.());
    if (!current) return;
    sniperRestore.set(m.uid, current);
    const v = Math.round(value ?? live?.mouse?.sniperDpi ?? 400);
    await guarded(m.uid, () => h.setDpi!({ x: v, y: v }));
    patchLive(m.uid, { dpi: { x: v, y: v } });
    dpiHud(m.uid, { x: v, y: v }, t("devices.hud.sniper"));
  } else {
    const restore = sniperRestore.get(m.uid);
    sniperRestore.delete(m.uid);
    if (!restore) return;
    await guarded(m.uid, () => h.setDpi!(restore));
    patchLive(m.uid, { dpi: restore });
    dpiHud(m.uid, restore);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

let started = false;
const stops: (() => void)[] = [];

export async function startDeviceManager(opts: { pollMs?: number; batteryMs?: number } = {}) {
  if (started) return;
  started = true;
  prefs = (await loadJson<Record<string, Prefs>>(PREFS_FILE)) ?? {};
  const installed = await installedDefinitions();
  useDevices.setState({
    definitions: mergeDefinitions(bundledDefinitions(), installed),
    scan,
    setEffect,
    setBrightness,
    setMouseSettings,
    restoreSnapshot,
    saveToOnboard,
    setDesk,
    setLayout,
    addDefinition,
  });

  stops.push(
    bus.on("community:installed", ({ kind, data }) => {
      if (kind === "device" && isDefinition(data)) addDefinition(data);
    }),
    bus.on("dpi:set", ({ value, uid }) => void setDpi(value, uid).catch(logBusError)),
    bus.on("dpi:cycle", ({ direction }) => void cycleDpi(direction ?? 1).catch(logBusError)),
    bus.on("dpi:sniper", ({ active, value }) => void sniper(active, value).catch(logBusError)),
    bus.on("device:effect", ({ uid, effect }) => {
      const uids = uid ? [uid] : [...entries.values()].filter((e) => e.handle.setEffect).map((e) => e.uid);
      for (const u of uids) void setEffect(u, effect, false).catch(logBusError);
    }),
  );
  try {
    const off = await backend.on("hid-changed", () => void scan());
    stops.push(off);
  } catch {
    /* ignore */
  }

  await scan();
  const poll = setInterval(() => void scan(), opts.pollMs ?? 5000);
  const battery = setInterval(() => {
    for (const uid of entries.keys()) void pollBattery(uid);
  }, opts.batteryMs ?? 60_000);
  stops.push(() => clearInterval(poll), () => clearInterval(battery));
}

/** Stop timers and listeners (tests / hot reload). */
export async function stopDeviceManager() {
  stops.splice(0).forEach((s) => s());
  for (const uid of [...entries.keys()]) await disconnect(uid);
  started = false;
}

function logBusError(e: unknown) {
  if (!(e instanceof SafeModeError)) console.warn("[devices]", e);
}

export { parseHex };
