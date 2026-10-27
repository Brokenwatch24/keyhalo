# Devices (`src/core/devices`)

Drivers, the device manager, simulators, layout templates and wizard helpers.
Import from `@/core/devices` (index.ts) or the individual modules.

## Store

`useDevices` (contract in `store.ts`, implemented by `manager.ts`):

| Field / action | What |
|---|---|
| `devices: ConnectedDevice[]` | recognised + probed devices (`uid`, `definition`, `layoutId`, `firmware`, `serial`, `desk`, `online`, `error`) |
| `definitions` | bundled (`community/devices/**`) + installed (`devices/installed/*.json`) |
| `live[uid]` | `effect`, `brightness` (0..1), `mouse` (`MouseSettings`, `activeStage` is 0-based), `dpi` (current sensor DPI), `battery`, `mode` (`software` = lit by KeyHalo, `hardware` = onboard effect) |
| `scanning`, `scan()` | rescan (also runs on start, on `hid-changed` and every 5 s) |
| `setEffect(uid, effect, store?)` | hardware effect; non-custom effects put the device in `hardware` mode |
| `setBrightness(uid, 0..1, store?)` | |
| `setMouseSettings(uid, patch)` | DPI stages/active stage, polling rate, idle sleep, low-battery threshold, `sniperDpi` |
| `restoreSnapshot(uid)` | writes back the state captured the first time the device was seen (`snapshots/<uid>.json`) |
| `saveToOnboard(uid, effect)` | `setEffect(…, store = true)` |
| `setDesk(uid, {x, y})`, `setLayout(uid, layoutId)` | persisted in `devices/prefs.json` |
| `addDefinition(def)` | save + rescan (also via bus `community:installed` kind `device`) |

Helpers: `primaryKeyboard`, `primaryMouse`, `layoutOf(device)`.

## Manager helpers (`manager.ts`)

`getHandle(uid)` (driver `DeviceHandle`), `getDevice(uid)`, `setDpi(value, uid?)`,
`cycleDpi(direction, uid?)`, `sniper(active, value?, uid?)`, `setSoftwareMode(uid?)`.
Bus handled: `dpi:set`, `dpi:cycle`, `dpi:sniper` (hold → temporary DPI, release → restore),
`device:effect` (`uid` omitted = all devices). DPI changes emit a `hud` message.
Mouse battery is polled every 60 s into `useSignals().battery[uid]`.

## Wizard (`wizard.ts`)

| API | What |
|---|---|
| `listUnknownHidDevices(vendorIds?)` | HID devices no definition matches, grouped per physical device |
| `findRazerInterface(dev)` / `probeRazer(path)` | read-only check: firmware/serial if the interface speaks the Razer protocol |
| `lightMatrixCell(pathOrHandle, row, col, color?, matrix?, transactionId?)` | light one cell of an undefined device (others off) |
| `lightLed(uid, address, color?)` / `releaseLed(uid)` | light one LED of a connected device, pausing engine output for it |
| `buildDefinitionFromMapping(input)` | `DeviceDefinition` from a template + `{ code: [row, col] }` mapping |

## Templates (`templates.ts`)

`ansi-60`, `iso-60`, `ansi-65`, `ansi-75`, `ansi-tkl`, `iso-tkl`, `ansi-100`, `iso-100`
(`TEMPLATES`, `getTemplate(id)`), plus legends for national layouts:
`applyLocale(layout, "es-ES" | "es-LA")` (`LOCALE_OVERLAYS`).

## Drivers (`drivers/`)

- `razer.ts` — 90-byte feature-report protocol (`razer-protocol.ts` is the pure packet layer).
  Per-device promise queue, busy retry, transaction-id fallback (per command), frame
  de-duplication by row and ≤ 30 fps, `settings.safeMode` blocks every write. `driverOptions`:
  `transactionId`, `matrix {rows, cols}`, `led`, `frameMode` (`matrix` | `led`),
  `waveDirections {left, right}`, `wireless`, `responseDelayMs`, `maxFps`, `customEveryFrame`.
- `lamparray.ts` — Windows Dynamic Lighting; VK → `KeyboardEvent.code` table in `vk.ts`;
  synthesises a definition from lamp positions; skips devices driven natively.
- `openrgb.ts` — OpenRGB SDK client (`openrgb-protocol.ts`), enabled by
  `settings.openrgb = { enabled, host, port }` (default off, 127.0.0.1:6742).

Protocol notes: `docs/protocols/razer.md`, `docs/protocols/openrgb-sdk.md`.

## Simulators (`sim/razer.ts`)

In the browser demo (`backend.kind === "mock"`), `init()` registers stateful HID simulators of the
user's Huntsman Mini (if0–if3, control on if2) and DeathAdder V2 Pro (wireless dongle; battery
drains slowly and recharges). `simulators.huntsman.state.matrix` shows the last custom frame.
