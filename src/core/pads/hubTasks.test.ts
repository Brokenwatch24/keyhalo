import { describe, expect, it } from "vitest";
import { comboKeys } from "@/core/integrations/hub";
import { hubColor, placeHubTasks } from "./hubTasks";
import { usePads } from "./store";
import { defaultBoard } from "./defaults";

const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "Pendiente", title: id, full: id, who: null, due: null, overdue: false, conversationId: null, ...extra });

describe("BrokenWatchHub to-dos", () => {
  it("keeps each to-do on its pad and fills the gaps with new ones", () => {
    let s = placeHubTasks([], [task("a"), task("b"), task("c")]);
    expect(s.map((x) => [x.id, x.slot])).toEqual([["a", 0], ["b", 1], ["c", 2]]);
    s = placeHubTasks(s, [task("c"), task("d"), task("a")]);
    expect(s.map((x) => [x.id, x.slot])).toEqual([["a", 0], ["d", 1], ["c", 2]]);
  });

  it("colours overdue, dated and plain to-dos", () => {
    expect(hubColor(task("x", { overdue: true, due: "lun 12" }))).toBe("#ff3b30");
    expect(hubColor(task("x", { due: "vie 20" }))).toBe("#ffb000");
    expect(hubColor(task("x"))).toBe("#a8e04d");
  });

  it("reads Broken's key combination", () => {
    expect(comboKeys("Ctrl+Alt+Space")).toEqual(["ControlLeft", "AltLeft", "Space"]);
    expect(comboKeys("ctrl + shift + b")).toEqual(["ControlLeft", "ShiftLeft", "KeyB"]);
    expect(comboKeys("Alt+F9")).toEqual(["AltLeft", "F9"]);
  });

  it("puts the Broken pad where Explorer was on older boards", () => {
    const old = defaultBoard();
    const home = old.pages.find((p) => p.id === "home")!;
    delete home.pads["g:6,0"];
    usePads.getState().setBoard({ ...old, version: 3 });
    expect(usePads.getState().board.pages.find((p) => p.id === "home")!.pads["g:6,0"]?.action).toEqual({ type: "broken" });
    expect(usePads.getState().board.version).toBe(5);
  });
});
