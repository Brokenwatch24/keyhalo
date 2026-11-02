//! Tabs of a window (Chrome, Edge, Windows Terminal, File Explorer…), read and switched through
//! UI Automation: their tab strips expose each tab as a `TabItem`.

use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub name: String,
    pub selected: bool,
}

#[cfg(windows)]
mod imp {
    use super::TabInfo;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::*;

    /// Web pages can hold thousands of elements and never hold the tab strip: skip documents.
    const MAX_DEPTH: u32 = 18;
    const MAX_TABS: usize = 64;

    fn walk(w: &IUIAutomationTreeWalker, el: &IUIAutomationElement, depth: u32, out: &mut Vec<IUIAutomationElement>) {
        if depth > MAX_DEPTH || out.len() >= MAX_TABS {
            return;
        }
        let mut child = unsafe { w.GetFirstChildElement(el) }.ok();
        while let Some(c) = child {
            match unsafe { c.CurrentControlType() } {
                Ok(t) if t == UIA_TabItemControlTypeId => out.push(c.clone()),
                Ok(t) if t == UIA_DocumentControlTypeId => {}
                _ => walk(w, &c, depth + 1, out),
            }
            if out.len() >= MAX_TABS {
                return;
            }
            child = unsafe { w.GetNextSiblingElement(&c) }.ok();
        }
    }

    fn tab_elements(hwnd: isize) -> Option<Vec<IUIAutomationElement>> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let ua: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let root = ua.ElementFromHandle(HWND(hwnd as *mut _)).ok()?;
            let walker = ua.ControlViewWalker().ok()?;
            let mut out = Vec::new();
            walk(&walker, &root, 0, &mut out);
            Some(out)
        }
    }

    fn is_selected(el: &IUIAutomationElement) -> bool {
        unsafe {
            el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
                .and_then(|p| p.CurrentIsSelected())
                .map(|b| b.as_bool())
                .unwrap_or(false)
        }
    }

    pub fn tabs(hwnd: isize) -> Vec<TabInfo> {
        tab_elements(hwnd)
            .unwrap_or_default()
            .iter()
            .map(|el| TabInfo {
                name: unsafe { el.CurrentName() }.map(|n| n.to_string()).unwrap_or_default(),
                selected: is_selected(el),
            })
            .collect()
    }

    /// Switch to tab `index`: select it, else invoke it, else its default action (a click).
    pub fn select(hwnd: isize, index: usize) -> bool {
        let Some(list) = tab_elements(hwnd) else { return false };
        let Some(el) = list.get(index) else { return false };
        unsafe {
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                if p.Select().is_ok() {
                    return true;
                }
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                if p.Invoke().is_ok() {
                    return true;
                }
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId) {
                return p.DoDefaultAction().is_ok();
            }
        }
        false
    }
}

#[cfg(windows)]
pub use imp::{select, tabs};

#[cfg(not(windows))]
pub fn tabs(_hwnd: isize) -> Vec<TabInfo> {
    Vec::new()
}
#[cfg(not(windows))]
pub fn select(_hwnd: isize, _index: usize) -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    /// Prints the tabs of every visible Chrome / Terminal / Explorer window (run by hand).
    #[test]
    #[ignore]
    fn probe_tabs() {
        for w in crate::system::foreground::windows() {
            let p = w.process.to_lowercase();
            if ["chrome.exe", "msedge.exe", "windowsterminal.exe", "explorer.exe", "cursor.exe"].contains(&p.as_str()) {
                let t0 = std::time::Instant::now();
                let tabs = super::tabs(w.hwnd);
                println!("{} | {} | {} tabs in {:?}", w.process, w.title, tabs.len(), t0.elapsed());
                for t in tabs.iter().take(12) {
                    println!("   {} {}", if t.selected { "*" } else { " " }, t.name);
                }
            }
        }
    }
}

#[cfg(all(test, windows))]
mod select_probe {
    /// Re-selects Chrome's current tab (no visible change) to check switching works (run by hand).
    #[test]
    #[ignore]
    fn probe_select() {
        for w in crate::system::foreground::windows().into_iter().filter(|w| w.process.eq_ignore_ascii_case("chrome.exe")) {
            if let Some(i) = super::tabs(w.hwnd).iter().position(|t| t.selected) {
                println!("{}: select #{i} -> {}", w.title, super::select(w.hwnd, i));
            }
        }
    }
}
