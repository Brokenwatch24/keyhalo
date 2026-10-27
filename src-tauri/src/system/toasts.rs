//! Windows notifications (toasts) currently in the Action Center, via UserNotificationListener.
//! Works for unpackaged apps; the user controls access in Settings → Privacy → Notifications.
//! The frontend polls `list()` and diffs by id (NotificationChanged needs package identity).

#![cfg(windows)]

use serde::Serialize;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToastInfo {
    pub id: u32,
    /// Display name of the sending app ("Discord", "Phone Link"); empty when Windows hides it.
    pub app: String,
    /// AppUserModelID, stable across languages.
    pub app_id: String,
    pub title: String,
    pub body: String,
    /// Unix epoch milliseconds.
    pub time: i64,
}

fn status_name(s: UserNotificationListenerAccessStatus) -> &'static str {
    match s {
        UserNotificationListenerAccessStatus::Allowed => "allowed",
        UserNotificationListenerAccessStatus::Denied => "denied",
        _ => "unspecified",
    }
}

pub fn access() -> Result<String, String> {
    let l = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    let s = l.GetAccessStatus().map_err(|e| e.to_string())?;
    Ok(status_name(s).into())
}

/// Shows the Windows consent prompt when the status is still "unspecified".
pub fn request_access() -> Result<String, String> {
    let l = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    let s = l
        .RequestAccessAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    Ok(status_name(s).into())
}

fn read(n: &UserNotification) -> Option<ToastInfo> {
    let id = n.Id().ok()?;
    let (app, app_id) = n
        .AppInfo()
        .map(|info| {
            let name = info
                .DisplayInfo()
                .and_then(|d| d.DisplayName())
                .map(|s| s.to_string())
                .unwrap_or_default();
            let aumid = info.AppUserModelId().map(|s| s.to_string()).unwrap_or_default();
            (name, aumid)
        })
        .unwrap_or_default();
    let mut texts: Vec<String> = Vec::new();
    if let Ok(binding) = n
        .Notification()
        .and_then(|x| x.Visual())
        .and_then(|v| v.GetBinding(&KnownNotificationBindings::ToastGeneric()?))
    {
        if let Ok(els) = binding.GetTextElements() {
            for el in els {
                if let Ok(t) = el.Text() {
                    texts.push(t.to_string());
                }
            }
        }
    }
    // FILETIME (100 ns since 1601) → Unix ms.
    let time = n
        .CreationTime()
        .map(|t| (t.UniversalTime - 116_444_736_000_000_000) / 10_000)
        .unwrap_or(0);
    let title = texts.first().cloned().unwrap_or_default();
    let body = texts.iter().skip(1).cloned().collect::<Vec<_>>().join("\n");
    Some(ToastInfo { id, app, app_id, title, body, time })
}

pub fn list() -> Result<Vec<ToastInfo>, String> {
    crate::util::com_init();
    let l = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    if l.GetAccessStatus().map_err(|e| e.to_string())? != UserNotificationListenerAccessStatus::Allowed {
        return Err("access denied".into());
    }
    let items = l
        .GetNotificationsAsync(NotificationKinds::Toast)
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    Ok(items.into_iter().filter_map(|n| read(&n)).collect())
}

#[cfg(test)]
mod tests {
    /// Reads the real Action Center: `cargo test --lib toasts -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_the_action_center() {
        println!("access: {:?}", super::access());
        let list = super::list().expect("list");
        println!("{} notifications", list.len());
        for n in list.iter().take(5) {
            println!("id={} app={:?} appId={:?} title_len={} body_len={} time={}", n.id, n.app, n.app_id, n.title.len(), n.body.len(), n.time);
        }
    }
}
