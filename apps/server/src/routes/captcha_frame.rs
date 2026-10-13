//! CAPTCHA frame for in-app registration in the desktop app.
//!
//! Turnstile does not run on the desktop webview origin, so the desktop registration form
//! embeds this API-hosted page in an iframe. The page solves the challenge and posts only the
//! Turnstile token to the parent desktop origin; registration verifies it with Siteverify like
//! every other CAPTCHA token. Only the desktop app origins (and local development origins that
//! are configured for CORS) may embed the page.

use super::*;

/// Origins of the packaged desktop app: WebView2 and the Linux CEF build use
/// `https://tauri.localhost`, macOS uses `tauri://localhost`.
const DESKTOP_APP_ORIGINS: [&str; 3] = [
    "https://tauri.localhost",
    "http://tauri.localhost",
    "tauri://localhost",
];

#[derive(Debug, serde::Deserialize)]
pub(super) struct FrameQuery {
    parent: Option<String>,
}

fn is_local_dev_origin(origin: &str) -> bool {
    ["http://localhost:", "http://127.0.0.1:"]
        .iter()
        .any(|prefix| {
            origin
                .strip_prefix(prefix)
                .is_some_and(|port| !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()))
        })
}

fn allowed_parent(state: &AppState, parent: &str) -> bool {
    DESKTOP_APP_ORIGINS.contains(&parent)
        || (is_local_dev_origin(parent) && state.cors_origins.iter().any(|origin| origin == parent))
}

fn frame_html(site_key: &str, parent: &str, nonce: &str) -> String {
    let site_key = escape_html_attribute(site_key);
    let parent = javascript_string_literal(parent);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>CAPTCHA - Voxpery</title>
<style nonce="{nonce}">
    html, body {{ margin: 0; background: transparent; color: #bdc9e3; font: 13px Inter, ui-sans-serif, system-ui, sans-serif; }}
    #captcha {{ min-height: 65px; }}
    #status {{ margin: 6px 0 0; }}
    #status:empty {{ display: none; }}
    #retry {{ margin-top: 6px; padding: 6px 12px; border: 1px solid #44577f; border-radius: 6px; background: #1b2544; color: #f4f7ff; font: inherit; cursor: pointer; }}
</style>
</head>
<body>
<div id="captcha" data-sitekey="{site_key}"></div>
<p id="status" role="status">Loading CAPTCHA...</p>
<button type="button" id="retry" hidden>Retry CAPTCHA</button>
<script nonce="{nonce}">
    const parentOrigin = {parent};
    const container = document.getElementById("captcha");
    const status = document.getElementById("status");
    const retry = document.getElementById("retry");
    let attempt = 0;
    let widget;
    let timeout;
    const post = (message) => window.parent.postMessage({{ source: "voxpery-captcha", ...message }}, parentOrigin);
    const reportSize = () => post({{ type: "size", height: Math.ceil(document.body.scrollHeight) }});
    new ResizeObserver(reportSize).observe(document.body);
    const fail = (message) => {{
        attempt += 1;
        clearTimeout(timeout);
        post({{ type: "token", token: null }});
        status.textContent = message;
        status.setAttribute("role", "alert");
        retry.hidden = false;
        if (widget !== undefined) {{
            try {{ window.turnstile.remove(widget); }} catch {{ /* The provider may be unavailable. */ }}
            widget = undefined;
        }}
    }};
    const render = (current) => {{
        clearTimeout(timeout);
        if (current !== attempt) return;
        if (typeof window.turnstile?.render !== "function") {{ fail("CAPTCHA could not be initialized. Try again."); return; }}
        status.textContent = "";
        try {{
            widget = window.turnstile.render(container, {{
                sitekey: container.dataset.sitekey,
                size: "flexible",
                theme: "dark",
                callback: (token) => {{ if (current === attempt) post({{ type: "token", token }}); }},
                "expired-callback": () => {{ if (current === attempt) post({{ type: "token", token: null }}); }},
                "error-callback": () => {{ if (current === attempt) fail("CAPTCHA verification failed. Try again."); }},
                "timeout-callback": () => {{ if (current === attempt) fail("CAPTCHA timed out. Try again."); }},
                "unsupported-callback": () => {{ if (current === attempt) fail("CAPTCHA is not supported here."); }},
            }});
        }} catch {{ fail("CAPTCHA could not be initialized. Try again."); }}
    }};
    const load = () => {{
        const current = ++attempt;
        retry.hidden = true;
        status.setAttribute("role", "status");
        status.textContent = "Loading CAPTCHA...";
        if (window.turnstile) {{ render(current); return; }}
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.nonce = "{nonce}";
        script.onload = () => render(current);
        script.onerror = () => {{ if (current === attempt) fail("CAPTCHA could not be loaded. Check your connection and try again."); }};
        timeout = setTimeout(() => {{ if (current === attempt) fail("CAPTCHA loading timed out. Check your connection and try again."); }}, 15000);
        document.head.appendChild(script);
    }};
    // The registration form asks for a fresh challenge after a failed attempt.
    window.addEventListener("message", (event) => {{
        if (event.origin !== parentOrigin || event.source !== window.parent) return;
        if (event.data?.source === "voxpery-registration" && event.data.type === "reset" && widget !== undefined) {{
            try {{ window.turnstile.reset(widget); }} catch {{ load(); }}
            post({{ type: "token", token: null }});
        }}
    }});
    retry.addEventListener("click", load);
    load();
</script>
</body>
</html>"#
    )
}

/// GET /api/auth/captcha-frame?parent=<desktop app origin>
pub(super) async fn show(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FrameQuery>,
) -> Response {
    let parent = query.parent.unwrap_or_default();
    let Some(site_key) = state.turnstile_site_key.as_deref() else {
        return (StatusCode::NOT_FOUND, "CAPTCHA is not configured").into_response();
    };
    if !allowed_parent(&state, &parent) {
        return (StatusCode::BAD_REQUEST, "Unsupported app origin").into_response();
    }

    let nonce = Uuid::new_v4().simple().to_string();
    let csp = format!(
        "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors {parent}; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com"
    );
    let mut response = Html(frame_html(site_key, &parent, &nonce)).into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&csp) {
        headers.insert(HeaderName::from_static("content-security-policy"), value);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::{frame_html, is_local_dev_origin, DESKTOP_APP_ORIGINS};

    #[test]
    fn only_desktop_and_numeric_local_origins_qualify() {
        assert!(DESKTOP_APP_ORIGINS.contains(&"https://tauri.localhost"));
        assert!(is_local_dev_origin("http://localhost:5173"));
        assert!(is_local_dev_origin("http://127.0.0.1:1420"));
        for rejected in [
            "http://localhost",
            "http://localhost:5173/path",
            "http://localhost:5173.evil.test",
            "https://voxpery.com",
            "http://127.0.0.1:",
        ] {
            assert!(!is_local_dev_origin(rejected), "{rejected}");
        }
    }

    #[test]
    fn frame_posts_only_to_the_escaped_parent_origin() {
        // A fresh nonce, as `show` generates one per response.
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let html = frame_html("site\"key", "https://tauri.localhost", &nonce);
        assert!(html.contains("const parentOrigin = \"https://tauri.localhost\";"));
        assert!(html.contains("data-sitekey=\"site&quot;key\""));
        assert!(html.contains("postMessage({ source: \"voxpery-captcha\", ...message }, parentOrigin)"));
        assert!(html.contains(&format!("<script nonce=\"{nonce}\">")));
    }
}
