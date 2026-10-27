//! JSON/text storage in the app data folder. Names are relative ("profiles/neon.json");
//! absolute paths and `..` are rejected.

use crate::util::{blocking, err, CmdResult};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

fn base() -> Result<PathBuf, String> {
    let app = crate::util::app().ok_or("app not ready")?;
    app.path().app_data_dir().map_err(err)
}

/// Validates a relative name and resolves it inside the app data folder.
pub fn resolve(root: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.replace('\\', "/");
    let rel = Path::new(&name);
    if name.contains(':') || name.starts_with('/') || rel.is_absolute() {
        return Err(format!("invalid storage name: {name}"));
    }
    let mut out = root.to_path_buf();
    for c in rel.components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return Err(format!("invalid storage name: {name}")),
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn storage_read(name: String) -> CmdResult<Option<String>> {
    blocking(move || {
        let path = resolve(&base()?, &name)?;
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
}

#[tauri::command]
pub async fn storage_write(name: String, contents: String) -> CmdResult<()> {
    blocking(move || {
        let root = base()?;
        let path = resolve(&root, &name)?;
        if path == root {
            return Err("empty storage name".into());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        // Write to a temp file and rename so a crash never leaves a truncated file.
        let tmp = path.with_extension(format!(
            "{}.tmp",
            path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default()
        ));
        std::fs::write(&tmp, contents).map_err(err)?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        })
    })
    .await
}

#[tauri::command]
pub async fn storage_list(dir: String) -> CmdResult<Vec<String>> {
    blocking(move || {
        let path = resolve(&base()?, &dir)?;
        let rd = match std::fs::read_dir(&path) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let mut names: Vec<String> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !n.ends_with(".tmp"))
            .collect();
        names.sort();
        Ok(names)
    })
    .await
}

#[tauri::command]
pub async fn storage_delete(name: String) -> CmdResult<()> {
    blocking(move || {
        let root = base()?;
        let path = resolve(&root, &name)?;
        if path == root {
            return Err("empty storage name".into());
        }
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::resolve;
    use std::path::Path;

    #[test]
    fn rejects_escapes() {
        let root = Path::new("C:\\data");
        assert!(resolve(root, "profiles/a.json").is_ok());
        assert!(resolve(root, "../x").is_err());
        assert!(resolve(root, "a/../../x").is_err());
        assert!(resolve(root, "C:\\Windows\\x").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "\\\\server\\share").is_err());
    }
}
