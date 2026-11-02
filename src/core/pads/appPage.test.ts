import { describe, expect, it } from "vitest";
import { useKeymaps } from "@/core/keymaps";
import { appForeground, appInput, appMap, appPack, appShortcuts, useAppPage } from "./appPage";

describe("App page", () => {
  it("follows the app in front and finds its shortcut pack", () => {
    appForeground("Obsidian.exe", 11);
    appForeground("keyhalo.exe", 12); // KeyHalo's own window keeps the app you were in
    expect(useAppPage.getState()).toMatchObject({ process: "Obsidian.exe", hwnd: 11 });
    const pack = appPack("obsidian.exe");
    expect(pack?.id).toBe("obsidian");
    expect(appShortcuts(pack, null)[0].label).toBe("Command palette");
    expect(appPack("Resolve.exe")?.apps).toContain("Resolve.exe");
    expect(appPack("unknown.exe")).toBeNull();
    expect(useKeymaps.getState().packs.length).toBeGreaterThan(5);
  });

  it("shows one category at a time from the top buttons", () => {
    appForeground("Obsidian.exe", 11);
    useAppPage.setState({ filter: null });
    appInput("t:1", true); // second category: Tabs
    expect(useAppPage.getState().filter).toBe("Tabs");
    const map = appMap();
    expect(map.page).toBe("Obsidian · Tabs");
    expect(map.buttons["g:0,0"]).toMatchObject({ label: "New tab" });
    appInput("t:1", true);
    expect(useAppPage.getState().filter).toBeNull();
  });
});
