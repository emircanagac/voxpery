//! Desktop notifications through the operating system (Windows toasts, the macOS and Linux
//! notification centers) instead of the webview's `Notification`. WebView2 refuses that
//! permission for the app's own origin without asking and never shows the notification, so the
//! page hands mentions and direct messages to this command. A click brings the window forward
//! and tells the page which conversation to open.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Event the page listens to; its payload is the notification target the page passed in.
pub const CLICK_EVENT: &str = "desktop-notification-click";

const MAX_TITLE_CHARS: usize = 120;
const MAX_BODY_CHARS: usize = 400;
const MAX_TARGET_BYTES: usize = 1024;
/// Targets of older notifications are dropped; a click on one of those only shows the window.
const MAX_TRACKED_TARGETS: usize = 50;

/// Where each shown notification leads, by notification id.
#[derive(Default)]
pub struct NotificationTargets {
    next_id: AtomicI32,
    targets: Mutex<BTreeMap<i32, String>>,
}

impl NotificationTargets {
    fn remember(&self, target: Option<String>) -> i32 {
        let id = self
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1)
            .max(1);
        if let (Some(target), Ok(mut targets)) = (target, self.targets.lock()) {
            targets.insert(id, target);
            while targets.len() > MAX_TRACKED_TARGETS {
                let Some(oldest) = targets.keys().next().copied() else {
                    break;
                };
                targets.remove(&oldest);
            }
        }
        id
    }

    fn take(&self, id: i32) -> Option<String> {
        self.targets.lock().ok()?.remove(&id)
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// A target is a small JSON object the page itself created (`NotificationTarget`); the page
/// validates it again when it comes back.
fn validate_target(target: Option<String>) -> Result<Option<String>, String> {
    let Some(target) = target else {
        return Ok(None);
    };
    if target.len() > MAX_TARGET_BYTES {
        return Err("Notification target is too large".into());
    }
    match serde_json::from_str::<serde_json::Value>(&target) {
        Ok(serde_json::Value::Object(_)) => Ok(Some(target)),
        _ => Err("Notification target must be a JSON object".into()),
    }
}

/// Reports clicks on notifications: the window comes forward and the page opens the target.
pub fn register_click_handler(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |action| {
        if action.action_id() != "tap" {
            return;
        }
        crate::show_main_window(&handle);
        let target = action.notification().and_then(|notification| {
            handle
                .state::<NotificationTargets>()
                .take(notification.id())
        });
        if let Some(target) = target {
            let _ = handle.emit_to("main", CLICK_EVENT, target);
        }
    });
}

#[tauri::command]
pub fn desktop_show_notification(
    title: String,
    body: String,
    target: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, NotificationTargets>,
) -> Result<(), String> {
    let title = truncate_chars(&title, MAX_TITLE_CHARS);
    if title.is_empty() {
        return Err("Notification title is required".into());
    }
    let body = truncate_chars(&body, MAX_BODY_CHARS);
    let target = validate_target(target)?;
    let id = state.remember(target);
    app.notification()
        .builder()
        .id(id)
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_must_be_small_json_objects() {
        assert_eq!(validate_target(None), Ok(None));
        assert!(validate_target(Some(r#"{"kind":"dm","channelId":"c"}"#.into())).is_ok());
        assert!(validate_target(Some("[]".into())).is_err());
        assert!(validate_target(Some("not json".into())).is_err());
        assert!(validate_target(Some(format!(r#"{{"k":"{}"}}"#, "x".repeat(2000)))).is_err());
    }

    #[test]
    fn remembered_targets_are_taken_once_and_bounded() {
        let targets = NotificationTargets::default();
        let first = targets.remember(Some("{}".into()));
        assert_eq!(targets.take(first), Some("{}".into()));
        assert_eq!(targets.take(first), None);
        for _ in 0..(MAX_TRACKED_TARGETS + 10) {
            targets.remember(Some("{}".into()));
        }
        assert_eq!(targets.targets.lock().unwrap().len(), MAX_TRACKED_TARGETS);
    }

    #[test]
    fn titles_and_bodies_are_trimmed_and_capped() {
        assert_eq!(truncate_chars("  hi  ", 10), "hi");
        assert_eq!(
            truncate_chars(&"ç".repeat(500), MAX_TITLE_CHARS)
                .chars()
                .count(),
            MAX_TITLE_CHARS
        );
    }
}
