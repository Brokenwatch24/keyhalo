# Integrations

Integrations feed live data into lighting widgets (`useSignals`), the HUD and automations.
Each one has an **enabled** switch, a status (`idle`, `connecting`, `connected`, `error` + message)
and, where it makes sense, a **Test** button. Settings are stored in `integrations.json` in the
app data folder. Nothing here ever blocks startup: network connections are made in the background
and retried with back-off.

| Integration | Data | Default |
|---|---|---|
| [System monitor](#system-monitor) | CPU / GPU / RAM | on (polls only while needed) |
| [Bambu Lab printer](#bambu-lab-printer) | print progress, state, layers | off |
| [Claude Code](#claude-code) | working / waiting / done / error | on |
| [App notifications](#app-notifications) | unread badges → flash | off |
| [Microphone mute](#microphone-mute) | mute state + hotkey | on |
| [Games](#games) | CS2 / Dota 2 GSI, League of Legends | on |
| [Home Assistant / MQTT](#home-assistant--mqtt) | keyboard as a light, sensors | off |
| [Local API](#local-api) | REST + WebSocket on 127.0.0.1 | on (Settings → API) |
| [Pomodoro](#pomodoro) | focus / break timer | — |

## System monitor

Reads CPU load and temperature, GPU load/temperature/VRAM and RAM usage once per second, **only
while something needs it** (a CPU/GPU lighting widget, the dashboard, or a `cpuAbove` /
`gpuTempAbove` rule). Values come from the Rust side (`system_metrics`); CPU temperature and GPU
data may be missing on some hardware.

## Bambu Lab printer

Shows the progress of the current print on your keyboard (progress bar widget) and flashes
green when it finishes / red when it fails.

1. On the printer: **Settings → Network** — note the **IP address** and the **LAN access code**
   (8 characters). Newer firmware calls it *LAN Only Mode* / *Developer mode*: the LAN MQTT
   server must be enabled. Cloud mode alone is not enough.
2. **Settings → Device** (or the sticker / Bambu Handy app) — note the **serial number**.
3. In KeyHalo → Integrations → Bambu Lab: enter IP, serial and access code, enable, press **Test**.

Technical details: MQTT over TLS on port **8883** (self-signed certificate, verification skipped),
user `bblp`, password = access code. KeyHalo subscribes to `device/<serial>/report` and sends
`{"pushing":{"sequence_id":"0","command":"pushall"}}` to `device/<serial>/request` to get the full
state once. Reports are partial (only changed fields), so KeyHalo merges `print.mc_percent`,
`gcode_state`, `mc_remaining_time`, `layer_num` and `total_layer_num` into a running state.
KeyHalo never sends print commands.

In the browser demo a simulated printer prints a fake job so you can see the widget move.

## Claude Code

Lights your keyboard while [Claude Code](https://docs.claude.com/en/docs/claude-code) works and
alerts you (HUD + flash) when it is **waiting** for your input. States: `idle`, `working`,
`waiting`, `done`, `error`.

The desktop app installs a small `keyhalo` CLI. Add hooks to `~/.claude/settings.json`
(or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "keyhalo claude working" }] }],
    "PreToolUse":       [{ "hooks": [{ "type": "command", "command": "keyhalo claude working" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "keyhalo claude waiting" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "keyhalo claude done" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "keyhalo claude idle" }] }]
  }
}
```

`keyhalo claude error` is available for your own scripts. Without the CLI, use the local API
directly (replace `TOKEN` with the token from Settings → API; omit the header if no token is set):

```bash
curl -s -X POST http://127.0.0.1:27463/api/v1/action \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"claude","params":{"state":"waiting"}}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:27463/api/v1/action `
  -Headers @{ Authorization = "Bearer TOKEN" } -ContentType "application/json" `
  -Body '{"action":"claude","params":{"state":"working"}}'
```

## App notifications

Flashes an app's colour when its **unread count goes up**. KeyHalo reads the titles of visible
top-level windows every 2 s (no screen capture, no message content) and looks for the badge the
app puts in its title:

| App | Process | Title pattern | Notes |
|---|---|---|---|
| Discord | `Discord.exe` | `(3) #channel - Discord` | mentions + DMs |
| WhatsApp | `WhatsApp.exe`, `WhatsApp.Root.exe` | `(5) WhatsApp` | |
| Telegram | `Telegram.exe` | `Telegram (12)` | |
| Slack | `slack.exe` | `* Slack …` (unread), `! Slack …` (mention), `… 3 new items` | no exact count for `*`/`!` |
| Microsoft Teams | `ms-teams.exe`, `Teams.exe` | `(2) Chat \| … \| Microsoft Teams` | |
| Outlook | `OUTLOOK.EXE`, `olk.exe` | `(3) …` / `Inbox (3)` | classic Outlook usually shows no count |
| Gmail (off by default) | browsers | `Inbox (12) - … - Gmail` | only when Gmail is the active tab |

This is **best effort**: apps change their title format between versions, the window must
exist (minimised or in the tray-but-open is fine; fully closed to tray is not), and the first
poll only records a baseline. Each app has its own colour, optional key list (empty = whole
keyboard) and optional HUD. The local API can also trigger notifications (see `notify` below).

## Microphone mute

Polls the default capture device's mute state every second → `signals.micMuted` (for a
mic widget, e.g. a red key while muted) and a HUD on every change. A global hotkey toggles it
(default **Ctrl+Shift+M**, change or clear it in the integration settings). ⚠️ Ctrl+Shift+M is also
Discord's own mute shortcut — while KeyHalo holds it, Discord won't see it; pick another combo
(e.g. Ctrl+Alt+M) if you use Discord's. Keymap packs can bind `{"type":"media","command":"micMute"}`.

## Games

Only **official game APIs** are used. KeyHalo never reads game memory or injects anything.

### Counter-Strike 2 and Dota 2 — Game State Integration

Press **Install for CS2 / Dota 2**. KeyHalo finds the game in your Steam libraries and writes:

- CS2: `…\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\gamestate_integration_keyhalo.cfg`
- Dota 2: `…\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\gamestate_integration_keyhalo.cfg`

The file tells the game to POST its state to `http://127.0.0.1:<api port>/gsi/cs2` (or `/gsi/dota2`)
with your API token (one is generated if you had none). Restart the game afterwards. The local API
must be enabled. Manual install: copy the file content shown in the UI into that path.

Published signals: CS2 health, armor, active weapon clip ratio, flashed, burning, bomb
(`planted`/`defused`/`exploded`), round phase, dead/spectating. Dota 2: health %, mana %, dead,
game state. Automation events: `round_start`, `round_end`, `freezetime`, `bomb_planted`,
`bomb_defused`, `bomb_exploded`, `low_health` (below the configured %, default 30), `death`,
`respawn`, `flashed`, `burning`.

### League of Legends — Live Client Data API

No setup. While `League of Legends.exe` is running, KeyHalo polls
`https://127.0.0.1:2999/liveclientdata/activeplayer` once per second (Riot's self-signed
certificate is accepted for this localhost URL only) → health %, mana/resource %, dead.

## Home Assistant / MQTT

Connects to any MQTT broker (the Home Assistant **Mosquitto broker** add-on works out of the box).

1. In Home Assistant: install the Mosquitto add-on and the MQTT integration; create a user for KeyHalo.
2. In KeyHalo: broker host (e.g. `homeassistant.local`), port 1883 (8883 with TLS), username,
   password, and a computer name (`nodeId`, e.g. `desk`). Enable and **Test**.

With **discovery** on, Home Assistant automatically shows a *KeyHalo (desk)* device with:

- `light.keyboard` — on/off, brightness, RGB colour (sets a static colour) and **effect = your
  lighting profiles** (selecting one applies it);
- sensors: typing speed (WPM), APM, mouse battery, keyboard battery, active profile, Claude Code state.

Topics (`<base>` = `keyhalo/<nodeId>`):

| Topic | Direction | Payload |
|---|---|---|
| `<base>/state` | KeyHalo → broker (retained, on change, at least every 10 s) | `{"profile","profile_id","wpm","apm","mouse_battery","keyboard_battery","claude","mic_muted","bambu_progress"}` |
| `<base>/availability` | retained | `online` / `offline` |
| `<base>/light/state` | retained | HA JSON light schema |
| `<base>/light/set` | broker → KeyHalo | `{"state":"ON","brightness":128,"color":{"r":255,"g":0,"b":0},"effect":"Neon Focus"}` |
| `homeassistant/light/keyhalo_<node>/keyboard/config` … | discovery (retained) | |

The same broker connection is used by automation rules with an **MQTT** trigger and the
**Publish MQTT message** action. (The broker connection has no last-will message, so if KeyHalo
crashes HA keeps the last `online` value until it reconnects.)

## Local API

Enable it in Settings → API (port **27463**, optional bearer token). The server listens on
127.0.0.1 only.

- `GET /api/v1/status` — JSON: `version`, `activeProfile`, `devices` (`name`, `type`, `battery`),
  `wpm`, `apm`, `claude`, `bambu`, `micMuted`, `pomodoro`. The same JSON is pushed over the
  WebSocket whenever it changes.
- `POST /api/v1/action` with `{"action": "...", "params": {...}}`:

| action | params | Effect |
|---|---|---|
| `profile` | `{"id"}` (or `"name"`) | apply a lighting profile |
| `effect` | `{"id", "params"?}` | switch the lighting effect |
| `flash` | `{"keys"?, "color", "times"?}` | flash keys (no keys = whole keyboard) |
| `notify` | `{"text", "color"?, "keys"?}` | flash + HUD message |
| `dpi` | `{"value"}` | set mouse DPI |
| `brightness` | `{"value"}` | 0..1 (or 0..100) |
| `claude` | `{"state"}` | Claude Code state |
| `pomodoro` | `{"action": "start"\|"stop"\|"skip"\|"pause"\|"resume"\|"toggle", "focusMin"?, "breakMin"?}` | timer control |
| `rule` | `{"name"}` | run the enabled automation rule with this name (or id) |
| *anything else* | | fires automation rules with an **API** trigger of that name |

```bash
curl -X POST http://127.0.0.1:27463/api/v1/action -H "Content-Type: application/json" \
  -d '{"action":"notify","params":{"text":"Build finished","color":"#7ee0a1"}}'
```

## Pomodoro

Focus/break timer (defaults 25 / 5 min, long break 15 min every 4 sessions) published as
`signals.pomodoro` for the timer widget, with a HUD and a flash at each phase change. Start it from
the dashboard, the API (`pomodoro`), or a Stream Deck button calling the API.
