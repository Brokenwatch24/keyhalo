//! One-click Codex connection: sets the top-level `notify` command in `~/.codex/config.toml`
//! (or `$CODEX_HOME/config.toml`) so Codex tells KeyHalo when a turn finishes. Codex appends
//! its JSON payload (thread id, folder, last message) as the last argument, which becomes curl's
//! `-d` body. Everything else in the file is kept; a different `notify` is never replaced.

use crate::util::{blocking, err, CmdResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

const ENDPOINT: &str = "/api/v1/hook/codex";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyStatus {
    pub installed: bool,
    /// Another program is already set as Codex's `notify` (KeyHalo leaves it alone).
    pub other: Option<String>,
    pub path: String,
    pub backup: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("CODEX_HOME") {
        return Ok(PathBuf::from(home).join("config.toml"));
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("home folder not found")?;
    Ok(PathBuf::from(home).join(".codex").join("config.toml"))
}

fn notify_line(port: u16, token: &str) -> String {
    let url = format!("http://127.0.0.1:{port}{ENDPOINT}");
    let mut args = vec!["curl", "-s", "-m", "2", "-X", "POST", &url, "-H", "X-KeyHalo-Hook: 1", "-H", "Content-Type: application/json"];
    let auth = format!("Authorization: Bearer {token}");
    if !token.is_empty() {
        args.extend(["-H", &auth]);
    }
    args.push("-d");
    // JSON string escaping is valid TOML basic-string escaping for these values.
    let items: Vec<String> = args.iter().map(|a| serde_json::to_string(a).unwrap_or_default()).collect();
    format!("notify = [{}]", items.join(", "))
}

/// Line range of the top-level `notify = …` (before the first table), if any.
fn find_notify(lines: &[&str]) -> Option<(usize, usize)> {
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if t.starts_with('[') {
            return None; // tables start: no more top-level keys
        }
        let Some(rest) = t.strip_prefix("notify") else { continue };
        if !rest.trim_start().starts_with('=') {
            continue;
        }
        // A multi-line array ends at the first line with a closing bracket.
        let mut end = i;
        if !line.contains(']') {
            while end + 1 < lines.len() && !lines[end].contains(']') {
                end += 1;
            }
        }
        return Some((i, end));
    }
    None
}

pub fn apply(path: &Path, action: &str, port: u16, token: &str) -> Result<NotifyStatus, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(err(e)),
    };
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<&str> = text.lines().collect();
    let found = find_notify(&lines);
    let current = found.map(|(a, b)| lines[a..=b].join("\n"));
    let ours = current.as_deref().is_some_and(|c| c.contains(ENDPOINT));
    let other = current.clone().filter(|_| !ours);

    let mut backup = None;
    let mut installed = ours;
    if action == "install" || action == "remove" {
        if action == "install" && other.is_some() {
            return Err(format!("Codex already runs another program on notify ({}). Remove it from {} first.", other.unwrap_or_default().trim(), path.display()));
        }
        if path.exists() {
            let b = path.with_extension("toml.keyhalo-backup");
            if !b.exists() {
                std::fs::copy(path, &b).map_err(err)?;
            }
            backup = Some(b.display().to_string());
        }
        let line = notify_line(port, token);
        if let (Some((a, b)), true) = (found, ours) {
            lines.drain(a..=b);
        }
        if action == "install" {
            lines.insert(0, &line);
        }
        let mut out = lines.join(eol);
        if !out.is_empty() {
            out.push_str(eol);
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(err)?;
        }
        std::fs::write(path, out).map_err(err)?;
        installed = action == "install";
    }
    Ok(NotifyStatus { installed, other, path: path.display().to_string(), backup })
}

/// `action`: "status" | "install" | "remove".
#[tauri::command]
pub async fn codex_notify(action: String, port: u16, token: Option<String>) -> CmdResult<NotifyStatus> {
    blocking(move || apply(&config_path()?, &action, port, token.as_deref().unwrap_or(""))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, contents: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("keyhalo-codex-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("config.toml");
        if let Some(c) = contents {
            std::fs::write(&p, c).unwrap();
        }
        p
    }

    #[test]
    fn install_and_remove_keep_the_rest_of_the_file() {
        let original = "model = \"gpt\"\r\n\r\n[projects.'D:\\dev']\r\ntrust_level = \"trusted\"\r\n";
        let p = temp("roundtrip", Some(original));
        let s = apply(&p, "install", 27463, "").unwrap();
        assert!(s.installed && s.other.is_none());
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.starts_with("notify = [\"curl\""));
        assert!(text.contains("/api/v1/hook/codex"));
        assert!(text.contains("[projects.'D:\\dev']\r\ntrust_level"));
        // Installing again does not duplicate.
        apply(&p, "install", 27463, "").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap().matches("notify =").count(), 1);
        assert!(!apply(&p, "remove", 27463, "").unwrap().installed);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original);
    }

    #[test]
    fn never_replaces_another_notify() {
        let p = temp("other", Some("notify = [\"python\", \"my.py\"]\nmodel = \"x\"\n"));
        let s = apply(&p, "status", 27463, "").unwrap();
        assert!(!s.installed && s.other.is_some());
        assert!(apply(&p, "install", 27463, "").is_err());
        assert!(std::fs::read_to_string(&p).unwrap().starts_with("notify = [\"python\""));
    }

    #[test]
    fn ignores_notify_keys_inside_tables() {
        let p = temp("table", Some("[tui]\nnotify = true\n"));
        assert!(apply(&p, "status", 27463, "").unwrap().other.is_none());
        apply(&p, "install", 27463, "tok").unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("Bearer tok"));
        assert!(text.contains("[tui]\nnotify = true"));
    }
}
