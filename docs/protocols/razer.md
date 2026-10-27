# Razer HID protocol notes

Facts gathered from public reverse-engineering work (OpenRazer, OpenRGB) and verified on real
hardware where marked ✔ (Razer Huntsman Mini `1532:0257` firmware 1.12, DeathAdder V2 Pro
`1532:007C` firmware 2.02). KeyHalo's implementation is original MIT code.

## Transport

Control messages are **90-byte HID feature reports with report id `0x00`** on the device's
control interface (Huntsman Mini: interface **2** ✔; DeathAdder V2 Pro: interface **0** ✔).
Send with `SetFeature`, wait ~2–50 ms, read the answer with `GetFeature`.

| Byte | Meaning |
|---|---|
| 0 | status — request `0x00`; reply `0x01` busy, `0x02` OK, `0x03` failure, `0x04` timeout, `0x05` not supported |
| 1 | transaction id (Huntsman Mini answers `0x1F` ✔ and `0x3F`; DeathAdder V2 Pro `0x3F` ✔) |
| 2–3 | remaining packets (big endian, 0) |
| 4 | protocol type (0) |
| 5 | data size (number of argument bytes used) |
| 6 | command class |
| 7 | command id (bit 7 set = "get") |
| 8–87 | arguments (80 bytes) |
| 88 | CRC: XOR of bytes 2..87 |
| 89 | reserved (0) |

Through hidapi the buffer is 91 bytes: `[0x00 report id, …90 bytes]`.

## Commands

`vs` = varstore: `0x00` NOSTORE (live only), `0x01` VARSTORE (saved to onboard memory).
LED ids: `0x00` zero/all, `0x01` scroll wheel, `0x04` logo, `0x05` backlight (keyboard).

| Class | Id | Size | Args | Meaning |
|---|---|---|---|---|
| 0x00 | 0x81 | 0x02 | → `[major, minor]` | firmware version ✔ |
| 0x00 | 0x82 | 0x16 | → ASCII | serial ✔ |
| 0x00 | 0x84 / 0x04 | 0x02 | `[mode, 0]` | get/set device mode (`0x00` normal ✔, `0x03` driver) |
| 0x00 | 0x86 | 0x02 | → `[layout, 0]` | keyboard layout id (`0x01` US ✔) |
| 0x00 | 0x85 / 0x05 | 0x01 | `[rate]` | polling rate: `0x01`=1000 ✔, `0x02`=500, `0x08`=125 |
| 0x04 | 0x85 / 0x05 | 0x07 | `[vs, xH, xL, yH, yL, 0, 0]` | current DPI ✔ |
| 0x04 | 0x86 / 0x06 | 0x26 | `[vs, active, count, (stage#, xH, xL, yH, yL, 0, 0)×count]` | DPI stages ✔ (read) |
| 0x07 | 0x80 | 0x02 | → `[0, level 0..255]` | battery ✔ |
| 0x07 | 0x84 | 0x02 | → `[0, charging]` | charging ✔ |
| 0x07 | 0x83 / 0x03 | 0x02 | `[secH, secL]` | idle sleep seconds (60–900) |
| 0x07 | 0x81 / 0x01 | 0x01 | `[threshold]` | low-battery threshold (`0x0C`…`0x3F`) |
| 0x0F | 0x82 / 0x02 | var | `[vs, led, effect, …]` | extended effect (get ✔ returned spectrum `01 05 03 00 00 01`) |
| 0x0F | 0x84 / 0x04 | 0x03 | `[vs, led, 0..255]` | extended brightness ✔ (`0xFF`) |
| 0x0F | 0x03 | 5+3n | `[0, 0, row, startCol, endCol, r,g,b…]` | custom frame row |

Extended effect ids (`0x0F 0x02`, args `[vs, led, id, …]`):
`0x00` off · `0x01` static `[0, 0, 1, r, g, b]` · `0x02` breathing `[mode(1 single/2 dual/0 random), 0, count, colours…]` ·
`0x03` spectrum · `0x04` wave `[direction 1/2, speed 0x28]` · `0x05` reactive `[0, speed 1..4, 1, r, g, b]` ·
`0x07` starlight `[0, speed, count, colours…]` · `0x08` custom (show the frame uploaded with `0x0F 0x03`, use `vs=0`).

Custom lighting = upload every row with `0x0F 0x03`, then select effect `0x08` (NOSTORE).
The Huntsman Mini matrix is **5 rows × 15 columns**; column 0 is unused and keys start at column 1.

## Additional facts (from public sources, not verified on hardware unless marked)

Sources: OpenRazer `driver/razercommon.h`, `razerchromacommon.c`, `razerkbd_driver.c`,
`razermouse_driver.c`, `daemon/openrazer_daemon/hardware/{keyboards,mouse}.py`; OpenRGB
`Controllers/RazerController/RazerDevices.cpp` and `KeyboardLayoutManager`; the Razer Huntsman Mini
master guide (`dl.razerzone.com/master-guides/RazerSynapse3/HUNTSMANMINI-00000599-en.pdf`) and
razer.com. Only facts are recorded here; KeyHalo's code is original.

### Framing and argument details

- Extended effect sizes: off/spectrum/random breathing/random starlight `0x06`; static, single
  breathing, reactive, single starlight `0x09`; dual breathing / dual starlight `0x0C`; custom
  frame select `0x0C` with args `[0x00, 0x00, 0x08]` (OpenRazer and OpenRGB agree).
- Wave: `[vs, led, 0x04, direction, speed]`, speed `0x28` default, lower = faster (`0x10` "fast").
  OpenRazer's driver comment says `1` = moving left, `2` = moving right; its daemon table uses
  `(0, 1)` for the Huntsman Mini and `(1, 2)` for the BlackWidow V3. KeyHalo exposes this as
  `driverOptions.waveDirections` (default `{ left: 1, right: 2 }`; Huntsman Mini `{ left: 0, right: 1 }`
  — **direction not verified**).
- Reactive speed `1..4`, starlight speed `1..3`.
- Custom frame row `0x0F 0x03`: OpenRazer always sends data size `0x47`; OpenRGB sends
  `5 + 3 × columns`. KeyHalo uses the OpenRGB size and uploads whole rows starting at column 0,
  then selects effect `0x08`. Neither OpenRazer nor OpenRGB switches keyboards to driver mode
  (`0x00 0x04 [0x03]`) for custom frames.
- The get-effect command `0x0F 0x82` is not used by OpenRazer/OpenRGB; it is verified (✔) on the
  Huntsman Mini only. KeyHalo sends it with size `0x0C`, args `[0x01, led]`.
- DPI stages `0x04 0x06`: `[VARSTORE, active (1-based), count, then per stage: index, xH, xL, yH, yL, 0, 0]`.
  OpenRazer writes the per-stage index 0-based; KeyHalo follows it (unverified).
- DPI `0x04 0x05`: OpenRazer's DeathAdder V2 Pro path ends up writing `VARSTORE` on the wire.
  KeyHalo writes `NOSTORE` for live changes and `VARSTORE` only when saving.
- Low-battery threshold byte maps linearly to percent: `0x0C` ≈ 5 %, `0x26` ≈ 15 %, `0x3F` ≈ 25 %.
- HyperPolling devices (not the ones below) use `0x00 0x40` / `0x00 0xC0` with
  `0x01` 8 kHz, `0x02` 4 kHz, `0x04` 2 kHz, `0x08` 1 kHz, `0x10` 500, `0x20` 250, `0x40` 125.
- More LED ids: `0x03` battery, `0x07` macro, `0x08` game mode, `0x0C/0D/0E` profile R/G/B,
  `0x10`/`0x11` right/left side, `0x1A–0x1F` ARGB channels.
- Layout ids (`0x00 0x86` arg 0): `0x01` US, `0x03` German, `0x04` French, `0x06` UK, `0x07` Nordic,
  `0x0C` Japan; arg 1 is a variant.

### Transaction ids

Transaction ids differ between sources and even between commands of one device. OpenRazer sends
DeathAdder V2 Pro / Viper Ultimate DPI-stage, idle and low-battery commands with `0xFF` and
lighting with `0x3F`; the Basilisk V3 uses `0x1F` but `0xFF` for DPI stages. KeyHalo's driver tries
the definition's id first, then `0x1F`, `0x3F`, `0xFF`, and remembers per command which id
answered. On the user's DeathAdder V2 Pro, `0x3F` answered DPI-stage reads ✔.

### Huntsman Mini LED matrix (confirmed against OpenRGB)

| Row | Keys (column) |
|---|---|
| 0 | Esc 1, `1`…`0` 2–11, `-` 12, `=` 13, Backspace 14 |
| 1 | Tab 1, Q…P 2–11, `[` 12, `]` 13, `\` 14 |
| 2 | Caps 1, A…L 2–10, `;` 11, `'` 12, Enter 14 |
| 3 | LShift 1, Z…M 3–9, `,` 10, `.` 11, `/` 12, RShift 14 |
| 4 | LCtrl 1, Win 2, LAlt 3, Space 7, RAlt 11, Fn 12, Menu 13, RCtrl 14 |

ISO boards (OpenRGB's generic handling): ANSI `\` (row 1 col 14) is removed, `#` is at row 2 col 13
and IntlBackslash at row 3 col 2. The Huntsman Mini Analog (`0x0282`, transaction `0x1F`) uses the
same keymap.

### Huntsman Mini Fn layer

Fn + `1`…`=` → F1–F12 (razer.com). Fn + Ctrl + `1`…`7` selects onboard effects off/static/
breathing/spectrum/wave/reactive/starlight (razer.com). Fn + Backspace → Delete and
Fn + I/J/K/L → ↑/←/↓/→ come from reviews. The master guide's keycap diagram is an image only, so
media, volume, brightness, gaming-mode, macro and sleep legends are **not verified** and are left
out of the definition.

### Other devices (definitions marked `experimental`)

| Device | PID | Transaction | Matrix | Notes |
|---|---|---|---|---|
| Huntsman Mini Analog | `0x0282` | `0x1F` | 5×15 | same keymap as the Huntsman Mini |
| BlackWidow V3 TKL | `0x0A24` | `0x3F` | 6×18 | OpenRGB keymap, keys shifted +1 column |
| BlackWidow V3 | `0x024E` | `0x3F` | 6×22 | logo LED at row 5 col 11; numpad cols 18–21 |
| DeathAdder V2 | `0x0084` | `0x3F` (OpenRGB `0x1F`) | — | logo `0x04`, scroll `0x01`; no DPI-stage command in OpenRazer |
| DeathAdder V2 Mini | `0x008C` | `0x3F` (OpenRGB `0x1F`) | — | logo `0x04`, 8500 DPI |
| Basilisk V3 | `0x0099` | `0x1F` | 1×11 | col 0 logo, col 1 scroll, cols 2–10 underglow; 26000 DPI |
| Viper Ultimate | `0x007A` / `0x007B` | `0x3F` (misc `0xFF`) | — | logo `0x04` (OpenRGB uses `0x05`), battery |

Sources disagree on Huntsman V2 / V2 TKL (transaction `0x1F` vs `0x3F`, 6×18 vs 6×17), so no
definition is shipped for them. For the DeathAdder V2 Pro, OpenRGB addresses the logo as LED
`0x05`; OpenRazer (and KeyHalo) use `0x04`.
