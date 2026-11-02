//! The folder shown by a File Explorer window (Shell.Application windows), so agent pads can
//! open Claude Code / Codex where you are browsing.

#![cfg(windows)]

use windows::core::Interface;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Shell::{IShellWindows, IWebBrowser2, ShellWindows};

/// "file:///D:/My%20Projects/x" → "D:\My Projects\x".
fn file_url_to_path(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file:///")?;
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&rest[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    Some(String::from_utf8_lossy(&out).replace('/', "\\"))
}

pub fn folder(hwnd: isize) -> Option<String> {
    crate::util::com_init();
    unsafe {
        let shell: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL).ok()?;
        for i in 0..shell.Count().ok()? {
            let Ok(disp) = shell.Item(&VARIANT::from(i)) else { continue };
            let Ok(browser) = disp.cast::<IWebBrowser2>() else { continue };
            if browser.HWND().map(|h| h.0).ok() != Some(hwnd) {
                continue;
            }
            let url = browser.LocationURL().ok()?.to_string();
            return file_url_to_path(&url);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_file_urls() {
        assert_eq!(super::file_url_to_path("file:///D:/My%20Projects/x").as_deref(), Some("D:\\My Projects\\x"));
        assert_eq!(super::file_url_to_path("file:///C:/Users/caf%C3%A9").as_deref(), Some("C:\\Users\\café"));
        assert_eq!(super::file_url_to_path("::{20D04FE0}"), None);
    }
}
