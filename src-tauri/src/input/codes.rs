//! Windows scancode / virtual-key ⇄ W3C `KeyboardEvent.code` mapping.
//!
//! `KeyboardEvent.code` names a *physical* key, so the primary mapping is by scancode
//! (with the 0xE0 prefix for extended keys, as reported by `LLKHF_EXTENDED`). The virtual-key
//! column is used as a fallback for events without a scancode (some media keys, injected
//! events from other software) and for keys that must be sent by VK (media/browser keys, Pause).
//!
//! Table derived from the USB HID usage tables and the W3C UI Events KeyboardEvent code spec.

use std::collections::HashMap;
use std::sync::OnceLock;

/// (code, scancode with 0xE0xx for extended keys, virtual key)
const KEYS: &[(&str, u16, u16)] = &[
    ("Escape", 0x0001, 0x1B),
    ("Digit1", 0x0002, 0x31),
    ("Digit2", 0x0003, 0x32),
    ("Digit3", 0x0004, 0x33),
    ("Digit4", 0x0005, 0x34),
    ("Digit5", 0x0006, 0x35),
    ("Digit6", 0x0007, 0x36),
    ("Digit7", 0x0008, 0x37),
    ("Digit8", 0x0009, 0x38),
    ("Digit9", 0x000A, 0x39),
    ("Digit0", 0x000B, 0x30),
    ("Minus", 0x000C, 0xBD),
    ("Equal", 0x000D, 0xBB),
    ("Backspace", 0x000E, 0x08),
    ("Tab", 0x000F, 0x09),
    ("KeyQ", 0x0010, 0x51),
    ("KeyW", 0x0011, 0x57),
    ("KeyE", 0x0012, 0x45),
    ("KeyR", 0x0013, 0x52),
    ("KeyT", 0x0014, 0x54),
    ("KeyY", 0x0015, 0x59),
    ("KeyU", 0x0016, 0x55),
    ("KeyI", 0x0017, 0x49),
    ("KeyO", 0x0018, 0x4F),
    ("KeyP", 0x0019, 0x50),
    ("BracketLeft", 0x001A, 0xDB),
    ("BracketRight", 0x001B, 0xDD),
    ("Enter", 0x001C, 0x0D),
    ("ControlLeft", 0x001D, 0xA2),
    ("KeyA", 0x001E, 0x41),
    ("KeyS", 0x001F, 0x53),
    ("KeyD", 0x0020, 0x44),
    ("KeyF", 0x0021, 0x46),
    ("KeyG", 0x0022, 0x47),
    ("KeyH", 0x0023, 0x48),
    ("KeyJ", 0x0024, 0x4A),
    ("KeyK", 0x0025, 0x4B),
    ("KeyL", 0x0026, 0x4C),
    ("Semicolon", 0x0027, 0xBA),
    ("Quote", 0x0028, 0xDE),
    ("Backquote", 0x0029, 0xC0),
    ("ShiftLeft", 0x002A, 0xA0),
    ("Backslash", 0x002B, 0xDC),
    ("KeyZ", 0x002C, 0x5A),
    ("KeyX", 0x002D, 0x58),
    ("KeyC", 0x002E, 0x43),
    ("KeyV", 0x002F, 0x56),
    ("KeyB", 0x0030, 0x42),
    ("KeyN", 0x0031, 0x4E),
    ("KeyM", 0x0032, 0x4D),
    ("Comma", 0x0033, 0xBC),
    ("Period", 0x0034, 0xBE),
    ("Slash", 0x0035, 0xBF),
    ("ShiftRight", 0x0036, 0xA1),
    ("NumpadMultiply", 0x0037, 0x6A),
    ("AltLeft", 0x0038, 0xA4),
    ("Space", 0x0039, 0x20),
    ("CapsLock", 0x003A, 0x14),
    ("F1", 0x003B, 0x70),
    ("F2", 0x003C, 0x71),
    ("F3", 0x003D, 0x72),
    ("F4", 0x003E, 0x73),
    ("F5", 0x003F, 0x74),
    ("F6", 0x0040, 0x75),
    ("F7", 0x0041, 0x76),
    ("F8", 0x0042, 0x77),
    ("F9", 0x0043, 0x78),
    ("F10", 0x0044, 0x79),
    ("Pause", 0x0045, 0x13),
    ("ScrollLock", 0x0046, 0x91),
    ("Numpad7", 0x0047, 0x67),
    ("Numpad8", 0x0048, 0x68),
    ("Numpad9", 0x0049, 0x69),
    ("NumpadSubtract", 0x004A, 0x6D),
    ("Numpad4", 0x004B, 0x64),
    ("Numpad5", 0x004C, 0x65),
    ("Numpad6", 0x004D, 0x66),
    ("NumpadAdd", 0x004E, 0x6B),
    ("Numpad1", 0x004F, 0x61),
    ("Numpad2", 0x0050, 0x62),
    ("Numpad3", 0x0051, 0x63),
    ("Numpad0", 0x0052, 0x60),
    ("NumpadDecimal", 0x0053, 0x6E),
    ("IntlBackslash", 0x0056, 0xE2),
    ("F11", 0x0057, 0x7A),
    ("F12", 0x0058, 0x7B),
    ("NumpadEqual", 0x0059, 0x92),
    ("F13", 0x0064, 0x7C),
    ("F14", 0x0065, 0x7D),
    ("F15", 0x0066, 0x7E),
    ("F16", 0x0067, 0x7F),
    ("F17", 0x0068, 0x80),
    ("F18", 0x0069, 0x81),
    ("F19", 0x006A, 0x82),
    ("F20", 0x006B, 0x83),
    ("F21", 0x006C, 0x84),
    ("F22", 0x006D, 0x85),
    ("F23", 0x006E, 0x86),
    ("KanaMode", 0x0070, 0x15),
    ("Lang2", 0x0071, 0x00),
    ("Lang1", 0x0072, 0x00),
    ("IntlRo", 0x0073, 0xC1),
    ("F24", 0x0076, 0x87),
    ("Convert", 0x0079, 0x1C),
    ("NonConvert", 0x007B, 0x1D),
    ("IntlYen", 0x007D, 0x00),
    ("NumpadComma", 0x007E, 0x6C),
    // Extended (0xE0-prefixed) keys.
    ("MediaTrackPrevious", 0xE010, 0xB1),
    ("MediaTrackNext", 0xE019, 0xB0),
    ("NumpadEnter", 0xE01C, 0x0D),
    ("ControlRight", 0xE01D, 0xA3),
    ("AudioVolumeMute", 0xE020, 0xAD),
    ("LaunchApp2", 0xE021, 0xB7),
    ("MediaPlayPause", 0xE022, 0xB3),
    ("MediaStop", 0xE024, 0xB2),
    ("AudioVolumeDown", 0xE02E, 0xAE),
    ("AudioVolumeUp", 0xE030, 0xAF),
    ("BrowserHome", 0xE032, 0xAC),
    ("NumpadDivide", 0xE035, 0x6F),
    ("PrintScreen", 0xE037, 0x2C),
    ("AltRight", 0xE038, 0xA5),
    ("NumLock", 0xE045, 0x90),
    ("Home", 0xE047, 0x24),
    ("ArrowUp", 0xE048, 0x26),
    ("PageUp", 0xE049, 0x21),
    ("ArrowLeft", 0xE04B, 0x25),
    ("ArrowRight", 0xE04D, 0x27),
    ("End", 0xE04F, 0x23),
    ("ArrowDown", 0xE050, 0x28),
    ("PageDown", 0xE051, 0x22),
    ("Insert", 0xE052, 0x2D),
    ("Delete", 0xE053, 0x2E),
    ("MetaLeft", 0xE05B, 0x5B),
    ("MetaRight", 0xE05C, 0x5C),
    ("ContextMenu", 0xE05D, 0x5D),
    ("Power", 0xE05E, 0x00),
    ("Sleep", 0xE05F, 0x5F),
    ("WakeUp", 0xE063, 0x00),
    ("BrowserSearch", 0xE065, 0xAA),
    ("BrowserFavorites", 0xE066, 0xAB),
    ("BrowserRefresh", 0xE067, 0xA8),
    ("BrowserStop", 0xE068, 0xA9),
    ("BrowserForward", 0xE069, 0xA7),
    ("BrowserBack", 0xE06A, 0xA6),
    ("LaunchApp1", 0xE06B, 0xB6),
    ("LaunchMail", 0xE06C, 0xB4),
    ("MediaSelect", 0xE06D, 0xB5),
];

struct Maps {
    by_scan: HashMap<u16, &'static str>,
    by_vk: HashMap<u16, &'static str>,
    by_code: HashMap<&'static str, (u16, u16)>,
}

fn maps() -> &'static Maps {
    static MAPS: OnceLock<Maps> = OnceLock::new();
    MAPS.get_or_init(|| {
        let mut by_scan = HashMap::new();
        let mut by_vk = HashMap::new();
        let mut by_code = HashMap::new();
        for &(code, scan, vk) in KEYS {
            by_scan.entry(scan).or_insert(code);
            if vk != 0 {
                by_vk.entry(vk).or_insert(code);
            }
            by_code.insert(code, (scan, vk));
        }
        // Ctrl+Pause produces VK_CANCEL with scancode E0 46 (Break).
        by_scan.insert(0xE046, "Pause");
        by_vk.insert(0x03, "Pause");
        // Generic (side-less) modifiers sometimes sent by other software.
        by_vk.insert(0x10, "ShiftLeft");
        by_vk.insert(0x11, "ControlLeft");
        by_vk.insert(0x12, "AltLeft");
        // Alt+PrintScreen reports SysRq (0x54).
        by_scan.insert(0x0054, "PrintScreen");
        Maps {
            by_scan,
            by_vk,
            by_code,
        }
    })
}

/// Maps a low-level hook event to a `KeyboardEvent.code`.
/// Returns None for events that do not correspond to a real key (e.g. the fake shifts that
/// Windows wraps around navigation keys when NumLock is on).
pub fn code_from_event(vk: u32, scan: u32, extended: bool) -> Option<&'static str> {
    let m = maps();
    let scan = (scan & 0xFF) as u16;
    if scan == 0x2A || scan == 0x36 {
        // E0 2A / E0 36 are synthetic "fake shifts".
        if extended {
            return None;
        }
    }
    if scan != 0 {
        let key = if extended { 0xE000 | scan } else { scan };
        if let Some(code) = m.by_scan.get(&key) {
            // NumLock arrives as extended 0x45, Pause as non-extended 0x45: trust the table,
            // but disambiguate with the VK when the hardware disagrees.
            if key == 0x0045 && vk == 0x90 {
                return Some("NumLock");
            }
            if key == 0xE045 && vk == 0x13 {
                return Some("Pause");
            }
            return Some(code);
        }
    }
    let vk16 = vk as u16;
    if vk16 == 0x0D && extended {
        return Some("NumpadEnter");
    }
    if extended {
        match vk16 {
            0x11 => return Some("ControlRight"),
            0x12 => return Some("AltRight"),
            _ => {}
        }
    }
    m.by_vk.get(&vk16).copied()
}

/// Looks up how to send a key: (scancode incl. 0xE0 prefix, virtual key).
pub fn lookup(code: &str) -> Option<(u16, u16)> {
    maps().by_code.get(code).copied()
}

/// Keys that are more reliable when injected by virtual key (media, browser, Pause…).
pub fn send_by_vk(code: &str) -> bool {
    code.starts_with("Media")
        || code.starts_with("Audio")
        || code.starts_with("Browser")
        || code.starts_with("Launch")
        || matches!(code, "Pause" | "Sleep" | "PrintScreen")
}

/// Modifier name ("Ctrl" | "Shift" | "Alt" | "Meta") → physical codes.
pub fn modifier_codes(name: &str) -> &'static [&'static str] {
    match name {
        "Ctrl" | "Control" => &["ControlLeft", "ControlRight"],
        "Shift" => &["ShiftLeft", "ShiftRight"],
        "Alt" => &["AltLeft", "AltRight"],
        "Meta" | "Win" => &["MetaLeft", "MetaRight"],
        _ => &[],
    }
}

pub fn is_modifier(code: &str) -> bool {
    matches!(
        code,
        "ControlLeft"
            | "ControlRight"
            | "ShiftLeft"
            | "ShiftRight"
            | "AltLeft"
            | "AltRight"
            | "MetaLeft"
            | "MetaRight"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        assert_eq!(code_from_event(0x41, 0x1E, false), Some("KeyA"));
        assert_eq!(code_from_event(0x0D, 0x1C, true), Some("NumpadEnter"));
        assert_eq!(code_from_event(0x0D, 0x1C, false), Some("Enter"));
        assert_eq!(code_from_event(0xA3, 0x1D, true), Some("ControlRight"));
        assert_eq!(code_from_event(0xA5, 0x38, true), Some("AltRight"));
        assert_eq!(code_from_event(0x13, 0x45, false), Some("Pause"));
        assert_eq!(code_from_event(0x90, 0x45, true), Some("NumLock"));
        assert_eq!(code_from_event(0x03, 0x46, true), Some("Pause"));
        assert_eq!(code_from_event(0xE2, 0x56, false), Some("IntlBackslash"));
        assert_eq!(code_from_event(0xB3, 0, false), Some("MediaPlayPause"));
        assert_eq!(code_from_event(0xA0, 0x2A, true), None);
        assert_eq!(lookup("F24"), Some((0x76, 0x87)));
        for &(code, _, _) in KEYS {
            assert!(lookup(code).is_some());
        }
    }
}
