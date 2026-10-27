//! OS information and small OS actions exposed as `system_*` commands.

pub mod foreground;
pub mod metrics;
#[cfg(windows)]
pub mod mic;
pub mod pointer;
pub mod steam;
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
