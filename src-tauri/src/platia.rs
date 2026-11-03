//! Platia GO's desktop app on this PC: its loopback API (tasks, approvals, synced to-dos), read
//! from the local-api.json it writes in its app data (only this user can read it).

use crate::util::{blocking, CmdResult};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatiaConfig {
    pub port: u16,
    pub token: String,
}

fn parse(text: &str) -> Option<PlatiaConfig> {
    let v: Value = serde_json::from_str(text).ok()?;
    let token = v.get("token")?.as_str()?.to_string();
    if token.len() < 32 {
        return None;
    }
    Some(PlatiaConfig { port: v.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).unwrap_or(47322), token })
}

fn read() -> Option<PlatiaConfig> {
    // Same place as the app: PLATIA_DATA_DIR, else Electron's userData (%APPDATA%\@platia\desktop).
    let dir = std::env::var_os("PLATIA_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("@platia").join("desktop")))?;
    parse(&std::fs::read_to_string(dir.join("local-api.json")).ok()?)
}

/// Platia GO's loopback address and token (None when it isn't installed or is older than 0.9.2).
#[tauri::command]
pub async fn platia_config() -> CmdResult<Option<PlatiaConfig>> {
    blocking(|| Ok(read())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_local_api_file() {
        let t = "x".repeat(43);
        assert_eq!(parse(&format!(r#"{{"port":47322,"token":"{t}"}}"#)), Some(PlatiaConfig { port: 47322, token: t.clone() }));
        assert_eq!(parse(&format!(r#"{{"token":"{t}"}}"#)).unwrap().port, 47322);
        assert!(parse(r#"{"token":"short"}"#).is_none());
        assert!(parse("nope").is_none());
    }
}
