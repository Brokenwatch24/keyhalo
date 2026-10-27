//! The remap engine: decides, inside the low-level hook callback, whether a physical event is
//! swallowed, and queues the resulting output for the worker thread. It never blocks: the only
//! lock is the engine mutex, held for microseconds by the hook, the tap-hold timer and
//! `remap_configure`.

use super::codes;
use super::types::{KeyAction, KeyBinding, LayerMode, MacroStep, RemapConfig, RemapPack};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Output produced by the engine, executed in order by the worker thread.
#[derive(Debug)]
pub enum Out {
    KeyDown(String),
    KeyUp(String),
    /// Tap a chord: lift physically-held modifiers, press keys, release them, restore modifiers.
    Chord {
        keys: Vec<String>,
        lift: Vec<String>,
    },
    Text {
        text: String,
        lift: Vec<String>,
    },
    Macro {
        steps: Vec<MacroStep>,
        lift: Vec<String>,
    },
    Launch {
        path: String,
        args: Vec<String>,
    },
    Mouse {
        button: String,
        down: bool,
    },
    MicToggle,
    Emit(&'static str, Value),
    ReleaseAll,
    TapHoldTimer {
        seq: u64,
        ms: u64,
    },
    PauseChanged(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Pass,
    Swallow,
}

/// What to do when a trigger key is released.
#[derive(Debug, Clone)]
enum Release {
    Nothing,
    KeysUp(Vec<String>),
    LayerOff { pack: String, layer: String },
    MouseUp(String),
}

#[derive(Debug, Clone)]
struct Active {
    release: Release,
    /// Key re-sent on auto-repeat (held key remaps).
    repeat_key: Option<String>,
}

#[derive(Debug, Clone)]
struct ActiveLayer {
    pack: String,
    layer: String,
    toggle: bool,
}

#[derive(Debug, Clone)]
struct Pending {
    seq: u64,
    trigger: String,
    ctx: Ctx,
    tap: KeyAction,
    hold: KeyAction,
}

#[derive(Debug, Clone)]
struct Ctx {
    pack: String,
    key: String,
    label: Option<String>,
    /// Physically held modifiers to lift while sending output (bindings with `with`).
    lift: Vec<String>,
}

pub struct Engine {
    config: Option<Arc<RemapConfig>>,
    pub paused: bool,
    /// Physical keys currently down, with the time they went down.
    held: HashMap<String, Instant>,
    triggers: HashMap<String, Active>,
    layers: Vec<ActiveLayer>,
    pending: Option<Pending>,
    seq: u64,
    fg_hwnd: isize,
    fg_process: String,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Engine {
            config: None,
            paused: false,
            held: HashMap::new(),
            triggers: HashMap::new(),
            layers: Vec::new(),
            pending: None,
            seq: 0,
            fg_hwnd: 0,
            fg_process: String::new(),
        }
    }

    pub fn config(&self) -> Option<&Arc<RemapConfig>> {
        self.config.as_ref()
    }

    /// Replaces the configuration and releases everything the engine was holding.
    pub fn set_config(&mut self, config: RemapConfig, out: &mut Vec<Out>) {
        self.reset(out);
        self.config = Some(Arc::new(config.normalize()));
    }

    /// Forgets held triggers, layers and pending tap-holds, and releases synthetic keys.
    pub fn reset(&mut self, out: &mut Vec<Out>) {
        self.triggers.clear();
        self.layers.clear();
        self.pending = None;
        out.push(Out::ReleaseAll);
    }

    pub fn set_paused(&mut self, paused: bool, out: &mut Vec<Out>) {
        if self.paused != paused {
            self.paused = paused;
            self.reset(out);
        }
    }

    pub fn is_held(&self, code: &str) -> bool {
        self.held.contains_key(code)
    }

    /// Tracks physical key state; returns true for auto-repeat downs.
    pub fn track(&mut self, code: &str, down: bool) -> bool {
        if down {
            if self.held.contains_key(code) {
                return true;
            }
            self.prune_stale(code);
            self.held.insert(code.to_string(), Instant::now());
            false
        } else {
            self.held.remove(code);
            false
        }
    }

    /// Drops keys we believe are down but the OS says are up (missed key-ups, e.g. after
    /// Win+L or the UAC secure desktop). Swallowed triggers are skipped: the OS never saw them.
    fn prune_stale(&mut self, current: &str) {
        let now = Instant::now();
        let triggers = &self.triggers;
        self.held.retain(|code, since| {
            if code == current || triggers.contains_key(code) {
                return true;
            }
            if now.duration_since(*since) < Duration::from_millis(1000) {
                return true;
            }
            super::os_key_down(code).unwrap_or(true)
        });
    }

    fn modifier_held(&self, name: &str, except: &str) -> Vec<String> {
        let codes = codes::modifier_codes(name);
        if codes.is_empty() {
            // Allow raw codes in `with` (e.g. "ControlLeft").
            return if name != except && self.held.contains_key(name) {
                vec![name.to_string()]
            } else {
                vec![]
            };
        }
        codes
            .iter()
            .filter(|c| **c != except && self.held.contains_key(**c))
            .map(|c| c.to_string())
            .collect()
    }

    fn with_satisfied(&self, b: &KeyBinding, code: &str) -> bool {
        b.with
            .iter()
            .all(|m| !self.modifier_held(m, code).is_empty())
    }

    /// A binding without `with` that produces new input (text, macro, launch…) only fires when
    /// no Ctrl/Alt/Meta is held, so e.g. Ctrl+F5 still reaches the app when F5 is bound.
    /// Plain remaps (key, layer, tap-hold, mouse, disabled) apply regardless of modifiers.
    fn plain_ok(&self, b: &KeyBinding, code: &str) -> bool {
        if !b.with.is_empty() {
            return true;
        }
        match b.action {
            KeyAction::Key { .. }
            | KeyAction::Layer { .. }
            | KeyAction::TapHold { .. }
            | KeyAction::Mouse { .. }
            | KeyAction::Disabled => true,
            _ => ["Ctrl", "Alt", "Meta"]
                .iter()
                .all(|m| self.modifier_held(m, code).is_empty()),
        }
    }

    fn best<'a>(&self, bindings: &'a [KeyBinding], code: &str) -> Option<&'a KeyBinding> {
        let mut best: Option<&KeyBinding> = None;
        for b in bindings {
            // The most specific match (most `with` modifiers) wins; ties keep the first.
            if b.key == code
                && self.with_satisfied(b, code)
                && self.plain_ok(b, code)
                && best.map(|x| b.with.len() > x.with.len()).unwrap_or(true)
            {
                best = Some(b);
            }
        }
        best
    }

    fn active_packs<'a>(cfg: &'a RemapConfig, process: &str) -> Vec<&'a RemapPack> {
        let matches = |app: &str| {
            app == process || app.trim_end_matches(".exe") == process.trim_end_matches(".exe")
        };
        let mut packs: Vec<&RemapPack> = Vec::new();
        if let Some(p) = cfg.packs.iter().find(|p| p.apps.iter().any(|a| matches(a))) {
            packs.push(p);
        }
        packs.extend(cfg.packs.iter().filter(|p| p.apps.is_empty()));
        packs
    }

    fn find(&self, packs: &[&RemapPack], code: &str) -> Option<(String, KeyBinding)> {
        for al in self.layers.iter().rev() {
            if let Some(pack) = packs.iter().find(|p| p.id == al.pack) {
                if let Some(layer) = pack.layers.iter().find(|l| l.id == al.layer) {
                    if let Some(b) = self.best(&layer.bindings, code) {
                        return Some((pack.id.clone(), b.clone()));
                    }
                }
            }
        }
        for pack in packs {
            if let Some(b) = self.best(&pack.bindings, code) {
                return Some((pack.id.clone(), b.clone()));
            }
        }
        None
    }

    fn foreground(&mut self) -> String {
        let hwnd = super::foreground_hwnd();
        if hwnd != self.fg_hwnd || self.fg_process.is_empty() {
            self.fg_hwnd = hwnd;
            self.fg_process = crate::system::foreground::process_for_hwnd(hwnd)
                .unwrap_or_default()
                .to_lowercase();
        }
        self.fg_process.clone()
    }

    /// Handles a physical event (already tracked with `track`). Returns whether to swallow it.
    pub fn on_key(&mut self, code: &str, down: bool, repeat: bool, out: &mut Vec<Out>) -> Decision {
        // Emergency switch: Ctrl+Alt+Pause toggles remapping, always.
        if down
            && code == "Pause"
            && !self.modifier_held("Ctrl", code).is_empty()
            && !self.modifier_held("Alt", code).is_empty()
        {
            if !repeat {
                let paused = !self.paused;
                self.set_paused(paused, out);
                self.triggers.insert(
                    code.to_string(),
                    Active {
                        release: Release::Nothing,
                        repeat_key: None,
                    },
                );
                out.push(Out::PauseChanged(paused));
                out.push(Out::Emit(
                    "remap-fired",
                    json!({ "packId": "system", "key": "Pause", "label": if paused { "Remapping paused" } else { "Remapping resumed" } }),
                ));
            }
            return Decision::Swallow;
        }

        if !down {
            if let Some(active) = self.triggers.remove(code) {
                self.release(active.release, out);
                return Decision::Swallow;
            }
            if let Some(p) = self.pending.take() {
                if p.trigger == code {
                    // Released before the term: it's a tap.
                    let r = self.press(&p.tap, &p.ctx, out);
                    self.release(r, out);
                    return Decision::Swallow;
                }
                self.pending = Some(p);
            }
            return Decision::Pass;
        }

        if repeat {
            if let Some(active) = self.triggers.get(code) {
                if let Some(k) = &active.repeat_key {
                    out.push(Out::KeyDown(k.clone()));
                }
                return Decision::Swallow;
            }
            if self
                .pending
                .as_ref()
                .map(|p| p.trigger == code)
                .unwrap_or(false)
            {
                return Decision::Swallow;
            }
            return Decision::Pass;
        }

        let cfg = match &self.config {
            Some(c) if c.enabled && !self.paused => c.clone(),
            _ => return Decision::Pass,
        };
        let process = self.foreground();
        if !process.is_empty()
            && cfg.pause_apps.iter().any(|a| {
                *a == process || a.trim_end_matches(".exe") == process.trim_end_matches(".exe")
            })
        {
            return Decision::Pass;
        }

        // Another key pressed while a tap-hold is undecided → it's a hold.
        if let Some(p) = self.pending.take() {
            if p.trigger != code {
                self.resolve_hold(p, out);
            } else {
                self.pending = Some(p);
                return Decision::Swallow;
            }
        }

        let packs = Self::active_packs(&cfg, &process);
        let Some((pack_id, binding)) = self.find(&packs, code) else {
            return Decision::Pass;
        };

        let mut lift: Vec<String> = Vec::new();
        for m in &binding.with {
            lift.extend(self.modifier_held(m, code));
        }
        let ctx = Ctx {
            pack: pack_id,
            key: code.to_string(),
            label: binding.label.clone(),
            lift,
        };

        if let KeyAction::TapHold { tap, hold, term_ms } = &binding.action {
            self.seq += 1;
            let ms = term_ms.unwrap_or(200).clamp(50, 2000);
            self.pending = Some(Pending {
                seq: self.seq,
                trigger: code.to_string(),
                ctx: ctx.clone(),
                tap: (**tap).clone(),
                hold: (**hold).clone(),
            });
            out.push(Out::TapHoldTimer { seq: self.seq, ms });
            return Decision::Swallow;
        }

        self.fire(&binding.action, &ctx, code, out);
        Decision::Swallow
    }

    fn fire(&mut self, action: &KeyAction, ctx: &Ctx, trigger: &str, out: &mut Vec<Out>) {
        let release = self.press(action, ctx, out);
        let repeat_key = match (action, &release) {
            (KeyAction::Key { keys }, Release::KeysUp(_)) => keys.last().cloned(),
            _ => None,
        };
        self.triggers.insert(
            trigger.to_string(),
            Active {
                release,
                repeat_key,
            },
        );
    }

    fn resolve_hold(&mut self, p: Pending, out: &mut Vec<Out>) {
        let trigger = p.trigger.clone();
        let hold = p.hold.clone();
        self.fire(&hold, &p.ctx, &trigger, out);
    }

    /// Called by the tap-hold timer thread.
    pub fn on_taphold_timeout(&mut self, seq: u64, out: &mut Vec<Out>) {
        if let Some(p) = self.pending.take() {
            if p.seq == seq {
                self.resolve_hold(p, out);
            } else {
                self.pending = Some(p);
            }
        }
    }

    fn emit_fired(&self, ctx: &Ctx, action: Option<&KeyAction>, out: &mut Vec<Out>) {
        let mut v = json!({ "packId": ctx.pack, "key": ctx.key });
        if let Some(l) = &ctx.label {
            v["label"] = json!(l);
        }
        if let Some(a) = action {
            v["action"] = serde_json::to_value(a).unwrap_or(Value::Null);
        }
        out.push(Out::Emit("remap-fired", v));
    }

    /// Performs the "press" half of an action and returns what to do on release.
    fn press(&mut self, action: &KeyAction, ctx: &Ctx, out: &mut Vec<Out>) -> Release {
        // A tap-hold nested inside another tap-hold behaves as its tap action (reported as such).
        if let KeyAction::TapHold { tap, .. } = action {
            let tap = (**tap).clone();
            return self.press(&tap, ctx, out);
        }
        // `remap-fired` is emitted on press only. Only dpi/profile need the frontend, so only
        // they carry `action` (always the resolved action, never a tapHold wrapper).
        let needs_frontend = matches!(action, KeyAction::Dpi { .. } | KeyAction::Profile { .. });
        self.emit_fired(ctx, if needs_frontend { Some(action) } else { None }, out);

        match action {
            KeyAction::Key { keys } => {
                if keys.is_empty() {
                    return Release::Nothing;
                }
                if ctx.lift.is_empty() {
                    for k in keys {
                        out.push(Out::KeyDown(k.clone()));
                    }
                    Release::KeysUp(keys.iter().rev().cloned().collect())
                } else {
                    let lift = ctx
                        .lift
                        .iter()
                        .filter(|m| !keys.contains(m))
                        .cloned()
                        .collect();
                    out.push(Out::Chord {
                        keys: keys.clone(),
                        lift,
                    });
                    Release::Nothing
                }
            }
            KeyAction::Text { text } => {
                out.push(Out::Text {
                    text: text.clone(),
                    lift: ctx.lift.clone(),
                });
                Release::Nothing
            }
            KeyAction::Macro { steps } => {
                out.push(Out::Macro {
                    steps: steps.clone(),
                    lift: ctx.lift.clone(),
                });
                Release::Nothing
            }
            KeyAction::Launch { path, args } => {
                out.push(Out::Launch {
                    path: path.clone(),
                    args: args.clone(),
                });
                Release::Nothing
            }
            KeyAction::Layer { layer, mode } => match mode {
                LayerMode::Hold => {
                    self.layers.push(ActiveLayer {
                        pack: ctx.pack.clone(),
                        layer: layer.clone(),
                        toggle: false,
                    });
                    Release::LayerOff {
                        pack: ctx.pack.clone(),
                        layer: layer.clone(),
                    }
                }
                LayerMode::Toggle => {
                    if let Some(i) = self
                        .layers
                        .iter()
                        .position(|l| l.toggle && l.pack == ctx.pack && &l.layer == layer)
                    {
                        self.layers.remove(i);
                    } else {
                        self.layers.push(ActiveLayer {
                            pack: ctx.pack.clone(),
                            layer: layer.clone(),
                            toggle: true,
                        });
                    }
                    Release::Nothing
                }
            },
            KeyAction::TapHold { .. } => Release::Nothing, // handled above
            KeyAction::Mouse { button } => {
                out.push(Out::Mouse {
                    button: button.clone(),
                    down: true,
                });
                Release::MouseUp(button.clone())
            }
            KeyAction::Media { command } => {
                let code = match command.as_str() {
                    "playPause" => "MediaPlayPause",
                    "next" => "MediaTrackNext",
                    "prev" => "MediaTrackPrevious",
                    "volumeUp" => "AudioVolumeUp",
                    "volumeDown" => "AudioVolumeDown",
                    "mute" => "AudioVolumeMute",
                    "micMute" => {
                        out.push(Out::MicToggle);
                        return Release::Nothing;
                    }
                    _ => return Release::Nothing,
                };
                out.push(Out::Chord {
                    keys: vec![code.to_string()],
                    lift: vec![],
                });
                Release::Nothing
            }
            // Sniper DPI ends on the trigger's `input-key` up event, handled by the frontend.
            KeyAction::Dpi { .. }
            | KeyAction::Profile { .. }
            | KeyAction::Disabled
            | KeyAction::Unknown => Release::Nothing,
        }
    }

    fn release(&mut self, r: Release, out: &mut Vec<Out>) {
        match r {
            Release::Nothing => {}
            Release::KeysUp(keys) => {
                for k in keys {
                    out.push(Out::KeyUp(k));
                }
            }
            Release::LayerOff { pack, layer } => {
                if let Some(i) = self
                    .layers
                    .iter()
                    .rposition(|l| !l.toggle && l.pack == pack && l.layer == layer)
                {
                    self.layers.remove(i);
                }
            }
            Release::MouseUp(button) => out.push(Out::Mouse {
                button,
                down: false,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(json: &str) -> RemapConfig {
        serde_json::from_str(json).unwrap()
    }

    fn key(e: &mut Engine, code: &str, down: bool, out: &mut Vec<Out>) -> Decision {
        let rep = e.track(code, down);
        e.on_key(code, down, rep, out)
    }

    #[test]
    fn remaps_and_layers() {
        let mut e = Engine::new();
        let mut out = vec![];
        e.set_config(
            cfg(r#"{"enabled":true,"pauseApps":[],"packs":[{"id":"g","apps":[],"bindings":[
                {"key":"CapsLock","action":{"type":"key","keys":["Escape"]}},
                {"key":"F13","action":{"type":"layer","layer":"nav","mode":"hold"}},
                {"key":"KeyJ","with":["Ctrl"],"action":{"type":"text","text":"x"}}
            ],"layers":[{"id":"nav","name":"Nav","bindings":[{"key":"KeyH","action":{"type":"key","keys":["ArrowLeft"]}}]}]}]}"#),
            &mut out,
        );
        out.clear();
        assert_eq!(key(&mut e, "CapsLock", true, &mut out), Decision::Swallow);
        assert!(matches!(&out[1], Out::KeyDown(k) if k == "Escape"));
        out.clear();
        assert_eq!(key(&mut e, "CapsLock", false, &mut out), Decision::Swallow);
        assert!(matches!(&out[0], Out::KeyUp(k) if k == "Escape"));

        out.clear();
        assert_eq!(key(&mut e, "KeyH", true, &mut out), Decision::Pass);
        key(&mut e, "KeyH", false, &mut out);
        key(&mut e, "F13", true, &mut out);
        out.clear();
        assert_eq!(key(&mut e, "KeyH", true, &mut out), Decision::Swallow);
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyDown(k) if k == "ArrowLeft")));
        key(&mut e, "KeyH", false, &mut out);
        key(&mut e, "F13", false, &mut out);
        assert_eq!(key(&mut e, "KeyH", true, &mut out), Decision::Pass);
        key(&mut e, "KeyH", false, &mut out);

        // `with` modifiers
        assert_eq!(key(&mut e, "KeyJ", true, &mut out), Decision::Pass);
        key(&mut e, "KeyJ", false, &mut out);
        key(&mut e, "ControlLeft", true, &mut out);
        out.clear();
        assert_eq!(key(&mut e, "KeyJ", true, &mut out), Decision::Swallow);
        assert!(out.iter().any(
            |o| matches!(o, Out::Text { lift, .. } if lift == &vec!["ControlLeft".to_string()])
        ));
    }

    #[test]
    fn tap_hold_and_emergency() {
        let mut e = Engine::new();
        let mut out = vec![];
        e.set_config(
            cfg(r#"{"enabled":true,"packs":[{"id":"g","apps":[],"bindings":[
                {"key":"Space","action":{"type":"tapHold","tap":{"type":"key","keys":["Space"]},"hold":{"type":"key","keys":["ShiftLeft"]}}}
            ]}]}"#),
            &mut out,
        );
        out.clear();
        key(&mut e, "Space", true, &mut out);
        assert!(matches!(out[0], Out::TapHoldTimer { .. }));
        out.clear();
        key(&mut e, "Space", false, &mut out);
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyDown(k) if k == "Space")));
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyUp(k) if k == "Space")));

        // interrupted → hold
        out.clear();
        key(&mut e, "Space", true, &mut out);
        out.clear();
        assert_eq!(key(&mut e, "KeyA", true, &mut out), Decision::Pass);
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyDown(k) if k == "ShiftLeft")));
        key(&mut e, "KeyA", false, &mut out);
        out.clear();
        key(&mut e, "Space", false, &mut out);
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyUp(k) if k == "ShiftLeft")));

        // timeout → hold
        out.clear();
        key(&mut e, "Space", true, &mut out);
        let seq = match out[0] {
            Out::TapHoldTimer { seq, .. } => seq,
            _ => panic!(),
        };
        out.clear();
        e.on_taphold_timeout(seq, &mut out);
        assert!(out
            .iter()
            .any(|o| matches!(o, Out::KeyDown(k) if k == "ShiftLeft")));
        key(&mut e, "Space", false, &mut out);

        // emergency pause
        key(&mut e, "ControlLeft", true, &mut out);
        key(&mut e, "AltLeft", true, &mut out);
        assert_eq!(key(&mut e, "Pause", true, &mut out), Decision::Swallow);
        assert!(e.paused);
        assert_eq!(key(&mut e, "Pause", false, &mut out), Decision::Swallow);
        key(&mut e, "ControlLeft", false, &mut out);
        key(&mut e, "AltLeft", false, &mut out);
        assert_eq!(key(&mut e, "Space", true, &mut out), Decision::Pass);
    }
}
