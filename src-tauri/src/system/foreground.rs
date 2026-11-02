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
    /// Window handle (stable while the window lives; titles change).
    pub hwnd: isize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub process: String,
    pub title: String,
    pub pid: u32,
    pub hwnd: isize,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::util::from_wide;
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
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

    /// Every process: pid -> (parent pid, image name).
    pub fn process_table() -> std::collections::HashMap<u32, (u32, String)> {
        let mut out = std::collections::HashMap::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return out;
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    out.insert(entry.th32ProcessID, (entry.th32ParentProcessID, from_wide(&entry.szExeFile)));
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        out
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
                    hwnd: hwnd.0 as isize,
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
        top_windows().into_iter().map(|(_, w)| w).collect()
    }

    /// Brings the window of `pid` titled `title` to the front (restoring it if minimised).
    pub fn focus(pid: u32, title: &str) -> bool {
        match top_windows().into_iter().find(|(_, w)| w.pid == pid && w.title == title) {
            Some((hwnd, _)) => bring(hwnd),
            None => false,
        }
    }

    /// Brings a window to the front by handle (false when it no longer exists).
    pub fn focus_hwnd(hwnd: isize) -> bool {
        let hwnd = HWND(hwnd as *mut _);
        unsafe { IsWindow(Some(hwnd)).as_bool() && bring(hwnd) }
    }

    /// Minimise, maximise, restore or close (asks the app to close, like its X button) a window.
    pub fn window_cmd(hwnd: isize, action: &str) -> bool {
        let hwnd = HWND(hwnd as *mut _);
        unsafe {
            if !IsWindow(Some(hwnd)).as_bool() {
                return false;
            }
            match action {
                "minimize" => { let _ = ShowWindow(hwnd, SW_MINIMIZE); true }
                "maximize" => { let _ = ShowWindow(hwnd, SW_MAXIMIZE); true }
                "restore" => { let _ = ShowWindow(hwnd, SW_RESTORE); true }
                "close" => PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)).is_ok(),
                _ => false,
            }
        }
    }

    /// Cells of a `n`-window grid over `area` (left, top, right, bottom): as square as possible,
    /// rows filled left to right, the last row stretched.
    pub fn grid_cells(n: usize, area: (i32, i32, i32, i32)) -> Vec<(i32, i32, i32, i32)> {
        if n == 0 {
            return Vec::new();
        }
        let cols = (n as f64).sqrt().ceil() as usize;
        let rows = n.div_ceil(cols);
        let (l, t, r, b) = area;
        let h = (b - t) / rows as i32;
        let mut out = Vec::new();
        for row in 0..rows {
            let in_row = if row == rows - 1 { n - cols * (rows - 1) } else { cols };
            let w = (r - l) / in_row as i32;
            for c in 0..in_row {
                out.push((l + w * c as i32, t + h * row as i32, w, h));
            }
        }
        out
    }

    /// Arrange windows (front to back) in a grid on the monitor of the window in front. Minimised
    /// windows stay minimised; at most 9 are arranged.
    pub fn tile(hwnds: &[isize]) -> usize {
        use windows::Win32::Graphics::Dwm::DWMWA_EXTENDED_FRAME_BOUNDS;
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
        use windows::Win32::Foundation::RECT;
        unsafe {
            let mon = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if !GetMonitorInfoW(mon, &mut info).as_bool() {
                return 0;
            }
            let wa = info.rcWork;
            let list: Vec<HWND> = hwnds
                .iter()
                .map(|h| HWND(*h as *mut _))
                .filter(|h| IsWindow(Some(*h)).as_bool() && !IsIconic(*h).as_bool())
                .filter(|h| MonitorFromWindow(*h, MONITOR_DEFAULTTOPRIMARY) == mon)
                .take(9)
                .collect();
            let cells = grid_cells(list.len(), (wa.left, wa.top, wa.right, wa.bottom));
            for (hwnd, (x, y, w, h)) in list.iter().zip(cells) {
                if IsZoomed(*hwnd).as_bool() {
                    let _ = ShowWindow(*hwnd, SW_RESTORE);
                }
                // Windows 10/11 frames have invisible resize borders: size the visible frame.
                let mut outer = RECT::default();
                let mut frame = RECT::default();
                let (mut dl, mut dt, mut dr, mut db) = (0, 0, 0, 0);
                if GetWindowRect(*hwnd, &mut outer).is_ok()
                    && DwmGetWindowAttribute(*hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut frame as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_ok()
                {
                    dl = frame.left - outer.left;
                    dt = frame.top - outer.top;
                    dr = outer.right - frame.right;
                    db = outer.bottom - frame.bottom;
                }
                let _ = SetWindowPos(*hwnd, None, x - dl, y - dt, w + dl + dr, h + dt + db, SWP_NOZORDER | SWP_NOACTIVATE);
            }
            list.len()
        }
    }

    fn bring(hwnd: HWND) -> bool {
        use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_MOUSE};
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            // Windows only lets the process that sent the last input take the foreground.
            let input = INPUT { r#type: INPUT_MOUSE, ..Default::default() };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            let _ = SetForegroundWindow(hwnd);
            if GetForegroundWindow() != hwnd {
                let fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
                let me = GetCurrentThreadId();
                let _ = AttachThreadInput(me, fg_thread, true);
                let _ = SetForegroundWindow(hwnd);
                let _ = BringWindowToTop(hwnd);
                let _ = AttachThreadInput(me, fg_thread, false);
            }
            GetForegroundWindow() == hwnd
        }
    }

    fn top_windows() -> Vec<(HWND, WindowInfo)> {
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
            out.push((
                hwnd,
                WindowInfo {
                    process,
                    title,
                    pid,
                    hwnd: hwnd.0 as isize,
                },
            ));
        }
        out
    }
}

#[cfg(windows)]
pub use imp::{focus, focus_hwnd, process_for_hwnd, process_name, process_table, tile, window_cmd, windows};

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
#[cfg(not(windows))]
pub fn focus(_pid: u32, _title: &str) -> bool {
    false
}
#[cfg(not(windows))]
pub fn focus_hwnd(_hwnd: isize) -> bool {
    false
}
#[cfg(not(windows))]
pub fn window_cmd(_hwnd: isize, _action: &str) -> bool {
    false
}
#[cfg(not(windows))]
pub fn tile(_hwnds: &[isize]) -> usize {
    0
}
#[cfg(not(windows))]
pub fn process_table() -> std::collections::HashMap<u32, (u32, String)> {
    Default::default()
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

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn grid_is_as_square_as_possible() {
        let g = super::imp::grid_cells(3, (0, 0, 1200, 800));
        assert_eq!(g, vec![(0, 0, 600, 400), (600, 0, 600, 400), (0, 400, 1200, 400)]);
        assert_eq!(super::imp::grid_cells(1, (0, 0, 100, 100)), vec![(0, 0, 100, 100)]);
        assert_eq!(super::imp::grid_cells(4, (0, 0, 100, 100)).len(), 4);
    }
}
