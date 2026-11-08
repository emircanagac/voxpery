//! OS keyring storage for the desktop session.
//!
//! Replaces `tauri-plugin-secure-storage` 1.x, which has no Tauri 3 release. The plugin name,
//! commands and payloads are unchanged, so the web app keeps calling
//! `plugin:secure-storage|get_item` and so on, and entries written by the old plugin remain
//! readable: the keyring service is the product name and the account is the prefixed key.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{command, AppHandle, Manager, Runtime};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionsRequest {
    prefixed_key: Option<String>,
    data: Option<String>,
}

#[derive(Debug, Serialize)]
struct GetItemResponse {
    data: Option<String>,
}

/// The only items the web app stores: its session token and tokens awaiting revocation.
const ALLOWED_KEYS: [&str; 2] = ["voxpery-auth-token", "voxpery-pending-revocations"];

fn entry<R: Runtime>(app: &AppHandle<R>, payload: &OptionsRequest) -> Result<Entry, String> {
    let key = payload
        .prefixed_key
        .as_deref()
        .filter(|key| ALLOWED_KEYS.contains(key))
        .ok_or("Key not found")?;
    let service = app
        .config()
        .product_name
        .clone()
        .ok_or("Product name is missing")?;
    // The active server is part of the account, so a session never leaves its own server.
    let active = app.try_state::<crate::custom_server::ActiveServer>();
    let account = crate::custom_server::keyring_account(
        key,
        active.as_ref().and_then(|state| state.0.as_ref()),
    );
    Entry::new(&service, &account).map_err(|_| "Secure storage is unavailable".to_string())
}

/// Runs a keyring call on the blocking pool: the OS keyring (Secret Service over D-Bus on Linux,
/// Credential Manager, Keychain) can wait on IPC or an unlock prompt, which must not hold up an
/// async runtime thread.
async fn run_keyring<T: Send + 'static>(
    call: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(call)
        .await
        .map_err(|_| "Secure storage is unavailable".to_string())?
}

#[command]
async fn get_item<R: Runtime>(
    app: AppHandle<R>,
    payload: OptionsRequest,
) -> Result<GetItemResponse, String> {
    let entry = entry(&app, &payload)?;
    let data = run_keyring(move || Ok(entry.get_password().ok())).await?;
    Ok(GetItemResponse { data })
}

#[command]
async fn set_item<R: Runtime>(
    app: AppHandle<R>,
    payload: OptionsRequest,
) -> Result<Option<String>, String> {
    let data = payload.data.clone().ok_or("Data not found")?;
    let entry = entry(&app, &payload)?;
    let value = data.clone();
    run_keyring(move || {
        entry
            .set_password(&value)
            .map_err(|_| "Secure storage could not save the value".to_string())
    })
    .await?;
    Ok(Some(data))
}

#[command]
async fn remove_item<R: Runtime>(
    app: AppHandle<R>,
    payload: OptionsRequest,
) -> Result<bool, String> {
    let entry = entry(&app, &payload)?;
    run_keyring(move || match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(true),
        Err(_) => Err("Secure storage could not remove the value".to_string()),
    })
    .await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-storage")
        .invoke_handler(tauri::generate_handler![get_item, set_item, remove_item])
        .build()
}
