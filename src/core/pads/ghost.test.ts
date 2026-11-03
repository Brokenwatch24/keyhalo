import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGhostFilter } from "./ghost";

describe("Launchpad ghost filter", () => {
  let t = 0;
  let out: string[] = [];
  let input: ReturnType<typeof createGhostFilter>;
  const at = (ms: number, id: string, down: boolean) => {
    vi.advanceTimersByTime(ms - t);
    t = ms;
    input(id, down);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    out = [];
    input = createGhostFilter((id, down) => out.push(`${id}${down ? "↓" : "↑"}`), { now: () => t });
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the round button when its row's pads ghost with it (seen live: Map → Mute)", () => {
    at(1000, "g:6,7", true);
    at(1000, "r:7", true);
    at(1001, "g:7,7", true);
    at(1050, "g:7,7", false);
    at(1069, "g:6,7", false);
    at(1089, "r:7", false);
    vi.advanceTimersByTime(200);
    expect(out).toEqual(["r:7↓", "r:7↑"]);
  });

  it("drops a pad that ghosts right after a round button", () => {
    at(1000, "r:7", true);
    at(1048, "g:6,7", true);
    at(1068, "g:6,7", false);
    at(1086, "r:7", false);
    vi.advanceTimersByTime(200);
    expect(out).toEqual(["r:7↓", "r:7↑"]);
  });

  it("drops a neighbour pad that ghosts with a pad", () => {
    at(1000, "g:7,0", true);
    at(1007, "g:6,0", true);
    at(1090, "g:6,0", false);
    at(1100, "g:7,0", false);
    vi.advanceTimersByTime(200);
    expect(out).toEqual(["g:7,0↓", "g:7,0↑"]);
  });

  it("lets normal presses through, a quick tap included", () => {
    at(1000, "g:2,3", true);
    at(1010, "g:2,3", false);
    vi.advanceTimersByTime(100);
    at(1200, "g:3,3", true);
    at(1300, "g:3,3", false);
    at(1301, "g:3,4", true);
    vi.advanceTimersByTime(100);
    expect(out).toEqual(["g:2,3↓", "g:2,3↑", "g:3,3↓", "g:3,3↑", "g:3,4↓"]);
  });

  it("allows chords in one row when the second press comes later, and other rows at once", () => {
    at(1000, "t:7", true);
    at(1020, "g:1,1", true);
    at(1300, "g:4,1", true);
    vi.advanceTimersByTime(100);
    expect(out).toEqual(["t:7↓", "g:1,1↓", "g:4,1↓"]);
  });

  it("double taps on the same pad still count", () => {
    at(1000, "g:0,0", true);
    at(1060, "g:0,0", false);
    at(1120, "g:0,0", true);
    at(1180, "g:0,0", false);
    vi.advanceTimersByTime(100);
    expect(out).toEqual(["g:0,0↓", "g:0,0↑", "g:0,0↓", "g:0,0↑"]);
  });
});
