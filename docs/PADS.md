# Pad controllers (Launchpad)

KeyHalo turns a MIDI pad controller into a macro board with live lights. Supported today:
**Novation Launchpad S** (and the original Launchpad / Launchpad Mini, which share its protocol).
No driver is needed: the Launchpad S is class-compliant.

## Layout

```
  ▲   ▼   ◀   ▶  Ses  U1  U2  Mix     ← top round buttons: extra pads (mixer: mute per column)
┌───────────────────────────────┐
│                               │ Vol   ← page 1
│                               │ Pan   ← page 2
│        8 × 8 grid pads        │ SndA  ← …
│                               │ …     ← page 7
│                               │ Arm   ← pad map (hold to peek, tap to toggle)
└───────────────────────────────┘
```

- **Right round buttons 1–7** pick the page. A page can also switch on by itself while an app is
  in front (`apps`, e.g. `Resolve.exe`), and goes back to your page when you leave it.
- **Arm** shows the **pad map**: a small always-on-top overlay with every pad's name, so you can
  learn the layout. Hold Arm to peek, tap it to keep the map open. A global hotkey can toggle it
  too (Pads → Settings).
- The LEDs are red/green, so colours are red, orange, amber, yellow, lime and green in 3 brightness
  levels. Blue-ish colours show as soft amber.

## What a pad can do

| Action | Example |
|---|---|
| Open an app | an `.exe`, or a Start-menu app as `shell:AppsFolder\<AppID>` (Claude, Cursor, Discord…) |
| Open a website | `https://mail.google.com` |
| Terminal command | `claude`, `codex`, `npm run dev` in a folder (opens Windows Terminal) |
| Claude Code | brings the terminal running Claude Code to the front; opens it if none is running |
| Bring an app to the front | `Discord.exe`, with an app or URL to open when it is not running |
| Shortcut / text | any key chord, or typed text |
| Shortcut in another app | focus an app, press a chord there, return (e.g. Spotify "like": Alt+Shift+B) |
| Media | play/pause, next, previous (works with any player that shows Windows media controls) |
| Volume | per app or master: up, down, mute |
| Microphone | toggle mute |
| Notifications | mark as seen (needs Integrations → Notifications) |
| Page, profile, pad map | switch page, apply a lighting profile, show the map |

A pad can have a second **hold action** (press ≥ 0.5 s). The default *Claude Code* pad brings
Claude Code forward on tap and opens a new Claude Code session on hold.

## Live lights

| State | Light |
|---|---|
| Claude Code | breathing green while it works, fast orange blink when it needs you, green when done, red on error (connect Claude Code in Integrations) |
| Microphone | red when muted, green when live |
| Now playing | green while something plays |
| Notification rule | blinks while a notification from that rule waits; pressing the pad opens the app and marks it as seen |
| App running | full colour while the process runs, dim otherwise |

## Agents page

Each pad is one coding-agent session: **orange = Claude Code**, **green = Codex**.

| Light | Meaning |
|---|---|
| slow blink | opening |
| dim | ready, waiting for your first prompt |
| breathing | working |
| fast blink | needs you (a permission or a question) |
| slow blink, full | finished its turn: your move |

- **Tap a session pad** to bring its terminal window to the front; the HUD shows what it needs
  (e.g. "Permission: Bash"). Once there, **tap again** to dictate and once more to stop, or **hold** it
  to dictate while held: KeyHalo holds Space (with key repeat) while you
  dictate, like Claude Code's hold-to-talk voice mode (`/voice`), and stops if you leave the window. In Cursor / VS Code the
  terminal is a panel, so dictation starts only if you were already in that window.
- **Tap an empty pad** to open Claude Code there, **double-tap** for Codex. It opens in the folder
  of the File Explorer window in front, otherwise in the page's default folder. ▲ and ▼ on top
  open Claude / Codex in the next free pad.
- **Every running Claude Code session shows up**, wherever it runs (Windows Terminal, Cursor,
  VS Code), even ones started before KeyHalo: KeyHalo reads Claude Code's own list in
  `~/.claude/sessions`. A pad is named after the session (its `/rename` name, or the title Claude
  gives it, as `/resume` shows it) and goes away when the session ends. Remove one by hand in
  Pads → Agents.
- **◀ Resume**: lists your recent Claude Code sessions on the pads and on screen (title, folder,
  how long ago). Tap one, then tap the (green) pad to open it on: it opens in that session's
  folder with `claude --resume`. ◀ again cancels. Pads → Agents lists them too.
- Connect both in Pads → Agents: Claude Code gets KeyHalo's hooks (each posts Claude's own JSON:
  session, folder, event, message); Codex gets a `notify` command in `~/.codex/config.toml`
  (thread id, folder, last message after each turn). Codex only reports finished turns, so its pads
  never breathe.
- Each session opens in its own Windows Terminal window, so KeyHalo can bring back exactly that
  one. Sessions in tabs of one window share the window.

## Tasks page

A checklist on the pads: amber = to do, dim green = done. While you are on this page the list shows
on screen (each row marks where its pad is).

- **Tap an empty pad** to write a task: a small box opens (Enter saves, Esc cancels).
- **Tap a task** to mark it done (or to do again); **hold** it to edit it (an empty text deletes it).
- ▲ writes a new task in the next free pad, ▼ clears the done ones.

## Windows page

Each pad is one open window, in the app's colour (full brightness = the window in front). A
window keeps its pad while it is open; new windows take the free pads.

- **Tap** brings it to the front; tap it again (when it is already in front) to minimise it.
- **Hold** closes it, like its X button: the app still asks before losing unsaved work.
- **Top buttons**: ▲ arrange (up to 9 open windows in a grid on the screen in front), ▼ desktop
  (Win+D), ◀ / ▶ snap the window in front to the left / right half, Ses maximise, U1 minimise,
  U2 Task view, Mix **close**: tap it to close the tab in front (Ctrl+W), or hold it and tap window
  pads (they blink red) to close those windows.

## Mixer page

Each column is one app: `master` (the output device), a process name such as `Spotify.exe`, or
empty to take the next app that is playing audio. The column's height is its volume (press a pad
to set it: top row = 100 %, bottom = 12.5 %), red when muted. The top round button mutes the column.

## Ableton and other DAWs

Windows MIDI ports are **exclusive**: while KeyHalo holds the Launchpad, Ableton can't use it. So
KeyHalo lets go of the Launchpad while any app in *Let go while these apps run* is open (Ableton
Live, FL Studio, Bitwig, Reaper, Studio One, Cubase, Reason, Maschine by default; `*` matches
anything) and takes it back a few seconds after you close it. If another app holds the port,
the Pads page shows "in use by another app" and KeyHalo retries.

## Data

The board is saved as `pads.json` in the app data folder. Protocol details:
`src/core/pads/launchpad.ts` (notes `16 × row + column`, top buttons CC 104–111, colour velocity
`16 × green + red + 12`, reset `B0 00 00`).
