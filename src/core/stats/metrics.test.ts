import { describe, expect, it } from "vitest";
import { addStats, dayKey, emptyStats, isPrintableCode, pixelsToMeters, pointerMultiplier, RollingRate, wpmFromChars } from "./metrics";
import { seedDay } from "./seed";

describe("stats metrics", () => {
  it("formats local day keys", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("counts printable keys only for WPM", () => {
    expect(isPrintableCode("KeyA")).toBe(true);
    expect(isPrintableCode("Space")).toBe(true);
    expect(isPrintableCode("Backspace")).toBe(false);
    expect(isPrintableCode("ShiftLeft")).toBe(false);
  });

  it("computes per-minute rates over a rolling 10 s window", () => {
    const r = new RollingRate(10_000);
    for (let i = 0; i < 50; i++) r.add(i * 100); // 50 chars in 5 s
    expect(r.perMinute(5_000)).toBe(300);
    expect(wpmFromChars(r.perMinute(5_000))).toBe(60);
    expect(r.count(20_000)).toBe(0);
  });

  it("converts pointer pixels to metres using DPI and pointer speed", () => {
    expect(pointerMultiplier(10)).toBe(1);
    expect(pointerMultiplier(6)).toBe(0.25);
    expect(pointerMultiplier(11)).toBe(1.25);
    expect(pixelsToMeters(800, 800)).toBeCloseTo(0.0254);
    expect(pixelsToMeters(1600, 1600, 20)).toBeCloseTo(0.0254 / 3.5);
    expect(pixelsToMeters(800, 0)).toBeCloseTo(0.0254); // falls back to 800 DPI
  });

  it("adds stats and seeds plausible demo days deterministically", () => {
    const a = { ...emptyStats("d"), keys: 2, perKey: { KeyA: 2 }, peakWpm: 50 };
    const b = { ...emptyStats("d"), keys: 3, perKey: { KeyA: 1, KeyB: 2 }, peakWpm: 70 };
    expect(addStats(a, b)).toMatchObject({ keys: 5, perKey: { KeyA: 3, KeyB: 2 }, peakWpm: 70 });
    expect(seedDay("2026-10-20")).toEqual(seedDay("2026-10-20"));
    expect(seedDay("2026-10-20").keys).toBeGreaterThan(1000);
  });
});
