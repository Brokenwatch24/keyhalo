# KeyHalo local API

KeyHalo runs a small HTTP + WebSocket server so scripts, games, stream tools and AI agents can
read its state and trigger actions (switch profiles, flash keys, show notifications…).

- Listens on **`127.0.0.1` only** (never on your network), default port **`27463`**.
- Enable/disable it, change the port and set a token in **Settings → Local API**.
- CORS is permissive so browser-based tools (stream overlays) can call it. **If you browse
  untrusted sites while KeyHalo runs, set a token**: without one, any web page could post
  actions to localhost.

## Authentication

When a token is configured, every request must carry it, either as a header or a query parameter:

```
Authorization: Bearer <token>
GET /api/v1/status?token=<token>
```

Game State Integration endpoints also accept the token inside the JSON body as `auth.token`,
which is how CS2 and Dota 2 send it. Requests without a valid token get `401`.

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/v1` | – | `{"name":"KeyHalo","version":"1.0.0","api":"/api/v1"}` (no token needed) |
| `GET` | `/api/v1/status` | – | `200` + the current state JSON (active profile, devices, DPI…) |
| `POST` | `/api/v1/action` | `{"action": "<name>", "params": {…}}` | `202 {"ok":true,"action":"<name>"}` |
| `POST` | `/api/v1/notify` | `{"text": "…", "color": "#hex", "keys": ["KeyA"]}` | `202 {"ok":true}` |
| `GET` | `/api/v1/ws` | WebSocket upgrade | pushes the state JSON on connect and on every change |
| `POST` | `/gsi/cs2` | CS2 GSI payload | `200 {"ok":true}` |
| `POST` | `/gsi/dota2` | Dota 2 GSI payload | `200 {"ok":true}` |

Errors return `{"ok": false, "error": "…"}` with `400` (bad JSON / missing field), `401` or `404`.

### Actions

`POST /api/v1/action` forwards `{action, params}` to the app as is, so new actions can be added
without touching the server. Built-in actions:

| Action | Params | Effect |
|---|---|---|
| `profile` | `{"id": "neon-focus"}` | Activate a profile |
| `effect` | `{"id": "rain"}` | Switch the lighting effect |
| `dpi` | `{"value": 1600}` | Set mouse DPI |
| `flash` | `{"keys": ["KeyW","KeyA"], "color": "#ff4d6d", "times": 3}` | Flash keys (omit `keys` for the whole desk) |
| `notify` | `{"text": "Build done", "color": "#3ddc97", "keys": ["F12"]}` | HUD toast + optional key flash (same as `/api/v1/notify`) |
| `brightness` | `{"value": 0.6}` (0..1, or 0..100) | Global lighting brightness |
| `claude` | `{"state": "working" \| "waiting" \| "done" \| "error" \| "idle"}` | Claude Code status lighting |
| `pomodoro` | `{"action": "start", "focusMin": 25}` / `{"action": "stop"}` | Pomodoro timer on the keyboard |

Any other action name (e.g. `{"action":"deploy"}`) is handed to the automation engine, so rules
with an `api` trigger can react to it; `{"action":"rule","params":{"name":"…"}}` runs a rule.

## curl examples

```bash
# State
curl http://127.0.0.1:27463/api/v1/status

# Switch profile
curl -X POST http://127.0.0.1:27463/api/v1/action \
  -H "Content-Type: application/json" \
  -d '{"action":"profile","params":{"id":"neon-focus"}}'

# Flash WASD red three times
curl -X POST http://127.0.0.1:27463/api/v1/action \
  -d '{"action":"flash","params":{"keys":["KeyW","KeyA","KeyS","KeyD"],"color":"#ff4d6d","times":3}}'

# Notification with a token
curl -X POST http://127.0.0.1:27463/api/v1/notify \
  -H "Authorization: Bearer $KEYHALO_TOKEN" \
  -d '{"text":"Deploy finished","color":"#3ddc97"}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:27463/api/v1/action `
  -Body '{"action":"dpi","params":{"value":800}}' -ContentType application/json
```

## WebSocket

`ws://127.0.0.1:27463/api/v1/ws` (add `?token=…` when a token is set). The server sends the full
state JSON once on connect and again every time it changes. Messages from the client are ignored
(pings are answered).

```js
const ws = new WebSocket("ws://127.0.0.1:27463/api/v1/ws");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

## CLI

The `keyhalo` command-line tool (source in `cli/`, installed next to the app) wraps the API:

```
keyhalo status
keyhalo action <name> [json-params]
keyhalo notify <text> [--color #hex] [--keys KeyA,KeyB]
keyhalo profile <id>
keyhalo effect <id>
keyhalo dpi <value>
keyhalo flash <keys|all> <#hex> [--times n]
keyhalo claude <working|waiting|done|error|idle>
keyhalo --help
```

Environment: `KEYHALO_PORT` (default `27463`) and `KEYHALO_TOKEN`.
Exit codes: `0` ok, `1` KeyHalo unreachable / request failed, `64` usage error.
`keyhalo claude …` always exits `0` quietly when KeyHalo isn't running, so it never disturbs hooks.

Build it with `cd cli && cargo build --release` → `cli/target/release/keyhalo.exe`; put it on
your `PATH`.

## Claude Code hooks

Make your keyboard show what Claude Code is doing: working (busy animation), waiting for you
(attention pulse), done. Add this to `~/.claude/settings.json` (merge with any existing `hooks`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "keyhalo claude working" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "keyhalo claude waiting" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "keyhalo claude done" }] }
    ]
  }
}
```

If `keyhalo` isn't on your `PATH`, use the full path, e.g.
`"C:\\Program Files\\KeyHalo\\keyhalo.exe claude working"`. Set `KEYHALO_TOKEN` in your
environment if you configured a token.

## Game State Integration (CS2 / Dota 2)

KeyHalo can install the config files for you (**Integrations → Games**). It finds the game
through Steam's `libraryfolders.vdf` and writes:

- CS2: `…/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/gamestate_integration_keyhalo.cfg`
- Dota 2: `…/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/gamestate_integration_keyhalo.cfg`

Manual setup (CS2 example):

```
"KeyHalo"
{
  "uri"        "http://127.0.0.1:27463/gsi/cs2"
  "timeout"    "1.0"
  "buffer"     "0.05"
  "throttle"   "0.1"
  "heartbeat"  "10.0"
  "auth"       { "token" "<your KeyHalo token, or anything if none is set>" }
  "data"
  {
    "provider"            "1"
    "player_id"           "1"
    "player_state"        "1"
    "player_weapons"      "1"
    "round"               "1"
    "map"                 "1"
    "bomb"                "1"
  }
}
```

For Dota 2 use `"uri" "http://127.0.0.1:27463/gsi/dota2"` and Dota's data sections (`hero`,
`abilities`, `items`, `map`, `player`). Restart the game after adding the file. Payloads are
forwarded to the app as `gsi` events (`{game, payload}`) and drive game lighting and automations.
GSI is an official, read-only Valve feature and is safe with VAC.
