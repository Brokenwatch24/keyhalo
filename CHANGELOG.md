# Changelog

All notable changes to KeyHalo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-10-27

First public beta.

### Added
- **Lighting studio**: layered per-key effects with blend modes, opacity, key masks and synced
  keyboard + mouse lighting; built-in ambient, reactive, audio and widget effects; sandboxed
  community effects; profiles with per-app auto-switching and onboard-memory saving.
- **Devices**: native Razer driver (Huntsman Mini and DeathAdder V2 Pro verified, more
  experimental), Windows Dynamic Lighting (LampArray) and an OpenRGB SDK bridge; device wizard
  that maps LEDs to keys and publishes definitions; restore-original snapshots; safe mode.
- **Performance**: DPI stages, sniper DPI, polling rate, battery, idle sleep, Windows pointer
  settings, eDPI / cm-per-360 and cross-game sensitivity converter.
- **Keymaps**: per-app shortcut packs with lit legends, cheat-sheet overlay, remaps, layers,
  tap-hold, macros, conflict detection, VS Code import, Kanata and AutoHotkey export; 13 bundled
  packs; automatic pause in anti-cheat games and a Ctrl+Alt+Pause emergency toggle.
- **Typing trainer**: adaptive lessons, tests, passages, code and shortcut drills, English and
  Spanish, physical-keyboard guidance, heatmaps, ghost races and share cards.
- **Test bench**: polling rate, clicks, key rollover/chatter, sensor path, DPI calibration,
  reaction time.
- **Automations & integrations**: rules engine; Bambu Lab, Claude Code, notifications, mic mute,
  CS2 / Dota 2 / League of Legends, Home Assistant / MQTT, pomodoro; local REST/WebSocket API and
  the `keyhalo` CLI.
- **Community**: gallery, install with risk review, publish via pull request, Gist sharing and
  `keyhalo://` deep links; JSON Schemas and CI validation.
