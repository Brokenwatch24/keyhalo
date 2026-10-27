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
