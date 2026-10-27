import { describe, expect, it } from "vitest";
import { deriveGameEvents, gsiConfigFile, joinPath, parseCs2, parseDota, parseLol } from "./gsi";

const cs2 = (over: Record<string, unknown> = {}) => ({
  provider: { name: "Counter-Strike 2", appid: 730, steamid: "765" },
  map: { phase: "live", name: "de_mirage" },
  round: { phase: "live" },
  player: {
    steamid: "765",
    state: { health: 76, armor: 100, helmet: true, flashed: 0, burning: 0 },
    weapons: {
      weapon_0: { name: "weapon_knife", state: "holstered" },
      weapon_1: { name: "weapon_ak47", ammo_clip: 15, ammo_clip_max: 30, state: "active" },
    },
  },
  auth: { token: "secret" },
  ...over,
});

describe("CS2 GSI", () => {
  it("parses health, armor, ammo clip ratio and phase", () => {
    expect(parseCs2(cs2())).toEqual({ game: "cs2", health: 76, armor: 100, flashed: 0, burning: 0, dead: false, ammo: 0.5, bomb: null, phase: "live" });
  });

  it("normalises flashed/burning to 0..1 and reads the bomb state", () => {
    const p = cs2({ round: { phase: "live", bomb: "planted" } });
    (p.player as unknown as { state: Record<string, number> }).state.flashed = 255;
    (p.player as unknown as { state: Record<string, number> }).state.burning = 51;
    const s = parseCs2(p)!;
    expect(s.flashed).toBe(1);
    expect(s.burning).toBeCloseTo(0.2);
    expect(s.bomb).toBe("planted");
  });

  it("treats spectating another player as dead", () => {
    const s = parseCs2(cs2({ player: { steamid: "999", state: { health: 100 } } }))!;
    expect(s.dead).toBe(true);
    expect(s.health).toBeUndefined();
  });

  it("ignores empty payloads", () => {
    expect(parseCs2({ provider: {} })).toBeNull();
    expect(parseCs2("nope")).toBeNull();
  });
});

describe("Dota 2 GSI and LoL", () => {
  it("parses Dota hero state", () => {
    expect(parseDota({ hero: { alive: false, health_percent: 0, mana_percent: 40 }, map: { game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" } })).toEqual({
      game: "dota2",
      health: 0,
      mana: 40,
      dead: true,
      phase: "game_in_progress",
    });
  });

  it("parses LoL active player stats", () => {
    expect(parseLol({ championStats: { currentHealth: 500, maxHealth: 1000, resourceValue: 100, resourceMax: 400 } })).toEqual({ game: "lol", health: 50, mana: 25, dead: false });
    expect(parseLol({ championStats: { currentHealth: 0, maxHealth: 1000 } })!.dead).toBe(true);
    expect(parseLol({})).toBeNull();
  });
});

describe("game events", () => {
  it("derives transitions", () => {
    const a = parseCs2(cs2({ round: { phase: "freezetime" } }))!;
    const b = parseCs2(cs2({ round: { phase: "live" } }))!;
    expect(deriveGameEvents(a, b)).toEqual(["round_start"]);
    const planted = { ...b, bomb: "planted" as const };
    expect(deriveGameEvents(b, planted)).toEqual(["bomb_planted"]);
    expect(deriveGameEvents(b, { ...b, health: 20 }, 30)).toEqual(["low_health"]);
    expect(deriveGameEvents({ ...b, health: 20 }, { ...b, health: 10 }, 30)).toEqual([]);
    expect(deriveGameEvents(b, { ...b, health: 0, dead: true })).toEqual(["death"]);
    expect(deriveGameEvents({ ...b, dead: true }, b)).toEqual(["respawn"]);
    expect(deriveGameEvents(b, { ...b, flashed: 0.8 })).toEqual(["flashed"]);
    expect(deriveGameEvents(b, { ...b, phase: "over" })).toEqual(["round_end"]);
  });

  it("does not fire round_start for the first payload", () => {
    expect(deriveGameEvents(undefined, parseCs2(cs2())!)).toEqual([]);
  });
});

describe("GSI config file", () => {
  it("points to the local API with the token", () => {
    const cfg = gsiConfigFile("cs2", 27463, "abc");
    expect(cfg).toContain('"uri"       "http://127.0.0.1:27463/gsi/cs2"');
    expect(cfg).toContain('"token" "abc"');
    expect(cfg).toContain('"player_weapons" "1"');
    expect(gsiConfigFile("dota2", 1, "t")).toContain('"hero" "1"');
  });

  it("joins Windows paths", () => {
    expect(joinPath("C:\\Steam\\steamapps\\common\\dota 2 beta\\", ["game", "dota", "cfg"])).toBe("C:\\Steam\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg");
  });
});
