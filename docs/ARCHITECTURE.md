# KeyHalo architecture

KeyHalo is a Tauri 2 desktop app (Rust + React/TypeScript). The guiding rule:

> **Rust moves bytes, TypeScript understands devices, JSON describes everything users share.**

```
┌──────────────────────────── React UI (src/sections, src/ui) ───────────────────────────┐
│ Dashboard · Devices · Lighting · Performance · Keymaps · Typing · Test bench ·          │
│ Automations · Integrations · Community · Settings                                       │
└───────────────▲────────────────────────────────────────────────────────▲────────────────┘
                │ zustand stores (src/core/**/store.ts)                   │ i18n (src/i18n)
┌───────────────┴──────────────── Core services (src/core) ───────────────┴───────────────┐
│ devices/   drivers (razer, lamparray, openrgb), device manager, simulators              │
│ lighting/  scene compositor, effects (builtin + sandboxed community), widgets           │
│ keymaps/   packs → remap config, conflicts, VS Code import, Kanata export               │
│ typing/    trainer engine, adaptive lessons, stats, ghosts                              │
│ integrations/ Bambu, Claude Code, game GSI, Home Assistant/MQTT, notifications          │
│ automation/   rules engine                                                              │
│ community/    GitHub catalog, install, publish (fork + PR), gists, deep links           │
│ stats/        input odometer, WPM/APM, battery history                                  │
└───────────────▲─────────────────────────────────────────────────────────────────────────┘
                │ Backend interface (src/core/backend/api.ts)
       ┌────────┴─────────┐
       │ TauriBackend     │  invoke("<command>") ──► src-tauri (Rust): HID, LampArray, TCP,
       │ MockBackend      │  MQTT, HTTP, OS info, input hook + remap engine, audio loopback,
       └──────────────────┘  local REST/WebSocket API, tray, HUD overlay, storage
```

## Conventions

- **Language**: code, comments, docs and UI source strings in English. UI strings go through
  `useT()` / `t()` with dictionaries in `src/i18n/{en,es}/<namespace>.json`; each feature owns
  its namespace file (e.g. `typing.json`). Always provide both `en` and `es`.
- **Keys** are identified by W3C `KeyboardEvent.code` names everywhere (`KeyA`, `Digit1`,
  `ShiftLeft`, `Backquote`…). The Fn key, which the OS never sees, is `Fn`.
- **Types** shared across features live in `src/core/types.ts`. Add new shared types there;
  feature-private types stay in the feature folder.
- **State**: one zustand store per feature (`src/core/<feature>/store.ts`). Persist with
  `loadJson`/`saveJson`/`saveJsonDebounced` from `src/core/state/persist.ts`
  (files in the app data folder; `localStorage` in the browser demo).
- **Startup**: each feature exposes `init()` in `src/core/<feature>/init.ts`, called from
  `src/core/init.ts`. Never block startup on network or hardware; log and continue.
- **UI**: use the primitives in `src/ui` (`Page`, `Card`, `Button`, `Slider`, `Toggle`,
  `Select`, `Segmented`, `Tabs`, `Modal`, `Badge`, `Stat`, `KeyboardView`, `MouseView`,
  charts…). Section-specific CSS lives next to the section (`src/sections/<id>/<id>.css`)
  with classes prefixed by the section id. The UI is neutral (greys); the only saturated
  colour comes from lighting previews, user data and status tones.
- **Browser demo**: everything must work with `MockBackend` (`npm run dev`) using simulated
  devices, so screenshots and contributors without hardware can use the app.
- **Safety**: never flash firmware. Respect `settings.safeMode` (no hardware writes).
  Capture a `DeviceSnapshot` before the first write so users can restore the original state.
  Imported community content containing `launch`, `macro`, `text` or `http` actions must be
  reviewed by the user before it is enabled.
- **Privacy**: global input events are used only for counts, live WPM and reactive lighting.
  Typed text is never stored outside the typing trainer's own sessions.
- **License**: MIT. Protocol knowledge may be learned from OpenRazer/OpenRGB documentation and
  sources (credited in `docs/protocols`), but never copy their (GPL) code.

## Shared content

Everything users share is JSON validated by `community/schemas/*.schema.json`:

| Folder | Type (`src/core/types.ts`) | Example |
|---|---|---|
| `community/devices/<vendor>/` | `DeviceDefinition` | `razer/huntsman-mini.json` |
| `community/profiles/` | `Profile` | `neon-focus.json` |
| `community/keymaps/` | `KeymapPack` | `davinci-resolve.json` |
| `community/effects/` | community effect module (JS) | `rain.js` |
| `community/typing/` | `TypingPack` | `es-common-words.json` |

CI (`.github/workflows/community.yml`) validates every pull request and rebuilds
`community/index.json` (`CatalogIndex`), which the app downloads to show the gallery.
