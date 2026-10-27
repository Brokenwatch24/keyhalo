//! Raw HID access (hidapi). Open handles are cached per path; a watcher thread emits
//! `hid-changed` whenever the set of connected interfaces changes.

use crate::util::{blocking, err, CmdResult};
use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::ffi::CString;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDeviceInfo {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
}

type DevMap = HashMap<String, Arc<Mutex<HidDevice>>>;

static API: LazyLock<Mutex<Option<HidApi>>> = LazyLock::new(|| Mutex::new(None));
static OPEN: LazyLock<Mutex<DevMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn api() -> Result<MutexGuard<'static, Option<HidApi>>, String> {
    let mut g = API.lock().unwrap_or_else(|e| e.into_inner());
    if g.is_none() {
        *g = Some(HidApi::new().map_err(err)?);
    }
    Ok(g)
}

fn open_map() -> MutexGuard<'static, DevMap> {
    OPEN.lock().unwrap_or_else(|e| e.into_inner())
}

fn non_empty(s: Option<&str>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn enumerate(vendor_ids: Option<&[u16]>) -> Result<Vec<HidDeviceInfo>, String> {
    let mut g = api()?;
    let api = g.as_mut().ok_or("hidapi unavailable")?;
    api.refresh_devices().map_err(err)?;
    Ok(api
        .device_list()
        .filter(|d| {
            vendor_ids
                .map(|v| v.is_empty() || v.contains(&d.vendor_id()))
                .unwrap_or(true)
        })
        .map(|d| HidDeviceInfo {
            path: d.path().to_string_lossy().to_string(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            interface_number: d.interface_number(),
            usage_page: d.usage_page(),
            usage: d.usage(),
            product: non_empty(d.product_string()),
            manufacturer: non_empty(d.manufacturer_string()),
            serial: non_empty(d.serial_number()),
        })
        .collect())
}

fn device(path: &str) -> Result<Arc<Mutex<HidDevice>>, String> {
    if let Some(d) = open_map().get(path) {
        return Ok(d.clone());
    }
    let dev = {
        let g = api()?;
        let api = g.as_ref().ok_or("hidapi unavailable")?;
        let c = CString::new(path).map_err(err)?;
        api.open_path(&c)
            .map_err(|e| format!("cannot open HID device: {e}"))?
    };
    let dev = Arc::new(Mutex::new(dev));
    open_map().insert(path.to_string(), dev.clone());
    Ok(dev)
}

fn forget(path: &str) {
    open_map().remove(path);
}

/// Runs an operation on a cached device; on I/O failure the handle is dropped so the next
/// call reopens it (devices get unplugged / re-enumerated).
fn with_device<T>(
    path: &str,
    f: impl FnOnce(&HidDevice) -> hidapi::HidResult<T>,
) -> Result<T, String> {
    let dev = device(path)?;
    let r = {
        let d = dev.lock().unwrap_or_else(|e| e.into_inner());
        f(&d)
    };
    r.map_err(|e| {
        forget(path);
        e.to_string()
    })
}

#[tauri::command]
pub async fn hid_enumerate(vendor_ids: Option<Vec<u16>>) -> CmdResult<Vec<HidDeviceInfo>> {
    blocking(move || enumerate(vendor_ids.as_deref())).await
}

#[tauri::command]
pub async fn hid_send_feature(path: String, data: Vec<u8>) -> CmdResult<()> {
    blocking(move || {
        if data.is_empty() {
            return Err("empty report".into());
        }
        with_device(&path, |d| d.send_feature_report(&data))
    })
    .await
}

#[tauri::command]
pub async fn hid_get_feature(path: String, report_id: u8, length: usize) -> CmdResult<Vec<u8>> {
    blocking(move || {
        let mut buf = vec![0u8; length.clamp(1, 4096)];
        buf[0] = report_id;
        let n = with_device(&path, |d| d.get_feature_report(&mut buf))?;
        buf.truncate(n.min(buf.len()));
        Ok(buf)
    })
    .await
}

#[tauri::command]
pub async fn hid_write(path: String, data: Vec<u8>) -> CmdResult<()> {
    blocking(move || with_device(&path, |d| d.write(&data)).map(|_| ())).await
}

#[tauri::command]
pub async fn hid_read(path: String, length: usize, timeout_ms: i32) -> CmdResult<Vec<u8>> {
    blocking(move || {
        let mut buf = vec![0u8; length.clamp(1, 4096)];
        let n = with_device(&path, |d| d.read_timeout(&mut buf, timeout_ms.max(0)))?;
        buf.truncate(n);
        Ok(buf)
    })
    .await
}

#[tauri::command]
pub async fn hid_close(path: String) -> CmdResult<()> {
    forget(&path);
    Ok(())
}

/// Polls enumeration every 2 s and emits `hid-changed` when the set of paths changes.
pub fn start_watcher() {
    let _ = std::thread::Builder::new()
        .name("kh-hid-watch".into())
        .spawn(|| {
            let mut last: Option<BTreeSet<String>> = None;
            loop {
                match enumerate(None) {
                    Ok(list) => {
                        let paths: BTreeSet<String> = list.into_iter().map(|d| d.path).collect();
                        if let Some(prev) = &last {
                            if *prev != paths {
                                // Drop cached handles of interfaces that went away.
                                open_map().retain(|p, _| paths.contains(p));
                                crate::util::emit("hid-changed", serde_json::json!({}));
                            }
                        }
                        last = Some(paths);
                    }
                    Err(e) => crate::khlog!("hid: enumerate failed: {e}"),
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
}
