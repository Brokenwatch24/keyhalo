# core/keymaps — public API

Import from `@/core/keymaps` (barrel `index.ts`). Format and behaviour: `docs/KEYMAPS.md`.

## Store: `useKeymaps`

| Field | Type | Notes |
|---|---|---|
| `packs` | `KeymapPack[]` | all packs, deduplicated (user > installed > bundled) |
| `bundled` / `user` / `installed` | `KeymapPack[]` | by source; `sourceOf(id)` → `"bundled" \| "user" \| "installed"` |
| `enabledIds` | `string[]` | default: every bundled legend-only pack |
| `paused` | `boolean` | remapping paused (tray / rule / API / UI) |
| `foreground` | `string \| null` | focused process |
| `activePackId` | `string \| null` | pack for the focused app (app pack, else first global pack with legends) |
| `activePackIds` | `string[]` | all packs that apply now, app packs first (pass to `legendColorsFor`) |
| `layer` | `string \| null` | active layer id (also `useSignals().layer`) |
| `lastConfig` / `lastError` | | last `RemapConfig` pushed to Rust / last error |

Actions: `get(id)`, `savePack(pack)` (create/update a user pack; editing a bundled pack saves a
user override), `deletePack(id)`, `duplicatePack(id)`, `importPack(jsonOrObject, {save?})` →
`{ ok, pack, errors, risky }` (never enables; show the review dialog when `risky.length`),
`importVsCode(text, {save?})` → `{ pack, imported, removed, skipped }`, `exportPack(id)` (JSON string),
`exportKanata(id)` / `exportAutoHotkey(id)` → `{ text, warnings }`, `setEnabled(ids)`,
`toggle(id, on)`, `setPaused(bool)`.

Everything is persisted (`keymaps/<id>.json`, `keymaps-installed/<id>.json`,
`keymaps-state.json`) and recompiled + pushed to Rust (`remap_configure`) automatically.

## Helpers

- `findConflicts(pack, { layout?, keyboardName? })` → `Conflict[]` with `kind`
  (`appShortcut | duplicate | osReserved | missingKey | fnOnly | invalidKey | unknownLayer`),
  `severity`, `layer`, `binding`, `combo` (display label), `messageKey` + `params` (i18n
  `keymaps.conflicts.*`), `message` (English), `suggestionKey?`.
  Get the layout with `layoutOf(primaryKeyboard(useDevices().devices))`.
- `riskyActions(pack)` → `RiskItem[]` (`kind: launch | macro | text | http`, `layer`, `binding`, `detail`).
- `validatePack(unknown)` → `string[]` errors.
- `legendColorsFor(packOrPacks, heldModifiers, { includeSupersets?, modifierColor? })` →
  `Record<KeyCode, RGB>` for previews (e.g. a `KeyboardView` legend preview).
- `layerColorsFor(pack, layerId)` → colours of a layer's keys.
- `compileRemapConfig(packs, enabledIds, opts)`, `packsForProcess(packs, enabledIds, process)`, `packHasRemaps(pack)`.
- `isKeyRemapped(code, process?)` — used by stats for Caps Lock tracking.
- Key helpers (`codes.ts`): `KEY_CODES`, `isValidKeyCode`, `isValidTrigger`, `keyLabel("KeyA") → "A"`,
  `comboLabel(["ControlLeft","KeyB"]) → "Ctrl+B"`, `comboFromKeys`, `comboFromBinding`, `hexToRgb`, `CATEGORY_PALETTE`.
- `parseJsonc`, `parseVsCodeStroke`, `kanataKey`.

## Cheat-sheet overlay

Runs automatically: after ~350 ms of holding Ctrl/Shift/Alt/Win it sets
`useSignals().overlays.cheatsheet = { priority: 50, colors, exclusive: true }` and clears it on
release. Disabled by `settings.cheatsheet = false`. Constants: `CHEATSHEET_OVERLAY`, `CHEATSHEET_PRIORITY`.

## Bus

Handles `keymaps:setEnabled`, `keymaps:pause`, `community:installed/removed` (kind `keymap`) and
tray action `pauseRemap` (value `"true"`/`"false"`, none = toggle). Emits `dpi:set`, `dpi:cycle`,
`dpi:sniper` (`active:false` on key-up of the trigger), `profile:apply` (reason `hotkey`),
`keymaps:action` for every fired binding, and `hud` for layer changes, pause and labelled
macro/launch/text bindings.
