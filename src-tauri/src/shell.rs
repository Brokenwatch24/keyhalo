//! Tray icon & menu, HUD overlay window, close-to-tray and small app commands.

use crate::util::{emit, err, CmdResult};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Runtime, Wry};

pub const TRAY_ID: &str = "keyhalo";

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
static HUD_GEN: AtomicU64 = AtomicU64::new(0);
static PROFILES: Mutex<Vec<TrayProfile>> = Mutex::new(Vec::new());
static PAUSE_ITEM: Mutex<Option<CheckMenuItem<Wry>>> = Mutex::new(None);

#[derive(Debug, Clone, Deserialize)]
pub struct TrayProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub active: bool,
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let profiles = PROFILES.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let mut sub = SubmenuBuilder::new(app, "Profiles");
    if profiles.is_empty() {
        sub = sub.item(&MenuItem::with_id(
            app,
            "profiles-empty",
            "No profiles",
            false,
            None::<&str>,
        )?);
    }
    for p in &profiles {
        let item = CheckMenuItem::with_id(
            app,
            format!("profile:{}", p.id),
            &p.name,
            true,
            p.active,
            None::<&str>,
        )?;
        sub = sub.item(&item);
    }
    let pause = CheckMenuItem::with_id(
        app,
        "pause",
        "Pause remapping",
        true,
        crate::input::is_paused(),
        None::<&str>,
    )?;
    *PAUSE_ITEM.lock().unwrap_or_else(|e| e.into_inner()) = Some(pause.clone());
    MenuBuilder::new(app)
        .item(&MenuItem::with_id(
            app,
            "show",
            "Show KeyHalo",
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&sub.build()?)
        .item(&pause)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)
        .build()
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref().to_string();
    match id.as_str() {
        "show" => show_main(app),
        "quit" => {
            crate::input::shutdown();
            app.exit(0);
        }
        "pause" => {
            let paused = !crate::input::is_paused();
            crate::input::set_paused(paused);
            tray_sync_pause(paused);
            emit(
                "tray-action",
                json!({ "action": "pauseRemap", "value": paused.to_string() }),
            );
        }
        other => {
            if let Some(pid) = other.strip_prefix("profile:") {
                // Optimistically move the check mark; the frontend confirms via tray_set_profiles.
                {
                    let mut ps = PROFILES.lock().unwrap_or_else(|e| e.into_inner());
                    for p in ps.iter_mut() {
                        p.active = p.id == pid;
                    }
                }
                rebuild(app);
                emit("tray-action", json!({ "action": "profile", "value": pid }));
            }
        }
    }
}

fn rebuild(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match build_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => crate::khlog!("tray: menu build failed: {e}"),
        }
    }
}

/// Keeps the tray's "Pause remapping" check mark in sync with the engine.
pub fn tray_sync_pause(paused: bool) {
    if let Some(item) = PAUSE_ITEM
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        let _ = item.set_checked(paused);
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let menu = build_menu(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("KeyHalo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Main-window close: hide to tray when enabled, otherwise quit (the hidden HUD window would
/// otherwise keep the process alive).
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
            api.prevent_close();
            let _ = window.hide();
        } else {
            crate::input::shutdown();
            window.app_handle().exit(0);
        }
    }
}

/// Makes the HUD a non-activating, click-through tool window.
pub fn setup_hud(app: &AppHandle) {
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.set_ignore_cursor_events(true);
        #[cfg(windows)]
        if let Ok(h) = hud.hwnd() {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::*;
            let hwnd = HWND(h.0 as *mut _);
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize,
                );
            }
        }
    }
}

#[cfg(windows)]
fn hud_native(window: &tauri::WebviewWindow, show: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::*;
    let Ok(h) = window.hwnd() else { return };
    let hwnd = HWND(h.0 as *mut _);
    unsafe {
        if show {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        } else {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}

#[tauri::command]
pub async fn hud_show(app: AppHandle, payload: Value) -> CmdResult<()> {
    let hud = app.get_webview_window("hud").ok_or("HUD window missing")?;
    let generation = HUD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let duration = payload
        .get("durationMs")
        .and_then(|d| d.as_u64())
        .unwrap_or(1400)
        .clamp(300, 30_000);
    let top = payload.get("position").and_then(|p| p.as_str()) == Some("top");

    // Bottom-centre (or top-centre) of the monitor under the cursor, inside its work area.
    if let Ok(cursor) = app.cursor_position() {
        let monitor = app
            .monitor_from_point(cursor.x, cursor.y)
            .ok()
            .flatten()
            .or_else(|| hud.primary_monitor().ok().flatten());
        if let Some(m) = monitor {
            let scale = m.scale_factor();
            let area = m.work_area();
            let size = hud.outer_size().map_err(err)?;
            let (w, h) = (size.width as i32, size.height as i32);
            let margin = (48.0 * scale) as i32;
            let x = area.position.x + (area.size.width as i32 - w) / 2;
            let y = if top {
                area.position.y + margin
            } else {
                area.position.y + area.size.height as i32 - h - margin
            };
            let _ = hud.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = hud.set_ignore_cursor_events(true);
    app.emit_to("hud", "hud-show", payload).map_err(err)?;
    #[cfg(windows)]
    hud_native(&hud, true);
    #[cfg(not(windows))]
    let _ = hud.show();

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(duration + 300)).await;
        if HUD_GEN.load(Ordering::SeqCst) == generation {
            if let Some(hud) = app2.get_webview_window("hud") {
                #[cfg(windows)]
                hud_native(&hud, false);
                #[cfg(not(windows))]
                let _ = hud.hide();
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn tray_set_profiles(app: AppHandle, profiles: Vec<TrayProfile>) -> CmdResult<()> {
    *PROFILES.lock().unwrap_or_else(|e| e.into_inner()) = profiles;
    rebuild(&app);
    Ok(())
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn app_set_close_to_tray(enabled: bool) -> CmdResult<()> {
    CLOSE_TO_TRAY.store(enabled, Ordering::SeqCst);
    Ok(())
}
