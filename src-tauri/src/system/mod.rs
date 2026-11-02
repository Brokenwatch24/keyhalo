//! OS information and small OS actions exposed as `system_*` commands.

pub mod foreground;
pub mod metrics;
#[cfg(windows)]
pub mod explorer;
#[cfg(windows)]
pub mod mixer;
#[cfg(windows)]
pub mod mic;
pub mod pointer;
pub mod steam;
pub mod tabs;
#[cfg(windows)]
pub mod toasts;

use crate::util::{blocking, err, CmdResult};
use foreground::{ForegroundApp, WindowInfo};
use metrics::SystemMetrics;
use pointer::PointerSettings;
use tauri_plugin_opener::OpenerExt;

/// Opens a file, folder or URL with the default handler.
pub fn open_with_shell(path: &str) -> Result<(), String> {
    let app = crate::util::app().ok_or("app not ready")?;
    let lower = path.to_ascii_lowercase();
    if lower.contains("://") || lower.starts_with("mailto:") {
        app.opener().open_url(path, None::<&str>).map_err(err)
    } else {
        app.opener().open_path(path, None::<&str>).map_err(err)
    }
}

#[tauri::command]
pub async fn system_foreground() -> CmdResult<Option<ForegroundApp>> {
    blocking(|| Ok(foreground::foreground())).await
}

#[tauri::command]
pub async fn system_processes() -> CmdResult<Vec<String>> {
    blocking(|| Ok(metrics::processes())).await
}

#[tauri::command]
pub async fn system_windows() -> CmdResult<Vec<WindowInfo>> {
    blocking(|| Ok(foreground::windows())).await
}

#[tauri::command]
pub async fn system_metrics() -> CmdResult<SystemMetrics> {
    blocking(|| Ok(metrics::metrics())).await
}

#[tauri::command]
pub async fn system_pointer_get() -> CmdResult<PointerSettings> {
    blocking(pointer::get).await
}

#[tauri::command]
pub async fn system_pointer_set(settings: PointerSettings) -> CmdResult<()> {
    blocking(move || pointer::set(settings)).await
}

#[tauri::command]
pub async fn system_mic_muted() -> CmdResult<bool> {
    #[cfg(windows)]
    return blocking(mic::get_muted).await;
    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
pub async fn system_set_mic_muted(muted: bool) -> CmdResult<()> {
    #[cfg(windows)]
    return blocking(move || mic::set_muted(muted)).await;
    #[cfg(not(windows))]
    {
        let _ = muted;
        Err("not supported".into())
    }
}

/// Windows notifications currently in the Action Center (empty elsewhere).
#[tauri::command]
pub async fn system_notifications() -> CmdResult<serde_json::Value> {
    #[cfg(windows)]
    return blocking(|| toasts::list().map(|v| serde_json::to_value(v).unwrap_or_default())).await;
    #[cfg(not(windows))]
    Ok(serde_json::Value::Array(vec![]))
}

/// "allowed" | "denied" | "unspecified" | "unsupported". `request` shows the Windows prompt.
#[tauri::command]
pub async fn system_notifications_access(request: Option<bool>) -> CmdResult<String> {
    #[cfg(windows)]
    return blocking(move || {
        if request.unwrap_or(false) {
            toasts::request_access()
        } else {
            toasts::access()
        }
    })
    .await;
    #[cfg(not(windows))]
    {
        let _ = request;
        Ok("unsupported".into())
    }
}

/// Brings a window (from `system_windows`) to the front.
#[tauri::command]
pub async fn system_focus_window(pid: u32, title: String) -> CmdResult<bool> {
    blocking(move || Ok(foreground::focus(pid, &title))).await
}

/// Brings a window to the front by handle.
#[tauri::command]
pub async fn system_focus_hwnd(hwnd: isize) -> CmdResult<bool> {
    blocking(move || Ok(foreground::focus_hwnd(hwnd))).await
}

/// The tabs of a window (Chrome, Edge, Windows Terminal, File Explorer…), in order.
#[tauri::command]
pub async fn system_tabs(hwnd: isize) -> CmdResult<Vec<tabs::TabInfo>> {
    blocking(move || Ok(tabs::tabs(hwnd))).await
}

/// Switch a window to its tab `index`.
#[tauri::command]
pub async fn system_tab_select(hwnd: isize, index: usize) -> CmdResult<bool> {
    blocking(move || Ok(tabs::select(hwnd, index))).await
}

/// Minimise / maximise / restore / close a window by handle.
#[tauri::command]
pub async fn system_window_cmd(hwnd: isize, action: String) -> CmdResult<bool> {
    blocking(move || Ok(foreground::window_cmd(hwnd, &action))).await
}

/// Arrange windows (front to back) in a grid on the monitor in front; returns how many moved.
#[tauri::command]
pub async fn system_tile(hwnds: Vec<isize>) -> CmdResult<usize> {
    blocking(move || Ok(foreground::tile(&hwnds))).await
}

/// The folder a File Explorer window shows (None for other windows or virtual folders).
#[tauri::command]
pub async fn system_explorer_folder(hwnd: isize) -> CmdResult<Option<String>> {
    #[cfg(windows)]
    return blocking(move || Ok(explorer::folder(hwnd))).await;
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        Ok(None)
    }
}

/// Per-app volume: master first, then one entry per process playing audio.
#[tauri::command]
pub async fn audio_apps() -> CmdResult<serde_json::Value> {
    #[cfg(windows)]
    return blocking(|| mixer::list().map(|v| serde_json::to_value(v).unwrap_or_default())).await;
    #[cfg(not(windows))]
    Ok(serde_json::Value::Array(vec![]))
}

/// Sets volume (0..1) and/or mute for a process ("master" = the output device).
#[tauri::command]
pub async fn audio_app_set(process: String, volume: Option<f32>, muted: Option<bool>) -> CmdResult<()> {
    #[cfg(windows)]
    return blocking(move || mixer::set(&process, volume, muted)).await;
    #[cfg(not(windows))]
    {
        let _ = (process, volume, muted);
        Err("not supported".into())
    }
}

/// The current "now playing" session, or null.
#[tauri::command]
pub async fn media_state() -> CmdResult<serde_json::Value> {
    #[cfg(windows)]
    return blocking(|| Ok(serde_json::to_value(mixer::media()).unwrap_or_default())).await;
    #[cfg(not(windows))]
    Ok(serde_json::Value::Null)
}

/// "playPause" | "next" | "prev" on the current media session.
#[tauri::command]
pub async fn media_command(command: String) -> CmdResult<bool> {
    #[cfg(windows)]
    return blocking(move || mixer::media_command(&command)).await;
    #[cfg(not(windows))]
    {
        let _ = command;
        Ok(false)
    }
}

#[tauri::command]
pub async fn system_open_path(path: String) -> CmdResult<()> {
    open_with_shell(&path)
}

#[tauri::command]
pub async fn system_find_steam_game(folder: String) -> CmdResult<Option<String>> {
    blocking(move || Ok(steam::find_game(&folder))).await
}

#[tauri::command]
pub async fn system_write_file(path: String, contents: String) -> CmdResult<()> {
    blocking(move || {
        let p = std::path::PathBuf::from(&path);
        if !p.is_absolute() {
            return Err("path must be absolute".into());
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        std::fs::write(&p, contents).map_err(err)
    })
    .await
}
