import { backend, isTauri } from "@/core/backend";
import { registerHotkey } from "@/core/integrations/hotkeys";
import { clearNotifications, useNotifications } from "@/core/integrations/notifications";
import { useSignals } from "@/core/lighting/signals";
import { bus } from "@/core/util/bus";
import { describePadAction, runPadAction } from "./actions";
import { ALL_BUTTONS, decode, grid, GRID, isLaunchpadPort, ledMessage, parseButton, RESET, right, top } from "./launchpad";
import { activePage, usePads } from "./store";
import type { PadButtonId, PadDef, PadMapPayload, PadPage } from "./types";

/**
 * Runs the pad controller: keeps the MIDI port open (and lets go while a DAW runs), turns
 * presses into actions, and redraws every LED ~10× per second from the board and live state.
 */

const TICK_MS = 100;
const CONNECT_MS = 3000;
const HOLD_MS = 500;
const MAP_BUTTON = right(7);
const DIM = 1 / 3;
const MID = 2 / 3;

type Led = { hex: string; b: number };

let port: string | null = null;
let lastSent = new Map<PadButtonId, string>();
const downAt = new Map<PadButtonId, number>();
const holdTimers = new Map<PadButtonId, ReturnType<typeof setTimeout>>();
const holdFired = new Set<PadButtonId>();
/** Page chosen by hand (restored when an app-specific page stops matching). */
let manualPage: string | null = null;

const lower = (s: string) => s.toLowerCase();
const globMatch = (pattern: string, name: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(name);

// ---------------------------------------------------------------------------
// Mixer
// ---------------------------------------------------------------------------

/** The process shown in each of the 8 mixer columns ("" columns take the next app playing audio). */
export function mixerColumns(page: PadPage, audio: { process: string }[]): (string | null)[] {
  const cols = (page.mixer ?? []).slice(0, GRID);
  while (cols.length < GRID) cols.push("");
  const explicit = new Set(cols.filter(Boolean).map(lower));
  const extra = audio.map((a) => a.process).filter((p) => p !== "master" && !explicit.has(lower(p)));
  return cols.map((c) => (c ? c : (extra.shift() ?? null)));
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

function stateLed(def: PadDef, t: number): Led {
  const s = def.state;
  const st = usePads.getState();
  if (!s) return { hex: def.color, b: MID };
  switch (s.type) {
    case "claude": {
      const c = useSignals.getState().claude?.state ?? "idle";
      if (c === "working") return { hex: "#3ccf4e", b: 0.34 + 0.66 * (0.5 + 0.5 * Math.sin((t / 1000) * Math.PI * 2 * 0.7)) };
      if (c === "waiting") return { hex: "#ff7a00", b: Math.floor(t / 300) % 2 ? 1 : 0.15 };
      if (c === "done") return { hex: "#3ccf4e", b: 1 };
      if (c === "error") return { hex: "#ff3b30", b: 1 };
      return { hex: def.color, b: DIM };
    }
    case "mic": {
      const m = useSignals.getState().micMuted;
      return m === undefined ? { hex: def.color, b: DIM } : m ? { hex: "#ff3b30", b: 1 } : { hex: "#3ccf4e", b: MID };
    }
    case "media":
      return st.media?.playing ? { hex: "#3ccf4e", b: 1 } : { hex: "#ffb000", b: DIM };
    case "notification": {
      const waiting = useNotifications.getState().pending.some((p) => p.ruleId === s.ruleId);
      return waiting ? { hex: def.color, b: Math.floor(t / 400) % 2 ? 1 : 0.15 } : { hex: def.color, b: DIM };
    }
    case "running":
      return { hex: def.color, b: st.running.includes(lower(s.process)) ? 1 : DIM };
  }
}

/** Desired LED for every button right now. */
export function computeLeds(t = performance.now()): Map<PadButtonId, Led> {
  const st = usePads.getState();
  const page = activePage(st);
  const out = new Map<PadButtonId, Led>();
  for (const id of ALL_BUTTONS) out.set(id, { hex: "#000000", b: 0 });
  // Right column: pages, then the pad map button.
  st.board.pages.slice(0, 7).forEach((p, i) => out.set(right(i), { hex: p.color, b: p.id === page?.id ? 1 : DIM }));
  out.set(MAP_BUTTON, { hex: "#ffe14d", b: st.mapVisible ? 1 : DIM });
  if (!page) return out;

  if (page.kind === "mixer") {
    const cols = mixerColumns(page, st.audio);
    cols.forEach((proc, x) => {
      const a = proc ? st.audio.find((v) => lower(v.process) === lower(proc)) : undefined;
      if (!proc) return;
      const lit = a ? Math.round(a.volume * GRID) : 0;
      for (let y = 0; y < GRID; y++) {
        const level = GRID - y; // 8 at the top row, 1 at the bottom
        if (level > lit) continue; out.set(grid(x, y), a?.muted ? { hex: "#ff3b30", b: DIM } : { hex: level >= 8 ? "#ff3b30" : level >= 6 ? "#ffb000" : "#3ccf4e", b: MID });
      }
      out.set(top(x), a?.muted ? { hex: "#ff3b30", b: 1 } : { hex: "#3ccf4e", b: a ? DIM : 0.15 });
    });
  } else {
    for (const [id, def] of Object.entries(page.pads)) out.set(id, stateLed(def, t));
  }
  // Pressed feedback on grid pages (the mixer shows the new level instead).
  if (page.kind === "grid") for (const id of Object.keys(st.pressed)) if (id !== MAP_BUTTON) out.set(id, { hex: "#ffe14d", b: 1 });
  return out;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

async function flush(force = false) {
  if (!port) return;
  if (force) lastSent = new Map();
  const msgs: number[][] = [];
  for (const [id, led] of computeLeds()) {
    const msg = ledMessage(id, led.hex, led.b);
    if (!msg) continue;
    const key = msg.join(",");
    if (lastSent.get(id) === key) continue;
    lastSent.set(id, key);
    msgs.push(msg);
  }
  if (msgs.length) await backend.midiSend(port, msgs).catch(() => {});
}

// ---------------------------------------------------------------------------
// Pad map overlay
// ---------------------------------------------------------------------------

export function mapPayload(): PadMapPayload {
  const st = usePads.getState();
  const page = activePage(st);
  const buttons: PadMapPayload["buttons"] = {};
  if (page?.kind === "mixer") {
    mixerColumns(page, st.audio).forEach((proc, x) => {
      if (proc) buttons[top(x)] = { label: proc === "master" ? "Master" : proc.replace(/\.exe$/i, ""), color: "#3ccf4e" };
    });
  } else if (page) {
    for (const [id, def] of Object.entries(page.pads)) buttons[id] = { label: def.label || describePadAction(def.action), color: def.color };
  }
  st.board.pages.slice(0, 7).forEach((p, i) => (buttons[right(i)] = { label: p.name, color: p.color }));
  buttons[MAP_BUTTON] = { label: "Map", color: "#ffe14d" };
  return { page: page?.name ?? "", pages: st.board.pages.map((p) => ({ name: p.name, color: p.color, active: p.id === page?.id })), buttons };
}

function syncMap() {
  const { mapVisible } = usePads.getState();
  void backend.padmapSet(mapVisible, mapVisible ? mapPayload() : undefined).catch(() => {});
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function hud(title: string) {
  if (usePads.getState().board.hud && title) bus.emit("hud", { title, icon: "keyboard", durationMs: 900 });
}

function run(def: PadDef | undefined, which: "action" | "hold") {
  const action = which === "hold" ? def?.hold : def?.action;
  if (!action) return;
  // Opening a message pad also marks its notifications as seen.
  if (def?.state?.type === "notification") clearNotifications(def.state.ruleId);
  if (action.type !== "map" && action.type !== "page") hud(def?.label || describePadAction(action));
  runPadAction(action).catch((e) => bus.emit("hud", { title: def?.label ?? "Pad", value: String((e as Error)?.message ?? e), icon: "info", color: "#ff6b6b" }));
}

/** Handle a press or release (from the device or the on-screen board). */
export function padInput(id: PadButtonId, down: boolean) {
  const st = usePads.getState();
  const page = activePage(st);
  const pressed = { ...st.pressed };
  if (down) pressed[id] = true;
  else delete pressed[id];
  usePads.setState({ pressed });

  // Pad map: hold to peek, tap to toggle.
  if (id === MAP_BUTTON) {
    if (down) {
      downAt.set(id, performance.now());
      if (!st.mapVisible) usePads.setState({ mapVisible: true });
      else downAt.set(id, -1); // already open: this tap closes it
    } else {
      const t0 = downAt.get(id) ?? 0;
      if (t0 === -1 || performance.now() - t0 > 400) usePads.setState({ mapVisible: false });
    }
    return;
  }
  const b = parseButton(id);
  if (!b || !page) return;
  if (b.kind === "r") {
    if (down && st.board.pages[b.y]) {
      manualPage = st.board.pages[b.y].id;
      st.setPage(manualPage);
    }
    return;
  }

  if (page.kind === "mixer") {
    if (!down) return;
    const proc = mixerColumns(page, st.audio)[b.x];
    if (!proc) return;
    const cur = st.audio.find((a) => lower(a.process) === lower(proc));
    const patch = b.kind === "t" ? { muted: !(cur?.muted ?? false) } : { volume: (GRID - b.y) / GRID, muted: false };
    // Optimistic: show the new level at once.
    usePads.setState({ audio: st.audio.map((a) => (a === cur ? { ...a, ...patch } : a)) });
    void backend.audioAppSet(proc, "volume" in patch ? patch.volume : undefined, patch.muted).catch(() => {});
    return;
  }

  const def = page.pads[id];
  if (!def) return;
  if (down) {
    if (def.hold) {
      holdFired.delete(id);
      holdTimers.set(
        id,
        setTimeout(() => {
          holdFired.add(id);
          run(def, "hold");
        }, HOLD_MS),
      );
    } else run(def, "action");
  } else if (def.hold) {
    clearTimeout(holdTimers.get(id));
    holdTimers.delete(id);
    if (!holdFired.has(id)) run(def, "action");
    holdFired.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function disconnect(reset = true) {
  if (!port) return;
  const p = port;
  port = null;
  if (reset) await backend.midiSend(p, [RESET]).catch(() => {});
  await backend.midiClose(p).catch(() => {});
}

async function connectTick() {
  const st = usePads.getState();
  let procs: string[] = [];
  try {
    procs = await backend.processes();
  } catch {
    /* keep going */
  }
  usePads.setState({ running: procs.map(lower) });

  const blocker = procs.find((p) => st.board.releaseFor.some((g) => globMatch(g, p)));
  if (blocker) {
    const name = port ?? st.board.port ?? "Launchpad";
    await disconnect();
    usePads.setState({ connection: { state: "released", port: name, app: blocker.replace(/\.exe$/i, "") } });
    return;
  }
  if (port) return;
  let ports: { inputs: string[]; outputs: string[] };
  try {
    ports = await backend.midiList();
  } catch {
    usePads.setState({ connection: { state: "searching" } });
    return;
  }
  const name = st.board.port ? ports.inputs.find((p) => p === st.board.port) : ports.inputs.find(isLaunchpadPort);
  if (!name) {
    usePads.setState({ connection: { state: "searching" } });
    return;
  }
  try {
    await backend.midiOpen(name);
    port = name;
    usePads.setState({ connection: { state: "connected", port: name } });
    await backend.midiSend(name, [RESET]).catch(() => {});
    await flush(true);
  } catch (e) {
    usePads.setState({ connection: { state: "busy", port: name, message: String((e as Error)?.message ?? e).replace(/^busy:\s*/, "") } });
  }
}

let started = false;

export async function startPads() {
  if (started) return;
  started = true;
  await usePads.getState().hydrate();

  await backend.on("midi-message", ({ port: p, data }) => {
    if (p !== port) return;
    const ev = decode(data);
    if (ev) padInput(ev.id, ev.down);
  });
  await backend.on("midi-closed", ({ port: p }) => {
    if (p !== port) return;
    port = null;
    usePads.setState({ connection: { state: "searching" } });
  });
  await backend.on("app-quitting", () => void disconnect());

  // App-specific pages.
  await backend.on("foreground-changed", (fg) => {
    const st = usePads.getState();
    const match = st.board.pages.find((p) => p.apps?.some((a) => globMatch(a, fg.process)));
    if (match) {
      if (st.pageId !== match.id) {
        if (!st.board.pages.find((p) => p.id === st.pageId)?.apps?.length) manualPage = st.pageId;
        st.setPage(match.id);
      }
    } else if (st.board.pages.find((p) => p.id === st.pageId)?.apps?.length && manualPage) st.setPage(manualPage);
  });

  // Live data, only what the active page needs.
  let tick = 0;
  setInterval(() => {
    tick++;
    const st = usePads.getState();
    const page = activePage(st);
    const needAudio = page?.kind === "mixer" || st.mapVisible;
    const needMedia = page?.kind === "grid" && Object.values(page.pads).some((d) => d.state?.type === "media");
    if (port && needAudio && tick % 5 === 0) void backend.audioApps().then((audio) => usePads.setState({ audio }), () => {});
    if (port && needMedia && tick % 10 === 0) void backend.mediaState().then((media) => usePads.setState({ media }), () => {});
    void flush();
  }, TICK_MS);

  void connectTick();
  setInterval(() => void connectTick(), CONNECT_MS);

  // Pad map overlay follows page / board / visibility changes.
  usePads.subscribe((s, p) => {
    if (s.mapVisible !== p.mapVisible || (s.mapVisible && (s.pageId !== p.pageId || s.board !== p.board || s.audio !== p.audio))) syncMap();
  });

  // Map hotkey.
  let unregister: (() => void) | null = null;
  let current = "";
  const syncHotkey = () => {
    const want = isTauri ? usePads.getState().board.mapHotkey : "";
    if (want === current) return;
    current = want;
    unregister?.();
    unregister = null;
    if (want)
      void registerHotkey(want, () => usePads.setState((s) => ({ mapVisible: !s.mapVisible })))
        .then((u) => (unregister = u))
        .catch((e) => console.warn("[pads] map hotkey", e));
  };
  syncHotkey();
  usePads.subscribe((s, p) => s.board.mapHotkey !== p.board.mapHotkey && syncHotkey());
}
