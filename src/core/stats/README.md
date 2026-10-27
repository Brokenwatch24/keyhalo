# core/stats — public API

Import from `@/core/stats`.

## Input listening (shared)

- `acquireInputListening(): () => void` — ref-counted switch for the Rust input hook
  (`input-key` / `input-mouse`). Call the returned function to release. **Every feature that needs
  global input events (typing trainer, reactive lighting, test bench…) should use this instead of
  calling `backend.inputSetListening` directly**, otherwise one feature can switch it off for another.
- `useInputListening(active = true)` — React hook version.

## Store: `useStats`

| Field | Type | Notes |
|---|---|---|
| `today` | `InputStats` | keys, clicks, mouseMeters, perKey (heatmap), peakWpm — refreshed ~4×/s |
| `lifetime` | `{ keys, clicks, mouseMeters, peakWpm, since }` | odometer |
| `wpm`, `apm` | `number` | live, rolling 10 s window (also `useSignals().wpm/apm`) |
| `series` | `{ t, wpm, apm }[]` | last 60 s, one sample per second (charts) |
| `battery` | `{ t, uid, name, percent, charging }[]` | last 7 days, every 5 min; `batteryOf(uid)` |
| `history` | `Record<day, InputStats>` | filled by `loadHistory` |
| `active` | `boolean` | counting (`settings.inputStats`) |

Actions: `loadHistory(days = 14)` → `InputStats[]` oldest → newest (today included, lazy-loaded
from `stats/<yyyy-mm-dd>.json`), `clearAll()`.

Notes: WPM counts printable keys only (chars / 5 per minute); APM counts every key-down and click.
Synthetic (remap-generated) events are ignored. Mouse metres use the primary mouse's current DPI
(`useDevices().live[uid].mouse`, fallback 800) and the Windows pointer speed (10 = 1:1).
`signals.capsLock` toggles on CapsLock presses (best effort: it can't read the real state, and
a pack that remaps CapsLock suppresses the toggle). In the browser demo (`backend.kind === "mock"`)
plausible history, lifetime totals and battery samples are seeded.

Pure helpers: `dayKey`, `emptyStats`, `isPrintableCode`, `pixelsToMeters`, `pointerMultiplier`, `RollingRate`.
