import { describe, expect, it } from "vitest";
import { increased, parseUnread, UNREAD_APPS, unreadCounts } from "./unread";
import { mergeBambuReport, EMPTY_BAMBU } from "./bambu";
import { haDiscovery, haTopics, topicMatches } from "./mqtt";
import { DEFAULT_INTEGRATIONS, mergeConfig } from "./config";

const app = (id: string) => UNREAD_APPS.find((a) => a.id === id)!;

describe("unread badge regexes", () => {
  it.each([
    ["discord", "(3) #general | KeyHalo - Discord", 3],
    ["discord", "#general | KeyHalo - Discord", null],
    ["whatsapp", "(12) WhatsApp", 12],
    ["whatsapp", "WhatsApp", null],
    ["telegram", "Telegram (5)", 5],
    ["telegram", "Telegram", null],
    ["slack", "* Slack | #random | Team", 1],
    ["slack", "! Slack | #random | Team", 1],
    ["slack", "Slack | #random | Team - 4 new items", 4],
    ["slack", "Slack | #random | Team", null],
    ["teams", "(2) Chat | Ana | Microsoft Teams", 2],
    ["outlook", "Inbox (7) - me@example.com - Outlook", 7],
    ["outlook", "Inbox - me@example.com - Outlook", null],
    ["gmail", "Inbox (12) - me@gmail.com - Gmail", 12],
  ])("%s: %s → %s", (id, title, expected) => {
    expect(parseUnread(app(id), title as string)).toBe(expected);
  });

  it("aggregates per app and detects increases", () => {
    const windows = [
      { process: "Discord.exe", title: "(2) #general | KeyHalo - Discord", pid: 1 },
      { process: "Discord.exe", title: "(5) Friends - Discord", pid: 2 },
      { process: "chrome.exe", title: "(9) YouTube - Google Chrome", pid: 3 },
    ];
    const c = unreadCounts(windows);
    expect(c.discord).toBe(5);
    expect(c.gmail).toBe(0);
    expect(c.whatsapp).toBe(0);
    expect(increased(null, c)).toEqual([]);
    expect(increased({ ...c, discord: 4 }, c)).toEqual(["discord"]);
    expect(increased({ ...c, discord: 6 }, c)).toEqual([]);
  });
});

describe("Bambu reports", () => {
  it("merges partial reports", () => {
    let s = mergeBambuReport(EMPTY_BAMBU, JSON.stringify({ print: { gcode_state: "RUNNING", mc_percent: 10, total_layer_num: 200, layer_num: 20, mc_remaining_time: 55 } }));
    s = mergeBambuReport(s, { print: { mc_percent: 11 } });
    expect(s).toEqual({ progress: 11, state: "RUNNING", remainingMin: 55, layer: 20, totalLayers: 200 });
    expect(mergeBambuReport(s, "{not json")).toBe(s);
    expect(mergeBambuReport(s, { info: {} })).toBe(s);
    expect(mergeBambuReport(s, { print: { gcode_state: "FINISH", mc_percent: "100" } }).state).toBe("FINISH");
  });
});

describe("MQTT / Home Assistant", () => {
  it("matches topic wildcards", () => {
    expect(topicMatches("home/+/door", "home/front/door")).toBe(true);
    expect(topicMatches("home/#", "home/a/b/c")).toBe(true);
    expect(topicMatches("home/+", "home/a/b")).toBe(false);
    expect(topicMatches("a/b", "a/b")).toBe(true);
  });

  it("builds discovery for a light with profile effects and sensors", () => {
    const cfg = { ...DEFAULT_INTEGRATIONS.homeAssistant, nodeId: "My PC" };
    const tp = haTopics(cfg);
    expect(tp.state).toBe("keyhalo/my_pc/state");
    const msgs = haDiscovery(cfg, ["Neon", "Focus"]);
    const light = JSON.parse(msgs.find(([t]) => t === "homeassistant/light/keyhalo_my_pc/keyboard/config")![1]);
    expect(light).toMatchObject({ schema: "json", command_topic: "keyhalo/my_pc/light/set", effect_list: ["Neon", "Focus"], supported_color_modes: ["rgb"], brightness: true });
    expect(msgs.some(([t]) => t.endsWith("/wpm/config"))).toBe(true);
    expect(msgs.some(([t]) => t.endsWith("/mouse_battery/config"))).toBe(true);
  });

  it("merges saved config over defaults", () => {
    const c = mergeConfig({ bambu: { host: "1.2.3.4" } as never, notifications: { apps: { discord: { enabled: false, color: "#000000", keys: [], hud: true } } } as never });
    expect(c.bambu.host).toBe("1.2.3.4");
    expect(c.bambu.port).toBe(8883);
    expect(c.notifications.apps.discord.enabled).toBe(false);
    expect(c.notifications.apps.whatsapp.enabled).toBe(true);
  });
});
