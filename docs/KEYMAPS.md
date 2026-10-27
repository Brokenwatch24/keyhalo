# Keymap packs

A **keymap pack** describes what an app's shortcuts are (so KeyHalo can light them) and,
optionally, what keys should do differently (remaps, macros, layers). Packs are plain JSON
(`KeymapPack` in `src/core/types.ts`) and live in `community/keymaps/` — every file there
ships with the app and appears in the community gallery.

There are two kinds of pack:

| Kind | Has `bindings` / `layers` | What it does | Safe in games with anti-cheat |
|---|---|---|---|
| **Legend-only** | no (`"bindings": []`) | Lights the app's own shortcuts by category | ✅ always — nothing is intercepted |
| **Remap pack** | yes | Remaps keys, runs macros, adds layers | Paused automatically in `remapPauseApps` |

## Format

```json
{
  "id": "davinci-resolve",
  "name": "DaVinci Resolve",
  "description": "Edit-page shortcuts for DaVinci Resolve.",
  "author": "KeyHalo",
  "version": "1.0.0",
  "apps": ["Resolve.exe"],
  "categories": { "Playback": "#ffb454", "Edit": "#5aa9ff" },
  "legends": [
    { "keys": ["KeyJ"], "label": "Play reverse", "category": "Playback" },
    { "keys": ["ControlLeft", "KeyB"], "label": "Razor", "category": "Edit" }
  ],
  "bindings": [],
  "tags": ["video", "editing"]
}
```

| Field | Meaning |
|---|---|
| `id` | Slug, equal to the file name (`davinci-resolve.json`). |
| `apps` | Process names the pack activates for (`"Resolve.exe"`, case-insensitive). `[]` = global (all apps). |
| `categories` | Category name → colour. Legends and bindings are lit with their category's colour. |
| `legends` | The app's **built-in** shortcuts. `keys` = modifiers first (`ControlLeft`, `ShiftLeft`, `AltLeft`, `MetaLeft`, in that order) then exactly one key. A modifier-only legend (`["ShiftLeft"]` = sprint) is allowed. |
| `bindings` | Remaps on the base layer (see below). |
| `layers` | Extra layers, each `{ id, name, bindings }`. |

Keys are always W3C [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values)
names (`KeyA`, `Digit1`, `BracketLeft`, `ArrowUp`, `Numpad7`…), so packs work on any layout
(AZERTY/QWERTZ users press the same physical key). Mouse buttons can trigger bindings as
`Mouse4`/`Mouse5` (`Mouse1`–`Mouse3` too, but be careful).

### Bindings

```json
{ "key": "F13", "with": ["Ctrl"], "action": { "type": "key", "keys": ["ControlLeft", "KeyZ"] },
  "label": "Undo", "category": "Edit" }
```

`with` lists modifiers that must be held (`Ctrl`, `Shift`, `Alt`, `Meta`). Actions:

| `type` | Fields | Notes |
|---|---|---|
| `key` | `keys` | Send a chord, e.g. `["ControlLeft","ShiftLeft","KeyZ"]` |
| `text` | `text` | Type text ⚠️ review |
| `macro` | `steps` (`down`/`up`/`tap` key, `delay` ms, `text`) | ⚠️ review |
| `launch` | `path`, `args?` | Start a program ⚠️ review |
| `layer` | `layer`, `mode: "hold" \| "toggle"` | Momentary or toggled layer |
| `tapHold` | `tap`, `hold`, `termMs?` (default 200) | Different action on tap vs hold |
| `mouse` | `button` | left/right/middle/back/forward |
| `dpi` | `mode: "sniper" \| "cycle" \| "set"`, `value?` | Handled by KeyHalo; sniper lasts while held |
| `profile` | `profileId` | Switch lighting profile |
| `media` | `command` | playPause/next/prev/volumeUp/volumeDown/mute/micMute |
| `disabled` | — | Swallow the key |

### Per-app activation

KeyHalo watches the focused window. Packs whose `apps` contain the focused process are applied
first, then global packs (`apps: []`) underneath. The shortcut **cheat-sheet** uses the same
order: hold Ctrl/Shift/Alt/Win for ~350 ms and the keys of every shortcut that uses *exactly*
those modifiers light up in their category colour (Settings → `cheatsheet` turns it off).
While an app with its own pack is in front, its shortcut keys **glow softly** in their category
colours (Settings → `appShortcutGlow`, or the switch on the Keymaps page). Global packs never glow
on their own; they show up in the cheat-sheet.

### Layers and tap-hold — the 60% navigation pack

`sixty-percent-nav.json` turns CapsLock into **Escape on tap** and a **navigation layer while
held**:

```json
"bindings": [{
  "key": "CapsLock",
  "action": { "type": "tapHold", "tap": { "type": "key", "keys": ["Escape"] },
              "hold": { "type": "layer", "layer": "nav", "mode": "hold" }, "termMs": 200 },
  "label": "Esc / Nav layer", "category": "Layer"
}],
"layers": [{ "id": "nav", "name": "Navigation", "bindings": [
  { "key": "KeyI", "action": { "type": "key", "keys": ["ArrowUp"] }, "label": "Up", "category": "Arrows" }
]}]
```

While CapsLock is held: I/J/K/L = arrows, U/O = Home/End, Y/H = PageUp/PageDown,
`;` = Backspace, P = Delete, `'` = Enter, `\` = Insert, 1…0 − = = F1…F12,
N = play/pause, M = mute, `,`/`.` = volume down/up, `[`/`]` = previous/next track.
The active layer is published to lighting (`signals.layer`) and shown in the HUD.

### Conflict checks

The editor runs `findConflicts(pack, { layout })` and warns about:

- bindings that **replace one of the app's own shortcuts** (a legend with the same combo);
- the **same trigger bound twice** in one layer;
- **Windows-reserved combos** (Ctrl+Alt+Del and Win+L cannot be remapped at all; Alt+Tab,
  Ctrl+Shift+Esc, Win+D, Win+Tab… should not be);
- triggers that **don't exist on your keyboard** — on a 60% board there is no F-row or arrow
  cluster, so KeyHalo suggests binding them on a layer (or tells you which Fn combo reaches them);
- layer actions pointing to a layer the pack doesn't define, and invalid key names.

## Importing and exporting

- **JSON** — Import/Export in the Keymaps page. Imported packs are never enabled
  automatically; if they contain `launch`, `macro` or `text` actions you get a review dialog
  listing each one (`riskyActions(pack)`).
- **VS Code** — import your `keybindings.json` (`%APPDATA%\Code\User\keybindings.json`).
  Comments and trailing commas are fine. Each single-stroke binding becomes a legend
  (merged over the bundled VS Code pack; `-command` entries remove a default). Multi-stroke
  chords (`ctrl+k ctrl+c`) can't be shown as one lit combo and are skipped (the import result
  lists them). `when` clauses are ignored.
- **Kanata** — *Export → Kanata (.kbd)* writes a [Kanata](https://github.com/jtroo/kanata)
  config: `defsrc` with every remapped key, `deflayer base` + one `deflayer` per layer,
  `defalias` for anything complex: `tap-hold`, `layer-while-held`, `layer-switch` (toggle; the
  same key switches back inside the layer), chords as `C-S-z`, text/macros as `(macro …)`,
  bindings with modifiers as `(fork …)`.
  Limitations (also written as `;; NOTE:` lines in the file):
  - Kanata has no per-app layers — an app pack becomes global.
  - `launch`, `dpi`, `profile` and mic-mute are KeyHalo-only and become `XX`.
  - Macro key-down/up of non-modifier keys becomes a tap; non-ASCII text is skipped (US layout assumed).
  - Mouse-button triggers and the `Fn` key are not exported.
  - `fork` keeps the held modifier pressed, and `with: ["Ctrl","Shift"]` matches either modifier.
- **AutoHotkey v2** — *Export → AutoHotkey* writes a script with `#HotIf WinActive("ahk_exe …")`
  for app packs, a `khLayer` variable for layers and `KeyWait` for tap-hold. Review it before running.

## Sharing a pack

1. Build it in the Keymaps page (or write the JSON by hand).
2. *Share → Publish to the gallery* opens a pull request against `community/keymaps/`
   (or copy the JSON into a PR yourself). CI validates the schema and key names.
3. Prefer legend-only packs for apps: they are useful to everyone and can't break anything.

## Anti-cheat

KeyHalo's remap engine uses a low-level keyboard hook. Competitive games with kernel
anti-cheat may dislike injected input, so **remapping and macros are paused automatically
while a process in `settings.remapPauseApps` is focused** — by default Rainbow Six Siege
(`RainbowSix.exe`, `RainbowSix_BE.exe`, `RainbowSix_Vulkan.exe`), Valorant, Fortnite, Apex
Legends and Escape from Tarkov. Legend-only packs (like the bundled **Tactical FPS** pack for
`RainbowSix.exe`) never intercept or inject keys — they only change colours — so they are safe
everywhere. You can also pause remapping from the tray menu, an automation rule, or the API.
