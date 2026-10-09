//! Shared pieces of the server-rendered registration pages (Google and desktop email).
//!
//! Both flows bind a short-lived, path-scoped HttpOnly cookie whose secret is never stored,
//! and render the same legal acknowledgement controls.

use super::*;

/// A new pending-registration cookie secret and the hash stored server-side.
pub(super) fn new_pending_secret() -> (String, String) {
    let secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = BASE64URL.encode(Sha256::digest(secret.as_bytes()));
    (secret, hash)
}

pub(super) fn pending_cookie(
    state: &AppState,
    name: &str,
    path: &str,
    value: &str,
    max_age: u32,
) -> String {
    format!(
        "{name}={value}; HttpOnly; Path={path}; SameSite=Lax; Max-Age={max_age}{}",
        if state.cookie_secure { "; Secure" } else { "" }
    )
}

/// Hash of the pending-registration cookie secret, or a user-facing expiry error.
pub(super) fn pending_cookie_hash(headers: &HeaderMap, name: &str) -> Result<String, AppError> {
    let prefix = format!("{name}=");
    let secret = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|part| part.trim().strip_prefix(&prefix))
        })
        .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| {
            AppError::Validation(
                "Registration expired. Return to Voxpery and sign in again.".into(),
            )
        })?;
    Ok(BASE64URL.encode(Sha256::digest(secret.as_bytes())))
}

/// Public web origin that serves /terms, /privacy and /kvkk.
pub(super) fn legal_links_origin(state: &AppState) -> &str {
    state
        .frontend_url
        .as_deref()
        .or_else(|| {
            state
                .cors_origins
                .iter()
                .find(|origin| origin.starts_with("https://") || origin.starts_with("http://"))
                .map(String::as_str)
        })
        .unwrap_or("http://localhost:5173")
}

/// Checkbox and hidden-version inputs for the three current legal documents.
pub(super) fn legal_acknowledgement_inputs(state: &AppState, accepted: [bool; 3]) -> String {
    let legal_origin = escape_html_attribute(legal_links_origin(state));
    [
        (
            "terms_accepted",
            "terms_version",
            "terms",
            "I accept the Terms of Service",
            CURRENT_TERMS_VERSION,
        ),
        (
            "privacy_notice_acknowledged",
            "privacy_notice_version",
            "privacy",
            "I have read the Privacy Notice",
            CURRENT_PRIVACY_NOTICE_VERSION,
        ),
        (
            "kvkk_notice_acknowledged",
            "kvkk_notice_version",
            "kvkk",
            "I have read the KVKK Notice",
            CURRENT_KVKK_NOTICE_VERSION,
        ),
    ]
    .iter()
    .enumerate()
    .map(|(index, (name, version_name, path, label, version))| {
        format!(
            "<label class=check><input type=checkbox name={name} value=true required {}><a href=\"{legal_origin}/{path}\" target=_blank rel=noreferrer>{label}</a></label><input type=hidden name={version_name} value=\"{}\">",
            if accepted[index] { "checked" } else { "" },
            escape_html_attribute(version),
        )
    })
    .collect()
}
