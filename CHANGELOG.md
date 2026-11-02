# Changelog

All notable changes to KeyHalo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-11-02

### Added
- **Launchpad support** (Novation Launchpad S / Mini / original): a macro board with up to seven
  pages, live pad lights (Claude Code, microphone, now playing, notifications, running apps), long
  press actions, app-specific pages and a per-app **volume mixer** page. Pads open apps, websites,
  Claude Code / Codex / any terminal command, bring windows forward, press shortcuts (also inside
  another app), control media, volume and the microphone.
- **Agents page**: every pad is a live Claude Code or Codex session. It breathes while the agent
  works and blinks when it needs you; tap it to jump to that session's window and see what it
  needs. Tap an empty pad to open Claude Code, double-tap for Codex, in the folder of the File
  Explorer window in front. Codex connects in one click (its `notify` command), and Claude Code
  hooks now report each session separately (hooks from 1.1 are upgraded automatically).
  Every running Claude Code session appears on its own, also in Cursor / VS Code terminals and
  ones started before KeyHalo, named like `/resume` shows it. Tap a session pad again (or hold it) to dictate
  (KeyHalo holds Space for Claude Code's voice mode).
- **Tasks page**: a checklist on the pads, shown on screen while you are on it. Tap an empty pad
  to type a task, tap a task to tick it, hold to edit.
- **Resume** on the Agents page: pick one of your recent Claude Code sessions on the pads, then the
  pad to open it on; it reopens in its own folder with `claude --resume`. Hold the Agents page's close
  button and tap sessions to close them.
- **Windows page**: every open window is a pad. Tap to bring it forward (again to minimise), hold
  to close it; the top buttons arrange windows in a grid, snap left / right, maximise, minimise,
  show the desktop and open Task view. Hold a window's pad to see its tabs (Chrome, Edge, Terminal)
  on the pads and jump between them. The close button closes the tab in front, or (held) every
  window pad you tap.
- **Pad map overlay**: hold or tap the Arm button (or a hotkey) to see every pad's name on screen
  while you learn the layout.
- KeyHalo lets go of the Launchpad while Ableton Live, FL Studio and other DAWs run (Windows MIDI
  ports are exclusive) and takes it back afterwards.

## [1.1.0] — 2026-10-27

### Added
- **Automatic updates**: the app checks GitHub at start and every six hours, downloads new
  versions in the background and restarts into them with one click (Settings or the sidebar).
  Updates are signed; installs from 1.0.0 need to download 1.1.0 by hand once.
- **Windows notifications**: lights keys for notifications from any app, including your phone
  through Phone Link, with per-app and per-word rules, mute rules, keys that stay lit until you
  read the message, a "mark all as seen" hotkey and a **Notification arrives** automation trigger.
  Notification text never leaves memory.
- **Connect Claude Code** in one click: KeyHalo adds its hooks to `~/.claude/settings.json`
  (other settings kept, backup saved) using `curl`, so the CLI is no longer needed.
- **App shortcuts glow**: while an app with a shortcut pack is in front, its shortcut keys light
  up softly; holding a modifier still shows the cheat-sheet. A "how it works" guide opens the
  Keymaps page.

### Changed
- Window-title unread badges are now the *Window titles (legacy)* notification source.

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
