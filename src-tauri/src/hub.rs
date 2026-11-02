//! BrokenWatchHub on this PC (the user's "Puente"): where it listens, its token and Broken's key,
//! read from its own config file so pads can show its to-dos and talk to Broken.

use crate::util::{blocking, CmdResult};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubConfig {
    pub port: u16,
    pub token: String,
    /// Broken's push-to-talk combination, e.g. "Ctrl+Alt+Space".
    pub combo: String,
    pub key_active: bool,
}

fn parse(text: &str) -> Option<HubConfig> {
    let v: Value = serde_json::from_str(text).ok()?;
    let token = v.get("token")?.as_str()?.to_string();
    if token.is_empty() {
        return None;
    }
    let tecla = v.get("tecla");
    Some(HubConfig {
        port: v.get("puerto").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).unwrap_or(7800),
        token,
        combo: tecla.and_then(|t| t.get("combinacion")).and_then(Value::as_str).unwrap_or("Ctrl+Alt+Space").to_string(),
        key_active: tecla.and_then(|t| t.get("activa")).and_then(Value::as_bool).unwrap_or(true),
    })
}

fn read() -> Option<HubConfig> {
    // Same place the Puente uses: BWH_DATA, else %APPDATA%\BrokenWatchHub.
    let dir = std::env::var_os("BWH_DATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("BrokenWatchHub")))?;
    parse(&std::fs::read_to_string(dir.join("config.json")).ok()?)
}

/// BrokenWatchHub's address, token and Broken key on this PC (None when it isn't installed).
#[tauri::command]
pub async fn hub_config() -> CmdResult<Option<HubConfig>> {
    blocking(|| Ok(read())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_puente_config() {
        let c = parse(r#"{"token":"abc","puerto":7801,"tecla":{"activa":false,"combinacion":"Ctrl+Shift+B"}}"#).unwrap();
        assert_eq!(c, HubConfig { port: 7801, token: "abc".into(), combo: "Ctrl+Shift+B".into(), key_active: false });
        let d = parse(r#"{"token":"abc"}"#).unwrap();
        assert_eq!((d.port, d.combo.as_str(), d.key_active), (7800, "Ctrl+Alt+Space", true));
        assert!(parse(r#"{"token":""}"#).is_none());
        assert!(parse("not json").is_none());
    }
}
