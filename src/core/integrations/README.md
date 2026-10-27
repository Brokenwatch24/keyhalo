# core/integrations — public API

Import from `@/core/integrations`. User docs: `docs/INTEGRATIONS.md`.

## Store: `useIntegrations`

- `config: IntegrationsConfig` — `system`, `bambu`, `claude`, `notifications`, `mic`, `games`,
  `homeAssistant`, `pomodoro` (types in `config.ts`, defaults `DEFAULT_INTEGRATIONS`).
- `status: Partial<Record<IntegrationId, { state: "idle"|"connecting"|"connected"|"error", message?, since }>>`
  (`IntegrationId` also includes `"api"`).
- `update(id, patch)` — persisted to `integrations.json` and applied immediately (reconnects as needed).
- `test(id)` → `Promise<{ ok, message }>` (system, bambu, notifications, mic, games, homeAssistant).

## Per integration

| Module | Exports for the UI |
|---|---|
| System monitor | `acquireSystemMetrics()` / `useSystemMetrics(active?)` — **call while a CPU/GPU/RAM widget or chart is visible** (polling is ref-counted); values in `useSignals().cpu/gpu/ram`; `lastSystemMetrics()` |
| Bambu | `useSignals().bambu` (`progress` 0..100, `state`, `remainingMin`, `layer`, `totalLayers`); `DEMO_PRINTER` |
| Claude Code | `useSignals().claude`; `setClaudeState(state)` (test buttons), `CLAUDE_STATES` |
| Notifications | `UNREAD_APPS` (id, name, processes), `lastUnread` counts, `DEFAULT_NOTIFICATION_APPS` |
| Mic | `useSignals().micMuted`; `toggleMic(muted?)` |
| Games | `installGsi("cs2" \| "dota2")` → `{ ok, path?, message }`; `useSignals().game`; `onGameEvent(cb)`; `GAME_EVENTS`; `handleGsi(game, payload)` (simulate) |
| Home Assistant / MQTT | `mqttSubscribe(filter, cb)`, `mqttPublish(topic, payload, retain?)`, `mqttConnected()`, `haTopics(cfg)` (show topics in the UI) |
| Pomodoro | `usePomodoro()` → `phase`, `endsAt`, `totalMs`, `pausedRemaining`, `completed`, `start({focusMin?, breakMin?})`, `stop()`, `skip()`, `pause()`, `resume()`, `toggle()`; also `useSignals().pomodoro` |
| Local API | `handleApiAction(action, params)`, `apiState(version)`, `BUILTIN_API_ACTIONS` |

Other helpers: `registerHotkey(accelerator, cb)` (Tauri global shortcut, shared/ref-counted),
`notifyUser(text, color?, keys?)`, `flash(color, keys?, times?)`, `hud(payload)`,
`profileList()` / `registerProfiles([{id,name}])` (profile directory used for HA effect names —
the lighting feature can call `registerProfiles` with its full list), `resolveProfile(idOrName)`.

## Bus

Owns `notify` (flash + HUD). Emits `lighting:flash`, `lighting:brightness`, `lighting:effect`,
`profile:apply` (reason `api`), `dpi:set`, `hud`. Listens to `profile:applied`,
`community:installed` (kind `profile`) and `keymaps:action` (`media`/`micMute`).
