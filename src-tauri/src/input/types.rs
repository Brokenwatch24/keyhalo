//! Serde mirrors of the keymap types in `src/core/types.ts` and `RemapConfig` in `api.ts`.
//! Unknown action/step types deserialize to `Unknown` so one bad binding never rejects a config.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum KeyAction {
    Key {
        keys: Vec<String>,
    },
    Text {
        text: String,
    },
    Macro {
        steps: Vec<MacroStep>,
    },
    Launch {
        path: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        args: Vec<String>,
    },
    Layer {
        layer: String,
        mode: LayerMode,
    },
    TapHold {
        tap: Box<KeyAction>,
        hold: Box<KeyAction>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        term_ms: Option<u64>,
    },
    Mouse {
        button: String,
    },
    Dpi {
        mode: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<f64>,
    },
    Profile {
        profile_id: String,
    },
    Media {
        command: String,
    },
    Disabled,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LayerMode {
    Hold,
    Toggle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum MacroStep {
    Down {
        key: String,
    },
    Up {
        key: String,
    },
    Tap {
        key: String,
    },
    Delay {
        ms: u64,
    },
    Text {
        text: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub key: String,
    #[serde(default)]
    pub with: Vec<String>,
    pub action: KeyAction,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeymapLayer {
    pub id: String,
    #[serde(default)]
    pub bindings: Vec<KeyBinding>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemapPack {
    pub id: String,
    #[serde(default)]
    pub apps: Vec<String>,
    #[serde(default)]
    pub bindings: Vec<KeyBinding>,
    #[serde(default)]
    pub layers: Vec<KeymapLayer>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemapConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub pause_apps: Vec<String>,
    #[serde(default)]
    pub packs: Vec<RemapPack>,
}

impl RemapConfig {
    /// Lower-cases app names so matching is case-insensitive.
    pub fn normalize(mut self) -> Self {
        for a in &mut self.pause_apps {
            *a = a.to_lowercase();
        }
        for p in &mut self.packs {
            for a in &mut p.apps {
                *a = a.to_lowercase();
            }
        }
        self
    }

    pub fn is_active(&self) -> bool {
        self.enabled
            && self
                .packs
                .iter()
                .any(|p| !p.bindings.is_empty() || !p.layers.is_empty())
    }

    /// True when any binding is triggered by a mouse button (needs the mouse hook).
    pub fn uses_mouse_triggers(&self) -> bool {
        self.packs.iter().any(|p| {
            p.bindings.iter().any(|b| b.key.starts_with("Mouse"))
                || p.layers
                    .iter()
                    .any(|l| l.bindings.iter().any(|b| b.key.starts_with("Mouse")))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_actions() {
        let json = r#"{"enabled":true,"pauseApps":["Valorant.exe"],"packs":[{"id":"p","apps":[],"bindings":[
            {"key":"CapsLock","action":{"type":"key","keys":["Escape"]}},
            {"key":"F13","with":["Ctrl"],"action":{"type":"tapHold","tap":{"type":"text","text":"hi"},"hold":{"type":"layer","layer":"nav","mode":"hold"},"termMs":180}},
            {"key":"F14","action":{"type":"profile","profileId":"x"}},
            {"key":"F15","action":{"type":"somethingNew","foo":1}},
            {"key":"Mouse4","action":{"type":"macro","steps":[{"op":"tap","key":"KeyA"},{"op":"delay","ms":5},{"op":"weird"}]}}
        ],"layers":[{"id":"nav","name":"Nav","bindings":[]}]}]}"#;
        let c: RemapConfig = serde_json::from_str(json).unwrap();
        let c = c.normalize();
        assert_eq!(c.pause_apps, vec!["valorant.exe"]);
        assert!(c.uses_mouse_triggers());
        assert_eq!(c.packs[0].bindings[3].action, KeyAction::Unknown);
        let v = serde_json::to_value(&c.packs[0].bindings[2].action).unwrap();
        assert_eq!(v["profileId"], "x");
        match &c.packs[0].bindings[1].action {
            KeyAction::TapHold { term_ms, .. } => assert_eq!(*term_ms, Some(180)),
            _ => panic!(),
        }
    }
}
