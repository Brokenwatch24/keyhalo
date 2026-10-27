# Lighting (`src/core/lighting`)

Scene compositor, effects (built-in + sandboxed community), widgets, flash service and profiles.
Import from `@/core/lighting` (index.ts) unless noted.

## Stores and hooks

| API | What |
|---|---|
| `useLighting` | zustand store: `scene`, `errors` (layer id → reason), `running`, `setScene`, `setLayers`, `addLayer(partial, index?) → id`, `updateLayer(id, patch)`, `removeLayer(id)`, `moveLayer(id, toIndex)`, `setBrightness(0..1)`, `setFps` |
| `useLightingFrame(uid)` | live colours `{ codeOrLedId: [r,g,b] }` of one device at ~20 fps; `"*"` = whole desk. With no device connected use `VIRTUAL_KEYBOARD` / `VIRTUAL_MOUSE` (a 60% ANSI board + the DeathAdder drawing). Subscribing keeps the engine running. Feed it to `KeyboardView colors` / `MouseView colors`. |
| `useEffects()` | `EffectMeta[]` of every effect (re-renders when community effects load) |
| `effectRegistry` | `list()`, `get(id)`, `register(module)`, `registerCommunity(source) → Promise<EffectMeta>`, `unregister(id)`, `subscribe(fn)` |
| `flash({ keys?, color, times?, durationMs? })` | temporary overlay (same as bus `lighting:flash`); capped at 2.5 Hz, 1.4 Hz with Reduce flashing |
| `useProfiles` | `profiles`, `sources` (id → `bundled`/`installed`/`user`), `activeId`, `dirty`, `create(name, base?)`, `duplicate(id, name?)`, `rename`, `update` (user profiles only), `remove`, `exportJson(id)`, `importJson(json)`, `apply(id, reason?, { silent? })`, `saveActiveScene(name?)` |
| `renderProfilePreview(profile, definition, layoutId?, opts?)` | `Promise<string>` PNG data URL of the device lit with the frame at t = 1 s (gallery / publish) |
| `statusColor(kind)`, `statusScale(t)` | colour-vision–safe status colours (follow `settings.colorVision`) |
| `hsv`, `mix`, `hex`, `toHex`, `gradientAt`, `noise2D` | colour/noise helpers |
| `Compositor` | standalone compositor (previews, tests) |

Scene edits are written back to the active profile when it is a user profile; for bundled or
installed profiles `useProfiles.dirty` becomes true — offer "Save as new profile"
(`saveActiveScene(name)`).

## Bus messages handled

`lighting:flash`, `lighting:brightness` (`value` 0..1, or 0..100), `lighting:effect` (replaces the
bottom layer's effect), `profile:apply`, `community:installed` / `community:removed` for kinds
`profile` and `effect` (effect data: the JS source string or `{ source }`).
Emitted: `profile:applied`, `hud` (profile name), `keymaps:setEnabled` (only when the profile has
a `keymaps` list).

## Behaviour notes

- The engine renders at `scene.fps` (default 30) and pauses when no device is connected and no
  preview is subscribed. Devices showing a hardware effect (`useDevices.live[uid].mode ===
  "hardware"`) are left alone until a profile is applied again.
- Layers with an `audio`-tagged effect turn on `backend.audioSetListening` and fill
  `useSignals.audio`; reactive effects turn on `backend.inputSetListening(true)` (never off).
- Auto-switch: profiles with `apps: ["Game.exe"]` are applied when that process is focused
  (`settings.autoSwitchProfiles`); leaving returns to the previous profile.
- Effect authors: see `docs/EFFECTS.md`.

## Files

`api.ts` (Effect API types) · `color.ts` · `noise.ts` · `scene.ts` (desk geometry) ·
`compositor.ts` · `engine.ts` · `hooks.ts` · `store.ts` · `profiles.ts` · `preview.ts` ·
`sandbox.ts` · `effects/{builtin,widgets,registry}.ts` · `init.ts` · tests: `lighting.test.ts`,
`integration.test.ts`.
