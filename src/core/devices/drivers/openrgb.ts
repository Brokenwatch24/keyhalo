import { backend } from "@/core/backend";
import { useSettings } from "@/core/state/settings";
import type { DeviceDefinition, DeviceSnapshot, DeviceType, KeyDef, LedDef } from "@/core/types";
import {
  CLIENT_PROTOCOL_VERSION,
  HEADER_LEN,
  NO_LED,
  PKT,
  Reader,
  ZONE_TYPE,
  decodeController,
  decodeHeader,
  encodeCString,
  encodePacket,
  encodeU32,
  encodeUpdateLeds,
  ledNameToCode,
  type OrgbController,
} from "./openrgb-protocol";
import { FramePump, SerialQueue, type DeviceHandle, type DeviceInfo, type DiscoveredDevice, type LedColor } from "./types";
import { legendFor } from "./vk";

/**
 * OpenRGB SDK client: drives any device the OpenRGB server supports (motherboards, RAM, GPUs,
 * other brands' peripherals) through `backend.tcp*`. Optional: only connects when
 * `settings.openrgb.enabled` is true.
 */

export const OPENRGB_DEFAULTS = { enabled: false, host: "127.0.0.1", port: 6742 };

export function openRgbSettings() {
  return { ...OPENRGB_DEFAULTS, ...(useSettings.getState().settings.openrgb ?? {}) };
}

class OpenRgbClient {
  id?: string;
  protocol = 0;
  listUpdated = true;
  endpoint = "";
  readonly queue = new SerialQueue();

  async connect(host: string, port: number) {
    this.endpoint = `${host}:${port}`;
    this.id = await backend.tcpConnect(host, port);
    this.listUpdated = true;
    // Protocol negotiation: servers older than v1 never answer this request.
    await backend.tcpSend(this.id, encodePacket(0, PKT.REQUEST_PROTOCOL_VERSION, encodeU32(CLIENT_PROTOCOL_VERSION)));
    try {
      const reply = await this.read(1500);
      const server = new Reader(reply.payload).u32();
      this.protocol = Math.min(CLIENT_PROTOCOL_VERSION, server);
    } catch {
      this.protocol = 0;
    }
    await backend.tcpSend(this.id, encodePacket(0, PKT.SET_CLIENT_NAME, encodeCString("KeyHalo")));
  }

  private async read(timeoutMs: number): Promise<{ pktId: number; devIdx: number; payload: number[] }> {
    for (;;) {
      const h = decodeHeader(await backend.tcpRecv(this.id!, HEADER_LEN, timeoutMs));
      const payload = h.size ? await backend.tcpRecv(this.id!, h.size, timeoutMs) : [];
      if (h.pktId === PKT.DEVICE_LIST_UPDATED) {
        this.listUpdated = true;
        continue;
      }
      return { pktId: h.pktId, devIdx: h.devIdx, payload };
    }
  }

  request(devIdx: number, pktId: number, payload: number[] = []): Promise<number[]> {
    return this.queue.run(async () => {
      await backend.tcpSend(this.id!, encodePacket(devIdx, pktId, payload));
      for (;;) {
        const r = await this.read(3000);
        if (r.pktId === pktId) return r.payload;
      }
    });
  }

  send(devIdx: number, pktId: number, payload: number[] = []): Promise<void> {
    return this.queue.run(() => backend.tcpSend(this.id!, encodePacket(devIdx, pktId, payload)));
  }

  async close() {
    if (this.id) await backend.tcpClose(this.id).catch(() => {});
    this.id = undefined;
  }
}

class OpenRgbHandle implements DeviceHandle {
  readonly driver = "openrgb" as const;
  private pump: FramePump<LedColor[]>;
  private customSet = false;

  constructor(
    readonly definition: DeviceDefinition,
    readonly path: string,
    private client: OpenRgbClient,
    public devIdx: number,
    private ledCount: number,
  ) {
    this.pump = new FramePump(
      (f) => this.send(f),
      (f) => f.map((c) => `${c.led}:${c.color.join(",")}`).join(";"),
      30,
      (e) => console.warn(`[openrgb] frame failed on ${definition.name}`, e),
    );
  }

  async info(): Promise<DeviceInfo> {
    return {};
  }

  setFrame(frame: LedColor[]): Promise<void> {
    if (useSettings.getState().settings.safeMode || !this.client.id) return Promise.resolve();
    return this.pump.push(frame);
  }

  private async send(frame: LedColor[]) {
    if (!this.customSet) {
      await this.client.send(this.devIdx, PKT.RGBCONTROLLER_SETCUSTOMMODE);
      this.customSet = true;
    }
    const colors = Array.from({ length: this.ledCount }, () => [0, 0, 0]);
    for (const { led, color } of frame) {
      const i = Array.isArray(led) ? led[1] : led;
      if (i >= 0 && i < this.ledCount) colors[i] = color.map((v) => Math.max(0, Math.min(255, Math.round(v))));
    }
    await this.client.send(this.devIdx, PKT.RGBCONTROLLER_UPDATELEDS, encodeUpdateLeds(colors));
  }

  async snapshot(): Promise<DeviceSnapshot> {
    return { capturedAt: new Date().toISOString() };
  }

  async restore(): Promise<void> {
    /* OpenRGB keeps its own profiles; nothing to restore from KeyHalo. */
  }

  async close(): Promise<void> {}
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function deviceType(typeName: string): DeviceType {
  if (typeName === "keyboard" || typeName === "keypad") return "keyboard";
  if (typeName === "mouse") return "mouse";
  if (typeName === "mousemat") return "mousepad";
  if (typeName === "headset" || typeName === "headset_stand") return "headset";
  return "other";
}

/** Build a definition from a controller's zones (matrix zones become keys). */
export function synthesizeOpenRgbDefinition(c: OrgbController, index: number): DeviceDefinition {
  const type = deviceType(c.typeName);
  const def: DeviceDefinition = {
    id: `openrgb-${slug(c.name) || "device"}-${index}`,
    name: c.name,
    vendor: c.vendor || "OpenRGB",
    type,
    match: [],
    driver: "openrgb",
    driverOptions: { location: c.location, serial: c.serial },
    capabilities: { perKeyRgb: c.zones.some((z) => z.type === ZONE_TYPE.MATRIX), zones: true },
    size: { w: 1, h: 1 },
    status: "experimental",
    notes: `OpenRGB ${c.typeName} controller (${c.description || "no description"}).`,
  };
  const keys: KeyDef[] = [];
  const leds: LedDef[] = [];
  const used = new Set<string>();
  let start = 0;
  let y = 0;
  let maxW = 1;
  for (const z of c.zones) {
    if (z.type === ZONE_TYPE.MATRIX && z.matrix) {
      const { width, height, map } = z.matrix;
      for (let r = 0; r < height; r++) {
        for (let col = 0; col < width; col++) {
          const local = map[r * width + col];
          if (local === NO_LED || local >= z.ledsCount) continue;
          const idx = start + local;
          const name = c.leds[idx]?.name ?? `LED ${idx}`;
          const code = ledNameToCode(name);
          if (code && !used.has(code) && type === "keyboard") {
            used.add(code);
            keys.push({ code, label: legendFor(code), x: col, y: y + r, led: idx });
          } else {
            leds.push({ id: `led-${idx}`, name, x: col + 0.5, y: y + r + 0.5, w: 0.8, h: 0.8, led: idx });
          }
        }
      }
      maxW = Math.max(maxW, width);
      y += height;
    } else {
      for (let i = 0; i < z.ledsCount; i++) {
        const idx = start + i;
        leds.push({ id: `led-${idx}`, name: c.leds[idx]?.name ?? `${z.name} ${i + 1}`, x: i + 0.5, y: y + 0.5, w: 0.8, h: 0.8, led: idx });
      }
      maxW = Math.max(maxW, z.ledsCount);
      y += 1;
    }
    start += z.ledsCount;
  }
  if (type === "mouse") {
    // Squeeze zone LEDs into the MouseView box (0..2 × 0..3.4).
    const n = leds.length || 1;
    leds.forEach((l, i) => {
      l.x = 1;
      l.y = +(0.5 + (2.6 * (i + 0.5)) / n).toFixed(3);
      l.w = 0.4;
      l.h = Math.min(0.4, 2.6 / n);
    });
    def.size = { w: 2, h: 3.4 };
  } else {
    def.size = { w: Math.max(1, maxW), h: Math.max(1, y) };
  }
  if (keys.length) {
    def.layouts = { openrgb: { id: "openrgb", name: "OpenRGB matrix", standard: "custom", keys } };
    def.defaultLayout = "openrgb";
  }
  if (leds.length) def.leds = leds;
  return def;
}

const client = new OpenRgbClient();
let cache: DiscoveredDevice[] = [];

/** Vendor/product ids parsed from an OpenRGB location string ("HID: …VID_1532&PID_0257…"). */
export function locationIds(location: string): { vendorId: number; productId: number } | null {
  const m = /VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i.exec(location);
  return m ? { vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) } : null;
}

/**
 * Controllers exposed by the OpenRGB server (empty when disabled/unreachable). Devices already
 * driven natively (same VID/PID) are skipped.
 */
export async function discoverOpenRgb(nativeIds: Set<string>): Promise<DiscoveredDevice[]> {
  const cfg = openRgbSettings();
  const endpoint = `${cfg.host}:${cfg.port}`;
  if (!cfg.enabled) {
    if (client.id) await client.close();
    cache = [];
    return [];
  }
  try {
    if (!client.id || client.endpoint !== endpoint) {
      await client.close();
      await client.connect(cfg.host, cfg.port);
    }
    if (!client.listUpdated) return cache;
    client.listUpdated = false;
    const countReply = await client.request(0, PKT.REQUEST_CONTROLLER_COUNT);
    const count = new Reader(countReply).u32();
    const out: DiscoveredDevice[] = [];
    for (let i = 0; i < count; i++) {
      const data = await client.request(i, PKT.REQUEST_CONTROLLER_DATA, client.protocol >= 1 ? encodeU32(client.protocol) : []);
      const ctrl = decodeController(data, client.protocol);
      const ids = locationIds(ctrl.location);
      if (ids && nativeIds.has(`${ids.vendorId}:${ids.productId}`)) continue;
      const definition = synthesizeOpenRgbDefinition(ctrl, i);
      const key = `openrgb:${ctrl.name}:${ctrl.location || i}`;
      const prev = cache.find((d) => d.key === key);
      const handle = prev?.handle instanceof OpenRgbHandle ? prev.handle : new OpenRgbHandle(definition, key, client, i, ctrl.leds.length);
      if (handle instanceof OpenRgbHandle) handle.devIdx = i;
      out.push({ key, definition, handle, vendorId: ids?.vendorId, productId: ids?.productId });
    }
    cache = out;
    return out;
  } catch (e) {
    console.warn("[openrgb] not available", e);
    await client.close();
    cache = [];
    return [];
  }
}
