import type { ReactNode } from "react";
import {
  AppWindow,
  BatteryLow,
  Bell,
  CirclePause,
  Clock,
  Cpu,
  Crosshair,
  Gamepad2,
  Globe,
  Keyboard,
  MessageSquare,
  Moon,
  Palette,
  Radio,
  Rocket,
  Send,
  Sun,
  Thermometer,
  Webhook,
  Zap,
} from "lucide-react";
import type { Rule, RuleAction, Trigger } from "@/core/types";
import { isValidKeyCode, keyLabel } from "@/core/keymaps";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const TRIGGER_TYPES: Trigger["type"][] = [
  "appFocus",
  "appLaunch",
  "time",
  "batteryBelow",
  "idle",
  "cpuAbove",
  "gpuTempAbove",
  "mqtt",
  "api",
  "game",
  "hotkey",
  "notification",
];
export const ACTION_TYPES: RuleAction["type"][] = ["profile", "flash", "notify", "brightness", "dpi", "pauseRemap", "mqttPublish", "http"];

export const TRIGGER_ICONS: Record<Trigger["type"], ReactNode> = {
  appFocus: <AppWindow />,
  appLaunch: <Rocket />,
  time: <Clock />,
  batteryBelow: <BatteryLow />,
  idle: <Moon />,
  cpuAbove: <Cpu />,
  gpuTempAbove: <Thermometer />,
  mqtt: <Radio />,
  api: <Webhook />,
  game: <Gamepad2 />,
  hotkey: <Keyboard />,
  notification: <MessageSquare />,
};

export const ACTION_ICONS: Record<RuleAction["type"], ReactNode> = {
  profile: <Palette />,
  flash: <Zap />,
  notify: <Bell />,
  dpi: <Crosshair />,
  brightness: <Sun />,
  mqttPublish: <Send />,
  http: <Globe />,
  pauseRemap: <CirclePause />,
};

/** Monday-first week, values are JS weekdays (0 = Sunday). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

function daysText(t: Translate, days?: number[]): string {
  if (!days?.length || days.length === 7) return t("automation.ui.desc.everyDay");
  const set = [...new Set(days)].sort();
  if (set.join() === "1,2,3,4,5") return t("automation.ui.desc.weekdays");
  if (set.join() === "0,6") return t("automation.ui.desc.weekends");
  return WEEK.filter((d) => set.includes(d))
    .map((d) => t(`automation.ui.days.${d}`))
    .join(", ");
}

/** Localised one-line description of a trigger. */
export function describe(t: Translate, tr: Trigger, deviceName?: (id: string) => string | undefined): string {
  switch (tr.type) {
    case "appFocus":
      return t("automation.ui.desc.appFocus", { app: tr.process || "—" });
    case "appLaunch":
      return t("automation.ui.desc.appLaunch", { app: tr.process || "—" });
    case "time":
      return t("automation.ui.desc.time", {
        at: tr.at,
        days: daysText(t, tr.days),
      });
    case "batteryBelow":
      return tr.device
        ? t("automation.ui.desc.batteryDevice", {
            percent: tr.percent,
            device: deviceName?.(tr.device) ?? tr.device,
          })
        : t("automation.ui.desc.battery", { percent: tr.percent });
    case "idle":
      return t("automation.ui.desc.idle", { minutes: tr.minutes });
    case "cpuAbove":
      return t("automation.ui.desc.cpu", { percent: tr.percent });
    case "gpuTempAbove":
      return t("automation.ui.desc.gpu", { celsius: tr.celsius });
    case "mqtt":
      return tr.match
        ? t("automation.ui.desc.mqttMatch", {
            topic: tr.topic,
            match: tr.match,
          })
        : t("automation.ui.desc.mqtt", { topic: tr.topic });
    case "api":
      return t("automation.ui.desc.api", { event: tr.event });
    case "game":
      return t("automation.ui.desc.game", {
        game: GAME_NAMES[tr.game],
        event: t(`automation.gameEvents.${tr.event}`),
      });
    case "hotkey":
      return t("automation.ui.desc.hotkey", { keys: tr.accelerator });
    case "notification": {
      const app = tr.app?.trim() || t("automation.ui.desc.anyApp");
      return tr.contains?.trim() ? t("automation.ui.desc.notificationContains", { app, text: tr.contains.trim() }) : t("automation.ui.desc.notification", { app });
    }
  }
}

export const GAME_NAMES: Record<"cs2" | "dota2" | "lol", string> = {
  cs2: "CS2",
  dota2: "Dota 2",
  lol: "League of Legends",
};

/** Short label for an action (used as chips in the rule list). */
export function actionLabel(t: Translate, a: RuleAction, profileName?: (id: string) => string | undefined): string {
  switch (a.type) {
    case "profile":
      return profileName?.(a.profileId) ?? a.profileId;
    case "flash":
      return t("automation.ui.chip.flash", { n: a.times ?? 2 });
    case "notify":
      return a.text.length > 22 ? a.text.slice(0, 21) + "…" : a.text || t("automation.actions.notify");
    case "dpi":
      return `${a.value} DPI`;
    case "brightness":
      return `${Math.round((a.value > 1 ? a.value / 100 : a.value) * 100)} %`;
    case "mqttPublish":
      return a.topic;
    case "http":
      return `${a.method.toUpperCase()} ${hostOf(a.url)}`;
    case "pauseRemap":
      return t(a.paused ? "automation.ui.chip.pause" : "automation.ui.chip.resume");
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url.slice(0, 24);
  }
}

/** Accent colour of a rule (first colour found in its actions), for the list icon. */
export function ruleColor(rule: Rule): string | undefined {
  for (const a of rule.actions) {
    if (a.type === "flash") return a.color;
    if (a.type === "notify" && a.color) return a.color;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Hotkey accelerators ⇄ key codes
// ---------------------------------------------------------------------------

const MOD_CODE: Record<string, string> = {
  ctrl: "ControlLeft",
  control: "ControlLeft",
  shift: "ShiftLeft",
  alt: "AltLeft",
  option: "AltLeft",
  super: "MetaLeft",
  meta: "MetaLeft",
  win: "MetaLeft",
  cmd: "MetaLeft",
};
const CODE_MOD: Record<string, string> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  AltLeft: "Alt",
  AltRight: "Alt",
  MetaLeft: "Super",
  MetaRight: "Super",
};

export function accelToCodes(accel: string): string[] {
  const out: string[] = [];
  for (const raw of accel
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const low = raw.toLowerCase();
    if (MOD_CODE[low]) out.push(MOD_CODE[low]);
    else if (/^[a-z]$/i.test(raw)) out.push(`Key${raw.toUpperCase()}`);
    else if (/^\d$/.test(raw)) out.push(`Digit${raw}`);
    else if (isValidKeyCode(raw)) out.push(raw);
    else {
      const cap = raw.charAt(0).toUpperCase() + raw.slice(1);
      if (isValidKeyCode(cap)) out.push(cap);
    }
  }
  return out;
}

export function codesToAccel(codes: string[]): string {
  const mods = ["Ctrl", "Shift", "Alt", "Super"].filter((m) => codes.some((c) => CODE_MOD[c] === m));
  const key = codes.find((c) => !CODE_MOD[c]);
  const keyName = key ? (/^Key[A-Z]$/.test(key) ? key.slice(3) : /^Digit\d$/.test(key) ? key.slice(5) : key) : "";
  return [...mods, keyName].filter(Boolean).join("+");
}

export const prettyAccel = (accel: string) => accelToCodes(accel).map((c) => (CODE_MOD[c] === "Super" ? "Win" : (CODE_MOD[c] ?? keyLabel(c))));

export function relativeTime(lang: string, at: number, now = Date.now()): string {
  const diff = Math.round((at - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, {
    numeric: "auto",
    style: "short",
  });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(diff, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
