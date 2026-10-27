/**
 * OpenRGB SDK network protocol (TCP, default port 6742). Pure encode/decode helpers.
 * Facts and sources: docs/protocols/openrgb-sdk.md. All integers are little-endian.
 */

export const ORGB_MAGIC = [0x4f, 0x52, 0x47, 0x42]; // "ORGB"
export const HEADER_LEN = 16;
/** Highest protocol version this client understands. */
export const CLIENT_PROTOCOL_VERSION = 5;

export const PKT = {
  REQUEST_CONTROLLER_COUNT: 0,
  REQUEST_CONTROLLER_DATA: 1,
  REQUEST_PROTOCOL_VERSION: 40,
  SET_CLIENT_NAME: 50,
  DEVICE_LIST_UPDATED: 100,
  RGBCONTROLLER_RESIZEZONE: 1000,
  RGBCONTROLLER_UPDATELEDS: 1050,
  RGBCONTROLLER_UPDATEZONELEDS: 1051,
  RGBCONTROLLER_UPDATESINGLELED: 1052,
  RGBCONTROLLER_SETCUSTOMMODE: 1100,
  RGBCONTROLLER_UPDATEMODE: 1101,
} as const;

/** OpenRGB device_type enum. */
export const DEVICE_TYPES = [
  "motherboard", "dram", "gpu", "cooler", "ledstrip", "keyboard", "mouse", "mousemat", "headset",
  "headset_stand", "gamepad", "light", "speaker", "virtual", "storage", "case", "microphone", "accessory",
  "keypad", "unknown",
] as const;

export const ZONE_TYPE = { SINGLE: 0, LINEAR: 1, MATRIX: 2 } as const;

export interface OrgbHeader {
  devIdx: number;
  pktId: number;
  size: number;
}

export interface OrgbMode {
  name: string;
  value: number;
  flags: number;
}

export interface OrgbZone {
  name: string;
  type: number;
  ledsMin: number;
  ledsMax: number;
  ledsCount: number;
  /** Matrix map: rows of LED indices *within the zone*, 0xFFFFFFFF = no LED. */
  matrix?: { height: number; width: number; map: number[] };
}

export interface OrgbLed {
  name: string;
  value: number;
}

export interface OrgbController {
  type: number;
  typeName: string;
  name: string;
  vendor: string;
  description: string;
  version: string;
  serial: string;
  location: string;
  activeMode: number;
  modes: OrgbMode[];
  zones: OrgbZone[];
  leds: OrgbLed[];
  colors: [number, number, number][];
}

export const NO_LED = 0xffffffff;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];

export function encodeHeader(devIdx: number, pktId: number, size: number): number[] {
  return [...ORGB_MAGIC, ...u32(devIdx), ...u32(pktId), ...u32(size)];
}

export function encodePacket(devIdx: number, pktId: number, payload: number[] = []): number[] {
  return [...encodeHeader(devIdx, pktId, payload.length), ...payload];
}

export function decodeHeader(b: ArrayLike<number>): OrgbHeader {
  for (let i = 0; i < 4; i++) if (b[i] !== ORGB_MAGIC[i]) throw new Error("Bad OpenRGB packet magic");
  const r = new Reader(b, 4);
  return { devIdx: r.u32(), pktId: r.u32(), size: r.u32() };
}

/** NUL-terminated ASCII (SET_CLIENT_NAME). */
export function encodeCString(s: string): number[] {
  return [...Array.from(s, (c) => c.charCodeAt(0) & 0x7f), 0];
}

/** UPDATELEDS payload: [data_size u32][count u16][count × (r,g,b,0)]. */
export function encodeUpdateLeds(colors: ArrayLike<number>[]): number[] {
  const body: number[] = [...u16(colors.length)];
  for (const c of colors) body.push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff, 0);
  return [...u32(body.length + 4), ...body];
}

export const encodeU32 = u32;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export class Reader {
  constructor(
    private b: ArrayLike<number>,
    public o = 0,
  ) {}
  u8() {
    return this.b[this.o++];
  }
  u16() {
    const v = this.b[this.o] | (this.b[this.o + 1] << 8);
    this.o += 2;
    return v;
  }
  u32() {
    const v = (this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16) | (this.b[this.o + 3] << 24)) >>> 0;
    this.o += 4;
    return v;
  }
  i32() {
    return this.u32() | 0;
  }
  /** u16 length (including the NUL) + bytes. */
  str() {
    const len = this.u16();
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = this.b[this.o + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    this.o += len;
    return s;
  }
  get remaining() {
    return this.b.length - this.o;
  }
}

/** Parse a REQUEST_CONTROLLER_DATA reply for the negotiated protocol version. */
export function decodeController(b: ArrayLike<number>, protocol: number): OrgbController {
  const r = new Reader(b);
  r.u32(); // data_size
  const type = r.i32();
  const name = r.str();
  const vendor = protocol >= 1 ? r.str() : "";
  const description = r.str();
  const version = r.str();
  const serial = r.str();
  const location = r.str();
  const numModes = r.u16();
  const activeMode = r.i32();
  const modes: OrgbMode[] = [];
  for (let i = 0; i < numModes; i++) {
    const mName = r.str();
    const value = r.i32();
    const flags = r.u32();
    r.u32(); // speed_min
    r.u32(); // speed_max
    if (protocol >= 3) {
      r.u32(); // brightness_min
      r.u32(); // brightness_max
    }
    r.u32(); // colors_min
    r.u32(); // colors_max
    r.u32(); // speed
    if (protocol >= 3) r.u32(); // brightness
    r.u32(); // direction
    r.u32(); // color_mode
    const nColors = r.u16();
    r.o += nColors * 4;
    modes.push({ name: mName, value, flags });
  }
  const numZones = r.u16();
  const zones: OrgbZone[] = [];
  for (let i = 0; i < numZones; i++) {
    const zName = r.str();
    const zType = r.i32();
    const ledsMin = r.u32();
    const ledsMax = r.u32();
    const ledsCount = r.u32();
    const matrixLen = r.u16();
    const zone: OrgbZone = { name: zName, type: zType, ledsMin, ledsMax, ledsCount };
    if (matrixLen > 0) {
      const height = r.u32();
      const width = r.u32();
      const map: number[] = [];
      for (let j = 0; j < height * width; j++) map.push(r.u32());
      zone.matrix = { height, width, map };
    }
    if (protocol >= 4) {
      const numSegments = r.u16();
      for (let s = 0; s < numSegments; s++) {
        r.str(); // segment name
        r.i32(); // type
        r.u32(); // start index
        r.u32(); // leds count
      }
    }
    if (protocol >= 5) r.u32(); // zone flags
    zones.push(zone);
  }
  const numLeds = r.u16();
  const leds: OrgbLed[] = [];
  for (let i = 0; i < numLeds; i++) leds.push({ name: r.str(), value: r.u32() });
  const numColors = r.u16();
  const colors: [number, number, number][] = [];
  for (let i = 0; i < numColors; i++) {
    const c: [number, number, number] = [r.u8(), r.u8(), r.u8()];
    r.u8();
    colors.push(c);
  }
  return {
    type,
    typeName: DEVICE_TYPES[type] ?? "unknown",
    name,
    vendor,
    description,
    version,
    serial,
    location,
    activeMode,
    modes,
    zones,
    leds,
    colors,
  };
}

// ---------------------------------------------------------------------------
// LED names → KeyboardEvent.code
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  escape: "Escape", esc: "Escape", "`": "Backquote", "~": "Backquote", "-": "Minus", "=": "Equal", backspace: "Backspace",
  tab: "Tab", "[": "BracketLeft", "]": "BracketRight", "\\ (ansi)": "Backslash", "\\": "Backslash", "caps lock": "CapsLock",
  ";": "Semicolon", "'": "Quote", "#": "Backslash", "pound": "Backslash", enter: "Enter", "enter (iso)": "Enter",
  "left shift": "ShiftLeft", "\\ (iso)": "IntlBackslash", ",": "Comma", ".": "Period", "/": "Slash", "right shift": "ShiftRight",
  "left control": "ControlLeft", "left windows": "MetaLeft", "left alt": "AltLeft", space: "Space", "right alt": "AltRight",
  "right windows": "MetaRight", "right fn": "Fn", fn: "Fn", menu: "ContextMenu", "context menu": "ContextMenu",
  "right control": "ControlRight", "print screen": "PrintScreen", "scroll lock": "ScrollLock", "pause/break": "Pause",
  pause: "Pause", insert: "Insert", home: "Home", "page up": "PageUp", delete: "Delete", end: "End", "page down": "PageDown",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", "up arrow": "ArrowUp", "down arrow": "ArrowDown",
  "left arrow": "ArrowLeft", "right arrow": "ArrowRight", "num lock": "NumLock", "number pad /": "NumpadDivide",
  "number pad *": "NumpadMultiply", "number pad -": "NumpadSubtract", "number pad +": "NumpadAdd",
  "number pad enter": "NumpadEnter", "number pad .": "NumpadDecimal", "media play/pause": "MediaPlayPause",
  "media next": "MediaTrackNext", "media previous": "MediaTrackPrevious", "media stop": "MediaStop", "media mute": "AudioVolumeMute",
};

/** "Key: A" → "KeyA", "Key: Left Shift" → "ShiftLeft", "Key: Number Pad 7" → "Numpad7". Null if unknown. */
export function ledNameToCode(name: string): string | null {
  const m = /^key:\s*(.+)$/i.exec(name.trim());
  if (!m) return null;
  const k = m[1].trim();
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
  const np = /^number pad ([0-9])$/i.exec(k);
  if (np) return `Numpad${np[1]}`;
  return NAMED[k.toLowerCase()] ?? null;
}
