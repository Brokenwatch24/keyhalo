import { beforeEach, describe, expect, it } from "vitest";
import { addTask, freeTaskSlot, taskInput, taskMap } from "./tasks";
import { usePads } from "./store";
import { defaultBoard } from "./defaults";

const tasksPage = () => usePads.getState().board.pages.find((p) => p.kind === "tasks")!;

describe("tasks page", () => {
  beforeEach(() => usePads.setState({ board: defaultBoard() }));

  it("ships a Tasks page and adds tasks to free pads", () => {
    const page = tasksPage();
    addTask(page.id, "  Llamar al banco ");
    addTask(page.id, "Enviar factura");
    expect(tasksPage().tasks!.map((x) => [x.text, x.slot])).toEqual([["Llamar al banco", 0], ["Enviar factura", 1]]);
    expect(freeTaskSlot(tasksPage().tasks!)).toBe(2);
    addTask(page.id, "   ");
    expect(tasksPage().tasks).toHaveLength(2);
  });

  it("toggles a task with a tap and lists done ones last on the map", () => {
    const page = tasksPage();
    addTask(page.id, "A");
    addTask(page.id, "B");
    taskInput(tasksPage(), "g:0,0", true);
    taskInput(tasksPage(), "g:0,0", false);
    expect(tasksPage().tasks!.find((x) => x.text === "A")!.done).toBe(true);
    const map = taskMap(tasksPage());
    expect(map.list!.map((x) => [x.label, x.done])).toEqual([["B", false], ["A", true]]);
    expect(map.buttons["g:0,0"]).toMatchObject({ label: "A" });
    // ▼ clears the done ones.
    taskInput(tasksPage(), "t:1", true);
    expect(tasksPage().tasks!.map((x) => x.text)).toEqual(["B"]);
  });
});
