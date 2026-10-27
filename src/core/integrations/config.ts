/** Persisted configuration of every integration (`integrations.json`). */

export interface SystemMonitorConfig {
  enabled: boolean;
  /** Poll interval while a consumer needs metrics. */
  intervalMs: number;
}

export interface BambuConfig {
  enabled: boolean;
  /** Printer LAN IP. */
  host: string;
  port: number;
  /** Printer serial number (Settings → Device on the printer screen). */
  serial: string;
  /** LAN access code (shown on the printer screen; LAN mode / developer mode). */
  accessCode: string;
  flashOnFinish: boolean;
  hud: boolean;
}

export interface ClaudeConfig {
  enabled: boolean;
  hudOnWaiting: boolean;
  flashOnWaiting: boolean;
  flashColor: string;
}

export interface NotificationAppConfig {
  enabled: boolean;
  color: string;
  /** Keys to flash (empty = whole keyboard). */
  keys: string[];
  hud: boolean;
}

export interface NotificationsConfig {
  enabled: boolean;
  intervalMs: number;
  apps: Record<string, NotificationAppConfig>;
}

export interface MicConfig {
  enabled: boolean;
  /** Tauri accelerator, e.g. "Ctrl+Shift+M". Empty = no hotkey. */
  hotkey: string;
  hud: boolean;
}

export interface GamesConfig {
  enabled: boolean;
  cs2: boolean;
  dota2: boolean;
  lol: boolean;
  /** Health % under which the `low_health` game event fires. */
  lowHealth: number;
}

export interface HomeAssistantConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  /** Node id used in topics: keyhalo/<nodeId>/… */
  nodeId: string;
  baseTopic: string;
  discovery: boolean;
  discoveryPrefix: string;
}

export interface PomodoroConfig {
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  /** Focus sessions before a long break. */
  cyclesBeforeLong: number;
  flash: boolean;
  hud: boolean;
  /** Start the next phase automatically. */
  autoContinue: boolean;
}

export interface IntegrationsConfig {
  system: SystemMonitorConfig;
  bambu: BambuConfig;
  claude: ClaudeConfig;
  notifications: NotificationsConfig;
  mic: MicConfig;
  games: GamesConfig;
  homeAssistant: HomeAssistantConfig;
  pomodoro: PomodoroConfig;
}

export type IntegrationId = keyof IntegrationsConfig | "api";

/** Default per-app notification colours (brand-ish but softened). */
export const DEFAULT_NOTIFICATION_APPS: Record<string, NotificationAppConfig> = {
  discord: { enabled: true, color: "#5865f2", keys: [], hud: false },
  whatsapp: { enabled: true, color: "#25d366", keys: [], hud: false },
  telegram: { enabled: true, color: "#2aabee", keys: [], hud: false },
  slack: { enabled: true, color: "#e01e5a", keys: [], hud: false },
  teams: { enabled: true, color: "#6264a7", keys: [], hud: false },
  outlook: { enabled: true, color: "#0a64ad", keys: [], hud: false },
  gmail: { enabled: false, color: "#ea4335", keys: [], hud: false },
};

export const DEFAULT_INTEGRATIONS: IntegrationsConfig = {
  system: { enabled: true, intervalMs: 1000 },
  bambu: { enabled: false, host: "", port: 8883, serial: "", accessCode: "", flashOnFinish: true, hud: true },
  claude: { enabled: true, hudOnWaiting: true, flashOnWaiting: true, flashColor: "#d97757" },
  notifications: { enabled: false, intervalMs: 2000, apps: DEFAULT_NOTIFICATION_APPS },
  mic: { enabled: true, hotkey: "Ctrl+Shift+M", hud: true },
  games: { enabled: true, cs2: true, dota2: true, lol: true, lowHealth: 30 },
  homeAssistant: {
    enabled: false,
    host: "",
    port: 1883,
    username: "",
    password: "",
    tls: false,
    nodeId: "pc",
    baseTopic: "keyhalo",
    discovery: true,
    discoveryPrefix: "homeassistant",
  },
  pomodoro: { focusMin: 25, breakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, flash: true, hud: true, autoContinue: true },
};

/** Merge saved config over defaults (one level deep, plus notification apps). */
export function mergeConfig(saved: Partial<IntegrationsConfig> | null | undefined): IntegrationsConfig {
  const out = JSON.parse(JSON.stringify(DEFAULT_INTEGRATIONS)) as IntegrationsConfig;
  if (!saved) return out;
  for (const k of Object.keys(out) as (keyof IntegrationsConfig)[]) {
    const v = saved[k];
    if (v && typeof v === "object") Object.assign(out[k], v);
  }
  out.notifications.apps = { ...DEFAULT_NOTIFICATION_APPS, ...(saved.notifications?.apps ?? {}) };
  return out;
}
