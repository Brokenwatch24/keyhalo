//! System audio spectrum: WASAPI loopback capture of the default render device → 1024-point
//! FFT (Hann window) → 16 log-spaced bands (40 Hz–16 kHz) → `audio-bands` at ~30 Hz.
//! Errors are logged and the capture restarts; nothing here can crash the app.

use crate::util::CmdResult;
use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde_json::json;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const FFT_SIZE: usize = 1024;
const BANDS: usize = 16;
const F_MIN: f32 = 40.0;
const F_MAX: f32 = 16_000.0;

static RUNNING: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Turns mono samples into smoothed band levels.
pub struct Analyzer {
    fft: Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    bands: [f32; BANDS],
    level: f32,
    rate: f32,
}

impl Analyzer {
    pub fn new(rate: f32) -> Self {
        let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
        let window = (0..FFT_SIZE)
            .map(|i| {
                0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
            })
            .collect();
        Analyzer {
            fft,
            window,
            bands: [0.0; BANDS],
            level: 0.0,
            rate,
        }
    }

    fn smooth(cur: f32, target: f32) -> f32 {
        let k = if target > cur { 0.6 } else { 0.15 };
        let v = cur + (target - cur) * k;
        if v < 0.002 {
            0.0
        } else {
            v
        }
    }

    /// `samples` = the most recent FFT_SIZE mono samples.
    pub fn process(&mut self, samples: &[f32]) -> ([f32; BANDS], f32) {
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt();
        let mut targets = [0f32; BANDS];
        let level_target = if rms < 1e-5 {
            0.0
        } else {
            let mut buf: Vec<Complex32> = samples
                .iter()
                .zip(&self.window)
                .map(|(s, w)| Complex32::new(s * w, 0.0))
                .collect();
            self.fft.process(&mut buf);
            let mags: Vec<f32> = buf[..FFT_SIZE / 2].iter().map(|c| c.norm()).collect();
            let bin_hz = self.rate / FFT_SIZE as f32;
            let reference = FFT_SIZE as f32 / 4.0; // full-scale sine through a Hann window
            for (b, t) in targets.iter_mut().enumerate() {
                let lo = F_MIN * (F_MAX / F_MIN).powf(b as f32 / BANDS as f32);
                let hi = F_MIN * (F_MAX / F_MIN).powf((b + 1) as f32 / BANDS as f32);
                let lo_bin = ((lo / bin_hz).floor() as usize).max(1);
                let hi_bin = ((hi / bin_hz).ceil() as usize).clamp(lo_bin + 1, mags.len());
                let peak = mags[lo_bin.min(mags.len() - 1)..hi_bin]
                    .iter()
                    .cloned()
                    .fold(0.0f32, f32::max);
                let centre = (lo * hi).sqrt();
                // +3 dB/octave tilt around 1 kHz so typical music looks balanced.
                let db =
                    20.0 * (peak / reference).max(1e-9).log10() + 3.0 * (centre / 1000.0).log2();
                *t = ((db + 65.0) / 60.0).clamp(0.0, 1.0);
            }
            ((20.0 * rms.log10() + 60.0) / 60.0).clamp(0.0, 1.0)
        };
        for (cur, t) in self.bands.iter_mut().zip(targets) {
            *cur = Self::smooth(*cur, t);
        }
        self.level = Self::smooth(self.level, level_target);
        (self.bands, self.level)
    }
}

#[cfg(windows)]
mod capture {
    use super::*;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
    use windows::Win32::Media::Multimedia::{
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

    fn default_id(en: &IMMDeviceEnumerator) -> Option<String> {
        unsafe {
            en.GetDefaultAudioEndpoint(eRender, eConsole)
                .ok()?
                .GetId()
                .ok()?
                .to_string()
                .ok()
        }
    }

    /// Captures until `stop` is set, an error occurs, or the default device changes.
    pub fn run_once(stop: &AtomicBool) -> windows::core::Result<()> {
        crate::util::com_init();
        unsafe {
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let dev_id = dev.GetId().ok().and_then(|p| p.to_string().ok());
            let client: IAudioClient = dev.Activate(CLSCTX_ALL, None)?;
            let fmt_ptr = client.GetMixFormat()?;
            let fmt = *fmt_ptr;
            let channels = fmt.nChannels.max(1) as usize;
            let rate = fmt.nSamplesPerSec as f32;
            let bits = fmt.wBitsPerSample;
            let is_float = if fmt.wFormatTag as u32 == WAVE_FORMAT_EXTENSIBLE {
                let ext = &*(fmt_ptr as *const WAVEFORMATEXTENSIBLE);
                let sub = ext.SubFormat;
                sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            } else {
                fmt.wFormatTag as u32 == WAVE_FORMAT_IEEE_FLOAT
            };
            let init = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                1_000_000,
                0,
                fmt_ptr,
                None,
            );
            CoTaskMemFree(Some(fmt_ptr as *const _));
            init?;
            let cap: IAudioCaptureClient = client.GetService()?;
            client.Start()?;

            let mut analyzer = Analyzer::new(rate);
            let mut ring: VecDeque<f32> = VecDeque::from(vec![0.0; FFT_SIZE]);
            let mut last_emit = Instant::now();
            let mut last_check = Instant::now();
            let mut got_data = false;
            let mut idle_frames = 0u32;
            let result = loop {
                if stop.load(Ordering::SeqCst) {
                    break Ok(());
                }
                std::thread::sleep(Duration::from_millis(10));
                let mut failure = None;
                loop {
                    let n = match cap.GetNextPacketSize() {
                        Ok(n) => n,
                        Err(e) => {
                            // e.g. AUDCLNT_E_DEVICE_INVALIDATED: restart on the new device.
                            failure = Some(e);
                            break;
                        }
                    };
                    if n == 0 {
                        break;
                    }
                    let mut data: *mut u8 = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    if cap
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .is_err()
                    {
                        break;
                    }
                    let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                    for f in 0..frames as usize {
                        let mut sum = 0.0f32;
                        if !silent && !data.is_null() {
                            for c in 0..channels {
                                let i = f * channels + c;
                                sum += if is_float && bits == 32 {
                                    *(data as *const f32).add(i)
                                } else if bits == 16 {
                                    *(data as *const i16).add(i) as f32 / 32768.0
                                } else if bits == 32 {
                                    *(data as *const i32).add(i) as f32 / 2_147_483_648.0
                                } else {
                                    0.0
                                };
                            }
                        }
                        ring.push_back(sum / channels as f32);
                    }
                    let _ = cap.ReleaseBuffer(frames);
                    got_data = true;
                }
                if let Some(e) = failure {
                    break Err(e);
                }
                while ring.len() > FFT_SIZE {
                    ring.pop_front();
                }
                if last_emit.elapsed() >= Duration::from_millis(33) {
                    if !got_data {
                        // Loopback delivers nothing while the device is silent: feed silence.
                        let fill = (rate * last_emit.elapsed().as_secs_f32()) as usize;
                        for _ in 0..fill.min(FFT_SIZE) {
                            ring.push_back(0.0);
                        }
                        while ring.len() > FFT_SIZE {
                            ring.pop_front();
                        }
                    }
                    got_data = false;
                    last_emit = Instant::now();
                    let samples: Vec<f32> = ring.iter().copied().collect();
                    let (bands, level) = analyzer.process(&samples);
                    let quiet = level == 0.0 && bands.iter().all(|b| *b == 0.0);
                    if quiet {
                        idle_frames = idle_frames.saturating_add(1);
                    } else {
                        idle_frames = 0;
                    }
                    // Keep emitting briefly after silence starts so listeners see zeros, then stop.
                    if idle_frames < 3 {
                        crate::util::emit("audio-bands", json!({ "bands": bands, "level": level }));
                    }
                }
                if last_check.elapsed() >= Duration::from_secs(3) {
                    last_check = Instant::now();
                    if default_id(&en) != dev_id {
                        break Ok(()); // default output changed → restart on the new device
                    }
                }
            };
            let _ = client.Stop();
            result
        }
    }
}

fn run(stop: Arc<AtomicBool>) {
    #[cfg(windows)]
    while !stop.load(Ordering::SeqCst) {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| capture::run_once(&stop)));
        match r {
            Ok(Ok(())) => {}
            Ok(Err(e)) => crate::khlog!("audio: capture error: {e}"),
            Err(_) => crate::khlog!("audio: capture panicked"),
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    #[cfg(not(windows))]
    let _ = stop;
}

#[tauri::command]
pub async fn audio_set_listening(enabled: bool) -> CmdResult<()> {
    let mut g = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if enabled {
        if g.is_none() {
            let stop = Arc::new(AtomicBool::new(false));
            let s = stop.clone();
            std::thread::Builder::new()
                .name("kh-audio".into())
                .spawn(move || run(s))
                .map_err(|e| e.to_string())?;
            *g = Some(stop);
        }
    } else if let Some(stop) = g.take() {
        stop.store(true, Ordering::SeqCst);
        crate::util::emit(
            "audio-bands",
            json!({ "bands": (vec![0.0f32; BANDS]), "level": 0.0 }),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_lights_the_right_band() {
        let rate = 48_000.0;
        let mut a = Analyzer::new(rate);
        let s: Vec<f32> = (0..FFT_SIZE)
            .map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / rate).sin() * 0.5)
            .collect();
        let mut bands = [0.0; BANDS];
        for _ in 0..10 {
            bands = a.process(&s).0;
        }
        let max = bands
            .iter()
            .cloned()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .unwrap();
        // 1 kHz falls in band 8 (≈ 1.0–1.45 kHz) or its neighbour.
        assert!((7..=8).contains(&max.0), "{bands:?}");
        let silent = vec![0.0; FFT_SIZE];
        for _ in 0..60 {
            bands = a.process(&silent).0;
        }
        assert!(bands.iter().all(|b| *b == 0.0));
    }
}
