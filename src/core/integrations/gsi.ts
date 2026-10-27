import type { Signals } from "@/core/lighting/signals";

/**
 * Pure parsers for official game APIs:
 *  - CS2 / Dota 2 Game State Integration (HTTP POSTs from the game to the local API server)
 *  - League of Legends Live Client Data API (https://127.0.0.1:2999/liveclientdata/activeplayer)
 * Never memory reading.
 */
export type GameSignal = NonNullable<Signals["game"]>;
export type GameId = GameSignal["game"];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** CS2 GSI payload → signal. Null when the payload carries no player/round data. */
export function parseCs2(payload: unknown): GameSignal | null {
  const p = obj(payload);
  if (!p) return null;
  const provider = obj(p.provider);
  const player = obj(p.player);
  const round = obj(p.round);
  const map = obj(p.map);
  if (!player && !round && !map) return null;
  const st = obj(player?.state);
  const spectating = Boolean(provider?.steamid && player?.steamid && provider.steamid !== player.steamid);
  const health = num(st?.health);
  const out: GameSignal = { game: "cs2" };
  if (!spectating && health !== undefined) out.health = clamp(health);
  if (!spectating && num(st?.armor) !== undefined) out.armor = clamp(num(st?.armor)!);
  if (!spectating && num(st?.flashed) !== undefined) out.flashed = clamp(num(st?.flashed)! / 255, 0, 1);
  if (!spectating && num(st?.burning) !== undefined) out.burning = clamp(num(st?.burning)! / 255, 0, 1);
  // Dead = we are spectating someone else, or our own health is 0 during a live round.
  out.dead = spectating || (health !== undefined && health <= 0);
  if (!spectating) {
    const weapons = obj(player?.weapons);
    const active = weapons ? Object.values(weapons).map(obj).find((w) => w?.state === "active") : undefined;
    const clip = num(active?.ammo_clip);
    const max = num(active?.ammo_clip_max);
    if (clip !== undefined && max) out.ammo = clamp(clip / max, 0, 1);
  }
  const bomb = round?.bomb;
  out.bomb = bomb === "planted" || bomb === "defused" || bomb === "exploded" ? bomb : null;
  const phase = typeof round?.phase === "string" ? round.phase : typeof map?.phase === "string" ? map.phase : undefined;
  if (phase) out.phase = phase;
  return out;
}

/** Dota 2 GSI payload → signal. */
export function parseDota(payload: unknown): GameSignal | null {
  const p = obj(payload);
  const hero = obj(p?.hero);
  const map = obj(p?.map);
  if (!hero && !map) return null;
  const out: GameSignal = { game: "dota2" };
  if (num(hero?.health_percent) !== undefined) out.health = clamp(num(hero?.health_percent)!);
  if (num(hero?.mana_percent) !== undefined) out.mana = clamp(num(hero?.mana_percent)!);
  if (typeof hero?.alive === "boolean") out.dead = !hero.alive;
  if (typeof map?.game_state === "string") out.phase = map.game_state.replace(/^DOTA_GAMERULES_STATE_/, "").toLowerCase();
  return out;
}

/** LoL Live Client Data `activeplayer` JSON → signal. */
export function parseLol(payload: unknown): GameSignal | null {
  const stats = obj(obj(payload)?.championStats);
  if (!stats) return null;
  const hp = num(stats.currentHealth);
  const maxHp = num(stats.maxHealth);
  const res = num(stats.resourceValue);
  const maxRes = num(stats.resourceMax);
  const out: GameSignal = { game: "lol" };
  if (hp !== undefined && maxHp) out.health = clamp((hp / maxHp) * 100);
  if (res !== undefined && maxRes) out.mana = clamp((res / maxRes) * 100);
  out.dead = hp !== undefined && hp <= 0;
  return out;
}

/** Discrete events derived from state transitions (used by `game` automation triggers). */
export const GAME_EVENTS = ["round_start", "round_end", "freezetime", "bomb_planted", "bomb_defused", "bomb_exploded", "low_health", "death", "respawn", "flashed", "burning"] as const;
export type GameEvent = (typeof GAME_EVENTS)[number];

export function deriveGameEvents(prev: GameSignal | undefined, next: GameSignal, lowHealth = 30): GameEvent[] {
  const ev: GameEvent[] = [];
  const p = prev && prev.game === next.game ? prev : undefined;
  if (next.phase && p?.phase !== next.phase) {
    if (next.phase === "live" && p?.phase && p.phase !== "live") ev.push("round_start");
    if (next.phase === "over") ev.push("round_end");
    if (next.phase === "freezetime") ev.push("freezetime");
  }
  if (next.bomb && next.bomb !== p?.bomb) ev.push(`bomb_${next.bomb}` as GameEvent);
  if (next.health !== undefined && next.health > 0 && next.health < lowHealth && (p?.health === undefined || p.health >= lowHealth)) ev.push("low_health");
  if (next.dead && p && !p.dead) ev.push("death");
  if (!next.dead && p?.dead) ev.push("respawn");
  if ((next.flashed ?? 0) > 0 && !((p?.flashed ?? 0) > 0)) ev.push("flashed");
  if ((next.burning ?? 0) > 0 && !((p?.burning ?? 0) > 0)) ev.push("burning");
  return ev;
}

/** Game State Integration config file contents (Valve KeyValues). */
export function gsiConfigFile(game: "cs2" | "dota2", port: number, token: string): string {
  const data =
    game === "cs2"
      ? { provider: 1, map: 1, round: 1, player_id: 1, player_state: 1, player_weapons: 1, player_match_stats: 0 }
      : { provider: 1, map: 1, player: 1, hero: 1, abilities: 0, items: 0 };
  const lines = [
    `"KeyHalo ${game === "cs2" ? "CS2" : "Dota 2"} integration"`,
    "{",
    `  "uri"       "http://127.0.0.1:${port}/gsi/${game}"`,
    `  "timeout"   "1.1"`,
    `  "buffer"    "0.1"`,
    `  "throttle"  "0.1"`,
    `  "heartbeat" "10.0"`,
    `  "auth"`,
    "  {",
    `    "token" "${token.replace(/"/g, "")}"`,
    "  }",
    `  "data"`,
    "  {",
    ...Object.entries(data).map(([k, v]) => `    "${k}" "${v}"`),
    "  }",
    "}",
    "",
  ];
  return lines.join("\n");
}

/** Steam library folder name and config path (relative to the game folder) per game. */
export const GSI_TARGETS = {
  cs2: { folder: "Counter-Strike Global Offensive", path: ["game", "csgo", "cfg", "gamestate_integration_keyhalo.cfg"] },
  dota2: { folder: "dota 2 beta", path: ["game", "dota", "cfg", "gamestate_integration", "gamestate_integration_keyhalo.cfg"] },
} as const;

export function joinPath(base: string, parts: readonly string[]): string {
  const sep = base.includes("\\") || !base.includes("/") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}
