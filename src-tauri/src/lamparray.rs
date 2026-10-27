//! Windows Dynamic Lighting (`Windows.Devices.Lights.LampArray`). Every failure degrades to an
//! empty list / an error string; nothing here may crash the app.

use crate::util::{blocking, CmdResult};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LampInfo {
    pub index: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_keys: Option<Vec<i32>>,
    pub purposes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LampArrayInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_id: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_id: Option<u16>,
    pub lamp_count: i32,
    pub width: f32,
    pub height: f32,
    pub lamps: Vec<LampInfo>,
    pub is_available: bool,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use windows::core::HSTRING;
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Devices::Lights::{LampArray, LampArrayKind, LampPurposes};
    use windows::System::VirtualKey;
    use windows::UI::Color;

    static CACHE: LazyLock<Mutex<HashMap<String, LampArray>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    fn kind_name(k: LampArrayKind) -> &'static str {
        match k.0 {
            1 => "Keyboard",
            2 => "Mouse",
            3 => "GameController",
            4 => "Peripheral",
            5 => "Scene",
            6 => "Notification",
            7 => "Chassis",
            8 => "Wearable",
            9 => "Furniture",
            10 => "Art",
            11 => "Headset",
            12 => "Microphone",
            13 => "Speaker",
            _ => "Undefined",
        }
    }

    fn purposes(p: LampPurposes) -> Vec<String> {
        const NAMES: [(u32, &str); 6] = [
            (1, "Control"),
            (2, "Accent"),
            (4, "Branding"),
            (8, "Status"),
            (16, "Illumination"),
            (32, "Presentation"),
        ];
        let v: Vec<String> = NAMES
            .iter()
            .filter(|(bit, _)| p.0 & bit != 0)
            .map(|(_, n)| n.to_string())
            .collect();
        if v.is_empty() {
            vec!["Undefined".into()]
        } else {
            v
        }
    }

    fn open(id: &str) -> windows::core::Result<LampArray> {
        if let Some(la) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            return Ok(la.clone());
        }
        let la = LampArray::FromIdAsync(&HSTRING::from(id))?.join()?;
        CACHE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), la.clone());
        Ok(la)
    }

    fn describe(id: String, name: String, la: &LampArray) -> windows::core::Result<LampArrayInfo> {
        let count = la.LampCount()?;
        let bbox = la.BoundingBox()?;
        let mut vks: HashMap<i32, Vec<i32>> = HashMap::new();
        for vk in 1..=254i32 {
            if let Ok(indices) = la.GetIndicesForKey(VirtualKey(vk)) {
                for i in indices.iter() {
                    vks.entry(*i).or_default().push(vk);
                }
            }
        }
        let mut lamps = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let info = la.GetLampInfo(i)?;
            let pos = info.Position()?;
            lamps.push(LampInfo {
                index: i,
                x: pos.X,
                y: pos.Y,
                z: pos.Z,
                virtual_keys: vks.remove(&i),
                purposes: purposes(info.Purposes()?),
            });
        }
        let vendor = la.HardwareVendorId().ok().filter(|v| *v != 0);
        let product = la.HardwareProductId().ok().filter(|v| *v != 0);
        Ok(LampArrayInfo {
            id,
            name,
            kind: kind_name(la.LampArrayKind()?).to_string(),
            vendor_id: vendor,
            product_id: product,
            lamp_count: count,
            width: bbox.X,
            height: bbox.Y,
            lamps,
            is_available: la.IsAvailable().unwrap_or(false),
        })
    }

    pub fn list() -> windows::core::Result<Vec<LampArrayInfo>> {
        crate::util::com_init();
        let selector = LampArray::GetDeviceSelector()?;
        let infos = DeviceInformation::FindAllAsyncAqsFilter(&selector)?.join()?;
        let mut out = Vec::new();
        for i in 0..infos.Size()? {
            let info = infos.GetAt(i)?;
            let id = info.Id()?.to_string();
            let name = info.Name().map(|n| n.to_string()).unwrap_or_default();
            // Re-open so a reconnected device gets a fresh object.
            CACHE.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            match open(&id).and_then(|la| describe(id.clone(), name, &la)) {
                Ok(d) => out.push(d),
                Err(e) => crate::khlog!("lamparray: {id}: {e}"),
            }
        }
        Ok(out)
    }

    pub fn set_colors(id: &str, colors: &[Vec<u8>]) -> windows::core::Result<()> {
        crate::util::com_init();
        let la = open(id)?;
        let count = la.LampCount()?.max(0) as usize;
        let n = colors.len().min(count);
        let cols: Vec<Color> = colors[..n]
            .iter()
            .map(|c| Color {
                A: 255,
                R: c.first().copied().unwrap_or(0),
                G: c.get(1).copied().unwrap_or(0),
                B: c.get(2).copied().unwrap_or(0),
            })
            .collect();
        let idx: Vec<i32> = (0..n as i32).collect();
        la.SetColorsForIndices(&cols, &idx)
    }
}

#[tauri::command]
pub async fn lamparray_list() -> CmdResult<Vec<LampArrayInfo>> {
    #[cfg(windows)]
    {
        let r = blocking(|| {
            Ok(std::panic::catch_unwind(imp::list)
                .unwrap_or_else(|_| Ok(vec![]))
                .unwrap_or_else(|e| {
                    crate::khlog!("lamparray: list failed: {e}");
                    vec![]
                }))
        })
        .await;
        Ok(r.unwrap_or_default())
    }
    #[cfg(not(windows))]
    Ok(vec![])
}

#[tauri::command]
pub async fn lamparray_set_colors(id: String, colors: Vec<Vec<u8>>) -> CmdResult<()> {
    #[cfg(windows)]
    return blocking(move || imp::set_colors(&id, &colors).map_err(|e| e.to_string())).await;
    #[cfg(not(windows))]
    {
        let _ = (id, colors);
        Err("LampArray requires Windows".into())
    }
}
