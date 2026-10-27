import type { WindowInfo } from "@/core/backend";

/**
 * Unread-badge detection from window titles (best effort — apps change their titles
 * between versions). Each app lists its processes and title patterns; the first capture
 * group is the count, a pattern without a group means "at least one unread".
 */
export interface UnreadApp {
  id: string;
  name: string;
  processes: string[];
  patterns: RegExp[];
}

export const UNREAD_APPS: UnreadApp[] = [
  // "(3) #general | Server - Discord" (the count is mentions + DMs).
  { id: "discord", name: "Discord", processes: ["discord.exe", "discordptb.exe", "discordcanary.exe"], patterns: [/^\((\d+)\)/] },
  // WhatsApp desktop (UWP + Electron): "(5) WhatsApp".
  { id: "whatsapp", name: "WhatsApp", processes: ["whatsapp.exe", "whatsapp.root.exe"], patterns: [/^\((\d+)\)/] },
  // Telegram Desktop: "Telegram (12)" — older builds use "Telegram (12) - Chat".
  { id: "telegram", name: "Telegram", processes: ["telegram.exe", "ayugram.exe"], patterns: [/^Telegram\s*\((\d+)\)/i, /^\((\d+)\)/] },
  // Slack: "* Slack | #channel | Workspace" (unread) / "! Slack …" (mention) / newer "Slack - … - 3 new items".
  { id: "slack", name: "Slack", processes: ["slack.exe"], patterns: [/(\d+) new items?/i, /^!/, /^\*/] },
  // New Teams: "(2) Chat | Name | Microsoft Teams".
  { id: "teams", name: "Microsoft Teams", processes: ["ms-teams.exe", "teams.exe"], patterns: [/^\((\d+)\)/] },
  // Outlook: classic shows "Inbox - name@x.com - Outlook" (no count); new Outlook / web titles can carry "(3)".
  { id: "outlook", name: "Outlook", processes: ["outlook.exe", "olk.exe"], patterns: [/^\((\d+)\)/, /Inbox\s*\((\d+)\)/i] },
  // Gmail in a browser (only the active tab's title is visible): "Inbox (12) - me@gmail.com - Gmail".
  { id: "gmail", name: "Gmail", processes: ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"], patterns: [/Inbox \((\d+)\)[^]*Gmail/i] },
];

/** Unread count in one window title for an app; null when the title shows none. */
export function parseUnread(app: UnreadApp, title: string): number | null {
  for (const re of app.patterns) {
    const m = re.exec(title.trim());
    if (!m) continue;
    if (m[1] === undefined) return 1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 1;
  }
  return null;
}

/** Unread counts per app id across all windows (max over the app's windows). */
export function unreadCounts(windows: WindowInfo[], apps: UnreadApp[] = UNREAD_APPS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const app of apps) {
    let best = 0;
    for (const w of windows) {
      if (!app.processes.includes(w.process.toLowerCase())) continue;
      const n = parseUnread(app, w.title);
      if (n && n > best) best = n;
    }
    out[app.id] = best;
  }
  return out;
}

/** App ids whose count increased since the previous poll. */
export function increased(prev: Record<string, number> | null, next: Record<string, number>): string[] {
  if (!prev) return [];
  return Object.keys(next).filter((id) => next[id] > (prev[id] ?? 0));
}
