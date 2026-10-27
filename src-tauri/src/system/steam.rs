//! Locates Steam game folders (used to install CS2 / Dota 2 GSI configs).

use std::path::{Path, PathBuf};

#[cfg(windows)]
fn reg_string(
    root: windows::Win32::System::Registry::HKEY,
    key: &str,
    value: &str,
) -> Option<String> {
    use crate::util::{from_wide, to_wide};
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let k = to_wide(key);
    let v = to_wide(value);
    let mut buf = vec![0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(
            root,
            PCWSTR(k.as_ptr()),
            PCWSTR(v.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    if r.is_err() {
        return None;
    }
    Some(from_wide(&buf))
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        if let Some(p) = reg_string(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath") {
            roots.push(PathBuf::from(p.replace('/', r"\")));
        }
        if let Some(p) = reg_string(
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Valve\Steam",
            "InstallPath",
        ) {
            roots.push(PathBuf::from(p));
        }
    }
    roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    roots
}

/// Extracts every `"path"  "<dir>"` value from libraryfolders.vdf.
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        // `\t"path"\t\t"D:\\SteamLibrary"` splits into ["\t", "path", "\t\t", "D:\\\\SteamLibrary", ""]
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case("path") {
            out.push(PathBuf::from(parts[3].replace(r"\\", r"\")));
        }
    }
    out
}

pub fn find_game(folder: &str) -> Option<String> {
    if folder.is_empty() || folder.contains("..") || folder.contains('/') || folder.contains('\\') {
        return None;
    }
    let mut libraries: Vec<PathBuf> = Vec::new();
    for root in steam_roots() {
        if !root.exists() {
            continue;
        }
        libraries.push(root.clone());
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            libraries.extend(parse_library_folders(&text));
        }
    }
    libraries.dedup();
    libraries
        .iter()
        .map(|lib| lib.join("steamapps").join("common").join(folder))
        .find(|p| Path::new(p).is_dir())
        .map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_vdf() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        let libs = super::parse_library_folders(vdf);
        assert_eq!(libs.len(), 2);
        assert_eq!(libs[1].to_string_lossy(), r"D:\SteamLibrary");
    }
}
