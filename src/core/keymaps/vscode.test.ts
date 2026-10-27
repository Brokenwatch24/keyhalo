import { describe, expect, it } from "vitest";
import type { KeymapPack } from "@/core/types";
import { categoryForCommand, importVsCodeKeybindings, labelForCommand, parseJsonc, parseVsCodeStroke } from "./vscode";

const SAMPLE = [
  "// Place your key bindings in this file to override the defaults",
  "[",
  '  // comment with "quotes" and a // inside',
  '  { "key": "ctrl+shift+p", "command": "workbench.action.showCommands" },',
  '  { "key": "ctrl+k ctrl+c", "command": "editor.action.addCommentLine", "when": "editorTextFocus" },',
  "  /* block",
  "     comment */",
  '  { "key": "alt+[Semicolon]", "command": "editor.action.commentLine" },',
  '  { "key": "ctrl+b", "command": "-workbench.action.toggleSidebarVisibility" },',
  '  { "key": "f5", "command": "workbench.action.debug.start" },',
  '  { "key": "ctrl+`", "command": "workbench.action.terminal.toggleTerminal", },',
  '  { "key": "ctrl+shift+oem_102", "command": "my.weird" },',
  '  { "key": "hyper+x", "command": "nope" },',
  "]",
].join("\n");

describe("VS Code import", () => {
  it("parses JSONC with comments and trailing commas, keeping // inside strings", () => {
    expect(parseJsonc<{ a: string }[]>('[ {"a": "http://x" }, // c\n ]')).toEqual([{ a: "http://x" }]);
    expect(parseJsonc<{ a: string }>('{"a": "x\\"/*y*/"}')).toEqual({ a: 'x"/*y*/' });
  });

  it("maps strokes to KeyboardEvent.code", () => {
    expect(parseVsCodeStroke("ctrl+shift+p")).toEqual(["ControlLeft", "ShiftLeft", "KeyP"]);
    expect(parseVsCodeStroke("shift+alt+down")).toEqual(["ShiftLeft", "AltLeft", "ArrowDown"]);
    expect(parseVsCodeStroke("ctrl+[Backquote]")).toEqual(["ControlLeft", "Backquote"]);
    expect(parseVsCodeStroke("ctrl+numpad_add")).toEqual(["ControlLeft", "NumpadAdd"]);
    expect(parseVsCodeStroke("ctrl+[NotACode]")).toBeNull();
    expect(parseVsCodeStroke("ctrl++")).toBeNull();
  });

  it("labels and categorises commands", () => {
    expect(labelForCommand("workbench.action.showCommands")).toBe("Show Commands");
    expect(categoryForCommand("workbench.action.terminal.toggleTerminal")).toBe("Terminal");
    expect(categoryForCommand("workbench.action.debug.start")).toBe("Debug");
    expect(categoryForCommand("editor.action.commentLine")).toBe("Edit");
  });

  it("imports legends, skips chords/unknown keys and applies removals over a base pack", () => {
    const base: KeymapPack = {
      id: "vscode",
      name: "VS Code",
      apps: ["Code.exe"],
      categories: { View: "#4dd0e1" },
      legends: [
        { keys: ["ControlLeft", "KeyB"], label: "Toggle sidebar", category: "View" },
        { keys: ["ControlLeft", "KeyP"], label: "Quick open", category: "View" },
      ],
      bindings: [],
    };
    const res = importVsCodeKeybindings(SAMPLE, { base });
    expect(res.removed).toBe(1);
    expect(res.skipped.map((s) => s.reason).sort()).toEqual(["chord", "unknownKey"]);
    const combos = res.pack.legends.map((l) => l.keys.join("+"));
    expect(combos).toContain("ControlLeft+ShiftLeft+KeyP");
    expect(combos).toContain("AltLeft+Semicolon");
    expect(combos).toContain("F5");
    expect(combos).toContain("ControlLeft+Backquote");
    expect(combos).toContain("ControlLeft+ShiftLeft+IntlBackslash");
    expect(combos).toContain("ControlLeft+KeyP");
    expect(combos).not.toContain("ControlLeft+KeyB");
    expect(res.pack.id).toBe("vscode-custom");
    expect(res.pack.apps).toEqual(["Code.exe"]);
    for (const l of res.pack.legends) expect(res.pack.categories[l.category]).toMatch(/^#/);
  });

  it("rejects non-array documents", () => {
    expect(() => importVsCodeKeybindings('{"key":"x"}')).toThrow();
  });
});
