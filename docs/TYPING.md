# Typing trainer

KeyHalo's typing section trains speed and accuracy and lights your real keyboard while you
practise. Everything runs locally; typed text is stored only in the trainer's own history.

- Engine: `src/core/typing/` (pure TypeScript, tested with `npx vitest run src/core/typing`)
- UI: `src/sections/typing/`
- Content: `community/typing/*.json` (`TypingPack`, see `src/core/types.ts`)
- Strings: `src/i18n/{en,es}/typing.json`

## Measurements

| Metric | Definition |
|---|---|
| **WPM** | characters that are correct at the end ÷ 5, per minute (a "word" is 5 characters, spaces included) |
| **Raw** | every character keystroke (right or wrong) ÷ 5, per minute |
| **Accuracy** | correct keystrokes ÷ all keystrokes. Errors stay counted after you fix them with Backspace |
| **Consistency** | 1 − coefficient of variation of the per-second raw speed, clamped to 0–100 % |
| **Key stats** | hits, misses and average interval per physical key (pauses over 2 s are ignored) |
| **Letter pairs** | average interval between two consecutive correct letters, slowest first |

Each key press is attributed to the **physical key of the expected character**, looked up
through the selected keyboard layout (`charmap.ts`: US, Spanish (Spain), Spanish (Latin
America)). The trainer reads the composed `KeyboardEvent.key`, never `code`, so dead keys
and AltGr work: `´` + `e` arrives as a single `é`, which is credited to the **E** key, and the
dead key (`'`/`´`) is shown as the first step in the on-screen and physical guidance.

## Modes

| Mode | What you type |
|---|---|
| **Adaptive** | Generated lessons that grow one letter at a time (see below) |
| **Test** | Common words for 15/30/60/120 s or 10/25/50/100 words. Optional punctuation (with `¿…?` and `¡…!` in Spanish) and numbers |
| **Passages** | Short original passages (`kind: "quotes"` packs) |
| **Code** | Snippets in JavaScript, TypeScript, Python, Rust, Go and C#. After a newline the indentation is typed for you; Tab types two spaces |
| **Shortcuts** | Press the chord for an action ("Cut clip (DaVinci Resolve)"). Uses the `legends` of keymap packs in `community/keymaps/`, plus a built-in everyday set. Chords the OS or browser swallow (Ctrl+W, Alt+Tab, Win+…) are skipped |
| **Fn layer** | If your keyboard's layout defines `fnLayer`, practise reaching those keys (Fn + I → ↑). Otherwise a symbols-and-numbers drill |
| **Custom** | Paste any text. Smart quotes and dashes are converted to plain keyboard characters |

Keys: **Tab/Esc** restart (fresh text if you had not started yet), **Enter** next text after a
result, **Ctrl+Backspace** deletes a word. The page listens for keys anywhere in the section
but never steals them from inputs, selects or open dialogs.

### Ghost races

Turn on **Race my best** to see a second caret replaying your personal best for the same
configuration (`configKey`, e.g. `test:30s:en:p`). Every result has a `replay` timeline
(`[msOffset, correct]` per keystroke). **Export ghost** saves the result as JSON; a friend
can **Load ghost…** it to race the exact same text. The ghost caret advances one character per
correct keystroke in the recording.

### Keyboard lighting

While a run is active the trainer publishes the `typing` overlay to
`useSignals().overlays` (priority 100, non-exclusive): next key white, Shift/AltGr grey, the
dead key first for accented letters, mistakes flash red for 150 ms, optional finger colours
on the home row. After a run, **Show on keyboard** paints the heatmap on the real keyboard for
10 s. Toggle it all with *Light the keyboard while typing* in the trainer settings.

## The adaptive algorithm ("Halo ladder")

1. **Letter order.** Letters are introduced by how often the language uses them
   (`LETTER_ORDER` in `adaptive.ts`). English starts with `e t a o i n`, Spanish with
   `e a o s r n`; Spanish accented letters and `ñ` join later as their own steps.
2. **Per-letter averages.** Every keystroke on a letter updates two exponential moving
   averages: the interval before a correct press (α = 0.1, converted to WPM) and hit/miss
   accuracy (α = 0.05). Pauses over 2 s count for accuracy only.
3. **Unlocking.** When *every* unlocked letter has at least 12 samples, a speed at or above
   the target (default 35 WPM, configurable) and accuracy of at least 95 %, the next letter
   unlocks. At most one letter unlocks per run.
4. **Focus letter.** The unlocked letter with the lowest readiness, `min(speed/target,
   accuracy/0.95) × confidence`, is the focus. It is outlined on the keyboard and gets 4× the
   weight when picking words.
5. **Lesson text.** Real words from the language's word pack that use only unlocked letters,
   favouring frequent words and words containing the focus letter. When fewer than 24 real
   words fit (early levels), the pool is topped up with pronounceable pseudo-words generated
   from a letter-pair (bigram) model of the same word list, filtered to unlocked letters.

Progress is stored per language in `typing/progress.json`. The Progress tab shows each letter
as a readiness ring and lets you unlock the next letter manually or reset.

## Storage

| File | Content |
|---|---|
| `typing/prefs.json` | mode, language, options |
| `typing/history.json` | the last 500 results (without replay/text) |
| `typing/progress.json` | personal bests (with replay, for ghosts), minutes practised per day (streaks), all-time key statistics per language, adaptive progress |

History is loaded the first time the Typing section opens; `init()` only registers the
`community:installed` handler for typing packs.

## Contributing typing packs

Add a JSON file to `community/typing/` that matches `TypingPack`:

```json
{
  "id": "fr-common-words",
  "name": "Français: mots courants",
  "language": "fr",
  "kind": "words",
  "author": "your-github-name",
  "description": "1,000 common French words, most frequent first.",
  "words": ["de", "la", "le", "et", "les", "des", "en", "un", "du", "une"]
}
```

- `kind: "words"`: a frequency-ordered list (most common first), lower case, unique, at least
  1,000 words. Used by Test and Adaptive.
- `kind: "quotes"`: `texts: [{ "text": "...", "source": "..." }]`, 1–3 sentences each. Write
  your own passages or use text whose licence allows redistribution under MIT; do not paste
  copyrighted quotations.
- `kind: "code"`: `texts` whose `source` is `"<Language> · <title>"` (middle dot, e.g.
  `"Rust · ring buffer"`). Indent with spaces, no trailing whitespace. Original code only.
- Use plain keyboard punctuation: straight quotes, `-` and `...` (the trainer normalises
  typographic characters, but packs should not rely on it).
- A new language for Adaptive also needs a letter order in `LETTER_ORDER` and, for correct
  key attribution, a layout table in `charmap.ts`.

Run `npx vitest run src/core/typing` before opening the pull request; `packs.test.ts` checks
every bundled pack.

## Dev switches (screenshots)

| URL | Effect |
|---|---|
| `/?demoResult=1#/typing` or `#/typing/demo` | simulated 30 s result |
| `/?demoTyping=1#/typing` | first text partly typed, showing a run in progress |
| `/?demoProgress=1#/typing/progress` | sample progress data (in memory, not saved) |
| `?theme=light` / `?theme=dark` | force a theme while the page is open |
| `?lang=en` / `?lang=es` | UI and practice language for this visit |

Note the query string goes **before** the `#`: the hash router treats everything after `#/`
as the path.
