import { describe, expect, it } from "vitest";
import { resumeInput, resumeMap, useResume } from "./resume";

const items = Array.from({ length: 20 }, (_, i) => ({ sessionId: `s${i}`, cwd: `D:/p${i}`, title: `Session ${i}`, prompt: null, updatedAt: Date.now() }));

describe("resume picker", () => {
  it("pages through recent sessions with ▲ / ▼ and picks from the top row", () => {
    useResume.setState({ step: "session", items, page: 0 });
    expect(resumeMap({})!.list!.map((x) => x.label)).toEqual(items.slice(0, 8).map((x) => x.title));
    resumeInput("t:1", true);
    resumeInput("t:1", true);
    resumeInput("t:1", true); // stays on the last page
    const map = resumeMap({})!;
    expect(map.page).toContain("3/3");
    expect(map.list!.map((x) => x.label)).toEqual(["Session 16", "Session 17", "Session 18", "Session 19"]);
    resumeInput("t:0", true);
    resumeInput("g:1,0", true);
    expect(useResume.getState()).toMatchObject({ step: "pad", chosen: { sessionId: "s9" } });
    resumeInput("t:2", true); // ◀ cancels
    expect(useResume.getState().step).toBeNull();
  });
});
