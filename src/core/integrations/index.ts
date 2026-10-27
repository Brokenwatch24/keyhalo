/** Public API of the integrations feature (see README.md). */
export { useIntegrations, registerTest, type IntegrationsState, type IntegrationStatus, type IntegrationState, type TestResult } from "./store";
export { DEFAULT_INTEGRATIONS, DEFAULT_NOTIFICATION_APPS, DEFAULT_NOTIFICATION_RULES, type IntegrationsConfig, type IntegrationId, type NotificationRule } from "./config";
export type * from "./config";
export { acquireSystemMetrics, useSystemMetrics, onSystemMetrics, lastSystemMetrics } from "./system";
export { mergeBambuReport, DEMO_PRINTER, type BambuState } from "./bambu";
export { setClaudeState, isClaudeState, CLAUDE_STATES, type ClaudeState } from "./claude";
export { UNREAD_APPS, parseUnread, unreadCounts, type UnreadApp } from "./unread";
export { lastUnread, useNotifications, clearNotifications, requestNotificationAccess, type PendingNotification, type RecentNotification } from "./notifications";
export { matchRule, toastAppName } from "./toasts";
export { toggleMic } from "./mic";
export { installGsi, handleGsi, onGameEvent, type GsiInstallResult } from "./games";
export { parseCs2, parseDota, parseLol, deriveGameEvents, gsiConfigFile, GAME_EVENTS, type GameEvent, type GameSignal, type GameId } from "./gsi";
export { mqttSubscribe, mqttPublish, mqttConnected, topicMatches, haTopics, haDiscovery } from "./mqtt";
export { usePomodoro, pomodoroCommand, type PomodoroState, type PomodoroPhase } from "./pomodoro";
export { handleApiAction, apiState, BUILTIN_API_ACTIONS } from "./api";
export { registerHotkey } from "./hotkeys";
export { notifyUser, flash, hud } from "./feedback";
export { profileList, registerProfiles, resolveProfile } from "./profiles";
