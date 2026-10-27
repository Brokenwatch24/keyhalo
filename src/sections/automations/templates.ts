import type { Profile, Rule } from "@/core/types";
import type { ConnectedDevice } from "@/core/types";
import { primaryMouse } from "@/core/devices";
import type { Translate } from "./shared";

export interface RuleTemplate {
  id: string;
  /** i18n key prefix under automation.ui.templates.<id> (title, text). */
  build(ctx: { t: Translate; profiles: Profile[]; devices: ConnectedDevice[] }): Omit<Rule, "id">;
}

const pickProfile = (profiles: Profile[], wanted: string[], fallback: string) =>
  wanted.map((w) => profiles.find((p) => p.id === w || p.name.toLowerCase().includes(w))).find(Boolean)?.id ?? profiles[0]?.id ?? fallback;

/** Quick-start rules shown in the gallery. They open in the editor; nothing is saved until the user does. */
export const TEMPLATES: RuleTemplate[] = [
  {
    id: "dimNight",
    build: ({ t }) => ({
      name: t("automation.ui.templates.dimNight.title"),
      enabled: true,
      trigger: { type: "time", at: "23:00" },
      actions: [{ type: "brightness", value: 0.2 }],
    }),
  },
  {
    id: "mouseBattery",
    build: ({ t, devices }) => {
      const mouse = primaryMouse(devices);
      return {
        name: t("automation.ui.templates.mouseBattery.title"),
        enabled: true,
        trigger: {
          type: "batteryBelow",
          percent: 20,
          ...(mouse ? { device: mouse.uid } : {}),
        },
        actions: [
          { type: "flash", color: "#ffb454", times: 4 },
          {
            type: "notify",
            text: t("automation.examples.mouseBatteryText"),
            color: "#ffb454",
          },
        ],
        cooldown: 1800,
      };
    },
  },
  {
    id: "cs2Gaming",
    build: ({ t, profiles }) => ({
      name: t("automation.ui.templates.cs2Gaming.title"),
      enabled: true,
      trigger: { type: "appLaunch", process: "cs2.exe" },
      actions: [
        {
          type: "profile",
          profileId: pickProfile(profiles, ["gaming-wasd", "gaming"], "gaming-wasd"),
        },
      ],
    }),
  },
  {
    id: "claudeWaiting",
    build: ({ t }) => ({
      name: t("automation.ui.templates.claudeWaiting.title"),
      enabled: true,
      trigger: { type: "api", event: "claude-waiting" },
      actions: [{ type: "flash", color: "#ff3b30", times: 3 }],
      cooldown: 5,
    }),
  },
  {
    id: "pomodoroFocus",
    build: ({ t, profiles }) => ({
      name: t("automation.ui.templates.pomodoroFocus.title"),
      enabled: true,
      trigger: { type: "hotkey", accelerator: "Ctrl+Alt+F" },
      actions: [
        {
          type: "profile",
          profileId: pickProfile(profiles, ["focus"], "focus"),
        },
        {
          type: "notify",
          text: t("automation.ui.templates.pomodoroFocus.notify"),
          color: "#ff8a65",
        },
      ],
    }),
  },
];
