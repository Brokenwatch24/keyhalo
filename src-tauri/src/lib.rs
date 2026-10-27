//! KeyHalo's Rust side: a thin, generic bridge to hardware and the OS.
//! Device protocols live in TypeScript; see src/core/backend/api.ts for the contract.

pub mod api_server;
pub mod audio;
pub mod claude_hooks;
pub mod hid;
pub mod http;
pub mod input;
pub mod lamparray;
pub mod mqtt;
pub mod shell;
pub mod storage;
pub mod system;
pub mod tcp;
pub mod util;

use serde_json::json;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

fn forward_deep_links(urls: impl IntoIterator<Item = String>) {
    for url in urls {
        if url.starts_with("keyhalo:") {
            util::emit("deep-link", json!({ "url": url }));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // One process-wide crypto provider for reqwest / rustls (ring: no extra native toolchain).
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        // Must be the first plugin. A second launch focuses this instance; with the
        // single-instance "deep-link" feature its keyhalo:// URL arrives via on_open_url.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            shell::show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            util::set_app(handle.clone());

            if let Err(e) = shell::setup_tray(&handle) {
                khlog!("tray setup failed: {e}");
            }
            shell::setup_hud(&handle);

            // Launched at login: start hidden in the tray.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // Register the scheme at runtime as well so dev builds handle keyhalo:// links
            // (the installer registers it for release builds).
            #[cfg(any(windows, target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                khlog!("deep-link register failed: {e}");
            }
            app.deep_link().on_open_url(|event| {
                forward_deep_links(event.urls().into_iter().map(|u| u.to_string()));
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let urls: Vec<String> = urls.into_iter().map(|u| u.to_string()).collect();
                if !urls.is_empty() {
                    // Give the frontend time to register its listener.
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(2500)).await;
                        for url in urls {
                            let _ = h.emit("deep-link", json!({ "url": url }));
                        }
                    });
                }
            }

            hid::start_watcher();
            system::foreground::start_watcher();
            Ok(())
        })
        .on_window_event(shell::on_window_event)
        .invoke_handler(tauri::generate_handler![
            hid::hid_enumerate,
            hid::hid_send_feature,
            hid::hid_get_feature,
            hid::hid_write,
            hid::hid_read,
            hid::hid_close,
            lamparray::lamparray_list,
            lamparray::lamparray_set_colors,
            tcp::tcp_connect,
            tcp::tcp_send,
            tcp::tcp_recv,
            tcp::tcp_close,
            mqtt::mqtt_connect,
            mqtt::mqtt_subscribe,
            mqtt::mqtt_publish,
            mqtt::mqtt_disconnect,
            http::http_request,
            system::system_foreground,
            system::system_processes,
            system::system_windows,
            system::system_metrics,
            system::system_pointer_get,
            system::system_pointer_set,
            system::system_mic_muted,
            system::system_set_mic_muted,
            system::system_notifications,
            system::system_notifications_access,
            system::system_open_path,
            system::system_find_steam_game,
            system::system_write_file,
            input::input_set_listening,
            input::remap_configure,
            input::input_send,
            audio::audio_set_listening,
            api_server::api_configure,
            api_server::api_set_state,
            storage::storage_read,
            storage::storage_write,
            storage::storage_list,
            storage::storage_delete,
            claude_hooks::claude_hooks,
            shell::tray_set_profiles,
            shell::hud_show,
            shell::app_version,
            shell::app_set_close_to_tray,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KeyHalo")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                input::shutdown();
            }
        });
}
