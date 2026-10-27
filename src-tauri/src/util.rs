//! Small helpers shared by every module: the global app handle, event emission, logging and
//! the blocking-call bridge used by async commands.

use serde::Serialize;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Result type returned by every Tauri command (errors travel to JS as strings).
pub type CmdResult<T> = Result<T, String>;

/// Logs to stderr with a module prefix. Visible in `tauri dev`; harmless in release builds.
#[macro_export]
macro_rules! khlog {
    ($($arg:tt)*) => {
        eprintln!("[keyhalo] {}", format!($($arg)*))
    };
}

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> Option<&'static AppHandle> {
    APP.get()
}

/// Emits a global event to every window. Never fails (errors are logged).
pub fn emit<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = app() {
        if let Err(e) = app.emit(event, payload) {
            khlog!("emit {event} failed: {e}");
        }
    }
}

/// Milliseconds since the Unix epoch (matches JS `Date.now()`).
pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Runs blocking work on Tauri's blocking pool so commands never stall the main thread.
pub async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CmdResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?
}

/// Initialises COM (multi-threaded apartment) on the calling thread. Safe to call repeatedly.
#[cfg(windows)]
pub fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// Converts a UTF-16 buffer (possibly NUL-terminated) to a String.
pub fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// NUL-terminated UTF-16 string for Win32 calls.
pub fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
