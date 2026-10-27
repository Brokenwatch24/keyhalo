import { backend } from "@/core/backend";
import { t } from "@/i18n";
import type { NotificationsConfig } from "./config";
import { flash, hud } from "./feedback";
import { registerTest, useIntegrations, watchConfig } from "./store";
import { increased, UNREAD_APPS, unreadCounts } from "./unread";

/** Polls window titles for unread badges and flashes the app's colour when a count goes up. */
let cfg: NotificationsConfig | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let prev: Record<string, number> | null = null;
let busy = false;

/** Latest unread counts per app id (for the UI). */
export let lastUnread: Record<string, number> = {};

async function poll() {
  if (!cfg || busy) return;
  busy = true;
  try {
    const apps = UNREAD_APPS.filter((a) => cfg!.apps[a.id]?.enabled);
    const counts = unreadCounts(await backend.windows(), apps);
    for (const id of increased(prev, counts)) {
      const appCfg = cfg.apps[id];
      const app = UNREAD_APPS.find((a) => a.id === id)!;
      flash(appCfg.color, appCfg.keys, 2);
      if (appCfg.hud) hud({ title: app.name, value: t("integrations.notifications.unread", { count: counts[id] }), icon: "info", color: appCfg.color });
    }
    prev = counts;
    lastUnread = counts;
    useIntegrations.getState().setStatus("notifications", "connected");
  } catch (e) {
    useIntegrations.getState().setStatus("notifications", "error", String((e as Error)?.message ?? e));
  } finally {
    busy = false;
  }
}

export function startNotifications() {
  registerTest("notifications", async () => {
    const counts = unreadCounts(await backend.windows());
    const found = Object.entries(counts).filter(([, n]) => n > 0);
    return { ok: true, message: found.length ? found.map(([id, n]) => `${id}: ${n}`).join(", ") : "No unread badges in window titles" };
  });
  watchConfig("notifications", (next) => {
    cfg = next;
    clearInterval(timer);
    timer = undefined;
    prev = null;
    if (!next.enabled) {
      useIntegrations.getState().setStatus("notifications", "idle");
      return;
    }
    poll();
    timer = setInterval(poll, Math.max(1000, next.intervalMs || 2000));
  });
}
