//! API integration tests. Require a running PostgreSQL and env vars:
//! - DATABASE_URL (or TEST_DATABASE_URL)
//! - JWT_SECRET (or set in .env)
//!
//! Run with: `cargo test --test integration` (from apps/server).
//! Skip DB tests if DATABASE_URL is not set: `cargo test --test integration -- --ignore`.

mod attachments;
mod auth;
mod direct_messages;
mod messages;
mod platform;
mod realtime;
mod security;
mod servers;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{
    postgres::{PgConnection, PgPoolOptions},
    Connection,
};
use std::{
    io::{Cursor, Read},
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tokio::sync::broadcast;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::WebSocketStream;
use tower::ServiceExt;
use uuid::Uuid;
use voxpery_server::{
    build_app, run_migrations,
    services::{
        auth::generate_token,
        image_proxy_grant,
        privacy::{
            CURRENT_KVKK_NOTICE_VERSION, CURRENT_PRIVACY_NOTICE_VERSION, CURRENT_TERMS_VERSION,
        },
    },
    AppState,
};

fn test_db_url() -> Option<String> {
    dotenvy::dotenv().ok();
    let raw = std::env::var("TEST_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())?;
    Some(normalize_compose_host(raw, "postgres", "127.0.0.1"))
}

fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| test_credential("jwt").to_string())
}

fn test_credential(label: &str) -> &'static str {
    Box::leak(format!("test-credential-{label}-{}", Uuid::new_v4().as_simple()).into_boxed_str())
}

fn registration_body(email: &str, username: &str, password: &str) -> serde_json::Value {
    json!({
        "email": email,
        "username": username,
        "password": password,
        "terms_accepted": true,
        "terms_version": CURRENT_TERMS_VERSION,
        "privacy_notice_acknowledged": true,
        "privacy_notice_version": CURRENT_PRIVACY_NOTICE_VERSION,
        "kvkk_notice_acknowledged": true,
        "kvkk_notice_version": CURRENT_KVKK_NOTICE_VERSION
    })
}

fn normalize_compose_host(url: String, service_host: &str, fallback_host: &str) -> String {
    let at_pattern = format!("@{service_host}:");
    let scheme_port_pattern = format!("://{service_host}:");
    let scheme_path_pattern = format!("://{service_host}/");

    url.replace(&at_pattern, &format!("@{fallback_host}:"))
        .replace(&scheme_port_pattern, &format!("://{fallback_host}:"))
        .replace(&scheme_path_pattern, &format!("://{fallback_host}/"))
}

fn redis_client() -> redis::Client {
    let redis_url = std::env::var("TEST_REDIS_URL")
        .ok()
        .or_else(|| std::env::var("REDIS_URL").ok())
        .unwrap_or_else(|| "redis://localhost:6379".into());
    let redis_url = normalize_compose_host(redis_url, "redis", "127.0.0.1");
    redis::Client::open(redis_url).expect("Failed to create Redis client for integration tests")
}

async fn setup_app() -> (axum::Router, Arc<AppState>) {
    setup_app_with_auth_features(false, false).await
}

async fn setup_app_with_auth_features(
    email_verification_enabled: bool,
    password_reset_enabled: bool,
) -> (axum::Router, Arc<AppState>) {
    setup_app_with_features(
        email_verification_enabled,
        password_reset_enabled,
        false,
        false,
    )
    .await
}

async fn setup_app_with_features(
    email_verification_enabled: bool,
    password_reset_enabled: bool,
    observability_enabled: bool,
    google_oauth_enabled: bool,
) -> (axum::Router, Arc<AppState>) {
    setup_app_with_features_and_livekit(
        email_verification_enabled,
        password_reset_enabled,
        observability_enabled,
        google_oauth_enabled,
        "wss://livekit.test.local".to_string(),
        None,
    )
    .await
}

async fn setup_app_with_features_and_livekit(
    email_verification_enabled: bool,
    password_reset_enabled: bool,
    observability_enabled: bool,
    google_oauth_enabled: bool,
    livekit_ws_url: String,
    livekit_api_url: Option<String>,
) -> (axum::Router, Arc<AppState>) {
    build_test_app(
        email_verification_enabled,
        false,
        password_reset_enabled,
        observability_enabled,
        google_oauth_enabled,
        livekit_ws_url,
        livekit_api_url,
    )
    .await
}

async fn setup_app_requiring_email_verification() -> (axum::Router, Arc<AppState>) {
    build_test_app(
        true,
        true,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        None,
    )
    .await
}

async fn build_test_app(
    email_verification_enabled: bool,
    email_verification_required: bool,
    password_reset_enabled: bool,
    observability_enabled: bool,
    google_oauth_enabled: bool,
    livekit_ws_url: String,
    livekit_api_url: Option<String>,
) -> (axum::Router, Arc<AppState>) {
    let database_url = test_db_url().expect("DATABASE_URL must be set for integration tests");
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to test database");

    run_migrations(&db).await.expect("Failed to run migrations");

    let upload_dir =
        std::env::temp_dir().join(format!("voxpery-attachments-test-{}", Uuid::new_v4()));
    let attachment_service =
        voxpery_server::services::attachments::AttachmentService::new_local_for_tests(
            upload_dir.clone(),
        )
        .await
        .expect("Failed to init test attachment service");

    let (tx, _rx) = broadcast::channel(256);
    let release_http_client = reqwest::Client::builder()
        .user_agent("voxpery-server-tests/releases")
        .no_proxy()
        .build()
        .expect("Failed to build release metadata HTTP client");
    let state = Arc::new(AppState {
        instance_id: Uuid::new_v4(),
        db,
        redis: redis_client(),
        jwt_secret: jwt_secret(),
        jwt_expiration: 86400,
        tx,
        sessions: DashMap::new(),
        voice_sessions: DashMap::new(),
        voice_session_connections: DashMap::new(),
        voice_participant_sids: DashMap::new(),
        pending_voice_moves: DashMap::new(),
        voice_channel_active_since_ms: DashMap::new(),
        voice_controls: DashMap::new(),
        screen_share_viewers: DashMap::new(),
        auth_rate_limit_max: 100,
        auth_rate_limit_window_secs: 60,
        login_failure_max_attempts: 8,
        login_failure_ip_max_attempts: 20,
        login_failure_window_secs: 900,
        trusted_proxies: voxpery_server::services::client_ip::TrustedProxySet::default(),
        message_rate_limit_max: 100,
        message_rate_limit_window_secs: 10,
        observability_enabled,
        observability_rate_limit_max: 100,
        observability_rate_limit_window_secs: 60,
        cookie_secure: false,
        cookie_name: "voxpery_token".to_string(),
        cors_origins: vec!["http://localhost:5173".to_string()],
        turn_urls: None,
        turn_shared_secret: None,
        turn_credential_ttl_secs: 3600,
        livekit_ws_url: Some(livekit_ws_url),
        livekit_api_url,
        livekit_api_key: Some(test_credential("livekit-api").to_string()),
        livekit_api_secret: Some(test_credential("livekit-signing").to_string()),
        google_client_id: google_oauth_enabled.then(|| "google-client.test".to_string()),
        google_client_secret: google_oauth_enabled.then(|| test_credential("google").to_string()),
        google_oauth_enabled,
        frontend_url: None,
        public_api_url: None,
        turnstile_secret_key: None,
        turnstile_site_key: None,
        smtp_host: None,
        smtp_password: None,
        smtp_user: None,
        email_delivery_enabled: false,
        email_verification_enabled,
        email_verification_required,
        password_reset_enabled,
        attachment_service: Arc::new(attachment_service),
        release_http_client,
        latest_release_cache: tokio::sync::RwLock::new(None),
    });

    let app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    (app, state)
}

async fn count_regular_files(root: &Path) -> usize {
    let mut directories = vec![root.to_path_buf()];
    let mut count = 0;

    while let Some(directory) = directories.pop() {
        let mut entries = tokio::fs::read_dir(&directory)
            .await
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", directory.display()));
        while let Some(entry) = entries.next_entry().await.expect("failed to read entry") {
            let file_type = entry.file_type().await.expect("failed to read file type");
            if file_type.is_dir() {
                directories.push(entry.path());
            } else if file_type.is_file() {
                count += 1;
            }
        }
    }

    count
}

async fn oneshot(app: &mut axum::Router, req: Request<Body>) -> (StatusCode, bytes::Bytes) {
    let response = app.clone().oneshot(req).await.expect("request failed");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("body collect")
        .to_bytes();
    (status, body)
}

async fn receive_ws_event<S>(
    stream: &mut WebSocketStream<S>,
    expected_type: &str,
) -> serde_json::Value
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut observed_types = Vec::new();
    for _ in 0..30 {
        let message = tokio::time::timeout(std::time::Duration::from_secs(2), stream.next())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for websocket event {expected_type}; observed types: {observed_types:?}"))
            .expect("websocket closed before expected event")
            .expect("websocket read failed");
        let WsMessage::Text(text) = message else {
            continue;
        };
        let event: serde_json::Value =
            serde_json::from_str(&text).expect("websocket event must be valid JSON");
        if event["type"] == expected_type {
            return event;
        }
        observed_types.push(event["type"].as_str().unwrap_or("unknown").to_string());
    }
    panic!("did not receive websocket event {expected_type}");
}

async fn voice_token_grant(
    app: &mut axum::Router,
    auth: &str,
    channel_id: Uuid,
) -> (serde_json::Value, serde_json::Value) {
    let request = Request::builder()
        .uri(format!("/api/webrtc/livekit-token?channel_id={channel_id}"))
        .header("Authorization", auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(app, request).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = response["token"].as_str().unwrap();
    let encoded_claims = token.split('.').nth(1).unwrap();
    let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded_claims)
        .unwrap();
    (response, serde_json::from_slice(&claims).unwrap())
}

fn signed_livekit_webhook(state: &Arc<AppState>, body: &[u8]) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &json!({
            "iss": state.livekit_api_key.as_deref().unwrap(),
            "sha256": BASE64.encode(Sha256::digest(body)),
            "nbf": now.saturating_sub(1),
            "exp": now + 60,
        }),
        &jsonwebtoken::EncodingKey::from_secret(
            state.livekit_api_secret.as_deref().unwrap().as_bytes(),
        ),
    )
    .unwrap()
}

async fn register_user(
    app: &mut axum::Router,
    email: &str,
    username: &str,
    password: &str,
) -> (String, Uuid) {
    let register_body = registration_body(email, username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap().to_string();
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();
    (token, user_id)
}

async fn create_server_with_default_text_channel(
    app: &mut axum::Router,
    state: &AppState,
    auth_header: &str,
    name: &str,
) -> (Uuid, Uuid, String) {
    let request = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": name })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "server create failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();
    let channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position ASC LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    (server_id, channel_id, invite_code)
}

fn token_hash_base64(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    BASE64.encode(hasher.finalize())
}

fn assert_feature_disabled(status: StatusCode, body: &[u8]) {
    assert_eq!(
        status,
        StatusCode::SERVICE_UNAVAILABLE,
        "expected FEATURE_DISABLED response, got {}: {}",
        status,
        String::from_utf8_lossy(body)
    );
    let json: serde_json::Value = serde_json::from_slice(body).unwrap();
    assert_eq!(json["code"], "FEATURE_DISABLED");
    assert!(
        json["error"]
            .as_str()
            .is_some_and(|message| !message.is_empty()),
        "FEATURE_DISABLED response should include a safe user-facing error message"
    );
}

async fn pending_google_fixture(
    state: &Arc<AppState>,
    desktop: bool,
) -> (String, String, String, String) {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let cookie = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = URL_SAFE_NO_PAD.encode(Sha256::digest(cookie.as_bytes()));
    let csrf = Uuid::new_v4().simple().to_string();
    let google_id = Uuid::new_v4().to_string();
    let verifier = "a".repeat(64);
    let challenge = desktop.then(|| URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())));
    sqlx::query("INSERT INTO pending_google_registrations (cookie_hash,csrf_token,google_id,email,username_seed,return_origin,redirect_path,code_challenge) VALUES ($1,$2,$3,$4,'pending_user',$5,'/social',$6)")
        .bind(&hash).bind(&csrf).bind(&google_id).bind(format!("{google_id}@example.test"))
        .bind(if desktop { "voxpery://auth" } else { "http://localhost:5173" }).bind(challenge)
        .execute(&state.db).await.unwrap();
    (cookie, csrf, google_id, verifier)
}

fn pending_google_request(cookie: &str, csrf: &str) -> Request<Body> {
    Request::builder().method("POST").uri("/api/auth/google/registration")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("origin", "http://localhost:5173")
        .header("cookie", format!("voxpery_google_registration={cookie}"))
        .body(Body::from(format!("csrf_token={csrf}&terms_accepted=true&terms_version={CURRENT_TERMS_VERSION}&privacy_notice_acknowledged=true&privacy_notice_version={CURRENT_PRIVACY_NOTICE_VERSION}&kvkk_notice_acknowledged=true&kvkk_notice_version={CURRENT_KVKK_NOTICE_VERSION}"))).unwrap()
}

async fn desktop_registration_fixture(
    app: &axum::Router,
    state: &Arc<AppState>,
    origin: &str,
) -> (String, String, String, String) {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let verifier = Uuid::new_v4().simple().to_string().repeat(2);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let response = app.clone().oneshot(Request::builder()
        .uri(format!("/api/auth/desktop-registration?origin={}&code_challenge={challenge}&redirect=%2Fsocial", urlencoding::encode(origin)))
        .body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert!(response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("HttpOnly"));
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("form-action 'self'"));
    let secret = cookie.split_once('=').unwrap().1;
    let hash = URL_SAFE_NO_PAD.encode(Sha256::digest(secret.as_bytes()));
    let csrf: String = sqlx::query_scalar(
        "SELECT csrf_token FROM pending_desktop_registrations WHERE cookie_hash=$1",
    )
    .bind(&hash)
    .fetch_one(&state.db)
    .await
    .unwrap();
    (cookie, csrf, hash, verifier)
}

fn desktop_registration_request(cookie: &str, csrf: &str, email: &str) -> Request<Body> {
    Request::builder().method("POST").uri("/api/auth/desktop-registration")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("cookie", cookie)
        .body(Body::from(format!("csrf_token={csrf}&username=qa_{}&email={}&password=registration-test-password&confirm_password=registration-test-password&terms_accepted=true&terms_version={CURRENT_TERMS_VERSION}&privacy_notice_acknowledged=true&privacy_notice_version={CURRENT_PRIVACY_NOTICE_VERSION}&kvkk_notice_acknowledged=true&kvkk_notice_version={CURRENT_KVKK_NOTICE_VERSION}",
            &Uuid::new_v4().simple().to_string()[..20], urlencoding::encode(email)))).unwrap()
}

fn desktop_exchange_request(code: &str, verifier: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/auth/desktop-exchange")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({"code": code, "code_verifier": verifier}).to_string(),
        ))
        .unwrap()
}

// ---------------------------------------------------------------------------
// Authorization and voice access regressions
// ---------------------------------------------------------------------------

type TestWs = WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const PERM_VIEW: i64 = 1 << 0;
const PERM_MANAGE_SERVER: i64 = 1 << 1;
const PERM_MANAGE_ROLES: i64 = 1 << 2;
const PERM_MANAGE_CHANNELS: i64 = 1 << 3;
const PERM_KICK: i64 = 1 << 4;
const PERM_BAN: i64 = 1 << 5;
const PERM_SEND: i64 = 1 << 7;
const PERM_MANAGE_MESSAGES: i64 = 1 << 8;
const PERM_CONNECT_VOICE: i64 = 1 << 10;

async fn api_json(
    app: &mut axum::Router,
    method: &str,
    uri: &str,
    auth: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", auth);
    let body = match body {
        Some(value) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&value).unwrap())
        }
        None => Body::empty(),
    };
    let (status, bytes) = oneshot(app, builder.body(body).unwrap()).await;
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes).to_string()));
    (status, value)
}

/// Registers a user and returns (Authorization header value, user id, password).
async fn register_named_user(app: &mut axum::Router, label: &str) -> (String, Uuid, &'static str) {
    let suffix = Uuid::new_v4();
    let password = test_credential(label);
    let (token, user_id) = register_user(
        app,
        &format!("authz-{label}-{suffix}@example.com"),
        &format!("authz_{label}_{}", suffix.as_u128() % 1_000_000),
        password,
    )
    .await;
    (format!("Bearer {token}"), user_id, password)
}

async fn join_with_invite(app: &mut axum::Router, auth: &str, invite_code: &str) {
    let (status, body) = api_json(
        app,
        "POST",
        "/api/servers/join",
        auth,
        Some(json!({ "invite_code": invite_code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "join failed: {body}");
}

async fn everyone_role_id(state: &AppState, server_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        "SELECT id FROM server_roles WHERE server_id = $1 AND LOWER(name) = 'everyone'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

async fn voice_channel_of(state: &AppState, server_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' ORDER BY position LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

/// Inserts a role directly and assigns it, so tests can set up a non-owner manager.
async fn grant_role_with_permissions(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
    name: &str,
    position: i32,
    permissions: i64,
) -> Uuid {
    let role_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO server_roles (id, server_id, name, color, position, permissions) VALUES ($1, $2, $3, NULL, $4, $5)",
    )
    .bind(role_id)
    .bind(server_id)
    .bind(name)
    .bind(position)
    .bind(permissions)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
    )
    .bind(server_id)
    .bind(user_id)
    .bind(role_id)
    .execute(&state.db)
    .await
    .unwrap();
    role_id
}

async fn put_channel_override_row(
    state: &AppState,
    channel_id: Uuid,
    role_id: Uuid,
    allow: i64,
    deny: i64,
) {
    sqlx::query(
        r#"INSERT INTO channel_role_overrides (channel_id, role_id, allow, deny)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (channel_id, role_id) DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny"#,
    )
    .bind(channel_id)
    .bind(role_id)
    .bind(allow)
    .bind(deny)
    .execute(&state.db)
    .await
    .unwrap();
}

async fn spawn_ws_app(state: &Arc<AppState>) -> std::net::SocketAddr {
    let ws_app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, ws_app).await;
    });
    addr
}

async fn connect_ws(addr: std::net::SocketAddr, auth: &str) -> TestWs {
    let token = auth.trim_start_matches("Bearer ");
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{token}")).unwrap(),
    );
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (stream, _) = connect_async(request)
        .await
        .expect("websocket must connect");
    stream
}

async fn ws_send(stream: &mut TestWs, value: serde_json::Value) {
    stream
        .send(WsMessage::Text(value.to_string().into()))
        .await
        .unwrap();
}

/// Sends a Ping and waits for its Pong: earlier client messages on this socket are processed.
async fn ws_barrier(stream: &mut TestWs) {
    ws_send(
        stream,
        json!({ "type": "Ping", "data": { "sent_at_ms": 1 } }),
    )
    .await;
    receive_ws_event(stream, "Pong").await;
}

async fn ws_subscribe(stream: &mut TestWs, channel_ids: &[Uuid]) {
    ws_send(
        stream,
        json!({ "type": "Subscribe", "data": { "channel_ids": channel_ids } }),
    )
    .await;
    ws_barrier(stream).await;
}

/// Fails if an event of `unexpected_type` mentioning `marker` arrives within `within`.
async fn assert_no_ws_event_mentioning(
    stream: &mut TestWs,
    unexpected_type: &str,
    marker: &str,
    within: std::time::Duration,
) {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return;
        }
        match tokio::time::timeout(remaining, stream.next()).await {
            Err(_) | Ok(None) | Ok(Some(Err(_))) => return,
            Ok(Some(Ok(WsMessage::Text(text)))) => {
                let event: serde_json::Value = serde_json::from_str(&text).unwrap();
                if event["type"] == unexpected_type {
                    assert!(
                        !text.contains(marker),
                        "unexpected websocket event for {marker}: {event}"
                    );
                }
            }
            Ok(Some(Ok(_))) => {}
        }
    }
}

async fn befriend(state: &AppState, one: Uuid, other: Uuid) {
    let (a, b) = if one < other {
        (one, other)
    } else {
        (other, one)
    };
    sqlx::query("INSERT INTO friendships (user_a, user_b) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(a)
        .bind(b)
        .execute(&state.db)
        .await
        .unwrap();
}

async fn upload_text_file(app: &mut axum::Router, auth: &str, name: &str, bytes: &[u8]) -> Uuid {
    let boundary = format!("----voxperyrelease{}", Uuid::new_v4());
    let body = [
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: text/plain\r\n\r\n"
        )
        .into_bytes(),
        bytes.to_vec(),
        format!("\r\n--{boundary}--\r\n").into_bytes(),
    ]
    .concat();
    let request = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let (status, body) = oneshot(app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "upload failed: {}",
        String::from_utf8_lossy(&body)
    );
    let uploaded: serde_json::Value = serde_json::from_slice(&body).unwrap();
    uploaded[0]["id"].as_str().unwrap().parse().unwrap()
}

async fn send_with_attachment(
    app: &mut axum::Router,
    auth: &str,
    channel_id: Uuid,
    attachment: Uuid,
) -> String {
    let (status, message) = api_json(
        app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        auth,
        Some(json!({ "content": "file", "attachments": [{ "id": attachment.to_string() }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{message}");
    message["id"].as_str().unwrap().to_string()
}

async fn upload_release_state(
    state: &AppState,
    id: Uuid,
) -> Option<(String, Option<chrono::DateTime<chrono::Utc>>)> {
    sqlx::query_as("SELECT storage_key, release_check_at FROM uploaded_attachments WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .unwrap()
}

/// Moves an upload back past the grace period for unsent files and makes it due for a check.
async fn age_upload(state: &AppState, id: Uuid, due: bool) {
    sqlx::query(
        "UPDATE uploaded_attachments
         SET last_claimed_at = NOW() - INTERVAL '2 days',
             release_check_at = CASE WHEN $2 THEN NOW() ELSE release_check_at END
         WHERE id = $1",
    )
    .bind(id)
    .bind(due)
    .execute(&state.db)
    .await
    .unwrap();
}

async fn storage_used(state: &AppState, user_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT storage_used_bytes FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap()
}

async fn seed_password_reset_token(
    state: &AppState,
    user_id: Uuid,
    expires_at: chrono::DateTime<chrono::Utc>,
) -> String {
    let token = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at",
    )
    .bind(user_id)
    .bind(BASE64.encode(hasher.finalize()))
    .bind(expires_at)
    .execute(&state.db)
    .await
    .unwrap();
    token
}

fn reset_password_request(token: &str, new_password: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/auth/reset-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "token": token, "new_password": new_password })).unwrap(),
        ))
        .unwrap()
}
