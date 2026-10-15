//! Optional self-hosted Voxpery server (docs/DESKTOP_RELEASE_HARDENING.md, "Custom Server").
//!
//! The choice is validated and stored here, never by the webview: the address must be an origin
//! (`https`, or `http` only for local and private-network hosts), the server must answer
//! `/api/system/features` like a Voxpery server, and the user must confirm they trust it. It takes
//! effect on the next start, when the HTTP scope, the CSP and the API base are derived from it.
//!
//! Users may enter the website address instead of the API: when the address is not an API, the
//! website's `/.well-known/voxpery/client` names it, and that API passes the same checks.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::utils::config::{Csp, CspDirectiveSources};
use tauri::{AppHandle, Manager, Runtime, Url};

const SETTINGS_FILE: &str = "custom-server.json";
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_PROBE_BYTES: usize = 64 * 1024;
const DISCOVERY_PATH: &str = "/.well-known/voxpery/client";
const NOT_VOXPERY: &str = "This address is not a Voxpery server. Enter the server's website, such as https://chat.example.org, or its API address, such as https://api.example.org";
const UNREACHABLE: &str = "Could not reach the server. Check the address and your connection";

/// The server chosen by the user; `None` in [`ActiveServer`] means voxpery.com.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomServer {
    /// Origin of the API, e.g. `https://chat.example.org`.
    pub api_origin: String,
    /// Origin of the server's LiveKit (`voice_url`), when it publishes one.
    pub voice_origin: Option<String>,
}

/// The server this process talks to, fixed at startup.
pub struct ActiveServer(pub Option<CustomServer>);

/// What the webview may know about a checked or active server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    pub api_origin: String,
    pub voice_origin: Option<String>,
    /// True for `http` servers, which the UI must warn about.
    pub insecure: bool,
    /// The website the user entered, when it named a different API origin.
    pub site_origin: Option<String>,
}

impl From<&CustomServer> for ServerView {
    fn from(server: &CustomServer) -> Self {
        Self {
            insecure: server.api_origin.starts_with("http:"),
            api_origin: server.api_origin.clone(),
            voice_origin: server.voice_origin.clone(),
            site_origin: None,
        }
    }
}

fn is_private_or_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

fn allows_plain_http(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(ip) => is_private_or_local_ip(ip),
        Err(_) => {
            let name = host.trim_end_matches('.').to_ascii_lowercase();
            name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local")
        }
    }
}

/// Reduces user input to an origin. `secure`/`plain` are the accepted schemes for this kind of
/// address (`https`/`http` for the API, `wss`/`ws` for voice); the plain one only for local hosts.
fn normalize_origin(input: &str, secure: &str, plain: &str) -> Result<String, String> {
    let trimmed = input.trim();
    let url = Url::parse(trimmed)
        .map_err(|_| "Enter a full address, such as https://chat.example.org".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("The address must not contain a user name or password".into());
    }
    if url.query().is_some() || url.fragment().is_some() || !matches!(url.path(), "" | "/") {
        return Err("Enter only the server address, without a path".into());
    }
    if url.host().is_none() {
        return Err("The address has no host".into());
    }
    let scheme = url.scheme();
    if scheme == plain {
        if !allows_plain_http(&url) {
            return Err(format!(
                "Use {secure}:// for servers outside your computer or local network"
            ));
        }
    } else if scheme != secure {
        return Err(format!("The address must start with {secure}://"));
    }
    Ok(url.origin().ascii_serialization())
}

pub fn normalize_api_origin(input: &str) -> Result<String, String> {
    normalize_origin(input, "https", "http")
}

/// Accepts the server's `voice_url`; returns the matching `https`/`http` origin for the CSP and
/// whether it is valid at all. A voice URL may carry a path (LiveKit behind a reverse proxy).
fn voice_origin_from_url(voice_url: &str) -> Option<String> {
    let mut url = Url::parse(voice_url.trim()).ok()?;
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    normalize_origin(url.as_str(), "wss", "ws").ok()
}

/// Checks that a `/api/system/features` body comes from a Voxpery server and extracts its
/// voice origin.
fn parse_features(body: &[u8]) -> Result<Option<String>, String> {
    let value: serde_json::Value = serde_json::from_slice(body)
        .map_err(|_| "This address is not a Voxpery server".to_string())?;
    let looks_like_voxpery = [
        "google_oauth_enabled",
        "password_reset_enabled",
        "email_verification_enabled",
    ]
    .iter()
    .all(|key| value.get(key).is_some_and(serde_json::Value::is_boolean));
    if !looks_like_voxpery {
        return Err("This address is not a Voxpery server".into());
    }
    match value.get("voice_url").and_then(serde_json::Value::as_str) {
        Some(url) if !url.trim().is_empty() => voice_origin_from_url(url)
            .map(Some)
            .ok_or_else(|| "The server's voice address is not allowed".to_string()),
        _ => Ok(None),
    }
}

/// Reads a website's `/.well-known/voxpery/client` and returns the API origin it names. The API
/// follows the usual address rules and may not drop from `https` to `http`.
fn parse_discovery(body: &[u8], site_origin: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| NOT_VOXPERY.to_string())?;
    let api = value
        .get("api_base_url")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| NOT_VOXPERY.to_string())?;
    let api_origin = normalize_api_origin(api).map_err(|_| {
        "This website names a Voxpery server address that is not allowed".to_string()
    })?;
    if site_origin.starts_with("https:") && !api_origin.starts_with("https:") {
        return Err("This website names an unencrypted Voxpery server".into());
    }
    Ok(api_origin)
}

enum Fetched {
    Body(Vec<u8>),
    /// The host answered, but not with a success status.
    NotFound,
}

/// GET with redirects off, a timeout and a size cap; nothing else is followed or trusted.
async fn fetch(url: &str) -> Result<Fetched, String> {
    use tauri_plugin_http::reqwest;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|_| "Could not check the server".to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    if !response.status().is_success() {
        return Ok(Fetched::NotFound);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the server's answer".to_string())?
    {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_PROBE_BYTES {
            return Err(NOT_VOXPERY.into());
        }
    }
    Ok(Fetched::Body(body))
}

async fn probe(api_origin: &str) -> Result<CustomServer, String> {
    match fetch(&format!("{api_origin}/api/system/features")).await? {
        Fetched::Body(body) => Ok(CustomServer {
            api_origin: api_origin.to_string(),
            voice_origin: parse_features(&body)?,
        }),
        Fetched::NotFound => Err(NOT_VOXPERY.into()),
    }
}

/// Finds the Voxpery server for an address the user entered: the address itself when it is an
/// API, otherwise the API its website names. Returns the server and, for a website, its origin.
async fn resolve(origin: &str) -> Result<(CustomServer, Option<String>), String> {
    let direct = match probe(origin).await {
        Ok(server) => return Ok((server, None)),
        Err(error) if error == UNREACHABLE => return Err(error),
        Err(error) => error,
    };
    let api_origin = match fetch(&format!("{origin}{DISCOVERY_PATH}")).await? {
        Fetched::Body(body) => parse_discovery(&body, origin)?,
        Fetched::NotFound => return Err(direct),
    };
    if api_origin == origin {
        return Err(direct);
    }
    let server = probe(&api_origin).await?;
    Ok((server, Some(origin.to_string())))
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(SETTINGS_FILE))
}

/// Reads the stored server; anything that no longer validates falls back to voxpery.com.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Option<CustomServer> {
    let raw = std::fs::read(settings_path(app)?).ok()?;
    let stored: CustomServer = serde_json::from_slice(&raw).ok()?;
    let api_origin = normalize_api_origin(&stored.api_origin).ok()?;
    let voice_origin = match stored.voice_origin.as_deref() {
        Some(origin) => Some(voice_origin_from_url(origin)?),
        None => None,
    };
    (api_origin == stored.api_origin).then_some(CustomServer {
        api_origin,
        voice_origin,
    })
}

fn store<R: Runtime>(app: &AppHandle<R>, server: Option<&CustomServer>) -> Result<(), String> {
    let path = settings_path(app).ok_or("The app settings folder is unavailable")?;
    match server {
        Some(server) => {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|_| "Could not save the server setting")?;
            }
            let json = serde_json::to_vec_pretty(server)
                .map_err(|_| "Could not save the server setting")?;
            std::fs::write(&path, json).map_err(|_| "Could not save the server setting".into())
        }
        None => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Could not reset the server setting".into()),
        },
    }
}

/// Keyring account for `key`: voxpery.com keeps the original names, so existing sessions stay;
/// a custom server gets its own entry, so one server's session is never sent to another.
pub fn keyring_account(key: &str, server: Option<&CustomServer>) -> String {
    match server {
        Some(server) => format!("{key}@{}", server.api_origin),
        None => key.to_string(),
    }
}

/// Origins a page may connect to for this server: the API (HTTP and WebSocket) and its voice
/// server (WebSocket and the HTTP fallback LiveKit uses).
fn connect_sources(server: &CustomServer) -> Vec<String> {
    let mut sources = Vec::new();
    for origin in std::iter::once(&server.api_origin).chain(server.voice_origin.iter()) {
        let (http, ws) = match origin.split_once("://") {
            Some(("https" | "wss", rest)) => (format!("https://{rest}"), format!("wss://{rest}")),
            Some((_, rest)) => (format!("http://{rest}"), format!("ws://{rest}")),
            None => continue,
        };
        for source in [http, ws] {
            if !sources.contains(&source) {
                sources.push(source);
            }
        }
    }
    sources
}

/// Adds the custom server to a CSP header value: connections, the CAPTCHA frame and images.
pub fn extend_csp(csp: &str, server: &CustomServer) -> String {
    let mut map: HashMap<String, CspDirectiveSources> = Csp::Policy(csp.to_string()).into();
    let mut add = |directive: &str, source: &str| {
        let entry = map.entry(directive.to_string()).or_default();
        if !entry.contains(source) {
            entry.push(source);
        }
    };
    for source in connect_sources(server) {
        add("connect-src", &source);
    }
    add("frame-src", &server.api_origin);
    add("img-src", &server.api_origin);
    Csp::from(map).to_string()
}

/// Defines `window.__VOXPERY_DESKTOP_SERVER__` before the app's scripts run.
pub fn initialization_script(server: &CustomServer) -> String {
    let value = serde_json::json!({ "apiBase": server.api_origin });
    format!("Object.defineProperty(window, '__VOXPERY_DESKTOP_SERVER__', {{ value: Object.freeze({value}), writable: false, configurable: false }});")
}

#[tauri::command]
pub fn desktop_custom_server(state: tauri::State<'_, ActiveServer>) -> Option<ServerView> {
    state.0.as_ref().map(ServerView::from)
}

/// Checks an address the user typed (a Voxpery API or a website that names one); nothing is
/// stored.
#[tauri::command]
pub async fn desktop_probe_custom_server(address: String) -> Result<ServerView, String> {
    let origin = normalize_api_origin(&address)?;
    let (server, site_origin) = resolve(&origin).await?;
    Ok(ServerView {
        site_origin,
        ..ServerView::from(&server)
    })
}

/// Stores the server (checked again here) after the user confirmed they trust it, or returns
/// to voxpery.com with `None`, then restarts so the new scope and CSP apply.
#[tauri::command]
pub async fn desktop_set_custom_server<R: Runtime>(
    app: AppHandle<R>,
    address: Option<String>,
    trusted: bool,
) -> Result<(), String> {
    let server = match address {
        Some(address) => {
            if !trusted {
                return Err("Confirm that you trust this server first".into());
            }
            let origin = normalize_api_origin(&address)?;
            Some(resolve(&origin).await?.0)
        }
        None => None,
    };
    store(&app, server.as_ref())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(api: &str, voice: Option<&str>) -> CustomServer {
        CustomServer {
            api_origin: api.into(),
            voice_origin: voice.map(Into::into),
        }
    }

    #[test]
    fn accepts_https_origins_and_local_http_only() {
        assert_eq!(
            normalize_api_origin(" https://Chat.Example.org/ ").unwrap(),
            "https://chat.example.org"
        );
        assert_eq!(
            normalize_api_origin("https://chat.example.org:8443").unwrap(),
            "https://chat.example.org:8443"
        );
        for local in [
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://192.168.1.20",
            "http://10.0.0.5:3001",
            "http://[::1]:3001",
            "http://voxpery.local",
        ] {
            assert!(normalize_api_origin(local).is_ok(), "{local}");
        }
        for rejected in [
            "http://chat.example.org",
            "http://8.8.8.8",
            "ftp://chat.example.org",
            "javascript:alert(1)",
            "https://user:pass@chat.example.org",
            "https://chat.example.org/api",
            "https://chat.example.org/?x=1",
            "chat.example.org",
            "",
        ] {
            assert!(normalize_api_origin(rejected).is_err(), "{rejected}");
        }
    }

    #[test]
    fn requires_a_voxpery_feature_response() {
        let ok = br#"{"google_oauth_enabled":false,"password_reset_enabled":true,"email_verification_enabled":false,"voice_url":"wss://livekit.example.org"}"#;
        assert_eq!(
            parse_features(ok).unwrap().as_deref(),
            Some("wss://livekit.example.org")
        );
        let no_voice = br#"{"google_oauth_enabled":false,"password_reset_enabled":true,"email_verification_enabled":false}"#;
        assert_eq!(parse_features(no_voice).unwrap(), None);
        assert!(parse_features(b"<html>").is_err());
        assert!(parse_features(br#"{"status":"ok"}"#).is_err());
        let public_plain_voice = br#"{"google_oauth_enabled":false,"password_reset_enabled":true,"email_verification_enabled":false,"voice_url":"ws://livekit.example.org"}"#;
        assert!(parse_features(public_plain_voice).is_err());
    }

    #[test]
    fn reads_the_api_a_website_names() {
        let named = |api: &str| format!(r#"{{"api_base_url":"{api}"}}"#).into_bytes();
        assert_eq!(
            parse_discovery(
                &named("https://api.example.org/"),
                "https://chat.example.org"
            )
            .unwrap(),
            "https://api.example.org"
        );
        assert_eq!(
            parse_discovery(&named("http://localhost:3001"), "http://localhost:5173").unwrap(),
            "http://localhost:3001"
        );
        for (body, site) in [
            (b"<!doctype html>".to_vec(), "https://chat.example.org"),
            (
                br#"{"api":"https://api.example.org"}"#.to_vec(),
                "https://chat.example.org",
            ),
            (
                named("https://api.example.org/v1"),
                "https://chat.example.org",
            ),
            (named("http://api.example.org"), "https://chat.example.org"),
            // A public website may not send the app to a local, unencrypted address.
            (named("http://localhost:3001"), "https://chat.example.org"),
            (named("javascript:alert(1)"), "https://chat.example.org"),
        ] {
            assert!(parse_discovery(&body, site).is_err(), "{site}");
        }
    }

    /// Serves canned answers on 127.0.0.1: `(path, status, body)`; other paths get 404.
    fn serve(routes: Vec<(&'static str, u16, String)>) -> String {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                let path = request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                    line.clear();
                }
                let (status, body) = routes
                    .iter()
                    .find(|(route, _, _)| *route == path)
                    .map(|(_, status, body)| (*status, body.clone()))
                    .unwrap_or((404, String::new()));
                let _ = (&stream).write_all(
                    format!(
                        "HTTP/1.1 {status} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
            }
        });
        origin
    }

    const FEATURES: &str = r#"{"google_oauth_enabled":false,"password_reset_enabled":true,"email_verification_enabled":false}"#;

    #[test]
    fn finds_the_server_from_its_website_or_its_api() {
        let api = serve(vec![("/api/system/features", 200, FEATURES.into())]);
        let site = serve(vec![(
            "/.well-known/voxpery/client",
            200,
            format!(r#"{{"api_base_url":"{api}"}}"#),
        )]);
        let (server, site_origin) = tauri::async_runtime::block_on(resolve(&api)).unwrap();
        assert_eq!(
            (server.api_origin.as_str(), site_origin),
            (api.as_str(), None)
        );
        let (server, site_origin) = tauri::async_runtime::block_on(resolve(&site)).unwrap();
        assert_eq!(server.api_origin, api);
        assert_eq!(site_origin.as_deref(), Some(site.as_str()));
    }

    #[test]
    fn explains_why_an_address_is_not_a_server() {
        // A single-page website answers every path with its HTML page.
        let spa = serve(vec![
            ("/api/system/features", 200, "<!doctype html>".into()),
            ("/.well-known/voxpery/client", 200, "<!doctype html>".into()),
        ]);
        let empty = serve(Vec::new());
        // An empty discovery file is refused.
        let blank = serve(vec![("/.well-known/voxpery/client", 200, String::new())]);
        for origin in [spa, empty] {
            let error = tauri::async_runtime::block_on(resolve(&origin)).unwrap_err();
            assert_eq!(error, NOT_VOXPERY, "{origin}");
        }
        assert!(tauri::async_runtime::block_on(resolve(&blank)).is_err());
        let closed = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", listener.local_addr().unwrap())
        };
        assert_eq!(
            tauri::async_runtime::block_on(resolve(&closed)).unwrap_err(),
            UNREACHABLE
        );
    }

    #[test]
    fn keeps_sessions_per_server() {
        assert_eq!(
            keyring_account("voxpery-auth-token", None),
            "voxpery-auth-token"
        );
        assert_eq!(
            keyring_account(
                "voxpery-auth-token",
                Some(&server("https://chat.example.org", None))
            ),
            "voxpery-auth-token@https://chat.example.org"
        );
    }

    #[test]
    fn extends_the_csp_with_only_the_chosen_server() {
        let csp = "default-src 'self'; connect-src ipc: 'self' https://api.voxpery.com; frame-src https://api.voxpery.com; img-src 'self' https:";
        let extended = extend_csp(
            csp,
            &server("https://chat.example.org", Some("wss://voice.example.org")),
        );
        let map: HashMap<String, CspDirectiveSources> = Csp::Policy(extended).into();
        let connect = &map["connect-src"];
        for source in [
            "https://api.voxpery.com",
            "https://chat.example.org",
            "wss://chat.example.org",
            "https://voice.example.org",
            "wss://voice.example.org",
        ] {
            assert!(connect.contains(source), "{source}");
        }
        assert!(map["frame-src"].contains("https://chat.example.org"));
        assert!(map["img-src"].contains("https://chat.example.org"));
        assert_eq!(
            Vec::<String>::from(map["default-src"].clone()),
            vec!["'self'".to_string()]
        );

        let local = extend_csp(csp, &server("http://localhost:3001", None));
        let map: HashMap<String, CspDirectiveSources> = Csp::Policy(local).into();
        assert!(map["connect-src"].contains("ws://localhost:3001"));
    }

    #[test]
    fn initialization_script_embeds_the_origin_as_data() {
        let script = initialization_script(&server("https://chat.example.org", None));
        assert!(script.contains(r#"{"apiBase":"https://chat.example.org"}"#));
    }
}
