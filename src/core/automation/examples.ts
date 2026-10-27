import type { Rule } from "@/core/types";
import { t } from "@/i18n";

/** Disabled example rules created on first run (names in the user's language). */
export function exampleRules(): Rule[] {
  return [
    {
      id: "example-mouse-battery",
      name: t("automation.examples.mouseBattery"),
      enabled: false,
      trigger: { type: "batteryBelow", percent: 15 },
      actions: [{ type: "notify", text: t("automation.examples.mouseBatteryText"), color: "#ffb454" }],
    },
    {
      id: "example-bomb-planted",
      name: t("automation.examples.bombPlanted"),
      enabled: false,
      trigger: { type: "game", game: "cs2", event: "bomb_planted" },
      actions: [{ type: "flash", color: "#ff3b30", times: 6 }],
    },
    {
      id: "example-cpu-hot",
      name: t("automation.examples.cpuHot"),
      enabled: false,
      trigger: { type: "cpuAbove", percent: 90 },
      actions: [{ type: "notify", text: t("automation.examples.cpuHotText"), color: "#ff8a65" }],
      cooldown: 300,
    },
    {
      id: "example-idle-dim",
      name: t("automation.examples.idleDim"),
      enabled: false,
      trigger: { type: "idle", minutes: 10 },
      actions: [{ type: "brightness", value: 0.15 }],
    },
    {
      id: "example-morning",
      name: t("automation.examples.morning"),
      enabled: false,
      trigger: { type: "time", at: "09:00", days: [1, 2, 3, 4, 5] },
      actions: [
        { type: "brightness", value: 1 },
        { type: "notify", text: t("automation.examples.morningText"), color: "#7ee0a1" },
      ],
    },
    {
      id: "example-doorbell",
      name: t("automation.examples.doorbell"),
      enabled: false,
      trigger: { type: "mqtt", topic: "home/doorbell", match: "ON" },
      actions: [{ type: "flash", color: "#4dd0e1", times: 4 }, { type: "notify", text: t("automation.examples.doorbellText"), color: "#4dd0e1" }],
      cooldown: 30,
    },
    {
      id: "example-pause-hotkey",
      name: t("automation.examples.pauseHotkey"),
      enabled: false,
      trigger: { type: "hotkey", accelerator: "Ctrl+Alt+P" },
      actions: [{ type: "pauseRemap", paused: true }],
    },
  ];
}
