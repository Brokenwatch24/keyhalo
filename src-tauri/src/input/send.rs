//! Synthetic input (SendInput). Every event carries `SIGNATURE` in dwExtraInfo so the hooks
//! recognise and never re-process KeyHalo's own output. Keys and mouse buttons pressed by the
//! engine are tracked so they can always be released (no stuck modifiers).

use super::codes;
use super::types::MacroStep;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// "KHKH" — marks events injected by KeyHalo.
pub const SIGNATURE: usize = 0x4B48_4B48;

/// Bumped on pause / config change; running macros stop when it changes.
pub static GENERATION: AtomicU64 = AtomicU64::new(0);

static HELD: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn held() -> std::sync::MutexGuard<'static, Option<HashSet<String>>> {
    HELD.lock().unwrap_or_else(|e| e.into_inner())
}

fn track(code: &str, down: bool) {
    let mut g = held();
    let set = g.get_or_insert_with(HashSet::new);
    if down {
        set.insert(code.to_string());
    } else {
        set.remove(code);
    }
}

#[cfg(windows)]
mod imp {
    use super::SIGNATURE;
    use crate::input::codes;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    fn send(inputs: &[INPUT]) {
        if inputs.is_empty() {
            return;
        }
        unsafe {
            SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    pub fn key_input(code: &str, down: bool) -> Option<INPUT> {
        let (scan, vk) = codes::lookup(code)?;
        let extended = scan & 0xFF00 == 0xE000;
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if !down {
            flags |= KEYEVENTF_KEYUP;
        }
        let (w_vk, w_scan) = if codes::send_by_vk(code) || scan == 0 {
            if vk == 0 {
                return None;
            }
            (vk, scan & 0xFF)
        } else {
            // Scancode injection: the system derives the VK from the active layout, which is
            // exactly the "physical key" meaning of KeyboardEvent.code, and games see it too.
            flags |= KEYEVENTF_SCANCODE;
            (0, scan & 0xFF)
        };
        Some(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(w_vk),
                    wScan: w_scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: SIGNATURE,
                },
            },
        })
    }

    pub fn key(code: &str, down: bool) -> bool {
        match key_input(code, down) {
            Some(i) => {
                send(&[i]);
                true
            }
            None => false,
        }
    }

    fn unicode_unit(unit: u16, up: bool) -> INPUT {
        let mut flags = KEYEVENTF_UNICODE;
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: SIGNATURE,
                },
            },
        }
    }

    pub fn text(s: &str) {
        let mut batch: Vec<INPUT> = Vec::new();
        for ch in s.chars() {
            match ch {
                '\r' => continue,
                '\n' | '\t' => {
                    let code = if ch == '\n' { "Enter" } else { "Tab" };
                    if let (Some(d), Some(u)) = (key_input(code, true), key_input(code, false)) {
                        batch.push(d);
                        batch.push(u);
                    }
                }
                _ => {
                    let mut buf = [0u16; 2];
                    for unit in ch.encode_utf16(&mut buf).iter() {
                        batch.push(unicode_unit(*unit, false));
                        batch.push(unicode_unit(*unit, true));
                    }
                }
            }
            if batch.len() >= 64 {
                send(&batch);
                batch.clear();
            }
        }
        send(&batch);
    }

    pub fn mouse_button(button: &str, down: bool) -> bool {
        let (flags, data) = match (button, down) {
            ("left", true) => (MOUSEEVENTF_LEFTDOWN, 0),
            ("left", false) => (MOUSEEVENTF_LEFTUP, 0),
            ("right", true) => (MOUSEEVENTF_RIGHTDOWN, 0),
            ("right", false) => (MOUSEEVENTF_RIGHTUP, 0),
            ("middle", true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
            ("middle", false) => (MOUSEEVENTF_MIDDLEUP, 0),
            ("back", true) => (MOUSEEVENTF_XDOWN, 1),
            ("back", false) => (MOUSEEVENTF_XUP, 1),
            ("forward", true) => (MOUSEEVENTF_XDOWN, 2),
            ("forward", false) => (MOUSEEVENTF_XUP, 2),
            _ => return false,
        };
        send(&[INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: SIGNATURE,
                },
            },
        }]);
        true
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn key(_code: &str, _down: bool) -> bool {
        false
    }
    pub fn text(_s: &str) {}
    pub fn mouse_button(_b: &str, _down: bool) -> bool {
        false
    }
}

/// Maps macro-friendly mouse names ("MouseLeft", "Mouse4"…) to SendInput buttons.
fn mouse_alias(code: &str) -> Option<&'static str> {
    match code {
        "MouseLeft" | "Mouse1" => Some("left"),
        "MouseRight" | "Mouse2" => Some("right"),
        "MouseMiddle" | "Mouse3" => Some("middle"),
        "Mouse4" | "MouseBack" => Some("back"),
        "Mouse5" | "MouseForward" => Some("forward"),
        _ => None,
    }
}

/// Presses or releases a key (or mouse alias) and tracks it.
pub fn key(code: &str, down: bool) {
    let ok = match mouse_alias(code) {
        Some(b) => imp::mouse_button(b, down),
        None => imp::key(code, down),
    };
    if ok {
        track(code, down);
    } else if down {
        crate::khlog!("input: cannot send unknown key {code}");
    }
}

/// Presses or releases a key without tracking (used to lift/restore physically held modifiers).
pub fn key_untracked(code: &str, down: bool) {
    imp::key(code, down);
}

pub fn tap(code: &str) {
    key(code, true);
    std::thread::sleep(Duration::from_millis(6));
    key(code, false);
}

pub fn text(s: &str) {
    imp::text(s);
}

pub fn mouse_button(button: &str, down: bool) {
    if imp::mouse_button(button, down) {
        track(&format!("mouse:{button}"), down);
    }
}

/// Releases every key / button KeyHalo is holding.
pub fn release_all() {
    let codes: Vec<String> = held()
        .as_mut()
        .map(|s| s.drain().collect())
        .unwrap_or_default();
    for c in codes {
        if let Some(b) = c.strip_prefix("mouse:") {
            imp::mouse_button(b, false);
        } else if let Some(b) = mouse_alias(&c) {
            imp::mouse_button(b, false);
        } else {
            imp::key(&c, false);
        }
    }
}

/// Plays macro steps on the current thread. Stops early when GENERATION changes and always
/// releases keys the macro pressed but did not release.
pub fn run_macro(steps: &[MacroStep]) {
    let gen = GENERATION.load(Ordering::SeqCst);
    let mut pressed: Vec<String> = Vec::new();
    for step in steps {
        if GENERATION.load(Ordering::SeqCst) != gen {
            break;
        }
        match step {
            MacroStep::Down { key: k } => {
                key(k, true);
                if !pressed.contains(k) {
                    pressed.push(k.clone());
                }
            }
            MacroStep::Up { key: k } => {
                key(k, false);
                pressed.retain(|p| p != k);
            }
            MacroStep::Tap { key: k } => tap(k),
            MacroStep::Delay { ms } => {
                // Sleep in slices so a pause aborts long delays quickly.
                let mut left = (*ms).min(600_000);
                while left > 0 && GENERATION.load(Ordering::SeqCst) == gen {
                    let s = left.min(50);
                    std::thread::sleep(Duration::from_millis(s));
                    left -= s;
                }
            }
            MacroStep::Text { text: t } => text(t),
            MacroStep::Unknown => {}
        }
    }
    for k in pressed.iter().rev() {
        key(k, false);
    }
}

/// True when `code` can be sent (known key or mouse alias).
#[allow(dead_code)]
pub fn is_sendable(code: &str) -> bool {
    mouse_alias(code).is_some() || codes::lookup(code).is_some()
}
