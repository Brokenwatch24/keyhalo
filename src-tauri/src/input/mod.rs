//! Global input engine: low-level keyboard/mouse hooks, input statistics events and the remap
//! engine.
//!
//! Threads:
//!  - `kh-input-hook`: owns WH_KEYBOARD_LL / WH_MOUSE_LL and a message loop. Hooks are only
//!    installed while needed (listening or an active remap config) so KeyHalo adds zero
//!    latency otherwise. The callbacks only classify the event, ask the engine for a decision
//!    and push work to channels — they never block.
//!  - `kh-input-out`: executes engine output (SendInput, launch, emits) in order.
//!  - `kh-input-events`: turns raw events into `input-key` / aggregated `input-mouse` events.

pub mod codes;
pub mod engine;
pub mod send;
pub mod types;

use crate::util::{blocking, err, CmdResult};
use engine::{Decision, Engine, Out};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{LazyLock, Mutex, MutexGuard, OnceLock};
use std::time::Duration;
use types::{MacroStep, RemapConfig};

static ENGINE: LazyLock<Mutex<Engine>> = LazyLock::new(|| Mutex::new(Engine::new()));
static LISTENING: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
static OUT_TX: OnceLock<Mutex<Sender<Out>>> = OnceLock::new();
static EVT_TX: OnceLock<Mutex<Sender<KeyEvt>>> = OnceLock::new();
/// Mouse travel in 1/1000 px and click count since the last `input-mouse` sample.
static MOUSE_DIST_MILLI: AtomicU64 = AtomicU64::new(0);
static MOUSE_CLICKS: AtomicU32 = AtomicU32::new(0);

struct KeyEvt {
    code: &'static str,
    down: bool,
    t: f64,
    synthetic: bool,
}

pub(crate) fn engine() -> MutexGuard<'static, Engine> {
    ENGINE.lock().unwrap_or_else(|e| e.into_inner())
}

fn out_tx() -> &'static Mutex<Sender<Out>> {
    OUT_TX.get_or_init(|| {
        let (tx, rx) = channel::<Out>();
        std::thread::Builder::new()
            .name("kh-input-out".into())
            .spawn(move || {
                #[cfg(windows)]
                crate::util::com_init();
                while let Ok(o) = rx.recv() {
                    // A failing action must never kill the worker.
                    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| execute(o)));
                    if r.is_err() {
                        crate::khlog!("input: action panicked");
                    }
                }
            })
            .expect("spawn input worker");
        Mutex::new(tx)
    })
}

pub(crate) fn dispatch(outs: Vec<Out>) {
    if outs.is_empty() {
        return;
    }
    let tx = out_tx().lock().unwrap_or_else(|e| e.into_inner());
    for o in outs {
        let _ = tx.send(o);
    }
}

fn lift(mods: &[String]) {
    for m in mods {
        send::key_untracked(m, false);
    }
}

fn restore(mods: &[String]) {
    if mods.is_empty() {
        return;
    }
    let still: Vec<String> = {
        let e = engine();
        mods.iter().filter(|m| e.is_held(m)).cloned().collect()
    };
    for m in still {
        send::key_untracked(&m, true);
    }
}

fn execute(o: Out) {
    match o {
        Out::KeyDown(k) => send::key(&k, true),
        Out::KeyUp(k) => send::key(&k, false),
        Out::Chord { keys, lift: mods } => {
            lift(&mods);
            for k in &keys {
                send::key(k, true);
            }
            std::thread::sleep(Duration::from_millis(6));
            for k in keys.iter().rev() {
                send::key(k, false);
            }
            restore(&mods);
        }
        Out::Text { text, lift: mods } => {
            lift(&mods);
            send::text(&text);
            restore(&mods);
        }
        Out::Macro { steps, lift: mods } => {
            let _ = std::thread::Builder::new()
                .name("kh-macro".into())
                .spawn(move || {
                    lift(&mods);
                    send::run_macro(&steps);
                    restore(&mods);
                });
        }
        Out::Launch { path, args } => launch(&path, &args),
        Out::Mouse { button, down } => send::mouse_button(&button, down),
        Out::MicToggle => {
            // The binding's own `remap-fired` was already emitted on press.
            #[cfg(windows)]
            if let Err(e) =
                crate::system::mic::get_muted().and_then(|m| crate::system::mic::set_muted(!m))
            {
                crate::khlog!("input: mic toggle failed: {e}");
            }
        }
        Out::Emit(event, payload) => crate::util::emit(event, payload),
        Out::ReleaseAll => send::release_all(),
        Out::TapHoldTimer { seq, ms } => {
            let _ = std::thread::Builder::new()
                .name("kh-taphold".into())
                .spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    let mut outs = Vec::new();
                    engine().on_taphold_timeout(seq, &mut outs);
                    dispatch(outs);
                });
        }
        Out::PauseChanged(paused) => {
            send::GENERATION.fetch_add(1, Ordering::SeqCst);
            crate::shell::tray_sync_pause(paused);
        }
    }
}

fn launch(path: &str, args: &[String]) {
    let mut cmd = std::process::Command::new(path);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Err(e) = cmd.spawn() {
        // Not an executable (document, folder, URL, .lnk…): let the shell open it.
        if args.is_empty() {
            if let Err(e2) = crate::system::open_with_shell(path) {
                crate::khlog!("input: launch {path} failed: {e}; open failed: {e2}");
            }
        } else {
            crate::khlog!("input: launch {path} failed: {e}");
        }
    }
}

fn evt_tx() -> &'static Mutex<Sender<KeyEvt>> {
    EVT_TX.get_or_init(|| {
        let (tx, rx) = channel::<KeyEvt>();
        std::thread::Builder::new()
            .name("kh-input-events".into())
            .spawn(move || {
                let mut last_mouse = std::time::Instant::now();
                loop {
                    match rx.recv_timeout(Duration::from_millis(25)) {
                        Ok(e) => crate::util::emit(
                            "input-key",
                            json!({ "code": e.code, "down": e.down, "t": e.t, "synthetic": e.synthetic }),
                        ),
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                        Err(_) => break,
                    }
                    if last_mouse.elapsed() >= Duration::from_millis(100) {
                        last_mouse = std::time::Instant::now();
                        let d = MOUSE_DIST_MILLI.swap(0, Ordering::Relaxed);
                        let c = MOUSE_CLICKS.swap(0, Ordering::Relaxed);
                        if (d > 0 || c > 0) && LISTENING.load(Ordering::Relaxed) {
                            crate::util::emit(
                                "input-mouse",
                                json!({ "distance": d as f64 / 1000.0, "clicks": c, "t": crate::util::now_ms() }),
                            );
                        }
                    }
                }
            })
            .expect("spawn input events");
        Mutex::new(tx)
    })
}

fn push_key_event(code: &'static str, down: bool, synthetic: bool) {
    if LISTENING.load(Ordering::Relaxed) {
        send_key_event(code, down, synthetic);
    }
}

/// Queues an `input-key` event regardless of listening. Used for the key-up of a swallowed
/// trigger: the frontend ends hold actions it performs itself (dpi sniper) on that key-up.
fn send_key_event(code: &'static str, down: bool, synthetic: bool) {
    if let Ok(tx) = evt_tx().try_lock() {
        let _ = tx.send(KeyEvt {
            code,
            down,
            t: crate::util::now_ms(),
            synthetic,
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Windows hooks
// ---------------------------------------------------------------------------------------------

#[cfg(windows)]
mod hook {
    use super::*;
    use std::cell::Cell;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::*;

    pub const WM_APP_REFRESH: u32 = WM_APP + 1;

    thread_local! {
        static KB: Cell<isize> = const { Cell::new(0) };
        static MOUSE: Cell<isize> = const { Cell::new(0) };
        static LAST_PT: Cell<Option<(i32, i32)>> = const { Cell::new(None) };
    }

    fn next(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe { CallNextHookEx(None, ncode, wparam, lparam) }
    }

    unsafe extern "system" fn kb_proc(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if ncode != HC_ACTION as i32 {
            return next(ncode, wparam, lparam);
        }
        let kb = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let swallow =
            std::panic::catch_unwind(|| on_keyboard(kb, wparam.0 as u32)).unwrap_or(false);
        if swallow {
            LRESULT(1)
        } else {
            next(ncode, wparam, lparam)
        }
    }

    fn on_keyboard(kb: &KBDLLHOOKSTRUCT, msg: u32) -> bool {
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let extended = kb.flags.0 & LLKHF_EXTENDED.0 != 0;
        let Some(code) = codes::code_from_event(kb.vkCode, kb.scanCode, extended) else {
            return false;
        };
        if kb.dwExtraInfo == send::SIGNATURE {
            push_key_event(code, down, true);
            return false;
        }
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        let mut outs = Vec::new();
        let decision = {
            let mut e = engine();
            let repeat = e.track(code, down);
            if !repeat {
                push_key_event(code, down, false);
            }
            if injected {
                // Input injected by other software is reported but never remapped.
                Decision::Pass
            } else {
                e.on_key(code, down, repeat, &mut outs)
            }
        };
        dispatch(outs);
        if !down && decision == Decision::Swallow && !LISTENING.load(Ordering::Relaxed) {
            send_key_event(code, false, false);
        }
        decision == Decision::Swallow
    }

    unsafe extern "system" fn mouse_proc(ncode: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if ncode != HC_ACTION as i32 {
            return next(ncode, wparam, lparam);
        }
        let ms = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let swallow = std::panic::catch_unwind(|| on_mouse(ms, wparam.0 as u32)).unwrap_or(false);
        if swallow {
            LRESULT(1)
        } else {
            next(ncode, wparam, lparam)
        }
    }

    fn on_mouse(ms: &MSLLHOOKSTRUCT, msg: u32) -> bool {
        if ms.dwExtraInfo == send::SIGNATURE {
            return false;
        }
        let listening = LISTENING.load(Ordering::Relaxed);
        match msg {
            WM_MOUSEMOVE => {
                if listening {
                    let p = (ms.pt.x, ms.pt.y);
                    if let Some(last) = LAST_PT.get() {
                        let (dx, dy) = ((p.0 - last.0) as f64, (p.1 - last.1) as f64);
                        let d = (dx * dx + dy * dy).sqrt();
                        if d < 10_000.0 {
                            MOUSE_DIST_MILLI.fetch_add((d * 1000.0) as u64, Ordering::Relaxed);
                        }
                    }
                    LAST_PT.set(Some(p));
                }
                false
            }
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
                if listening {
                    MOUSE_CLICKS.fetch_add(1, Ordering::Relaxed);
                }
                false
            }
            WM_XBUTTONDOWN | WM_XBUTTONUP => {
                let down = msg == WM_XBUTTONDOWN;
                if down && listening {
                    MOUSE_CLICKS.fetch_add(1, Ordering::Relaxed);
                }
                let code: &'static str = match (ms.mouseData >> 16) & 0xFFFF {
                    1 => "Mouse4",
                    2 => "Mouse5",
                    _ => return false,
                };
                if ms.flags & LLMHF_INJECTED != 0 {
                    return false;
                }
                let mut outs = Vec::new();
                let decision = {
                    let mut e = engine();
                    let repeat = e.track(code, down);
                    if !repeat {
                        push_key_event(code, down, false);
                    }
                    e.on_key(code, down, repeat, &mut outs)
                };
                dispatch(outs);
                if !down && decision == Decision::Swallow && !LISTENING.load(Ordering::Relaxed) {
                    send_key_event(code, false, false);
                }
                decision == Decision::Swallow
            }
            _ => false,
        }
    }

    fn wanted() -> (bool, bool) {
        let listening = LISTENING.load(Ordering::Relaxed);
        let e = engine();
        let (remap, mouse_remap) = match e.config() {
            Some(c) if c.is_active() => (true, c.uses_mouse_triggers()),
            _ => (false, false),
        };
        (listening || remap, listening || mouse_remap)
    }

    fn apply() {
        let (want_kb, want_mouse) = wanted();
        let hmod = unsafe { GetModuleHandleW(None) }
            .map(|h| HINSTANCE(h.0))
            .ok();
        KB.with(|kb| {
            if want_kb && kb.get() == 0 {
                match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_proc), hmod, 0) } {
                    Ok(h) => kb.set(h.0 as isize),
                    Err(e) => crate::khlog!("input: keyboard hook failed: {e}"),
                }
            } else if !want_kb && kb.get() != 0 {
                unsafe {
                    let _ = UnhookWindowsHookEx(HHOOK(kb.get() as *mut _));
                }
                kb.set(0);
            }
        });
        MOUSE.with(|m| {
            if want_mouse && m.get() == 0 {
                LAST_PT.set(None);
                match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hmod, 0) } {
                    Ok(h) => m.set(h.0 as isize),
                    Err(e) => crate::khlog!("input: mouse hook failed: {e}"),
                }
            } else if !want_mouse && m.get() != 0 {
                unsafe {
                    let _ = UnhookWindowsHookEx(HHOOK(m.get() as *mut _));
                }
                m.set(0);
            }
        });
    }

    pub fn ensure_thread() {
        if HOOK_THREAD.load(Ordering::SeqCst) != 0 {
            return;
        }
        static STARTED: std::sync::Once = std::sync::Once::new();
        STARTED.call_once(|| {
            let (ready_tx, ready_rx) = channel::<()>();
            let _ = std::thread::Builder::new()
                .name("kh-input-hook".into())
                .spawn(move || unsafe {
                    let mut msg = MSG::default();
                    // Creates the thread's message queue before publishing the thread id.
                    let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                    HOOK_THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
                    let _ = ready_tx.send(());
                    apply();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        if msg.message == WM_APP_REFRESH {
                            apply();
                            continue;
                        }
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                });
            let _ = ready_rx.recv_timeout(Duration::from_secs(2));
        });
    }

    pub fn refresh() {
        ensure_thread();
        let tid = HOOK_THREAD.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_APP_REFRESH, WPARAM(0), LPARAM(0));
            }
        }
    }
}

#[cfg(windows)]
pub(crate) fn foreground_hwnd() -> isize {
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow().0 as isize }
}

#[cfg(not(windows))]
pub(crate) fn foreground_hwnd() -> isize {
    0
}

/// Physical/OS state of a key via GetAsyncKeyState (None when unknown).
#[cfg(windows)]
pub(crate) fn os_key_down(code: &str) -> Option<bool> {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    let vk = match code {
        "Mouse4" => 0x05,
        "Mouse5" => 0x06,
        _ => codes::lookup(code)?.1,
    };
    if vk == 0 {
        return None;
    }
    Some(unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000 != 0)
}

#[cfg(not(windows))]
pub(crate) fn os_key_down(_code: &str) -> Option<bool> {
    None
}

fn refresh_hooks() {
    #[cfg(windows)]
    hook::refresh();
}

/// Pauses/resumes remapping (tray menu, emergency combo). Releases anything held.
pub fn set_paused(paused: bool) {
    let mut outs = Vec::new();
    engine().set_paused(paused, &mut outs);
    send::GENERATION.fetch_add(1, Ordering::SeqCst);
    dispatch(outs);
}

pub fn is_paused() -> bool {
    engine().paused
}

/// Releases every synthetic key (app exit).
pub fn shutdown() {
    send::GENERATION.fetch_add(1, Ordering::SeqCst);
    send::release_all();
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn input_set_listening(enabled: bool) -> CmdResult<()> {
    LISTENING.store(enabled, Ordering::SeqCst);
    if enabled {
        let _ = evt_tx();
    }
    refresh_hooks();
    Ok(())
}

#[tauri::command]
pub async fn remap_configure(config: serde_json::Value) -> CmdResult<()> {
    let config: RemapConfig =
        serde_json::from_value(config).map_err(|e| format!("invalid remap config: {e}"))?;
    let mut outs = Vec::new();
    engine().set_config(config, &mut outs);
    send::GENERATION.fetch_add(1, Ordering::SeqCst);
    dispatch(outs);
    refresh_hooks();
    Ok(())
}

#[tauri::command]
pub async fn input_send(steps: Vec<MacroStep>) -> CmdResult<()> {
    blocking(move || {
        send::run_macro(&steps);
        Ok(())
    })
    .await
    .map_err(err)
}
