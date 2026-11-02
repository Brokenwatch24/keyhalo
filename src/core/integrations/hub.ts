import { create } from "zustand";
import { backend, isTauri } from "@/core/backend";
import type { MacroStep } from "@/core/types";
import { t } from "@/i18n";
import { bus } from "@/core/util/bus";

/**
 * BrokenWatchHub ("el Puente", http://127.0.0.1:7800): your to-dos (kept by HILO, read through
 * the Puente) and Broken, its voice assistant. KeyHalo reads the Puente's address and token from
 * its config file on this PC; nothing is set up by hand.
 */
export interface HubConfig {
  port: number;
  token: string;
  combo: string;
  keyActive: boolean;
}

/** A to-do as HILO lists it: from your WhatsApp chats or dictated. */
export interface HubTask {
  id: string;
  /** "Prometí", "Me pidieron", "Fecha", "Pendiente"… */
  kind: string;
  title: string;
  full: string;
  who: string | null;
  due: string | null;
  overdue: boolean;
  conversationId: string | null;
}

export const useHub = create<{ installed: boolean | null }>(() => ({ installed: null }));

let cache: { at: number; cfg: HubConfig | null } | null = null;

export async function hubConfig(): Promise<HubConfig | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.cfg;
  const cfg = isTauri ? await backend.hubConfig().catch(() => null) : null;
  cache = { at: Date.now(), cfg };
  if (useHub.getState().installed !== !!cfg) useHub.setState({ installed: !!cfg });
  return cfg;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const c = await hubConfig();
  if (!c) throw new Error(t("pads.hub.missing"));
  const r = await backend.httpRequest({
    method,
    url: `http://127.0.0.1:${c.port}/api${path}`,
    headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 8000,
  });
  let data: unknown = {};
  try {
    data = r.body ? JSON.parse(r.body) : {};
  } catch {
    // not JSON
  }
  if (r.status >= 400) throw new Error((data as { error?: string }).error ?? `BrokenWatchHub: HTTP ${r.status}`);
  return data as T;
}

export const hub = {
  tasks: () => call<HubTask[]>("GET", "/hilo/pendientes"),
  done: (id: string) => call<{ ok: boolean }>("POST", `/hilo/memoria/${encodeURIComponent(id)}/hecho`, {}),
  /** HILO reads the date from the text ("mañana a las 3", "el viernes"). */
  capture: (text: string) => call<{ ok: boolean; kind: string; title: string }>("POST", "/hilo/captura", { text }),
};

// ---------------------------------------------------------------------------
// Broken's key
// ---------------------------------------------------------------------------

const NAMES: Record<string, string> = { ctrl: "ControlLeft", control: "ControlLeft", alt: "AltLeft", shift: "ShiftLeft", win: "MetaLeft", space: "Space", espacio: "Space", enter: "Enter" };

/** "Ctrl+Alt+Space" → ["ControlLeft", "AltLeft", "Space"] (the last one is the key you hold). */
export function comboKeys(combo: string): string[] {
  return combo
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .map((p) => NAMES[p] ?? (/^[a-z]$/.test(p) ? `Key${p.toUpperCase()}` : /^[0-9]$/.test(p) ? `Digit${p}` : /^f\d{1,2}$/.test(p) ? p.toUpperCase() : ""))
    .filter(Boolean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The press in progress (a fast tap may release before it is done) and the key held down. */
let pressing: Promise<string | null> | null = null;

/**
 * A pad that talks to Broken: it holds the Puente's combination while you hold the pad, so it
 * works exactly like Broken's key (hold = talk, tap = mic open until the next tap).
 */
export function brokenPad(down: boolean) {
  if (down) {
    pressing = (async () => {
      const c = await hubConfig();
      if (!c || !c.keyActive) {
        bus.emit("hud", { title: "Broken", value: t(c ? "pads.hub.keyOff" : "pads.hub.missing"), icon: "info", color: "#ff6b6b", durationMs: 2500 });
        return null;
      }
      const keys = comboKeys(c.combo);
      if (!keys.length) return null;
      const main = keys[keys.length - 1];
      const mods = keys.slice(0, -1);
      await backend.inputSend([...mods.map((key) => ({ op: "down", key }) as MacroStep), { op: "down", key: main }]).catch(() => {});
      // The hotkey has fired: let go of the modifiers so they don't change other clicks. Broken
      // listens to the main key to know you are still holding.
      await sleep(80);
      await backend.inputSend([...mods].reverse().map((key) => ({ op: "up", key }) as MacroStep)).catch(() => {});
      return main;
    })();
    return;
  }
  const p = pressing;
  pressing = null;
  void p?.then((main) => {
    if (main) void backend.inputSend([{ op: "up", key: main }]).catch(() => {});
  });
}
