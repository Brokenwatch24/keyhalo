//! Per-app volume (WASAPI audio sessions on the default output) and the "now playing" media
//! session (GlobalSystemMediaTransportControls), for the pad mixer and media pads.

#![cfg(windows)]

use serde::Serialize;
use windows::core::{Interface, GUID};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// Pseudo-process for the device's master volume.
pub const MASTER: &str = "master";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    /// Process name ("Spotify.exe"), or "master" for the output device.
    pub process: String,
    pub volume: f32,
    pub muted: bool,
}

fn device() -> windows::core::Result<windows::Win32::Media::Audio::IMMDevice> {
    crate::util::com_init();
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        en.GetDefaultAudioEndpoint(eRender, eConsole)
    }
}

/// Every audio session on the default output, with its process name.
fn sessions() -> windows::core::Result<Vec<(String, ISimpleAudioVolume)>> {
    let dev = device()?;
    let mut out = Vec::new();
    unsafe {
        let mgr: IAudioSessionManager2 = dev.Activate(CLSCTX_ALL, None)?;
        let en = mgr.GetSessionEnumerator()?;
        for i in 0..en.GetCount()? {
            let Ok(ctl) = en.GetSession(i) else { continue };
            let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
            // S_OK = the system sounds session (S_FALSE otherwise).
            if ctl2.IsSystemSoundsSession() == windows::Win32::Foundation::S_OK {
                continue;
            }
            let pid = ctl2.GetProcessId().unwrap_or(0);
            if pid == 0 {
                continue;
            }
            let (name, _) = super::foreground::process_name(pid);
            if name.is_empty() {
                continue;
            }
            if let Ok(vol) = ctl.cast::<ISimpleAudioVolume>() {
                out.push((name, vol));
            }
        }
    }
    Ok(out)
}

fn master() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe { device()?.Activate(CLSCTX_ALL, None) }
}

/// Master volume first, then one entry per process (the loudest session wins).
pub fn list() -> Result<Vec<AudioApp>, String> {
    let mut out = Vec::new();
    if let Ok(m) = master() {
        unsafe {
            out.push(AudioApp {
                process: MASTER.into(),
                volume: m.GetMasterVolumeLevelScalar().unwrap_or(0.0),
                muted: m.GetMute().map(|b| b.as_bool()).unwrap_or(false),
            });
        }
    }
    for (name, vol) in sessions().map_err(|e| e.to_string())? {
        let volume = unsafe { vol.GetMasterVolume().unwrap_or(0.0) };
        let muted = unsafe { vol.GetMute().map(|b| b.as_bool()).unwrap_or(false) };
        match out.iter_mut().find(|a| a.process.eq_ignore_ascii_case(&name)) {
            Some(a) => {
                a.volume = a.volume.max(volume);
                a.muted &= muted;
            }
            None => out.push(AudioApp { process: name, volume, muted }),
        }
    }
    Ok(out)
}

/// Sets volume (0..1) and/or mute for every session of `process` (or the master volume).
pub fn set(process: &str, volume: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    let ctx = GUID::zeroed();
    if process.eq_ignore_ascii_case(MASTER) {
        let m = master().map_err(|e| e.to_string())?;
        unsafe {
            if let Some(v) = volume {
                m.SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), &ctx).map_err(|e| e.to_string())?;
            }
            if let Some(mu) = muted {
                m.SetMute(mu, &ctx).map_err(|e| e.to_string())?;
            }
        }
        return Ok(());
    }
    let mut found = false;
    for (name, vol) in sessions().map_err(|e| e.to_string())? {
        if !name.eq_ignore_ascii_case(process) {
            continue;
        }
        found = true;
        unsafe {
            if let Some(v) = volume {
                vol.SetMasterVolume(v.clamp(0.0, 1.0), &ctx).map_err(|e| e.to_string())?;
            }
            if let Some(mu) = muted {
                vol.SetMute(mu, &ctx).map_err(|e| e.to_string())?;
            }
        }
    }
    if found {
        Ok(())
    } else {
        Err(format!("{process} is not playing audio"))
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// AppUserModelID of the player ("Spotify.exe", "Chrome").
    pub app: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
}

fn session() -> Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    MediaManager::RequestAsync().and_then(|op| op.join()).and_then(|m| m.GetCurrentSession()).ok()
}

/// The current media session (None when nothing is playing or paused).
pub fn media() -> Option<MediaState> {
    let s = session()?;
    let playing = s
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(|st| st == Status::Playing)
        .unwrap_or(false);
    let (title, artist) = s
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.join())
        .map(|p| (p.Title().map(|t| t.to_string()).unwrap_or_default(), p.Artist().map(|t| t.to_string()).unwrap_or_default()))
        .unwrap_or_default();
    Some(MediaState { app: s.SourceAppUserModelId().map(|t| t.to_string()).unwrap_or_default(), title, artist, playing })
}

/// "playPause" | "next" | "prev". Returns false when there is no media session.
pub fn media_command(command: &str) -> Result<bool, String> {
    let Some(s) = session() else { return Ok(false) };
    let op = match command {
        "playPause" => s.TryTogglePlayPauseAsync(),
        "next" => s.TrySkipNextAsync(),
        "prev" => s.TrySkipPreviousAsync(),
        _ => return Err(format!("unknown media command {command}")),
    };
    op.and_then(|o| o.join()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    /// Reads the real mixer and media session: `cargo test --lib mixer -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_audio_apps_and_media() {
        for a in super::list().expect("list") {
            println!("{:<28} vol={:.2} muted={}", a.process, a.volume, a.muted);
        }
        println!("media: {:?}", super::media().map(|m| (m.app, m.playing, !m.title.is_empty())));
    }
}
