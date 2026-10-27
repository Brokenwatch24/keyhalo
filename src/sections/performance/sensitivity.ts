/**
 * Game sensitivity maths (hip-fire only).
 *
 * Every supported game turns the camera by `yaw × sensitivity` degrees per mouse count, so
 * converting between games keeps the physical distance of a 360° turn (cm/360) constant:
 *
 *   degrees per count = yaw × sens
 *   counts per 360°   = 360 / (yaw × sens)
 *   cm/360            = counts per 360° / DPI × 2.54
 *   eDPI              = DPI × sens            (only comparable inside the same game)
 *
 * Yaw values (degrees per count at sensitivity 1), as published by the converter tables of
 * https://csdb.gg/sensitivity-converter/ (game table on
 * https://csdb.gg/sensitivity-converter/siege-to-cs2/) and cross-checked with
 * https://www.mouse-sensitivity.com/ :
 *   - Counter-Strike 2 / Apex Legends (Source engine m_yaw): 0.022
 *   - Valorant: 0.07 (= CS2 / 3.1818…)
 *   - Overwatch 2: 0.0066
 *   - Fortnite: 0.005555 per displayed "%" of the X sensitivity slider (community-measured;
 *     0.5555 per config-file unit, e.g. MouseX = 0.065 ⇔ 6.5 %)
 *   - Rainbow Six Siege, hip-fire: MouseSensitivityMultiplierUnit × 0.286479
 *     (= 0.00572957795 at the default multiplier 0.02, GameSettings.ini). Siege scales ADS
 *     with FOV-dependent multipliers; those are deliberately not modelled here.
 */

export type GameId = "cs2" | "valorant" | "apex" | "ow2" | "fortnite" | "r6";

export interface GameInfo {
  id: GameId;
  name: string;
  /** Decimals shown for a converted sensitivity. */
  decimals: number;
  /** Shown after the value (Fortnite's slider is a percentage). */
  suffix?: string;
  /** Typical in-game step, used by the number input. */
  step: number;
}

export const GAMES: GameInfo[] = [
  { id: "cs2", name: "Counter-Strike 2", decimals: 3, step: 0.01 },
  { id: "valorant", name: "Valorant", decimals: 3, step: 0.001 },
  { id: "apex", name: "Apex Legends", decimals: 3, step: 0.01 },
  { id: "ow2", name: "Overwatch 2", decimals: 2, step: 0.01 },
  { id: "fortnite", name: "Fortnite", decimals: 1, suffix: "%", step: 0.1 },
  { id: "r6", name: "Rainbow Six Siege", decimals: 0, step: 1 },
];

/** Default Siege `MouseSensitivityMultiplierUnit`. */
export const R6_DEFAULT_MULTIPLIER = 0.02;
/** Siege hip-fire yaw per unit of the multiplier (0.00572957795 / 0.02). */
const R6_YAW_PER_MULTIPLIER = 0.00572957795 / 0.02;

/** Degrees turned per count at sensitivity 1. */
export function yawOf(game: GameId, r6Multiplier = R6_DEFAULT_MULTIPLIER): number {
  switch (game) {
    case "cs2":
    case "apex":
      return 0.022;
    case "valorant":
      return 0.07;
    case "ow2":
      return 0.0066;
    case "fortnite":
      return 0.005555;
    case "r6":
      return Math.max(1e-6, r6Multiplier) * R6_YAW_PER_MULTIPLIER;
  }
}

/** Centimetres of mouse travel for a 360° turn. */
export function cmPer360(game: GameId, sens: number, dpi: number, r6Multiplier?: number): number {
  const degPerCount = yawOf(game, r6Multiplier) * sens;
  if (!(degPerCount > 0) || !(dpi > 0)) return NaN;
  return (360 / degPerCount / dpi) * 2.54;
}

/** Sensitivity in `to` that gives the same cm/360 as `sens` in `from`. */
export function convertSens(from: GameId, sens: number, fromDpi: number, to: GameId, toDpi: number, r6Multiplier?: number): number {
  if (!(toDpi > 0)) return NaN;
  return (yawOf(from, r6Multiplier) * sens * fromDpi) / (yawOf(to, r6Multiplier) * toDpi);
}

export function formatSens(game: GameId, value: number): string {
  if (!Number.isFinite(value)) return "—";
  const g = GAMES.find((x) => x.id === game)!;
  return value.toFixed(g.decimals) + (g.suffix ?? "");
}
