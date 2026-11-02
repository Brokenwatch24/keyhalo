import { describe, expect, it } from "vitest";
import { decode, ledMessage, levels, parseButton } from "./launchpad";
import { findClaudeWindow, terminalArgs } from "./actions";
import { mixerColumns } from "./engine";
import { defaultBoard } from "./defaults";

describe("Launchpad S protocol", () => {
  it("decodes grid, right column and top buttons", () => {
    expect(decode([0x90, 0x00, 127])).toEqual({ id: "g:0,0", down: true });
    expect(decode([0x90, 0x77, 0])).toEqual({ id: "g:7,7", down: false });
    expect(decode([0x80, 0x35, 64])).toEqual({ id: "g:5,3", down: false });
    expect(decode([0x90, 0x78, 127])).toEqual({ id: "r:7", down: true });
    expect(decode([0xb0, 104, 127])).toEqual({ id: "t:0", down: true });
    expect(decode([0xb0, 111, 0])).toEqual({ id: "t:7", down: false });
    expect(decode([0xb0, 7, 100])).toBeNull();
  });

  it("encodes LED colours as red/green levels", () => {
    expect(levels("#ff0000")).toEqual({ r: 3, g: 0 });
    expect(levels("#00ff00")).toEqual({ r: 0, g: 3 });
    expect(levels("#ffb000")).toEqual({ r: 3, g: 2 });
    expect(levels("#ff0000", 1 / 3)).toEqual({ r: 1, g: 0 });
    expect(levels("#ff7a00", 1 / 3)).toEqual({ r: 1, g: 1 }); // dim orange keeps its green
    expect(levels("#ff7a00", 0)).toEqual({ r: 0, g: 0 });
    expect(levels("#3ccf4e", 2 / 3)).toEqual({ r: 0, g: 2 }); // green stays green when dimmed
    expect(levels("#ff3b30")).toEqual({ r: 3, g: 0 });
    expect(levels("#000000")).toEqual({ r: 0, g: 0 });
    // No blue LED: blue stays visible instead of turning off.
    const blue = levels("#0000ff");
    expect(blue.r + blue.g).toBeGreaterThan(0);
    expect(ledMessage("g:2,1", "#ff0000")).toEqual([0x90, 0x12, 3 + 12]);
    expect(ledMessage("r:0", "#00ff00")).toEqual([0x90, 0x08, 48 + 12]);
    expect(ledMessage("t:3", "#ffff00")).toEqual([0xb0, 107, 48 + 3 + 12]);
    expect(parseButton("r:4")).toEqual({ kind: "r", x: 8, y: 4 });
  });
});

describe("pads", () => {
  it("fills auto mixer columns with apps playing audio", () => {
    const page = defaultBoard().pages.find((p) => p.kind === "mixer")!;
    const cols = mixerColumns(page, [
      { process: "master" },
      { process: "chrome.exe" },
      { process: "Probably Stolen.exe" },
      { process: "steam.exe" },
    ]);
    expect(cols.slice(0, 6)).toEqual(["master", "Spotify.exe", "Discord.exe", "chrome.exe", "Probably Stolen.exe", "steam.exe"]);
    expect(cols[6]).toBeNull();
  });

  it("finds the terminal running Claude Code by its title", () => {
    const w = findClaudeWindow([
      { process: "chrome.exe", title: "✳ not a terminal", pid: 1 },
      { process: "WindowsTerminal.exe", title: "PowerShell", pid: 2 },
      { process: "WindowsTerminal.exe", title: "◑ ESP32 para impresora Epson L121", pid: 3 },
    ]);
    expect(w?.pid).toBe(3);
    expect(findClaudeWindow([{ process: "WindowsTerminal.exe", title: "PowerShell", pid: 2 }])).toBeUndefined();
  });

  it("opens terminal commands in a folder", () => {
    expect(terminalArgs("codex", "D:\dev")).toEqual(["-d", "D:\dev", "powershell", "-NoExit", "-Command", "codex"]);
  });

  it("ships a board that fits the Launchpad", () => {
    const b = defaultBoard();
    expect(b.pages.length).toBeLessThanOrEqual(7);
    for (const p of b.pages) for (const id of Object.keys(p.pads)) expect(parseButton(id)).not.toBeNull();
  });
});
