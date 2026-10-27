# core/automation — public API

Import from `@/core/automation`. Types `Rule`, `Trigger`, `RuleAction` live in `src/core/types.ts`.

## Store: `useRules`

| Member | Notes |
|---|---|
| `rules: Rule[]` | persisted in `rules.json`; first run creates disabled example rules |
| `log: RunLogEntry[]` | last 50 firings, newest first: `{ id, ruleId, ruleName, at, reason, manual, ok, error? }` |
| `add(rule)` → `Rule` | id generated when missing |
| `update(id, patch)`, `remove(id)`, `setEnabled(id, on)`, `duplicate(id)` | |
| `importRules(json)` → `{ ok, rules, errors, risky }` | imported rules are added **disabled**; `risky` lists `http`/`mqttPublish` actions to review |
| `exportRules(ids?)` → JSON string | |
| `testRule(id)` → `RunLogEntry` | runs the actions now (ignores enabled/cooldown) |
| `clearLog()` | |

## Triggers (engine semantics)

| type | fires when |
|---|---|
| `appFocus` / `appLaunch` | process focused / newly running (process list polled every 3 s only if such a rule is enabled); names case-insensitive, `.exe` optional |
| `time` | `at: "HH:MM"`, optional `days` (0 = Sunday … 6 = Saturday); once per matching minute |
| `batteryBelow` | a device (optional `device` = uid, definition id or name substring) drops below `percent`; once per crossing, re-arms 2 points above |
| `idle` | no keyboard/mouse input for `minutes` (enables the input hook while such a rule exists) |
| `cpuAbove` / `gpuTempAbove` | sustained for 10 s; re-arms when it drops |
| `mqtt` | message on `topic` (wildcards `+`/`#`) on the Home Assistant/MQTT broker; `match` = substring or `/regex/flags` |
| `api` | local API action with that name (`POST /api/v1/action {"action":"<event>"}`) |
| `game` | `cs2`/`dota2`/`lol` events: `round_start`, `round_end`, `freezetime`, `bomb_planted`, `bomb_defused`, `bomb_exploded`, `low_health`, `death`, `respawn`, `flashed`, `burning` |
| `hotkey` | global accelerator, e.g. `Ctrl+Alt+P` (desktop app only) |

Actions: `profile`, `flash`, `notify`, `dpi`, `brightness`, `mqttPublish`, `http`, `pauseRemap`.
`cooldown` (seconds) limits how often a rule can fire.

## Helpers

`validateRule(unknown)` → errors, `riskyRuleActions(rules)`, `describeTrigger(trigger)` (English
summary; prefer i18n `automation.triggers.*`), `dispatch(event)` (feed a synthetic `EngineEvent`,
e.g. a "simulate" button), `fireRuleByName(name)`, `TriggerEvaluator` (pure), `exampleRules()`.
i18n: `automation.triggers.*`, `automation.actions.*`, `automation.gameEvents.*`.
