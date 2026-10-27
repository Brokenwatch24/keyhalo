import { describe, expect, it } from "vitest";
import type { ToastNotification } from "@/core/backend";
import { DEFAULT_NOTIFICATION_RULES, mergeConfig, type NotificationRule } from "./config";
import { matchRule, newToasts, toastAppName } from "./toasts";

const toast = (p: Partial<ToastNotification>): ToastNotification => ({ id: 1, app: "", appId: "", title: "", body: "", time: 0, ...p });
const rule = (p: Partial<NotificationRule>): NotificationRule => ({ id: "r", name: "r", enabled: true, apps: [], contains: [], color: "#fff", keys: [], hud: false, keepLit: false, ...p });

describe("matchRule", () => {
  it("matches the default rules by app name or AppUserModelID", () => {
    expect(matchRule(DEFAULT_NOTIFICATION_RULES, toast({ app: "Discord" }))?.id).toBe("discord");
    expect(matchRule(DEFAULT_NOTIFICATION_RULES, toast({ app: "Enlace Móvil", appId: "Microsoft.YourPhone_8wekyb3d8bbwe!App" }))?.id).toBe("phone");
    expect(matchRule(DEFAULT_NOTIFICATION_RULES, toast({ app: "", appId: "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" }))?.id).toBe("whatsapp");
  });

  it("leaves unknown apps alone while the catch-all is off", () => {
    expect(matchRule(DEFAULT_NOTIFICATION_RULES, toast({ app: "Spotify" }))).toBeNull();
    const rules = DEFAULT_NOTIFICATION_RULES.map((r) => (r.id === "other" ? { ...r, enabled: true } : r));
    expect(matchRule(rules, toast({ app: "Spotify" }))?.id).toBe("other");
  });

  it("filters by text, case-insensitively, and the first match wins", () => {
    const rules = [rule({ id: "mention", apps: ["discord"], contains: ["Alex"] }), rule({ id: "discord", apps: ["discord"] })];
    expect(matchRule(rules, toast({ app: "Discord", body: "hey @alex look" }))?.id).toBe("mention");
    expect(matchRule(rules, toast({ app: "Discord", body: "hello" }))?.id).toBe("discord");
  });

  it("skips disabled rules and returns mute rules", () => {
    const rules = [rule({ id: "off", enabled: false }), rule({ id: "mute", apps: ["outlook"], mute: true }), rule({ id: "any" })];
    expect(matchRule(rules, toast({ app: "Outlook" }))?.id).toBe("mute");
    expect(matchRule(rules, toast({ app: "Teams" }))?.id).toBe("any");
  });
});

describe("helpers", () => {
  it("finds notifications that were not seen before", () => {
    expect(newToasts(new Set([1, 2]), [toast({ id: 2 }), toast({ id: 3 })]).map((n) => n.id)).toEqual([3]);
  });

  it("names apps even when Windows hides the display name", () => {
    expect(toastAppName(toast({ app: "Phone Link" }))).toBe("Phone Link");
    expect(toastAppName(toast({ appId: "Microsoft.YourPhone_8wekyb3d8bbwe!App" }))).toBe("Microsoft.YourPhone");
  });

  it("keeps saved rules and fills defaults for configs saved before rules existed", () => {
    const old = mergeConfig({ notifications: { enabled: true, intervalMs: 2000, apps: {} } as never });
    expect(old.notifications.enabled).toBe(true);
    expect(old.notifications.source).toBe("windows");
    expect(old.notifications.rules.length).toBe(DEFAULT_NOTIFICATION_RULES.length);
    const saved = mergeConfig({ notifications: { ...old.notifications, rules: [rule({ id: "only" })] } });
    expect(saved.notifications.rules.map((r) => r.id)).toEqual(["only"]);
  });
});
