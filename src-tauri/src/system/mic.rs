//! Default capture endpoint mute (IMMDeviceEnumerator + IAudioEndpointVolume).

#![cfg(windows)]

use windows::core::GUID;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

fn endpoint(
    role: windows::Win32::Media::Audio::ERole,
) -> windows::core::Result<(String, IAudioEndpointVolume)> {
    crate::util::com_init();
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dev = en.GetDefaultAudioEndpoint(eCapture, role)?;
        let id = dev
            .GetId()
            .map(|p| p.to_string().unwrap_or_default())
            .unwrap_or_default();
        let vol: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None)?;
        Ok((id, vol))
    }
}

pub fn get_muted() -> Result<bool, String> {
    let (_, vol) = endpoint(eConsole).map_err(|e| format!("no microphone: {e}"))?;
    unsafe {
        vol.GetMute()
            .map(|b| b.as_bool())
            .map_err(|e| e.to_string())
    }
}

/// Mutes the default console capture device, and the default communications device if different.
pub fn set_muted(muted: bool) -> Result<(), String> {
    let (id, vol) = endpoint(eConsole).map_err(|e| format!("no microphone: {e}"))?;
    unsafe {
        vol.SetMute(muted, &GUID::zeroed())
            .map_err(|e| e.to_string())?
    };
    if let Ok((id2, vol2)) = endpoint(eCommunications) {
        if id2 != id {
            unsafe {
                let _ = vol2.SetMute(muted, &GUID::zeroed());
            }
        }
    }
    Ok(())
}
