# OpenRGB SDK protocol notes

KeyHalo can drive any device supported by a running [OpenRGB](https://openrgb.org) instance
through its SDK server (Settings → OpenRGB bridge; off by default). The client is
`src/core/devices/drivers/openrgb.ts` (transport) and `openrgb-protocol.ts` (encoding). It speaks
TCP through `backend.tcp*`.

Sources: OpenRGB `Documentation/OpenRGBSDK.md` and `RGBController/RGBController.{h,cpp}`
(tag `release_candidate_1.0rc2`). Only protocol facts are recorded here; KeyHalo's code is
original MIT code.

## Transport

- TCP, default port **6742**. All integers are **little-endian**.
- Every packet starts with a 16-byte header:

| Offset | Type | Field |
|---|---|---|
| 0 | 4 × char | magic `"ORGB"` |
| 4 | u32 | device index |
| 8 | u32 | packet id |
| 12 | u32 | payload size (bytes after the header) |

- Strings are a `u16` length **including** the terminating NUL, then the bytes and the NUL.
- Colours are `u32` = `r | g << 8 | b << 16`, so the bytes on the wire are `r, g, b, 0`.

## Packet ids used by KeyHalo

| Id | Name | Payload |
|---|---|---|
| 0 | REQUEST_CONTROLLER_COUNT | → `u32 count` |
| 1 | REQUEST_CONTROLLER_DATA | `u32 protocol` (v1+) → controller data |
| 40 | REQUEST_PROTOCOL_VERSION | `u32 client version` → `u32 server version` (v0 servers never answer) |
| 50 | SET_CLIENT_NAME | NUL-terminated name |
| 100 | DEVICE_LIST_UPDATED | none (server → client, unsolicited) |
| 1050 | RGBCONTROLLER_UPDATELEDS | `u32 data size (counts itself)`, `u16 n`, `n × colour` |
| 1100 | RGBCONTROLLER_SETCUSTOMMODE | none (switches to Direct/custom mode) |

Other ids: 10 ACK (v6), 51–53 v6 names/flags, 101–103 detection progress (v6), 140 rescan (v5),
150–153 profiles (v2), 200–201 plugins (v4), 1000 RESIZEZONE, 1001/1002 segments (v5),
1051 UPDATEZONELEDS (`u32 size, u32 zone, u16 n, colours`), 1052 UPDATESINGLELED
(`i32 index, colour`), 1101 UPDATEMODE, 1102 SAVEMODE (v3), 1103 UPDATEZONEMODE (v6).

## Version negotiation

The client sends its highest version; the effective version is `min(client, server)` and the
server formats controller data for the version the client requests. The current maximum is 6,
but v6 is still marked unreleased and removes fields, so **KeyHalo negotiates up to 5**.

## Controller data (REQUEST_CONTROLLER_DATA reply)

1. `u32 data_size` (includes itself), `i32 type`
2. `name`, `vendor` (v1+), `description`, `version`, `serial`, `location`
3. `u16 num_modes`, `i32 active_mode`, then each mode:
   `name`, `i32 value`, `u32 flags`, `u32 speed_min`, `u32 speed_max`,
   `u32 brightness_min`, `u32 brightness_max` (v3+), `u32 colors_min`, `u32 colors_max`,
   `u32 speed`, `u32 brightness` (v3+), `u32 direction`, `u32 color_mode`, `u16 n`, `n × colour`
4. `u16 num_zones`, then each zone:
   `name`, `i32 type` (0 single, 1 linear, 2 matrix), `u32 leds_min`, `u32 leds_max`,
   `u32 leds_count`, `u16 matrix_len` (0 or `8 + 4·h·w`), then `u32 height`, `u32 width`,
   `h·w × u32` LED indices (`0xFFFFFFFF` = empty);
   v4+: `u16 num_segments`, each `name`, `i32 type`, `u32 start`, `u32 count`;
   v5+: `u32 zone flags`
5. `u16 num_leds`, each `name` + `u32 value`
6. `u16 num_colors`, `n × colour`
7. v5+: alternate names and `u32` controller flags (KeyHalo stops reading before these).

Device types: 0 motherboard, 1 DRAM, 2 GPU, 3 cooler, 4 LED strip, 5 keyboard, 6 mouse,
7 mouse mat, 8 headset, 9 headset stand, 10 gamepad, 11 light, 12 speaker, 13 virtual,
14 storage, 15 case, 16 microphone, 17 accessory, 18 keypad, 19 unknown.

## How KeyHalo uses it

- Matrix zones become keys: LED names such as `Key: A`, `Key: Left Shift`, `Key: Number Pad 7`
  are mapped to `KeyboardEvent.code`; other LEDs become `LedDef`s. Mice are squeezed into the
  mouse drawing box.
- Controllers whose `location` contains `VID_xxxx&PID_xxxx` of a device KeyHalo drives natively
  are skipped.
- First frame: SETCUSTOMMODE; every frame: UPDATELEDS with the whole controller (≤ 30 fps,
  identical frames skipped).
