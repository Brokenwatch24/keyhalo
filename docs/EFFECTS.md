# Writing lighting effects

KeyHalo effects are small JavaScript modules. Built-in effects (TypeScript, in
`src/core/lighting/effects/`) and community effects (`community/effects/*.js`) use **the same
API**; community effects run in a sandbox.

## The desk

Effects draw on the **desk**: every connected device sits at its desk position, measured in
keyboard units (1 unit = one alpha key, about 19 mm). An effect that sweeps along `x` therefore
crosses from the keyboard onto the mouse. Each light (a key or a non-key LED such as a mouse
logo) is a `SceneKey`:

```ts
{ id: "KeyA" | "logo" | …,   // KeyboardEvent.code for keys, LedDef id for other LEDs
  x, y,                      // centre, in desk units (the scene starts at 0,0)
  w, h,                      // size in units
  index,                     // position in the frame buffer (for ctx.setAt)
  kind: "key" | "led",
  device, definition }       // connected device uid and definition id
```

## Module shape

```js
export default {
  meta: {
    id: "my-effect",            // unique, lowercase; "widget:" prefix is reserved
    name: "My effect",
    description: "What it looks like.",
    author: "your-github-name",
    tags: ["ambient"],          // ambient | reactive | audio | retro | calm | vivid | …
    reactive: false,            // true if it uses key presses
    params: {
      color: { type: "color", label: "Color", default: "#00e5ff" },
      speed: { type: "number", label: "Speed", min: 0.1, max: 4, step: 0.1, default: 1 },
    },
  },
  create(params) {              // params = user values with defaults applied
    // Keep per-instance state in this closure.
    return {
      frame(ctx) {
        for (const k of ctx.region) ctx.setAt(k.index, ctx.hsv(k.x * 10 + ctx.t * 60 * params.speed));
      },
      onKey(event) {},          // optional: { id, x, y, t, down }
    };
  },
};
```

`create()` runs again whenever the user changes a parameter, so state is reset.

### Parameter types

| type | extra fields | value |
|---|---|---|
| `number` | `min`, `max`, `step?` | number |
| `color` | | `"#rrggbb"` (use `ctx.hex()`) |
| `colors` | | `string[]` |
| `boolean` | | boolean |
| `select` | `options: [{ value, label }]` | string |

Every parameter needs `label` and `default`. Labels may stay in English.

## `frame(ctx)`

| Field | Meaning |
|---|---|
| `t` | engine clock in seconds (same clock as key events) |
| `dt` | seconds since the previous frame |
| `width`, `height` | desk size in units |
| `keys` | every `SceneKey` |
| `region` | the lights this layer may draw (its mask/device filter applied); same as `keys` when unmasked |
| `masked` | `true` if the user restricted the layer to some keys |
| `pressed` | `Set` of key ids held right now |
| `events` | key events of the last 3 s: `{ id, x, y, t, down }`, oldest first |
| `signals` | read-only live data (below) |
| `params` | resolved parameters |
| `set(id, rgb, alpha = 1)` | colour every light with that id |
| `setAt(index, rgb, alpha = 1)` | colour one light |
| `fill(rgb, alpha = 1)` | colour the whole region |
| `hsv(h, s = 1, v = 1)` | h in degrees → `[r, g, b]` (0–255) |
| `mix(a, b, t)` | linear mix |
| `hex("#rrggbb")` | → `[r, g, b]` |
| `noise2D(x, y)` | smooth deterministic noise, about −1…1 |
| `clamp(v, lo = 0, hi = 1)`, `lerp(a, b, t)` | maths helpers |
| `statusColor("good" \| "warn" \| "bad" \| "info")` | colour-vision–safe status colour |

Colours are `[r, g, b]` arrays with 0–255 channels. Lights you do not set in a frame stay
**transparent**: layers below show through. Use `alpha` for soft edges.

### Signals

`ctx.signals` may contain (all optional except `battery`):

```ts
cpu: { load, temp? }            gpu: { load, temp, vramPct }      ram: { pct }
battery: { [uid]: { percent, charging } }
bambu: { progress, state, remainingMin?, layer?, totalLayers? }
claude: { state: "idle" | "working" | "waiting" | "done" | "error", since }
micMuted, capsLock, layer (keymap layer name or null)
pomodoro: { phase: "focus" | "break" | "idle", remainingMs, totalMs }
wpm, apm
audio: { bands: number[] /* 0..1, low → high */, level }
game: { game, health?, armor?, ammo? /* 0..1 */, mana?, dead?, bomb?, flashed?, burning?, phase? }
```

`audio` is only filled while a layer with the `audio` tag is enabled (KeyHalo turns on audio
capture for it). Only built-in effects can request that today.

## Layers, blending and overlays

A profile's scene is a stack of layers, bottom first. Each layer has an effect, `blend`
(`normal`, `add`, `multiply`, `screen`, `max`), `opacity`, an optional `mask` (key ids / LED ids)
and an optional `devices` filter (device uids or definition ids). After the layers come overlays
(typing-trainer guides, shortcut cheat-sheets, flashes) and the global brightness.

With **Reduce flashing** on, the engine low-passes every light so nothing strobes faster than
about 3 Hz. Please do not rely on fast strobes anyway: keep blinks at or below 1–2 Hz.

## Widgets

Built-in effects whose id starts with `widget:` draw live data on a few keys (CPU bar, battery
key, print progress, Claude Code status, mic mute, Caps Lock, active layer, pomodoro, WPM, game
health/ammo, notification pulse). Without a mask they use default keys; give the layer a mask to
place them anywhere. They leave other keys transparent, so stack them above a base effect.

## The sandbox

Community effects run in their own Web Worker:

- `fetch`, `XMLHttpRequest`, `importScripts`, `WebSocket`, `EventSource`, nested workers,
  `BroadcastChannel`, `indexedDB`, `caches`, `navigator`, `location`, `self` and `globalThis`
  are removed or shadowed before your code runs. Effects cannot reach the network, the file
  system, the DOM or other effects.
- `import` statements, `import()` and `require()` are rejected: an effect is one
  self-contained file (≤ 200 kB).
- Each frame has a budget of **8 ms**. An effect that keeps going over budget, throws 5 times,
  or stops answering for 1.5 s is disabled and the user sees why.
- Rendering is one frame behind the built-in effects (the worker answers asynchronously).
  This is invisible at 30 fps.

## Testing and sharing

1. Put your file in `community/effects/<id>.js` (file name = `meta.id`).
2. `npm run dev` loads every file in that folder into the effect list, so you can try it in
   the Lighting editor of the browser demo.
3. `npx vitest run src/core/lighting` loads every community effect in the sandbox runtime and
   renders a few frames; it must pass.
4. Open a pull request. CI validates the file and adds it to the gallery.

Look at `community/effects/` (`matrix-rain.js`, `lava-lamp.js`, `neon-scanner.js`,
`breathing-duo.js`, `typing-sparks.js`) for complete examples.
