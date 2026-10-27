//! Windows pointer speed and "Enhance pointer precision".

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerSettings {
    pub speed: u32,
    pub enhance_precision: bool,
}

#[cfg(windows)]
pub fn get() -> Result<PointerSettings, String> {
    use windows::Win32::UI::WindowsAndMessaging::*;
    let mut speed: u32 = 10;
    let mut accel = [0i32; 3];
    unsafe {
        SystemParametersInfoW(
            SPI_GETMOUSESPEED,
            0,
            Some(&mut speed as *mut u32 as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .map_err(|e| e.to_string())?;
        SystemParametersInfoW(
            SPI_GETMOUSE,
            0,
            Some(accel.as_mut_ptr() as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(PointerSettings {
        speed,
        enhance_precision: accel[2] != 0,
    })
}

#[cfg(windows)]
pub fn set(s: PointerSettings) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::*;
    let speed = s.speed.clamp(1, 20) as usize;
    let mut accel: [i32; 3] = if s.enhance_precision {
        [6, 10, 1]
    } else {
        [0, 0, 0]
    };
    let flags = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE;
    unsafe {
        // SPI_SETMOUSESPEED takes the speed itself in pvParam.
        SystemParametersInfoW(SPI_SETMOUSESPEED, 0, Some(speed as *mut _), flags)
            .map_err(|e| e.to_string())?;
        SystemParametersInfoW(SPI_SETMOUSE, 0, Some(accel.as_mut_ptr() as *mut _), flags)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn get() -> Result<PointerSettings, String> {
    Err("not supported on this platform".into())
}
#[cfg(not(windows))]
pub fn set(_s: PointerSettings) -> Result<(), String> {
    Err("not supported on this platform".into())
}
