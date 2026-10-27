//! Foreground window / process information and the `foreground-changed` watcher.

use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundApp {
    pub process: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exe_path: Option<String>,
    pub title: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub process: String,
    pub title: String,
    pub pid: u32,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::util::from_wide;
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::*;

    pub fn exe_path(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                h,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(h);
            ok.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// Process image name via a toolhelp snapshot (works for elevated processes too).
    pub fn name_from_snapshot(pid: u32) -> Option<String> {
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            let mut found = None;
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    if entry.th32ProcessID == pid {
                        found = Some(from_wide(&entry.szExeFile));
                        break;
                    }
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
            found
        }
    }

    pub fn process_name(pid: u32) -> (String, Option<String>) {
        match exe_path(pid) {
            Some(p) => {
                let name = std::path::Path::new(&p)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                (name, Some(p))
            }
            None => (name_from_snapshot(pid).unwrap_or_default(), None),
        }
    }

    pub fn window_title(hwnd: HWND) -> String {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..n.max(0) as usize])
        }
    }

    pub fn pid_of(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        pid
    }

    pub fn foreground() -> Option<(isize, ForegroundApp)> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return None;
            }
            let pid = pid_of(hwnd);
            let (process, exe_path) = process_name(pid);
            Some((
                hwnd.0 as isize,
                ForegroundApp {
                    process,
                    exe_path,
                    title: window_title(hwnd),
                    pid,
                },
            ))
        }
    }

    pub fn process_for_hwnd(hwnd: isize) -> Option<String> {
        if hwnd == 0 {
            return None;
        }
        let pid = pid_of(HWND(hwnd as *mut _));
        let (name, _) = process_name(pid);
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        list.push(hwnd);
        BOOL(1)
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
        }
    }

    pub fn windows() -> Vec<WindowInfo> {
        let mut hwnds: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut hwnds as *mut Vec<HWND> as isize));
        }
        let mut names: std::collections::HashMap<u32, String> = std::collections::HashMap::new();
        let mut out = Vec::new();
        for hwnd in hwnds {
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    continue;
                }
                if GetWindow(hwnd, GW_OWNER)
                    .map(|o| !o.is_invalid())
                    .unwrap_or(false)
                {
                    continue;
                }
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
                if ex & WS_EX_TOOLWINDOW.0 != 0 {
                    continue;
                }
            }
            if is_cloaked(hwnd) {
                continue;
            }
            let title = window_title(hwnd);
            if title.is_empty() {
                continue;
            }
            let pid = pid_of(hwnd);
            let process = names
                .entry(pid)
                .or_insert_with(|| process_name(pid).0)
                .clone();
            out.push(WindowInfo {
                process,
                title,
                pid,
            });
        }
        out
    }
}

#[cfg(windows)]
pub use imp::{process_for_hwnd, windows};

#[cfg(windows)]
pub fn foreground() -> Option<ForegroundApp> {
    imp::foreground().map(|(_, f)| f)
}

#[cfg(not(windows))]
pub fn foreground() -> Option<ForegroundApp> {
    None
}
#[cfg(not(windows))]
pub fn process_for_hwnd(_hwnd: isize) -> Option<String> {
    None
}
#[cfg(not(windows))]
pub fn windows() -> Vec<WindowInfo> {
    Vec::new()
}

/// Polls the foreground window every 250 ms and emits `foreground-changed` when the focused
/// window or process changes (title-only changes are throttled to once per second).
pub fn start_watcher() {
    let _ = std::thread::Builder::new()
        .name("kh-foreground".into())
        .spawn(|| {
            #[cfg(windows)]
            {
                let mut last_hwnd: isize = 0;
                let mut last: Option<ForegroundApp> = None;
                let mut last_title_emit = Instant::now();
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    let Some((hwnd, app)) = imp::foreground() else {
                        continue;
                    };
                    let changed_window = hwnd != last_hwnd
                        || last.as_ref().map(|l| l.pid != app.pid).unwrap_or(true);
                    let changed_title = last.as_ref().map(|l| l.title != app.title).unwrap_or(true);
                    if changed_window
                        || (changed_title && last_title_emit.elapsed() >= Duration::from_secs(1))
                    {
                        last_hwnd = hwnd;
                        last_title_emit = Instant::now();
                        crate::util::emit("foreground-changed", app.clone());
                        last = Some(app);
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let _ = (Instant::now(), Duration::from_secs(1));
            }
        });
}
