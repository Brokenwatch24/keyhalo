//! Live Claude Code sessions, read from the registry Claude Code keeps in `~/.claude/sessions`
//! (one `<pid>.json` per running session, wherever it runs: Windows Terminal, Cursor, VS Code…).
//! This finds sessions that started before KeyHalo, or whose hooks never fired.

use crate::system::foreground;
use crate::util::{blocking, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    pid: u32,
    session_id: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    started_at: u64,
    #[serde(default)]
    status_updated_at: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    name_source: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveAgent {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    /// "busy" or "idle", as Claude Code reports it.
    pub status: String,
    pub started_at: u64,
    pub status_updated_at: u64,
    /// Its name (/rename) or Claude's automatic title, as /resume shows it.
    pub title: Option<String>,
    /// The app hosting its terminal (WindowsTerminal.exe, Cursor.exe…).
    pub host: Option<String>,
    /// Its window, when it can be told apart from the host's other windows.
    pub hwnd: Option<isize>,
}

fn claude_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude"))
}

/// A name worth showing (a rename to "." or "-" isn't).
fn meaningful(s: &str) -> Option<String> {
    let s = s.trim();
    s.chars().any(char::is_alphanumeric).then(|| s.to_string())
}

/// The last title in a transcript: a /rename (`custom-title`) beats Claude's own (`ai-title`).
fn last_title(transcript: &str) -> Option<String> {
    let (mut custom, mut ai) = (None, None);
    for line in transcript.lines().filter(|l| l.contains("-title\"")) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("custom-title") => custom = v.get("customTitle").and_then(|t| t.as_str()).map(String::from),
            Some("ai-title") => ai = v.get("aiTitle").and_then(|t| t.as_str()).map(String::from),
            _ => {}
        }
    }
    custom.as_deref().and_then(meaningful).or_else(|| ai.as_deref().and_then(meaningful))
}

/// Transcripts live in `projects/<folder with every non-alphanumeric as '-'>/<session>.jsonl`.
fn transcript_path(claude: &std::path::Path, cwd: &str, session: &str) -> PathBuf {
    let dir: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    claude.join("projects").join(dir).join(format!("{session}.jsonl"))
}

/// Title cache by session: re-read only when the transcript grows.
type TitleCache = HashMap<String, (u64, Option<String>)>;
static TITLES: std::sync::Mutex<Option<TitleCache>> = std::sync::Mutex::new(None);

fn title(claude: &std::path::Path, e: &Entry) -> Option<String> {
    if e.name_source == "user" {
        if let Some(n) = meaningful(&e.name) {
            return Some(n);
        }
    }
    transcript_title(&transcript_path(claude, &e.cwd, &e.session_id))
}

/// A transcript's title (cached by size). Titles repeat through the file, so the last 512 KB
/// usually hold one; the whole file is read only when they don't.
fn transcript_title(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let len = std::fs::metadata(path).ok()?.len();
    let key = path.to_string_lossy().to_string();
    if let Some((l, t)) = TITLES.lock().ok()?.get_or_insert_with(HashMap::new).get(&key) {
        if *l == len {
            return t.clone();
        }
    }
    const TAIL: u64 = 512 * 1024;
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    if len > TAIL {
        f.seek(SeekFrom::Start(len - TAIL)).ok()?;
    }
    f.read_to_end(&mut buf).ok()?;
    let mut t = last_title(&String::from_utf8_lossy(&buf));
    if t.is_none() && len > TAIL {
        t = std::fs::read(path).ok().and_then(|b| last_title(&String::from_utf8_lossy(&b)));
    }
    TITLES.lock().ok()?.get_or_insert_with(HashMap::new).insert(key, (len, t.clone()));
    t
}

/// The folder a transcript ran in (its first lines carry `cwd`).
fn transcript_cwd(path: &std::path::Path) -> Option<String> {
    use std::io::{BufRead, BufReader};
    let f = std::fs::File::open(path).ok()?;
    BufReader::new(f).lines().take(50).map_while(Result::ok).find_map(|l| {
        if !l.contains("\"cwd\"") {
            return None;
        }
        serde_json::from_str::<serde_json::Value>(&l).ok()?.get("cwd")?.as_str().map(String::from)
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub session_id: String,
    pub cwd: String,
    pub title: Option<String>,
    /// Last write, ms since the epoch.
    pub updated_at: u64,
}

/// The most recently used Claude Code sessions (newest first), as `/resume` lists them.
fn recent(limit: usize) -> Vec<RecentSession> {
    let Some(claude) = claude_dir() else { return Vec::new() };
    let Ok(projects) = std::fs::read_dir(claude.join("projects")) else { return Vec::new() };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = projects
        .flatten()
        .filter_map(|d| std::fs::read_dir(d.path()).ok())
        .flat_map(|r| r.flatten())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files
        .into_iter()
        .filter_map(|(at, path)| {
            let session_id = path.file_stem()?.to_string_lossy().to_string();
            let cwd = transcript_cwd(&path)?;
            Some(RecentSession {
                title: transcript_title(&path),
                updated_at: at.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
                session_id,
                cwd,
            })
        })
        .take(limit)
        .collect()
}

/// Recent Claude Code sessions to resume, newest first.
#[tauri::command]
pub async fn agents_recent(limit: Option<usize>) -> CmdResult<Vec<RecentSession>> {
    blocking(move || Ok(recent(limit.unwrap_or(24).min(64)))).await
}

/// Parent chain of `pid`, nearest first (stops at loops and after 8 steps).
fn ancestors(pid: u32, table: &HashMap<u32, (u32, String)>) -> Vec<u32> {
    let mut out = Vec::new();
    let mut cur = pid;
    while let Some((parent, _)) = table.get(&cur) {
        if *parent == 0 || out.contains(parent) || out.len() >= 8 {
            break;
        }
        out.push(*parent);
        cur = *parent;
    }
    out
}

/// The nearest ancestor with windows hosts the terminal. Its window is the only one it has, the
/// one titled after the session (Claude Code titles its terminal "✳ <title>"), or the one whose
/// title names the session's folder (editors put the project name in the title).
fn pick_window(chain: &[u32], windows: &[(u32, isize, String)], cwd: &str, title: Option<&str>) -> Option<(u32, Option<isize>)> {
    let folder = cwd.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
    let title = title.map(str::to_lowercase).filter(|t| t.len() > 2);
    for pid in chain {
        let mine: Vec<_> = windows.iter().filter(|w| w.0 == *pid).collect();
        if mine.is_empty() {
            continue;
        }
        if mine.len() == 1 {
            return Some((*pid, Some(mine[0].1)));
        }
        let by_title = title.as_ref().and_then(|t| mine.iter().find(|w| w.2.to_lowercase().contains(t.as_str())));
        let named = by_title.or_else(|| mine.iter().find(|w| !folder.is_empty() && w.2.to_lowercase().contains(&folder)));
        return Some((*pid, named.map(|w| w.1)));
    }
    None
}

fn live() -> Vec<LiveAgent> {
    let Some(claude) = claude_dir() else { return Vec::new() };
    let Ok(read) = std::fs::read_dir(claude.join("sessions")) else { return Vec::new() };
    let table = foreground::process_table();
    let windows: Vec<(u32, isize, String)> = foreground::windows().into_iter().map(|w| (w.pid, w.hwnd, w.title)).collect();
    let mut out: Vec<LiveAgent> = read
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str::<Entry>(&std::fs::read_to_string(e.path()).ok()?).ok())
        // A file outlives a crashed session: keep it only while that pid is still Claude.
        .filter(|e| table.get(&e.pid).is_some_and(|(_, name)| name.to_lowercase().starts_with("claude")))
        .map(|e| {
            let title = title(&claude, &e);
            let found = pick_window(&ancestors(e.pid, &table), &windows, &e.cwd, title.as_deref());
            LiveAgent {
                title,
                host: found.and_then(|(pid, _)| table.get(&pid).map(|(_, n)| n.clone())),
                hwnd: found.and_then(|(_, h)| h),
                pid: e.pid,
                session_id: e.session_id,
                cwd: e.cwd,
                status: e.status,
                started_at: e.started_at,
                status_updated_at: e.status_updated_at,
            }
        })
        .collect();
    out.sort_by_key(|a| a.started_at);
    out
}

/// Running Claude Code sessions, oldest first.
#[tauri::command]
pub async fn agents_live() -> CmdResult<Vec<LiveAgent>> {
    blocking(|| Ok(live())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_latest_title() {
        let t = r#"{"type":"ai-title","aiTitle":"Old"}
{"type":"user","message":"x"}
{"type":"ai-title","aiTitle":"Reporte de cuenta"}"#;
        assert_eq!(last_title(t).as_deref(), Some("Reporte de cuenta"));
        let renamed = format!("{t}\n{}", r#"{"type":"custom-title","customTitle":"Pdf"}"#);
        assert_eq!(last_title(&renamed).as_deref(), Some("Pdf"));
        let dot = format!("{t}\n{}", r#"{"type":"custom-title","customTitle":"."}"#);
        assert_eq!(last_title(&dot).as_deref(), Some("Reporte de cuenta"));
        assert_eq!(
            transcript_path(std::path::Path::new("C:/c"), "D:/01_Proyectos/jugada-maestra", "s"),
            std::path::Path::new("C:/c").join("projects").join("D--01-Proyectos-jugada-maestra").join("s.jsonl")
        );
    }

    #[test]
    fn walks_up_to_the_process_with_windows() {
        let table: HashMap<u32, (u32, String)> = [
            (10, (9, "claude.exe".to_string())),
            (9, (8, "powershell.exe".to_string())),
            (8, (7, "Cursor.exe".to_string())),
            (7, (1, "Cursor.exe".to_string())),
        ]
        .into();
        let chain = ancestors(10, &table);
        assert_eq!(chain, vec![9, 8, 7, 1]);
        let windows = vec![
            (7, 100, "app.ts - jugada-maestra - Cursor".to_string()),
            (7, 101, "index.ts - platia-pocket - Cursor".to_string()),
            (3, 200, "Spotify".to_string()),
        ];
        assert_eq!(pick_window(&chain, &windows, "D:/Github/platia-pocket", None), Some((7, Some(101))));
        assert_eq!(pick_window(&chain, &windows, "C:/Users/me", None), Some((7, None)));
        assert_eq!(pick_window(&chain, &windows[..1], "C:/Users/me", None), Some((7, Some(100))));
        assert_eq!(pick_window(&chain, &windows[2..], "C:/Users/me", None), None);
        let terms = vec![(7, 300, "✳ Video promocional".to_string()), (7, 301, "◐ Teclado Razer".to_string())];
        assert_eq!(pick_window(&chain, &terms, "C:/Users/me", Some("Teclado Razer")), Some((7, Some(301))));
    }
}
