import { backend } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import type { GamesConfig } from "./config";
import { deriveGameEvents, gsiConfigFile, GSI_TARGETS, joinPath, parseCs2, parseDota, parseLol, type GameEvent, type GameId, type GameSignal } from "./gsi";
import { registerTest, useIntegrations, watchConfig } from "./store";

/** Live game state from official APIs → `signals.game` + derived events for automations. */
let cfg: GamesConfig | null = null;
let current: GameSignal | undefined;
let staleTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(game: GameId, event: GameEvent) => void>();

/** Subscribe to derived game events (bomb_planted, low_health, death, round_start…). */
export function onGameEvent(cb: (game: GameId, event: GameEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function apply(next: GameSignal) {
  const events = deriveGameEvents(current, next, cfg?.lowHealth ?? 30);
  current = next;
  useSignals.getState().set({ game: next });
  useIntegrations.getState().setStatus("games", "connected", next.game);
  events.forEach((e) => listeners.forEach((l) => l(next.game, e)));
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    current = undefined;
    useSignals.getState().set({ game: undefined });
    useIntegrations.getState().setStatus("games", "idle");
  }, 30_000);
}

/** Feed a raw GSI payload (exposed for tests and the UI's "simulate" button). */
export function handleGsi(game: "cs2" | "dota2", payload: unknown) {
  if (!cfg?.enabled || !cfg[game]) return;
  const token = useSettings.getState().settings.api.token;
  const auth = (payload as { auth?: { token?: unknown } } | null)?.auth?.token;
  if (token && auth !== undefined && auth !== token) return; // config from someone else
  const parsed = game === "cs2" ? parseCs2(payload) : parseDota(payload);
  if (parsed) apply(parsed);
}

function randomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GsiInstallResult {
  ok: boolean;
  path?: string;
  message: string;
}

/**
 * Write the Game State Integration config into the game's cfg folder (found through Steam).
 * Generates an API token first when none is set (GSI authenticates with it).
 */
export async function installGsi(game: "cs2" | "dota2"): Promise<GsiInstallResult> {
  const target = GSI_TARGETS[game];
  const dir = await backend.findSteamGame(target.folder).catch(() => null);
  if (!dir) return { ok: false, message: `${game === "cs2" ? "Counter-Strike 2" : "Dota 2"} was not found in your Steam libraries.` };
  const settings = useSettings.getState();
  let { api } = settings.settings;
  if (!api.token) {
    api = { ...api, token: randomToken() };
    settings.update({ api });
  }
  const path = joinPath(dir, target.path);
  await backend.writeFile(path, gsiConfigFile(game, api.port, api.token));
  return { ok: true, path, message: `Installed. Restart ${game === "cs2" ? "CS2" : "Dota 2"} to activate it.` };
}

// --- League of Legends (Live Client Data API, only while the game runs) -------------------
let lolProcTimer: ReturnType<typeof setInterval> | undefined;
let lolTimer: ReturnType<typeof setInterval> | undefined;
let lolBusy = false;

async function pollLol() {
  if (lolBusy) return;
  lolBusy = true;
  try {
    const res = await backend.httpRequest({ method: "GET", url: "https://127.0.0.1:2999/liveclientdata/activeplayer", insecure: true, timeoutMs: 800 });
    if (res.status === 200) {
      const parsed = parseLol(JSON.parse(res.body));
      if (parsed) apply(parsed);
    }
  } catch {
    /* loading screen / not in a game yet */
  } finally {
    lolBusy = false;
  }
}

async function checkLolProcess() {
  const running = (await backend.processes().catch(() => [] as string[])).some((p) => p.toLowerCase() === "league of legends.exe");
  if (running && !lolTimer) lolTimer = setInterval(pollLol, 1000);
  if (!running && lolTimer) {
    clearInterval(lolTimer);
    lolTimer = undefined;
  }
}

export async function startGames() {
  await backend.on("gsi", ({ game, payload }) => handleGsi(game, payload));
  registerTest("games", async () => {
    const [cs, dota] = await Promise.all([backend.findSteamGame(GSI_TARGETS.cs2.folder).catch(() => null), backend.findSteamGame(GSI_TARGETS.dota2.folder).catch(() => null)]);
    return { ok: Boolean(cs || dota), message: `CS2: ${cs ? "found" : "not found"} · Dota 2: ${dota ? "found" : "not found"}` };
  });
  watchConfig("games", (next) => {
    cfg = next;
    clearInterval(lolProcTimer);
    lolProcTimer = undefined;
    clearInterval(lolTimer);
    lolTimer = undefined;
    if (next.enabled && next.lol && backend.kind === "tauri") {
      checkLolProcess();
      lolProcTimer = setInterval(checkLolProcess, 5000);
    }
    if (!next.enabled) {
      current = undefined;
      useSignals.getState().set({ game: undefined });
      useIntegrations.getState().setStatus("games", "idle");
    }
  });
}
