import type { ToastNotification } from "@/core/backend";
import type { NotificationRule } from "./config";

/**
 * Matching Windows notifications against the user's rules. Pure functions only; the poller
 * lives in notifications.ts. Notification text is matched in memory and never stored.
 */

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFC");

/** First enabled rule that matches the notification (mute rules included), or null. */
export function matchRule(rules: NotificationRule[], toast: ToastNotification): NotificationRule | null {
  const source = norm(`${toast.app}\n${toast.appId}`);
  const text = norm(`${toast.title}\n${toast.body}`);
  for (const r of rules) {
    if (!r.enabled) continue;
    const apps = r.apps.map((a) => norm(a.trim())).filter(Boolean);
    if (apps.length && !apps.some((a) => source.includes(a))) continue;
    const words = r.contains.map((w) => norm(w.trim())).filter(Boolean);
    if (words.length && !words.some((w) => text.includes(w))) continue;
    return r;
  }
  return null;
}

/** Notifications whose id was not in `known`. */
export function newToasts(known: ReadonlySet<number>, list: ToastNotification[]): ToastNotification[] {
  return list.filter((n) => !known.has(n.id));
}

/** A readable label for the sending app ("Phone Link", or the AUMID's last part when Windows hides the name). */
export function toastAppName(toast: ToastNotification): string {
  if (toast.app) return toast.app;
  const id = toast.appId.split("!")[0];
  const tail = id.split(/[\\/]/).pop() ?? id;
  return tail.replace(/_[a-z0-9]{13}$/i, "").replace(/^\d+[A-F0-9]*\./i, "") || "?";
}
