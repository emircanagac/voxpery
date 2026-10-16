//! Google OAuth (web and desktop) and the PKCE-bound desktop sign-in handoff.
use super::*;

pub(super) const DESKTOP_OAUTH_ORIGIN: &str = "voxpery://auth";
// Long enough to copy the code from the browser page when the app does not open by itself.
pub(super) const DESKTOP_OAUTH_CODE_TTL_SECS: u64 = 300;
/// Upper bound for each request to Google's OAuth token and userinfo endpoints.
pub(super) const GOOGLE_OAUTH_HTTP_TIMEOUT: Duration = Duration::from_secs(10);
pub(super) fn is_desktop_oauth_origin(origin: &str) -> bool {
    origin.trim_end_matches('/') == DESKTOP_OAUTH_ORIGIN
}

pub(super) fn normalize_oauth_origin(state: &AppState, origin: &str) -> String {
    let requested = origin.trim();
    if is_desktop_oauth_origin(requested) {
        return DESKTOP_OAUTH_ORIGIN.to_string();
    }
    if state
        .cors_origins
        .iter()
        .any(|allowed| allowed == requested)
    {
        return requested.to_string();
    }
    tracing::warn!(
        "Rejecting unapproved origin for Google OAuth: {}",
        requested
    );
    state
        .cors_origins
        .first()
        .cloned()
        .unwrap_or_else(|| "http://localhost:5173".to_string())
}

pub(super) fn oauth_state_cookie_header(state: &AppState, oauth_state: &str) -> String {
    let mut cookie =
        format!("oauth_state={oauth_state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax");
    if state.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

pub(super) fn clear_oauth_state_cookie_header(state: &AppState) -> String {
    let mut cookie = "oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax".to_string();
    if state.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

pub(super) fn oauth_state_matches_cookie(callback_state: Option<&str>, cookie_state: &str) -> bool {
    callback_state.is_some_and(|value| constant_time_eq(value, cookie_state))
}

pub(super) fn parse_oauth_legal_metadata(parts: &[&str]) -> (String, String, String, bool) {
    let terms = parts.first().copied().unwrap_or("").trim().to_string();
    let privacy = parts.get(1).copied().unwrap_or("").trim().to_string();
    let (kvkk, acknowledged) = if parts.len() >= 4 {
        (
            parts.get(2).copied().unwrap_or("").trim().to_string(),
            parts.get(3).copied().unwrap_or("0").trim() == "1",
        )
    } else {
        // v0.2.13 used one Privacy/KVKK acknowledgement and an eight-part OAuth state.
        (
            privacy.clone(),
            parts.get(2).copied().unwrap_or("0").trim() == "1",
        )
    };
    (terms, privacy, kvkk, acknowledged)
}

/// The one-time exchange code carried by a desktop return URL, if it is well formed.
pub(super) fn desktop_handoff_code(redirect_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(redirect_url).ok()?;
    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned())?;
    (code.len() == 32 && code.bytes().all(|b| b.is_ascii_hexdigit())).then_some(code)
}

pub(super) fn desktop_oauth_handoff_html(
    redirect_url: &str,
    succeeded: bool,
    csp_nonce: &str,
) -> String {
    let href = escape_html_attribute(redirect_url);
    let app_url = javascript_string_literal(redirect_url);
    // The code only works together with the PKCE verifier held by the app that started the
    // sign-in, once, within a few minutes, so showing it for manual entry is safe.
    let manual_code = desktop_handoff_code(redirect_url)
        .filter(|_| succeeded)
        .map(|code| {
            format!(
                r#"<details class="manual"><summary>Voxpery did not open?</summary><p>Copy this sign-in code and paste it in Voxpery under <strong>Use a sign-in code</strong>. It works once and expires in 5 minutes.</p><div class="code-row"><code id="sign-in-code">{code}</code><button type="button" id="copy-code" class="copy">Copy</button></div></details>"#
            )
        })
        .unwrap_or_default();
    let (eyebrow, title, message, action) = if succeeded {
        (
            "Desktop sign-in",
            "You are signed in",
            "Voxpery should open automatically. Keep this page open until the desktop app appears.",
            "Open Voxpery",
        )
    } else {
        (
            "Desktop sign-in",
            "Sign-in could not be completed",
            "Return to Voxpery to review the error and try again.",
            "Return to Voxpery",
        )
    };
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>{title} - Voxpery</title>
<style nonce="{csp_nonce}">
    :root {{ font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #f4f7ff; background: #11182d; }}
    * {{ box-sizing: border-box; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #11182d; }}
    .card {{ width: min(100%, 460px); padding: 32px; border: 1px solid rgba(170, 196, 255, .18); border-radius: 8px; background: #1b2544; box-shadow: 0 22px 64px rgba(2, 7, 20, .45); text-align: left; }}
    .brand {{ display: flex; align-items: center; gap: 10px; margin-bottom: 28px; font-weight: 800; font-size: 18px; }}
    .mark {{ display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: #4f7fd8; color: white; }}
    .eyebrow {{ margin: 0 0 8px; color: #9fbae9; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }}
    h1 {{ margin: 0; color: #ffffff; font-size: clamp(24px, 6vw, 32px); line-height: 1.15; }}
    p {{ margin: 14px 0 0; color: #bdc9e3; line-height: 1.55; }}
    .status {{ min-height: 20px; margin-top: 18px; color: #9fbae9; font-size: 13px; }}
    .btn {{ display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; margin-top: 20px; padding: 10px 16px; border: 1px solid #8bb4ff; border-radius: 8px; background: #4f7fd8; color: #ffffff; text-decoration: none; font-weight: 800; transition: background .15s ease, border-color .15s ease; }}
    .btn:hover {{ background: #6090e5; border-color: #b2ceff; }}
    .btn:focus-visible {{ outline: 3px solid rgba(160, 197, 255, .55); outline-offset: 3px; }}
    .manual {{ margin-top: 22px; color: #bdc9e3; }}
    .manual summary {{ cursor: pointer; color: #9fbae9; font-weight: 700; }}
    .code-row {{ display: flex; gap: 8px; align-items: center; margin-top: 12px; }}
    .code-row code {{ flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 10px; border: 1px solid #44577f; border-radius: 6px; background: #0e1b2d; color: #ffffff; font-size: 14px; }}
    .copy {{ min-height: 40px; padding: 8px 14px; border: 1px solid #8bb4ff; border-radius: 6px; background: transparent; color: #ffffff; font: inherit; font-weight: 700; cursor: pointer; }}
    @media (max-width: 480px) {{ body {{ padding: 14px; }} .card {{ padding: 24px 20px; }} }}
</style>
</head>
<body>
<main class="card">
    <div class="brand"><span class="mark" aria-hidden="true">V</span><span>Voxpery</span></div>
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p>{message}</p>
    <p id="handoff-status" class="status" role="status" aria-live="polite">Opening the desktop app...</p>
    <a id="open-voxpery" href="{href}" class="btn">{action}</a>
    {manual_code}
</main>
<script nonce="{csp_nonce}">
    const appUrl = {app_url};
    const status = document.getElementById("handoff-status");
    const openButton = document.getElementById("open-voxpery");
    const openDesktop = () => {{
        window.location.assign(appUrl);
    }};
    openButton.addEventListener("click", () => {{
        status.textContent = "Opening Voxpery...";
    }});
    const copyButton = document.getElementById("copy-code");
    copyButton?.addEventListener("click", () => {{
        const code = document.getElementById("sign-in-code").textContent;
        navigator.clipboard?.writeText(code).then(
            () => {{ copyButton.textContent = "Copied"; }},
            () => {{ copyButton.textContent = "Select and copy"; }},
        );
    }});
    window.setTimeout(openDesktop, 50);
    window.setTimeout(() => {{
        if (document.visibilityState === "visible") {{
            status.textContent = "If Voxpery did not open, use the button below.";
        }}
    }}, 900);
</script>
</body>
</html>"#
    )
}

pub(super) fn desktop_oauth_handoff_response(redirect_url: &str, succeeded: bool) -> Response {
    let csp_nonce = Uuid::new_v4().as_simple().to_string();
    let csp = format!(
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; style-src 'nonce-{csp_nonce}'; script-src 'nonce-{csp_nonce}'"
    );
    let mut response = Html(desktop_oauth_handoff_html(
        redirect_url,
        succeeded,
        &csp_nonce,
    ))
    .into_response();
    if let Ok(value) = HeaderValue::from_str(&csp) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("content-security-policy"), value);
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    response
}

pub(super) fn oauth_callback_response(
    origin: &str,
    redirect_path: &str,
    error: Option<&str>,
) -> Response {
    let path = match error {
        Some(code) if !is_desktop_oauth_origin(origin) => {
            let login = append_query_param("/login", "error", code);
            append_query_param(&login, "redirect", redirect_path)
        }
        Some(code) => append_query_param(redirect_path, "error", code),
        None => redirect_path.to_string(),
    };
    let redirect_url = format!("{}{}", origin, path);
    if is_desktop_oauth_origin(origin) {
        desktop_oauth_handoff_response(&redirect_url, error.is_none())
    } else {
        Redirect::temporary(&redirect_url).into_response()
    }
}

pub(super) fn is_valid_pkce_component(value: &str) -> bool {
    let len = value.len();
    if !(43..=128).contains(&len) {
        return false;
    }
    value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
}

pub(super) fn pkce_s256_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    BASE64URL.encode(digest)
}

pub(super) fn desktop_oauth_code_key(code: &str) -> String {
    format!("auth:oauth:desktop_code:{code}")
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct DesktopOAuthCodePayload {
    pub(super) token: String,
    pub(super) code_challenge: Option<String>,
}

pub(super) async fn issue_desktop_oauth_code(
    state: &Arc<AppState>,
    token: &str,
    code_challenge: &str,
) -> Result<String, AppError> {
    let code = Uuid::new_v4().simple().to_string();
    let key = desktop_oauth_code_key(&code);
    let payload = serde_json::to_string(&DesktopOAuthCodePayload {
        token: token.to_string(),
        code_challenge: Some(code_challenge.to_string()),
    })
    .map_err(|e| AppError::Internal(format!("Failed to encode desktop OAuth payload: {e}")))?;
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;
    let _: () = conn
        .set_ex(&key, payload, DESKTOP_OAUTH_CODE_TTL_SECS)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to store desktop OAuth code: {e}")))?;
    Ok(code)
}

pub(super) async fn consume_desktop_oauth_code(
    state: &Arc<AppState>,
    code: &str,
) -> Result<Option<DesktopOAuthCodePayload>, AppError> {
    let key = desktop_oauth_code_key(code);
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Redis connection failed: {e}")))?;

    let token = match redis::cmd("GETDEL")
        .arg(&key)
        .query_async::<Option<String>>(&mut conn)
        .await
    {
        Ok(v) => v,
        Err(_) => redis::Script::new(
            "local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return v",
        )
        .key(&key)
        .invoke_async::<Option<String>>(&mut conn)
        .await
        .map_err(|e| AppError::Internal(format!("Redis code consumption failed: {e}")))?,
    };
    Ok(token.map(|raw| {
        serde_json::from_str::<DesktopOAuthCodePayload>(&raw).unwrap_or(DesktopOAuthCodePayload {
            token: raw,
            code_challenge: None,
        })
    }))
}

#[cfg(test)]
mod oauth_pkce_tests {
    use super::{
        constant_time_eq, desktop_oauth_handoff_html, is_valid_pkce_component,
        normalize_oauth_username_seed, oauth_callback_response, pkce_s256_challenge,
    };

    #[test]
    fn compares_sensitive_strings_without_plain_equality() {
        assert!(constant_time_eq("same-secret", "same-secret"));
        assert!(!constant_time_eq("same-secret", "same-secret-extended"));
        assert!(!constant_time_eq("same-secret", "same-secres"));
    }

    #[test]
    fn validates_pkce_component_charset_and_length() {
        let valid = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        assert!(is_valid_pkce_component(valid));
        assert!(!is_valid_pkce_component("short"));
        assert!(!is_valid_pkce_component(
            "contains+plus_which_is_not_allowed"
        ));
    }

    #[test]
    fn computes_rfc7636_s256_challenge() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(pkce_s256_challenge(verifier), expected);
    }

    #[test]
    fn transliterates_turkish_oauth_names_for_usernames() {
        assert_eq!(
            normalize_oauth_username_seed("\u{00C7}a\u{011F}da\u{015F} \u{015E}\u{00FC}kr\u{00FC}",),
            "cagdas_sukru"
        );
        assert_eq!(
            normalize_oauth_username_seed("\u{0130}rem \u{00D6}zt\u{00FC}rk"),
            "irem_ozturk"
        );
    }

    #[test]
    fn normalizes_general_latin_names_for_usernames() {
        assert_eq!(
            normalize_oauth_username_seed("J\u{00FC}rgen M\u{00FC}ller"),
            "jurgen_muller"
        );
        assert_eq!(
            normalize_oauth_username_seed("Fran\u{00E7}ois d'\u{00C6}vreux"),
            "francois_d_aevreux"
        );
    }

    #[test]
    fn desktop_oauth_handoff_keeps_automatic_and_manual_open_paths_safe() {
        let html = desktop_oauth_handoff_html(
            "voxpery://auth/servers?next=\"</script><script>alert(1)</script>&code=abc",
            true,
            "test-nonce",
        );

        assert!(html.contains("id=\"open-voxpery\""));
        assert!(html.contains("window.location.assign(appUrl)"));
        assert!(html.contains("<style nonce=\"test-nonce\">"));
        assert!(html.contains("<script nonce=\"test-nonce\">"));
        assert!(html.contains("You are signed in"));
        assert!(html.contains("&quot;&lt;/script&gt;"));
        assert!(
            !html.contains("id=\"sign-in-code\""),
            "malformed codes are never shown"
        );
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(!html.contains("<script>alert(1)</script>"));
    }

    #[test]
    fn desktop_oauth_handoff_shows_the_one_time_code_for_manual_entry() {
        let code = "0123456789abcdef0123456789abcdef";
        let html = desktop_oauth_handoff_html(
            &format!("voxpery://auth/servers?code={code}"),
            true,
            "test-nonce",
        );
        assert!(html.contains(&format!("<code id=\"sign-in-code\">{code}</code>")));
        assert!(html.contains("Use a sign-in code"));

        let failed = desktop_oauth_handoff_html(
            &format!("voxpery://auth/servers?code={code}"),
            false,
            "test-nonce",
        );
        assert!(!failed.contains("<code id=\"sign-in-code\">"));
    }

    #[test]
    fn desktop_oauth_failure_uses_the_branded_handoff_page() {
        let response = oauth_callback_response("voxpery://auth", "/servers", Some("oauth_failed"));

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
        let csp = response
            .headers()
            .get("content-security-policy")
            .and_then(|value| value.to_str().ok())
            .expect("desktop handoff CSP");
        assert!(csp.contains("default-src 'none'"));
        assert!(csp.contains("style-src 'nonce-"));
        assert!(csp.contains("script-src 'nonce-"));
        assert!(!csp.contains("'unsafe-inline'"));
        assert_eq!(response.headers()["cache-control"], "no-store");
    }

    #[test]
    fn linking_google_identity_keeps_only_verified_local_passwords() {
        let sql = crate::services::auth::LINK_GOOGLE_IDENTITY_SQL;
        assert!(sql.contains(
            "password_hash = CASE WHEN email_verified THEN password_hash ELSE 'oauth' END"
        ));
        assert!(sql.contains("token_version = token_version + 1"));
    }

    #[test]
    fn oauth_state_integrity_covers_registration_metadata() {
        let state = "nonce\nhttps://voxpery.com\n/social\n\nregister\n2026-08-23\n2026-08-23\n2026-08-23\n1";
        let changed = state.replace("register", "login");

        assert!(super::oauth_state_matches_cookie(Some(state), state));
        assert!(!super::oauth_state_matches_cookie(Some(&changed), state));
        assert!(!super::oauth_state_matches_cookie(None, state));
    }

    #[test]
    fn parses_current_and_rolling_deploy_oauth_legal_metadata() {
        let current =
            super::parse_oauth_legal_metadata(&["2026-08-23", "2026-08-23", "2026-08-23", "1"]);
        assert_eq!(
            current,
            (
                "2026-08-23".into(),
                "2026-08-23".into(),
                "2026-08-23".into(),
                true,
            )
        );

        let previous = super::parse_oauth_legal_metadata(&["2026-08-23", "2026-08-23", "1"]);
        assert_eq!(previous, current);
    }
}

pub(super) fn transliterate_special_latin_char(c: char) -> &'static str {
    match c {
        '\u{00DF}' => "ss",
        '\u{00E6}' => "ae",
        '\u{0153}' => "oe",
        '\u{00F8}' => "o",
        '\u{0142}' => "l",
        '\u{0111}' | '\u{00F0}' => "d",
        '\u{00FE}' => "th",
        '\u{0131}' => "i",
        _ => "",
    }
}

pub(super) fn normalize_oauth_username_seed(input: &str) -> String {
    let lower = input.trim().to_lowercase();
    let decomposed = lower.nfkd().collect::<String>();
    let mut normalized = String::with_capacity(decomposed.len());

    for c in decomposed.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.' {
            normalized.push(c);
            continue;
        }

        if is_combining_mark(c) {
            continue;
        }

        let mapped = transliterate_special_latin_char(c);
        if !mapped.is_empty() {
            normalized.push_str(mapped);
        } else {
            normalized.push('_');
        }
    }

    let mut collapsed = String::with_capacity(normalized.len());
    let mut last_was_sep = false;
    for c in normalized.chars() {
        let is_sep = c == '_' || c == '.';
        if is_sep && last_was_sep {
            continue;
        }
        collapsed.push(c);
        last_was_sep = is_sep;
    }

    collapsed
        .trim_matches(|c| c == '_' || c == '.')
        .chars()
        .take(32)
        .collect()
}

/// Query for GET /api/auth/google
#[derive(Debug, serde::Deserialize)]
pub(super) struct GoogleOAuthStartQuery {
    /// Frontend path to redirect after login (e.g. /app/friends)
    pub(super) redirect: Option<String>,
    /// Frontend origin (e.g. http://localhost:5173) for redirect after callback
    pub(super) origin: Option<String>,
    /// Desktop OAuth PKCE code challenge (S256).
    pub(super) code_challenge: Option<String>,
    /// Registration can supply acknowledgements; Login may require registration completion.
    pub(super) intent: Option<String>,
    pub(super) terms_accepted: Option<bool>,
    pub(super) terms_version: Option<String>,
    pub(super) privacy_notice_acknowledged: Option<bool>,
    pub(super) privacy_notice_version: Option<String>,
    pub(super) kvkk_notice_acknowledged: Option<bool>,
    pub(super) kvkk_notice_version: Option<String>,
}

/// GET /api/auth/google — redirect to Google OAuth. Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_API_URL.
pub(super) async fn google_oauth_start(
    State(state): State<Arc<AppState>>,
    Query(q): Query<GoogleOAuthStartQuery>,
) -> impl IntoResponse {
    if !state.google_oauth_enabled {
        return feature_disabled("Google sign-in is disabled on this server").into_response();
    }

    let (client_id, _secret) = match (
        state.google_client_id.as_ref(),
        state.google_client_secret.as_ref(),
    ) {
        (Some(id), Some(sec)) if !id.is_empty() && !sec.is_empty() => (id.as_str(), sec.as_str()),
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Google sign-in is not configured" })),
            )
                .into_response()
        }
    };
    let public_url = state
        .public_api_url
        .as_deref()
        .unwrap_or("http://localhost:3001")
        .trim_end_matches('/');
    let redirect_uri = format!("{}/api/auth/google/callback", public_url);
    let redirect_path = q.redirect.as_deref().unwrap_or("/servers").trim();
    let redirect_path = if redirect_path.starts_with('/')
        && !redirect_path.starts_with("//")
        && !redirect_path.contains(['\\', '\n', '\r'])
    {
        redirect_path
    } else {
        "/"
    };
    let origin = q
        .origin
        .as_deref()
        .unwrap_or("http://localhost:5173")
        .trim()
        .to_string();
    let origin = normalize_oauth_origin(&state, &origin);
    let is_desktop = is_desktop_oauth_origin(&origin);
    let code_challenge = q
        .code_challenge
        .as_deref()
        .map(str::trim)
        .filter(|v| is_valid_pkce_component(v))
        .map(str::to_string);
    if is_desktop && code_challenge.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing or invalid desktop PKCE challenge" })),
        )
            .into_response();
    }

    let nonce = Uuid::new_v4().to_string();
    let intent = q.intent.as_deref().unwrap_or("login").trim();
    let intent = if intent == "register" {
        "register"
    } else {
        "login"
    };
    let kvkk_notice_acknowledged = q
        .kvkk_notice_acknowledged
        .unwrap_or(q.privacy_notice_acknowledged.unwrap_or(false));
    let kvkk_notice_version = q
        .kvkk_notice_version
        .as_deref()
        .or(q.privacy_notice_version.as_deref())
        .unwrap_or("");
    let legal_acknowledged = q.terms_accepted == Some(true)
        && q.privacy_notice_acknowledged == Some(true)
        && kvkk_notice_acknowledged;
    if intent == "register" {
        if let Err(error) = validate_current_legal_documents(
            q.terms_accepted.unwrap_or(false),
            q.terms_version.as_deref().unwrap_or("").trim(),
            q.privacy_notice_acknowledged.unwrap_or(false),
            q.privacy_notice_version.as_deref().unwrap_or("").trim(),
            kvkk_notice_acknowledged,
            kvkk_notice_version.trim(),
        ) {
            return error.into_response();
        }
    }
    let state_param = BASE64.encode(format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        nonce,
        origin,
        redirect_path,
        code_challenge.as_deref().unwrap_or(""),
        intent,
        q.terms_version.as_deref().unwrap_or(""),
        q.privacy_notice_version.as_deref().unwrap_or(""),
        kvkk_notice_version,
        if legal_acknowledged { "1" } else { "0" },
    ));
    let scope = "openid email profile";
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=offline&prompt=consent",
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(&state_param),
    );

    // Bind the complete state to the HttpOnly cookie so intent, legal versions,
    // redirect metadata, and PKCE values cannot be changed before callback.
    let cookie = oauth_state_cookie_header(&state, &state_param);
    let mut response = Redirect::temporary(&url).into_response();
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, v);
    }
    response
}

/// Query for GET /api/auth/google/callback
#[derive(Debug, serde::Deserialize)]
pub(super) struct GoogleOAuthCallbackQuery {
    pub(super) code: Option<String>,
    pub(super) error: Option<String>,
    pub(super) state: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GoogleOAuthDesktopExchangeRequest {
    pub(super) code: String,
    pub(super) code_verifier: String,
}

/// POST /api/auth/google/desktop-exchange — exchange short-lived desktop OAuth code for JWT.
pub(super) async fn google_oauth_desktop_exchange(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<GoogleOAuthDesktopExchangeRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    if !state.google_oauth_enabled {
        return Err(feature_disabled(
            "Google sign-in is disabled on this server",
        ));
    }

    desktop_auth_exchange(State(state), connect_info, headers, Json(body)).await
}

/// Exchange any PKCE-bound desktop handoff, independently of OAuth configuration.
pub(super) async fn desktop_auth_exchange(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<GoogleOAuthDesktopExchangeRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    if let Some(ip) = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    ) {
        enforce_rate_limit(
            &state.redis,
            format!("auth:desktop_exchange_ip:{ip}"),
            20,
            Duration::from_secs(60),
            "Too many sign-in attempts. Please wait and try again.",
        )
        .await?;
    }
    let code = body.code.trim();
    if code.len() != 32 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Validation("Invalid desktop OAuth code".into()));
    }
    let code_verifier = body.code_verifier.trim();
    if !is_valid_pkce_component(code_verifier) {
        return Err(AppError::Validation(
            "Invalid desktop OAuth code verifier".into(),
        ));
    }

    let payload = consume_desktop_oauth_code(&state, code)
        .await?
        .ok_or(AppError::Unauthorized)?;
    let expected_challenge = payload
        .code_challenge
        .filter(|c| is_valid_pkce_component(c))
        .ok_or(AppError::Unauthorized)?;
    let computed_challenge = pkce_s256_challenge(code_verifier);
    if !constant_time_eq(&computed_challenge, &expected_challenge) {
        tracing::warn!("Desktop OAuth PKCE challenge mismatch");
        return Err(AppError::Unauthorized);
    }
    let token = payload.token;

    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, &token).await {
        Ok(true) => return Err(AppError::Unauthorized),
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Redis JWT blacklist check failed: {}", e);
            return Err(AppError::Unauthorized);
        }
    }

    let claims = jsonwebtoken::decode::<Claims>(
        &token,
        &jsonwebtoken::DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .map_err(|_| AppError::Unauthorized)?
    .claims;

    let version_ok = claims_match_current_token_version(&state.db, claims.sub, claims.ver)
        .await
        .map_err(|_| AppError::Unauthorized)?;
    if !version_ok {
        return Err(AppError::Unauthorized);
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

    Ok(Json(AuthResponse {
        token,
        user: UserPublic::from(user),
    }))
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GoogleTokenResponse {
    pub(super) access_token: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct GoogleUserInfo {
    pub(super) id: String,
    pub(super) email: Option<String>,
    pub(super) verified_email: Option<bool>,
    pub(super) name: Option<String>,
    #[serde(rename = "given_name")]
    pub(super) given_name: Option<String>,
}

/// GET /api/auth/google/callback — exchange code for token, get user, create or login, set cookie, redirect to frontend.
pub(super) async fn google_oauth_callback(
    State(state): State<Arc<AppState>>,
    Query(q): Query<GoogleOAuthCallbackQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !state.google_oauth_enabled {
        return feature_disabled("Google sign-in is disabled on this server").into_response();
    }

    let (client_id, client_secret) = match (
        state.google_client_id.as_ref(),
        state.google_client_secret.as_ref(),
    ) {
        (Some(id), Some(sec)) if !id.is_empty() && !sec.is_empty() => (id.clone(), sec.clone()),
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Google sign-in is not configured" })),
            )
                .into_response()
        }
    };
    let public_url = state
        .public_api_url
        .as_deref()
        .unwrap_or("http://localhost:3001")
        .trim_end_matches('/');
    let redirect_uri = format!("{}/api/auth/google/callback", public_url);

    let decoded_state = q
        .state
        .as_ref()
        .and_then(|s| BASE64.decode(s.as_bytes()).ok());
    let state_string = decoded_state.and_then(|b| String::from_utf8(b).ok());

    let (
        _nonce,
        origin,
        redirect_path,
        code_challenge,
        oauth_intent,
        terms_version,
        privacy_notice_version,
        kvkk_notice_version,
        legal_acknowledged,
    ) = match state_string {
        Some(ref s) => {
            let mut parts = s.splitn(9, '\n');
            let n = parts.next().unwrap_or("").trim().to_string();
            let o = parts.next().unwrap_or("").trim().to_string();
            let r = parts.next().unwrap_or("").trim().to_string();
            let c = parts.next().unwrap_or("").trim().to_string();
            let intent = parts.next().unwrap_or("login").trim().to_string();
            let legal_parts = parts.collect::<Vec<_>>();
            let (terms, privacy, kvkk, acknowledged) = parse_oauth_legal_metadata(&legal_parts);
            if n.is_empty()
                || o.is_empty()
                || !r.starts_with('/')
                || r.starts_with("//")
                || r.contains(['\\', '\n', '\r'])
            {
                tracing::warn!(
                    "OAuth state parsing failed. nonce_present={}, origin_len={}, redirect_len={}, pkce_challenge_present={}",
                    !n.is_empty(),
                    o.len(),
                    r.len(),
                    !c.is_empty()
                );
                (
                    "".to_string(),
                    "http://localhost:5173".to_string(),
                    "/servers".to_string(),
                    None,
                    "login".to_string(),
                    String::new(),
                    String::new(),
                    String::new(),
                    false,
                )
            } else {
                (
                    n,
                    o,
                    r,
                    if c.is_empty() { None } else { Some(c) },
                    intent,
                    terms,
                    privacy,
                    kvkk,
                    acknowledged,
                )
            }
        }
        None => {
            tracing::warn!("OAuth state was None or decoding failed.");
            (
                "".to_string(),
                "http://localhost:5173".to_string(),
                "/servers".to_string(),
                None,
                "login".to_string(),
                String::new(),
                String::new(),
                String::new(),
                false,
            )
        }
    };
    let origin = normalize_oauth_origin(&state, &origin);
    let failure = |error: &str| {
        let mut response = oauth_callback_response(&origin, &redirect_path, Some(error));
        if let Ok(value) = HeaderValue::from_str(&clear_oauth_state_cookie_header(&state)) {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
        response
    };

    let mut is_csrf_valid = false;
    let mut found_oauth_state = None;
    if let Some(cookie_header) = headers.get(header::COOKIE) {
        if let Ok(cookie_str) = cookie_header.to_str() {
            for part in cookie_str.split(';') {
                let part = part.trim();
                let prefix = "oauth_state=";
                if let Some(cookie_val) = part.strip_prefix(prefix) {
                    found_oauth_state = Some(cookie_val.to_string());
                    if oauth_state_matches_cookie(q.state.as_deref(), cookie_val) {
                        is_csrf_valid = true;
                    }
                    break;
                }
            }
        }
    }

    if !is_csrf_valid {
        tracing::warn!(
            "OAuth CSRF check failed (state mismatch or missing cookie). has_cookie_state={}",
            found_oauth_state.is_some()
        );
        return failure("oauth_failed_csrf");
    }

    // Google returns an error without a code when consent is denied. Validate
    // the state first, then return to the originating client without a token request.
    if let Some(error) = q.error.as_deref() {
        return failure(if error == "access_denied" {
            "oauth_cancelled"
        } else {
            "oauth_failed"
        });
    }
    let code = match q
        .code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
    {
        Some(code) => code,
        None => return failure("oauth_failed"),
    };

    let token_url = "https://oauth2.googleapis.com/token";
    let body = [
        ("code", code),
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("redirect_uri", &redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    // Bounded so a slow or unreachable Google cannot hold the sign-in request open.
    let client = match reqwest::Client::builder()
        .timeout(GOOGLE_OAUTH_HTTP_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            tracing::warn!("Google OAuth client setup failed: {}", e);
            return failure("oauth_failed");
        }
    };
    let token_res = match client.post(token_url).form(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Google token exchange failed: {}", e);
            return failure("oauth_failed");
        }
    };
    if !token_res.status().is_success() {
        let status = token_res.status();
        let body_len = token_res.text().await.map(|b| b.len()).unwrap_or(0);
        tracing::warn!(
            "Google token response error: {} (redacted body, {} bytes)",
            status,
            body_len
        );
        return failure("oauth_failed");
    }
    let token_data: GoogleTokenResponse = match token_res.json().await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("Google token parse failed: {}", e);
            return failure("oauth_failed");
        }
    };

    let userinfo_res = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token_data.access_token)
        .send()
        .await;
    let userinfo: GoogleUserInfo = match userinfo_res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!("Google userinfo parse failed: {}", e);
                return failure("oauth_failed");
            }
        },
        _ => {
            tracing::warn!("Google userinfo request failed");
            return failure("oauth_failed");
        }
    };

    let google_id = userinfo.id;
    let email = userinfo
        .email
        .filter(|e| e.contains('@'))
        .unwrap_or_else(|| format!("{}@oauth.local", google_id));
    let email = email.trim().to_lowercase();

    if userinfo.verified_email != Some(true) {
        tracing::warn!(
            "Google OAuth login rejected: unverified email ({})",
            redact_email_for_log(&email)
        );
        return failure("oauth_unverified_email");
    }

    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE google_id = $1 OR (google_id IS NULL AND lower(email) = $2)",
    )
    .bind(&google_id)
    .bind(&email)
    .fetch_optional(&state.db)
    .await;

    let user = match user {
        Ok(Some(mut u)) => {
            if u.google_id.is_none() {
                if let Err(error) =
                    crate::services::auth::link_google_identity(&state.db, u.id, &google_id).await
                {
                    tracing::warn!("Google OAuth account link failed: {}", error);
                    return failure("oauth_failed");
                }
                if !u.email_verified {
                    u.password_hash = "oauth".to_string();
                }
                u.google_id = Some(google_id.clone());
                u.email_verified = true;
                u.token_version += 1;
            }
            u
        }
        Ok(None) => {
            // New user: create account
            if oauth_intent != "register"
                || !legal_acknowledged
                || validate_current_legal_documents(
                    true,
                    &terms_version,
                    true,
                    &privacy_notice_version,
                    true,
                    &kvkk_notice_version,
                )
                .is_err()
            {
                return match google_registration::begin(
                    &state,
                    &google_id,
                    &email,
                    userinfo
                        .name
                        .as_deref()
                        .or(userinfo.given_name.as_deref())
                        .unwrap_or("user"),
                    &origin,
                    &redirect_path,
                    code_challenge.as_deref(),
                )
                .await
                {
                    Ok(response) => response,
                    Err(error) => error.into_response(),
                };
            }
            let name = userinfo
                .name
                .or(userinfo.given_name)
                .unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_string())
                .to_lowercase();
            let mut tx = match state.db.begin().await {
                Ok(tx) => tx,
                Err(e) => {
                    tracing::warn!("Google OAuth transaction start failed: {}", e);
                    return failure("oauth_failed");
                }
            };
            let user = match google_registration::create_account(&mut tx, &google_id, &email, &name)
                .await
            {
                Ok(user) => user,
                Err(error) => {
                    tracing::warn!("Google OAuth account creation failed: {error}");
                    return failure("oauth_failed");
                }
            };
            if let Err(e) = tx.commit().await {
                tracing::warn!("Google OAuth transaction commit failed: {}", e);
                return failure("oauth_failed");
            }
            user
        }
        Err(e) => {
            tracing::warn!("Google OAuth db lookup failed: {}", e);
            return failure("oauth_failed");
        }
    };

    if let Err(e) = ensure_default_server_join(&state.db, user.id).await {
        tracing::warn!("Default server join failed for OAuth user: {}", e);
        return failure("oauth_failed");
    }

    let token = match generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("JWT generate failed: {}", e);
            return failure("oauth_failed");
        }
    };

    let cookie_headers = auth_cookie_header(&state, &token);
    let is_desktop = is_desktop_oauth_origin(&origin);
    let redirect_url = if is_desktop {
        let challenge = match code_challenge
            .as_deref()
            .map(str::trim)
            .filter(|v| is_valid_pkce_component(v))
        {
            Some(value) => value,
            None => {
                tracing::warn!("Desktop OAuth callback missing PKCE challenge in state");
                return failure("oauth_failed");
            }
        };
        let exchange_code = match issue_desktop_oauth_code(&state, &token, challenge).await {
            Ok(code) => code,
            Err(e) => {
                tracing::warn!("Failed to issue desktop OAuth code: {}", e);
                return failure("oauth_failed");
            }
        };
        let path_with_code = append_query_param(&redirect_path, "code", &exchange_code);
        format!("{}{}", DESKTOP_OAUTH_ORIGIN, path_with_code)
    } else {
        format!("{}{}", origin, redirect_path)
    };

    let mut response = if is_desktop {
        desktop_oauth_handoff_response(&redirect_url, true)
    } else {
        Redirect::temporary(&redirect_url).into_response()
    };

    let clear_oauth_state = clear_oauth_state_cookie_header(&state);
    if let Ok(v) = HeaderValue::from_str(&clear_oauth_state) {
        response.headers_mut().append(header::SET_COOKIE, v);
    }

    // Desktop receives its session only through the PKCE exchange; do not also sign in the
    // system browser that completed the OAuth flow.
    if !is_desktop {
        for (k, v) in cookie_headers.iter() {
            if let Ok(v) = v.to_str() {
                response.headers_mut().append(
                    k.clone(),
                    HeaderValue::from_str(v).unwrap_or(HeaderValue::from_static("")),
                );
            }
        }
    }
    response
}
