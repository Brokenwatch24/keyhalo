import { create } from "zustand";
import { backend, isTauri, type NotificationAccess, type ToastNotification } from "@/core/backend";
import { hexToRgb } from "@/core/keymaps/codes";
import { useSignals } from "@/core/lighting/signals";
import { bus } from "@/core/util/bus";
import { t } from "@/i18n";
import type { RGB } from "@/core/types";
import type { NotificationsConfig } from "./config";
import { flash, hud } from "./feedback";
import { registerHotkey } from "./hotkeys";
import { registerTest, useIntegrations, watchConfig } from "./store";
import { matchRule, newToasts, toastAppName } from "./toasts";
import { increased, UNREAD_APPS, unreadCounts } from "./unread";

/**
 * App notifications, from one of two sources:
 *  - "windows": the Windows Action Center (UserNotificationListener). A matching rule flashes
 *    keys and, with "keep lit", leaves them on until the notification is read or dismissed.
 *  - "titles": legacy unread badges in window titles ("(3) Discord").
 * Only notifications that arrive while KeyHalo runs count; older ones in the Action Center
 * are ignored. Text is matched in memory and never written anywhere.
 */

export const OVERLAY_ID = "notifications";
// Below the shortcut cheat-sheet (50) and the typing trainer (100).
const OVERLAY_PRIORITY = 40;
const RECENT_MAX = 12;

export interface PendingNotification {
  id: number;
  app: string;
  title: string;
  ruleId: string;
  color: string;
  keys: string[];
  time: number;
}

export interface RecentNotification {
  id: number;
  app: string;
  appId: string;
  title: string;
  time: number;
  /** Rule that matched (null = none). */
  ruleId: string | null;
  muted: boolean;
}

interface NotificationsState {
  access: NotificationAccess | null;
  pending: PendingNotification[];
  recent: RecentNotification[];
}

/** Live notification state for the UI. */
export const useNotifications = create<NotificationsState>(() => ({ access: null, pending: [], recent: [] }));

let cfg: NotificationsConfig | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
/** Toast ids already seen (null until the first poll after (re)starting). */
let known: Set<number> | null = null;
/** Title-badge counts from the previous poll ("titles" source). */
let prevCounts: Record<string, number> | null = null;
let unregister: (() => void) | null = null;
let hotkeyGen = 0;

/** Latest unread counts per app id ("titles" source, for the UI). */
export let lastUnread: Record<string, number> = {};

function setOverlay(pending: PendingNotification[]) {
  const colors: Record<string, RGB> = {};
  // Oldest first, so the newest notification's colour wins on shared keys.
  for (const p of [...pending].sort((a, b) => a.time - b.time)) {
    const rgb = hexToRgb(p.color);
    for (const k of p.keys) colors[k] = rgb;
  }
  useSignals.getState().setOverlay(OVERLAY_ID, Object.keys(colors).length ? { priority: OVERLAY_PRIORITY, colors } : null);
}

function setPending(pending: PendingNotification[]) {
  useNotifications.setState({ pending });
  setOverlay(pending);
}

/** Mark everything as seen: turns off the "keep lit" keys. */
export function clearNotifications() {
  setPending([]);
}

async function pollWindows(c: NotificationsConfig) {
  let list: ToastNotification[];
  try {
    list = await backend.notifications();
  } catch (e) {
    const access = await backend.notificationsAccess().catch(() => "unsupported" as const);
    useNotifications.setState({ access });
    throw e;
  }
  if (useNotifications.getState().access !== "allowed") useNotifications.setState({ access: "allowed" });
  const ids = new Set(list.map((n) => n.id));
  const fresh = known ? newToasts(known, list) : [];
  known = ids;

  const before = useNotifications.getState().pending;
  const pending = before.filter((p) => ids.has(p.id));
  const recent: RecentNotification[] = [];
  for (const n of fresh.sort((a, b) => a.time - b.time)) {
    const rule = matchRule(c.rules, n);
    const app = toastAppName(n);
    recent.push({ id: n.id, app, appId: n.appId, title: n.title, time: n.time || Date.now(), ruleId: rule?.id ?? null, muted: Boolean(rule?.mute) });
    if (rule?.mute) continue;
    bus.emit("notification:received", { app, appId: n.appId, title: n.title, body: n.body, ruleId: rule?.id ?? null });
    if (!rule) continue;
    flash(rule.color, rule.keys.length ? rule.keys : undefined, 2);
    if (rule.hud) hud({ title: app, value: n.title || t("integrations.notifications.newOne"), icon: "info", color: rule.color });
    if (rule.keepLit) {
      const keys = rule.keys.length ? rule.keys : c.indicatorKeys;
      if (keys.length) pending.push({ id: n.id, app, title: n.title, ruleId: rule.id, color: rule.color, keys, time: Date.now() });
    }
  }
  if (recent.length) useNotifications.setState({ recent: [...recent.reverse(), ...useNotifications.getState().recent].slice(0, RECENT_MAX) });
  if (pending.length !== before.length || pending.some((p, i) => p !== before[i])) setPending(pending);
}

async function pollTitles(c: NotificationsConfig) {
  const apps = UNREAD_APPS.filter((a) => c.apps[a.id]?.enabled);
  const counts = unreadCounts(await backend.windows(), apps);
  for (const id of increased(prevCounts, counts)) {
    const appCfg = c.apps[id];
    const app = UNREAD_APPS.find((a) => a.id === id)!;
    flash(appCfg.color, appCfg.keys, 2);
    if (appCfg.hud) hud({ title: app.name, value: t("integrations.notifications.unread", { count: counts[id] }), icon: "info", color: appCfg.color });
  }
  prevCounts = counts;
  lastUnread = counts;
}

async function poll() {
  if (!cfg || busy) return;
  busy = true;
  try {
    if (cfg.source === "titles") await pollTitles(cfg);
    else await pollWindows(cfg);
    useIntegrations.getState().setStatus("notifications", "connected");
  } catch (e) {
    useIntegrations.getState().setStatus("notifications", "error", String((e as Error)?.message ?? e));
  } finally {
    busy = false;
  }
}

/** Ask Windows for access (shows the consent prompt when it has not been decided yet). */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  const access = await backend.notificationsAccess(true).catch(() => "unsupported" as const);
  useNotifications.setState({ access });
  return access;
}

export function startNotifications() {
  registerTest("notifications", async () => {
    if (useIntegrations.getState().config.notifications.source === "titles") {
      const counts = unreadCounts(await backend.windows());
      const found = Object.entries(counts).filter(([, n]) => n > 0);
      return { ok: true, message: found.length ? found.map(([id, n]) => `${id}: ${n}`).join(", ") : "No unread badges in window titles" };
    }
    const access = await backend.notificationsAccess();
    useNotifications.setState({ access });
    if (access !== "allowed") return { ok: false, message: `Windows notification access: ${access}` };
    const list = await backend.notifications();
    const apps = [...new Set(list.map(toastAppName))];
    return { ok: true, message: list.length ? `${list.length} in the Action Center (${apps.join(", ")})` : "Access OK, the Action Center is empty" };
  });
  bus.on("notifications:clear", () => clearNotifications());
  backend.notificationsAccess().then(
    (access) => useNotifications.setState({ access }),
    () => useNotifications.setState({ access: "unsupported" }),
  );

  watchConfig("notifications", (next) => {
    const restart = !cfg || cfg.enabled !== next.enabled || cfg.source !== next.source || cfg.intervalMs !== next.intervalMs;
    const prevHotkey = cfg?.enabled ? cfg.clearHotkey : "";
    cfg = next;
    if (restart) {
      clearInterval(timer);
      timer = undefined;
      known = null;
      prevCounts = null;
      clearNotifications();
      if (!next.enabled) {
        useIntegrations.getState().setStatus("notifications", "idle");
      } else {
        poll();
        timer = setInterval(poll, Math.max(1000, next.intervalMs || 1500));
      }
    } else {
      // Rules changed: re-colour what is still pending, drop what no longer qualifies.
      setPending(
        useNotifications.getState().pending.flatMap((p) => {
          const r = next.rules.find((x) => x.id === p.ruleId);
          if (!r || !r.enabled || r.mute || !r.keepLit) return [];
          return [{ ...p, color: r.color, keys: r.keys.length ? r.keys : next.indicatorKeys }];
        }),
      );
    }

    const wantHotkey = next.enabled && isTauri ? next.clearHotkey : "";
    if (wantHotkey === prevHotkey && unregister) return;
    unregister?.();
    unregister = null;
    if (!wantHotkey) return;
    const gen = ++hotkeyGen;
    registerHotkey(wantHotkey, clearNotifications)
      .then((un) => (gen === hotkeyGen ? (unregister = un) : un()))
      .catch((e) => useIntegrations.getState().setStatus("notifications", "error", `Hotkey ${wantHotkey}: ${String((e as Error)?.message ?? e)}`));
  });
}
