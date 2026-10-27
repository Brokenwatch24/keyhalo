//! One-click Claude Code connection: adds (or removes) KeyHalo's hooks in the user's
//! `~/.claude/settings.json`, keeping every other setting and hook untouched. The hooks call the
//! local API with curl (built into Windows 10+), so the optional CLI is not needed.

use crate::util::{blocking, err, CmdResult};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Marker header that identifies KeyHalo's hook commands.
const MARKER: &str = "X-KeyHalo-Hook: 1";

/// Claude Code hook event → KeyHalo Claude state.
const EVENTS: [(&str, &str); 5] = [
    ("UserPromptSubmit", "working"),
    ("PreToolUse", "working"),
    ("Notification", "waiting"),
    ("Stop", "done"),
    ("SessionEnd", "idle"),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    pub installed: bool,
    pub path: String,
    /// Backup written before the first change, if any.
    pub backup: Option<String>,
}

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("home folder not found")?;
    Ok(PathBuf::from(home).join(".claude").join("settings.json"))
}

fn hook_command(state: &str, port: u16, token: &str) -> String {
    let auth = if token.is_empty() {
        String::new()
    } else {
        format!(" -H \"Authorization: Bearer {token}\"")
    };
    // Works in cmd and bash; `|| exit 0` keeps Claude Code quiet when KeyHalo is closed.
    format!(
        "curl -s -m 2 -X POST http://127.0.0.1:{port}/api/v1/action -H \"{MARKER}\" -H \"Content-Type: application/json\"{auth} -d \"{{\\\"action\\\":\\\"claude\\\",\\\"params\\\":{{\\\"state\\\":\\\"{state}\\\"}}}}\" || exit 0"
    )
}

fn is_ours(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(MARKER) || c.trim_start().starts_with("keyhalo claude "))
}

/// Removes KeyHalo hooks; drops groups and events left empty.
fn strip(hooks: &mut Map<String, Value>) {
    for (_, groups) in hooks.iter_mut() {
        if let Some(list) = groups.as_array_mut() {
            for g in list.iter_mut() {
                if let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                    hs.retain(|h| !is_ours(h));
                }
            }
            list.retain(|g| g.get("hooks").and_then(Value::as_array).map_or(true, |h| !h.is_empty()));
        }
    }
    hooks.retain(|_, v| v.as_array().map_or(true, |a| !a.is_empty()));
}

fn installed_in(root: &Value) -> bool {
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    EVENTS.iter().all(|(event, _)| {
        hooks
            .get(*event)
            .and_then(Value::as_array)
            .is_some_and(|groups| groups.iter().any(|g| g.get("hooks").and_then(Value::as_array).is_some_and(|hs| hs.iter().any(is_ours))))
    })
}

fn read(path: &Path) -> Result<Value, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(json!({})),
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON ({e}); fix it first", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(err(e)),
    }
}

/// Applies `install` / `remove` to the settings at `path`; returns the new status.
pub fn apply(path: &Path, action: &str, port: u16, token: &str) -> Result<HooksStatus, String> {
    let mut root = read(path)?;
    let mut backup = None;
    if action == "install" || action == "remove" {
        if !root.is_object() {
            return Err(format!("{} must contain a JSON object", path.display()));
        }
        if path.exists() {
            let b = path.with_extension("json.keyhalo-backup");
            if !b.exists() {
                std::fs::copy(path, &b).map_err(err)?;
            }
            backup = Some(b.display().to_string());
        }
        let obj = root.as_object_mut().unwrap();
        let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
        if !hooks.is_object() {
            return Err("\"hooks\" in Claude Code settings is not an object".into());
        }
        let map = hooks.as_object_mut().unwrap();
        strip(map);
        if action == "install" {
            for (event, state) in EVENTS {
                let list = map.entry(event).or_insert_with(|| json!([]));
                if let Some(arr) = list.as_array_mut() {
                    arr.push(json!({ "hooks": [{ "type": "command", "command": hook_command(state, port, token), "timeout": 5 }] }));
                }
            }
        }
        if map.is_empty() {
            obj.remove("hooks");
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        let text = serde_json::to_string_pretty(&root).map_err(err)?;
        std::fs::write(path, text + "\n").map_err(err)?;
    }
    Ok(HooksStatus { installed: installed_in(&root), path: path.display().to_string(), backup })
}

/// `action`: "status" | "install" | "remove".
#[tauri::command]
pub async fn claude_hooks(action: String, port: u16, token: Option<String>) -> CmdResult<HooksStatus> {
    blocking(move || apply(&settings_path()?, &action, port, token.as_deref().unwrap_or(""))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, contents: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("keyhalo-hooks-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        if let Some(c) = contents {
            std::fs::write(&p, c).unwrap();
        }
        p
    }

    #[test]
    fn install_keeps_other_settings_and_hooks_then_remove_restores_them() {
        let original = r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"node other.mjs stop"}]}]}}"#;
        let p = temp("merge", Some(original));
        let s = apply(&p, "install", 27463, "").unwrap();
        assert!(s.installed);
        assert!(s.backup.is_some());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["model"], "opus");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["hooks"][0]["command"], "node other.mjs stop");
        // Installing twice does not duplicate.
        apply(&p, "install", 27463, "").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);

        let s = apply(&p, "remove", 27463, "").unwrap();
        assert!(!s.installed);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let back: Value = serde_json::from_str(original).unwrap();
        assert_eq!(v, back);
    }

    #[test]
    fn creates_the_file_and_replaces_old_cli_hooks() {
        let p = temp("new", None);
        assert!(!apply(&p, "status", 27463, "").unwrap().installed);
        assert!(apply(&p, "install", 1234, "tok").unwrap().installed);
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("127.0.0.1:1234"));
        assert!(text.contains("Bearer tok"));

        let p = temp("cli", Some(r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"keyhalo claude done"}]}]}}"#));
        apply(&p, "install", 27463, "").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert!(stop[0]["hooks"][0]["command"].as_str().unwrap().contains(MARKER));
    }

    #[test]
    fn hook_command_sends_valid_json() {
        let c = hook_command("waiting", 27463, "");
        let body = c.split(" -d \"").nth(1).unwrap().split("\" ||").next().unwrap().replace("\\\"", "\"");
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["params"]["state"], "waiting");
    }

    #[test]
    fn refuses_invalid_json() {
        let p = temp("bad", Some("{ not json"));
        assert!(apply(&p, "install", 27463, "").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{ not json");
    }
}
