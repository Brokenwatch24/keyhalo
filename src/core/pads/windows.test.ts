import { describe, expect, it } from "vitest";
import { placeWindows, windowLabel } from "./windows";

const w = (hwnd: number, process = "chrome.exe", title = `Tab ${hwnd} - Google Chrome`) => ({ hwnd, process, title, pid: hwnd });

describe("windows page", () => {
  it("keeps each window on its pad and gives new ones the free pads", () => {
    let s = placeWindows([], [w(1), w(2), w(3)]);
    expect(s.map((x) => [x.hwnd, x.slot])).toEqual([[1, 0], [2, 1], [3, 2]]);
    s = placeWindows(s, [w(3), w(4), w(1)]);
    expect(s.map((x) => [x.hwnd, x.slot])).toEqual([[1, 0], [4, 1], [3, 2]]);
  });

  it("skips the desktop and KeyHalo's overlays", () => {
    const s = placeWindows([], [w(1, "explorer.exe", "Program Manager"), w(2, "keyhalo.exe", "KeyHalo HUD"), w(3, "keyhalo.exe", "KeyHalo"), w(4, "explorer.exe", "Downloads")]);
    expect(s.map((x) => x.hwnd)).toEqual([3, 4]);
  });

  it("labels a window without its app name", () => {
    expect(windowLabel({ title: "Inbox - Gmail - Google Chrome", process: "chrome.exe" })).toBe("Inbox - Gmail");
    expect(windowLabel({ title: "Spotify Premium", process: "Spotify.exe" })).toBe("Spotify Premium");
  });
});
