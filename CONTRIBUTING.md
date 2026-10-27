# Contributing to KeyHalo

Thanks for helping! KeyHalo is built so that most contributions, such as a new device, a
lighting profile, a keymap pack for your favourite app, an effect or a typing pack, are
**plain JSON or a small JS file**, with no Rust needed.

> ¿Prefieres español? Lee la [guía de contribución en español](docs/CONTRIBUTING.es.md).

- [Development setup](#development-setup)
- [Useful scripts](#useful-scripts)
- [Project structure](#project-structure)
- [Adding community content](#adding-community-content)
- [Commits and pull requests](#commits-and-pull-requests)
- [Code style](#code-style)

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## Development setup

Requirements:

- **Node.js 22** (LTS) and npm
- **Rust** stable via [rustup](https://rustup.rs) (only for the desktop app)
- On Windows: **Microsoft C++ Build Tools** ("Desktop development with C++") and the
  **WebView2 runtime** (preinstalled on Windows 11). See the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Brokenwatch24/keyhalo.git
cd keyhalo
npm install

# Browser demo with simulated devices, no hardware or Rust needed
npm run dev          # → http://localhost:1420

# Full desktop app (Tauri)
npm run app:dev
```

The browser demo uses `MockBackend` (`src/core/backend/mock.ts`): a simulated desk with a
keyboard and a mouse that speak the real protocols, so you can work on the UI, lighting
effects, keymaps and the typing trainer without any hardware.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `npm test` | Unit tests (Vitest) for the app and the scripts |
| `npm run community:validate` | Validate everything in `community/` against the JSON Schemas plus extra checks |
| `npm run community:index` | Rebuild `community/index.json` and the devices table in `README.md` |
| `npm run site:build` | Build the website into `site/dist/` |
| `npm run screenshots` | Capture every page in dark and light theme into `docs/screenshots/` (needs `npm run dev` running and Microsoft Edge installed; runs Edge headless) |
| `node scripts/social-card.mjs` | Render `docs/social-preview.png` (1280×640) |
| `npm run app:build` | Build the Windows installers locally |

## Project structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture. In short:
**Rust moves bytes, TypeScript understands devices, JSON describes everything users share.**

```
src/
  core/<feature>/   services + one zustand store per feature (devices, lighting, keymaps,
                    typing, integrations, automation, community, stats)
  core/backend/     Backend interface → TauriBackend (desktop) / MockBackend (browser demo)
  core/types.ts     shared types (DeviceDefinition, Profile, KeymapPack, TypingPack…)
  sections/<id>/    one folder per page (Dashboard, Lighting, Keymaps…)
  ui/               design-system primitives (Page, Card, Button, KeyboardView…)
  i18n/{en,es}/     translations, one JSON namespace per feature
src-tauri/          Rust: HID, LampArray, input hook + remap engine, local API, tray, storage
community/          shared content + JSON Schemas (see community/README.md)
site/               the website (GitHub Pages)
scripts/            validation, index, website, screenshot tooling (Node ESM)
docs/               architecture, protocol notes, local API, screenshots
```

## Adding community content

All shared content lives in [`community/`](community/README.md) and is validated by
`community/schemas/*.schema.json`. Two rules apply everywhere:

- **The file name must equal the `id`** (`community/profiles/neon-focus.json` → `"id": "neon-focus"`).
  Ids are lowercase kebab-case.
- An optional **preview image** can sit next to the file as `<id>.png` (or `<id>.svg`); the
  gallery and the website use it.

Run `npm run community:validate` before opening a PR. CI runs the same checks and comments
a summary on your pull request.

You can also skip Git entirely: **Community → Publish** in the app signs you in with GitHub,
forks the repository, commits your file and opens the pull request for you.

### Device definitions

**Easiest: the Device Wizard.** In the app, go to **Devices → Add device**. The wizard
captures the USB VID/PID and HID interfaces, lets you pick a layout template and map keys to
LEDs while watching them light up, then **Publish** opens a PR.

**By hand:**

1. Copy a similar file from `community/devices/<vendor>/` (e.g. `razer/huntsman-mini.json`).
2. Set `"$schema": "../../schemas/device.schema.json"`.
3. Fill `match` with hex strings: `{ "vendorId": "0x1532", "productId": "0x0257", "interface": 2 }`.
4. Pick a `driver`: `razer`, `lamparray` (Windows Dynamic Lighting) or `openrgb`.
5. Describe `layouts` with keys named by W3C
   [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values)
   (`KeyA`, `Digit1`, `ShiftLeft`, `Backquote`, `Fn`…), positions in keyboard units and `led`
   addresses.
6. Use `"status": "community"` (or `experimental`). Maintainers move it to `verified` after
   "Works on my device" reports.
7. Test with **Safe mode** first, then for real, and run `npm run community:validate`.

Protocol research belongs in [`docs/protocols`](docs/protocols). Credit your sources and
**never copy GPL code**.

### Profiles

`community/profiles/<id>.json` (`Profile`): a lighting scene (layers, brightness, fps),
optional mouse settings, onboard effects, keymap ids and apps to auto-activate with.
Create it in the app and export it with **Lighting → Share**, or write it by hand.

### Keymap packs

`community/keymaps/<id>.json` (`KeymapPack`):

- `apps`: process names the pack activates for (`"Resolve.exe"`); empty = global.
- `categories`: category → colour (`#rrggbb`) used to light the keys.
- `legends`: the app's **built-in** shortcuts, lit by category (no remapping involved).
- `bindings` / `layers`: actual remaps and macros.

Actions of type `launch`, `text`, `macro` steps that type text, and `http` are **risky**:
CI flags them and users must confirm them on install. Avoid them unless the pack needs them,
and explain why in the PR.

### Effects

`community/effects/<id>.js`, a small ES module:

```js
export default {
  meta: {
    id: "rain",
    name: "Rain",
    source: "community",
    params: { color: { type: "color", label: "Color", default: "#4c6fff" } },
  },
  create(params) {
    return {
      frame(ctx) {
        // compute and return colours for this frame from ctx (time, keys, …)
      },
    };
  },
};
```

- Effects run **sandboxed** in a Web Worker: no network (`fetch`, `XMLHttpRequest`,
  `WebSocket`), no `importScripts`, `eval` or `Function(`, no globals. CI rejects them.
- Keep them deterministic (derive everything from `ctx` and `params`) and cheap per frame.
- `meta` is validated against `community/schemas/effect-meta.schema.json`.

### Typing packs

`community/typing/<id>.json` (`TypingPack`): `language`, `kind`
(`words` | `quotes` | `code` | `lessons`) and either a frequency-ordered `words` list or
`texts` passages with an optional `source`.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org):
  `feat(lighting): add gradient sweep`, `fix(razer): retry busy replies`,
  `docs: clarify device wizard`, `chore`, `refactor`, `test`. Community content uses
  `community(<kind>): …`, e.g. `community(device): add Razer BlackWidow V4`.
- Keep pull requests **small and focused**: one feature, fix or content item per PR.
- Include **screenshots** for UI changes (dark and light if relevant).
- Fill in the pull request template checklist.
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Code style

- **TypeScript strict**, functional React components, **one zustand store per feature**
  (`src/core/<feature>/store.ts`). Shared types go in `src/core/types.ts`.
- Features talk through the bus (`src/core/util/bus.ts`), not each other's internals.
- **i18n**: every UI string goes through `useT()` / `t()` with entries in **both**
  `src/i18n/en` and `src/i18n/es`.
- Build UI from the primitives in `src/ui`. The interface stays **neutral grey**; the only
  saturated colour comes from lighting previews, user data and status tones.
- Everything must work in the browser demo (`MockBackend`).
- Never write to hardware in safe mode, never flash firmware.
- **No GPL code.** Protocol knowledge from OpenRazer/OpenRGB is fine when credited in
  `docs/protocols`, but the implementation must be original MIT code.
- **Rust**: keep it thin and generic (move bytes, read OS state), `cargo fmt` and
  `cargo clippy -- -D warnings` clean.
