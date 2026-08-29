//! API integration tests. Require a running PostgreSQL and env vars:
//! - DATABASE_URL (or TEST_DATABASE_URL)
//! - JWT_SECRET (or set in .env)
//!
//! Run with: `cargo test --test integration` (from apps/server).
//! Skip DB tests if DATABASE_URL is not set: `cargo test --test integration -- --ignore`.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use dashmap::DashMap;
use http_body_util::BodyExt;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use std::{
    io::{Cursor, Read},
    path::Path,
    sync::Arc,
};
use tokio::sync::broadcast;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tower::ServiceExt;
use uuid::Uuid;
use voxpery_server::{
    build_app, run_migrations,
    services::{
        auth::generate_token,
        privacy::{CURRENT_PRIVACY_NOTICE_VERSION, CURRENT_TERMS_VERSION},
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
        "privacy_notice_version": CURRENT_PRIVACY_NOTICE_VERSION
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
        voice_participant_sids: DashMap::new(),
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
        livekit_ws_url: Some("wss://livekit.test.local".to_string()),
        livekit_api_key: Some(test_credential("livekit-api").to_string()),
        livekit_api_secret: Some(test_credential("livekit-signing").to_string()),
        google_client_id: google_oauth_enabled.then(|| "google-client.test".to_string()),
        google_client_secret: google_oauth_enabled.then(|| test_credential("google").to_string()),
        google_oauth_enabled,
        frontend_url: None,
        public_api_url: None,
        turnstile_secret_key: None,
        smtp_host: None,
        smtp_password: None,
        smtp_user: None,
        email_delivery_enabled: false,
        email_verification_enabled,
        email_verification_required: false,
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

#[tokio::test]
async fn health_returns_200_when_db_connected() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;

    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json.get("checks").is_none());
}

#[tokio::test]
async fn privacy_safe_observability_is_feature_gated_and_accepts_only_the_fixed_schema() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app_with_features(false, false, true, false).await;

    let features = Request::builder()
        .uri("/api/system/features")
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, features).await;
    assert_eq!(status, StatusCode::OK);
    let features: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(features["observability_enabled"], true);

    let valid = Request::builder()
        .method("POST")
        .uri("/api/system/observability/events")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "event": "voice_join_succeeded", "client": "web" }).to_string(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, valid).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_empty());

    let arbitrary = Request::builder()
        .method("POST")
        .uri("/api/system/observability/events")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "event": "voice_join_succeeded",
                "client": "web",
                "message": "must not be logged"
            })
            .to_string(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, arbitrary).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn api_security_headers_cover_normal_error_and_preflight_responses() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, _) = setup_app().await;

    let requests = [
        Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .uri("/missing-route")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("OPTIONS")
            .uri("/api/auth/login")
            .header("Origin", "http://localhost:5173")
            .header("Access-Control-Request-Method", "POST")
            .body(Body::empty())
            .unwrap(),
    ];

    for request in requests {
        let response = app.clone().oneshot(request).await.expect("request failed");
        let headers = response.headers();
        assert_eq!(headers["strict-transport-security"], "max-age=31536000");
        assert_eq!(headers["x-frame-options"], "DENY");
        assert_eq!(headers["x-content-type-options"], "nosniff");
        assert_eq!(headers["referrer-policy"], "no-referrer");
        assert!(headers["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert!(headers["permissions-policy"]
            .to_str()
            .unwrap()
            .contains("display-capture=()"));
    }
}

#[tokio::test]
async fn desktop_oauth_handoff_runs_under_the_full_api_security_middleware() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, _) = setup_app_with_features(false, false, false, true).await;
    let nonce = Uuid::new_v4().to_string();
    let challenge = "A".repeat(43);
    let oauth_state = BASE64.encode(format!("{nonce}\nvoxpery://auth\n/servers\n{challenge}"));
    let uri = format!(
        "/api/auth/google/callback?code=unused&state={}",
        urlencoding::encode(&oauth_state)
    );

    // Deliberately omit the state cookie so the callback returns the desktop
    // error handoff without making a network request to Google.
    let response = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .expect("desktop OAuth callback request failed");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .expect("desktop OAuth CSP")
        .to_string();
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("style-src 'nonce-"));
    assert!(csp.contains("script-src 'nonce-"));
    assert!(!csp.contains("'unsafe-inline'"));
    let csp_nonce = csp
        .split("script-src 'nonce-")
        .nth(1)
        .and_then(|suffix| suffix.split('\'').next())
        .expect("script nonce in CSP");

    let body = response
        .into_body()
        .collect()
        .await
        .expect("desktop OAuth body")
        .to_bytes();
    let html = String::from_utf8(body.to_vec()).expect("desktop OAuth HTML");
    assert!(html.contains(&format!("<style nonce=\"{csp_nonce}\">")));
    assert!(html.contains(&format!("<script nonce=\"{csp_nonce}\">")));
    assert!(html.contains("window.setTimeout(openDesktop, 50)"));
    assert!(html.contains("Return to Voxpery"));
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

#[tokio::test]
async fn optional_auth_integrations_return_feature_disabled_when_unconfigured() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let disabled_reset_password = format!("disabled-reset-{}", Uuid::new_v4());
    let disabled_token = Uuid::new_v4().to_string();

    let disabled_requests = [
        Request::builder()
            .method("GET")
            .uri("/api/auth/google")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("GET")
            .uri("/api/auth/google/callback?code=test-code")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/google/desktop-exchange")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "code": "00000000000000000000000000000000",
                    "code_verifier": "test-verifier"
                }))
                .unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/forgot-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "email": "disabled@example.com" })).unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/reset-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "token": &disabled_token,
                    "new_password": disabled_reset_password
                }))
                .unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/email/confirm")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "token": &disabled_token })).unwrap(),
            ))
            .unwrap(),
    ];

    for req in disabled_requests {
        let (status, body) = oneshot(&mut app, req).await;
        assert_feature_disabled(status, &body);
    }
}

#[tokio::test]
async fn email_verification_request_returns_feature_disabled_when_email_delivery_is_disabled() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("verify-disabled-{uid}@example.com");
    let username = format!("verify_disabled_{}", uid.as_u128() % 1_000_000);
    let password = format!("verify-disabled-{}", uid.as_simple());
    let (token, _) = register_user(&mut app, &email, &username, &password).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;

    assert_feature_disabled(status, &body);
}

#[tokio::test]
async fn registration_requires_current_legal_documents() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("legal-{uid}@example.com");
    let username = format!("legal_{}", uid.as_u128() % 1_000_000);

    let missing_acceptance = json!({
        "email": email,
        "username": username,
        "password": test_credential("legal-missing")
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&missing_acceptance).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let stale_documents = json!({
        "email": format!("stale-{uid}@example.com"),
        "username": format!("stale_{}", uid.as_u128() % 1_000_000),
        "password": test_credential("legal-stale"),
        "terms_accepted": true,
        "terms_version": "outdated",
        "privacy_notice_acknowledged": true,
        "privacy_notice_version": "outdated"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&stale_documents).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn register_login_me_flow() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("test-{}@example.com", uid);
    let username = format!("user_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    // Register
    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().expect("token in response");
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();

    let legal_record: (Option<String>, Option<String>) = sqlx::query_as(
        r#"SELECT terms_version, privacy_notice_version
           FROM users
           WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(legal_record.0.as_deref(), Some(CURRENT_TERMS_VERSION));
    assert_eq!(
        legal_record.1.as_deref(),
        Some(CURRENT_PRIVACY_NOTICE_VERSION)
    );
    let registration_audit_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM privacy_audit_log
           WHERE user_id = $1 AND event_type = 'account_registered'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(registration_audit_count, 1);

    // GET /api/auth/me with Bearer
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let me: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(me["username"], username);
    assert_eq!(me["dm_privacy"], "everyone");
    assert!(me["id"].as_str().is_some());

    // Login
    let login_body = json!({
        "identifier": email,
        "password": password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn cookie_authenticated_writes_require_a_trusted_origin() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("csrf-{uid}@example.com");
    let username = format!("csrf_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("csrf");
    let (token, _) = register_user(&mut app, &email, &username, password).await;
    let cookie = format!("voxpery_token={token}");

    for origin in [None, Some("https://evil.example"), Some("null")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/auth/email/request-verification")
            .header("cookie", &cookie)
            .header("content-type", "application/json");
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        let (status, _) = oneshot(&mut app, request.body(Body::from("{}")).unwrap()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "cookie write from {origin:?} should be rejected"
        );
    }

    let allowed_origin = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("cookie", &cookie)
        .header("origin", "http://localhost:5173")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, allowed_origin).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let allowed_referer = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("cookie", &cookie)
        .header("referer", "http://localhost:5173/settings/account")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, allowed_referer).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let desktop_bearer = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("authorization", format!("Bearer {token}"))
        .header("cookie", &cookie)
        .header("origin", "https://evil.example")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, desktop_bearer).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let safe_cookie_read = Request::builder()
        .uri("/api/auth/me")
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, safe_cookie_read).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn default_voxpery_server_has_moderator_role_after_register() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("mod-{}@example.com", uid);
    let username = format!("moduser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();

    let role_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'moderator'"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("role count query should succeed");

    assert!(
        role_count >= 1,
        "default Voxpery server must have Moderator role after register"
    );

    let guide: (bool, String, String, Vec<Uuid>, Vec<String>) = sqlx::query_as(
        r#"SELECT sog.enabled, sog.title, sog.body, sog.recommended_channel_ids, sog.starter_tasks
           FROM server_onboarding_guides sog
           INNER JOIN servers s ON s.id = sog.server_id
           WHERE s.invite_code = 'voxpery'"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("default Voxpery server should have a seeded onboarding guide");

    assert!(
        guide.0,
        "default Voxpery onboarding guide should be enabled"
    );
    assert_eq!(guide.1, "Welcome to the Voxpery Community");
    assert!(
        guide
            .2
            .contains("Start here, say hello, and jump into voice"),
        "default Voxpery onboarding guide should explain the first session"
    );
    assert_eq!(
        guide.3.len(),
        2,
        "default Voxpery onboarding guide should recommend text and voice channels"
    );
    assert_eq!(
        guide.4,
        vec![
            "Send your first message in #general".to_string(),
            "Join the General voice channel".to_string(),
            "Explore the open-source project on GitHub".to_string(),
        ]
    );

    let moderator_permissions = sqlx::query_scalar::<_, i64>(
        r#"SELECT sr.permissions
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'moderator'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("moderator permissions query should succeed");

    assert_eq!(
        moderator_permissions, 7024,
        "default Voxpery Moderator role should use recommended default permissions"
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT sr.id
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'everyone'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist on default Voxpery server");

    let everyone_permissions: i64 = sqlx::query_scalar(
        r#"SELECT sr.permissions
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'everyone'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("@everyone permissions query should succeed");

    assert_eq!(
        everyone_permissions, 1153,
        "@everyone role should use baseline default permissions"
    );

    let has_everyone_role: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_member_roles smr
           INNER JOIN servers s ON s.id = smr.server_id
           WHERE s.invite_code = 'voxpery'
             AND smr.user_id = $1
             AND smr.role_id = $2"#,
    )
    .bind(user_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("member-role mapping query should succeed");
    assert_eq!(
        has_everyone_role, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );
}

#[tokio::test]
async fn create_server_list_servers_get_server() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("srv-{}@example.com", uid);
    let username = format!("srvuser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap();
    let auth_header = format!("Bearer {}", token);

    // Create server
    let create_body = json!({ "name": "My Test Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    // List servers
    let req = Request::builder()
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!list.is_empty());
    assert!(list.iter().any(|s| s["id"].as_str() == Some(server_id)));

    // Get server by id
    let req = Request::builder()
        .uri(format!("/api/servers/{}", server_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let got: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(got["id"], server_id);
    assert_eq!(got["name"], "My Test Server");
}

#[tokio::test]
async fn server_onboarding_guide_update_and_member_read_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("onboarding-owner-{owner_uid}@example.com");
    let owner_username = format!("onboarding_owner_{}", owner_uid.as_u128() % 1_000_000);
    let (owner_token, _) = register_user(
        &mut app,
        &owner_email,
        &owner_username,
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Onboarding {}", owner_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position ASC LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let update_body = json!({
        "enabled": true,
        "title": "Welcome to the lab",
        "body": "Start here before jumping into voice.",
        "recommended_channel_ids": [channel_id],
        "starter_tasks": ["Read the rules", "Introduce yourself"]
    });
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&update_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "update onboarding failed: {}",
        String::from_utf8_lossy(&body)
    );
    let guide: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(guide["enabled"], true);
    assert_eq!(guide["title"], "Welcome to the lab");
    assert_eq!(guide["recommended_channel_ids"][0], channel_id.to_string());
    assert_eq!(guide["starter_tasks"][1], "Introduce yourself");

    let member_uid = Uuid::new_v4();
    let member_email = format!("onboarding-member-{member_uid}@example.com");
    let member_username = format!("onboarding_member_{}", member_uid.as_u128() % 1_000_000);
    let (member_token, _) = register_user(
        &mut app,
        &member_email,
        &member_username,
        test_credential("default"),
    )
    .await;
    let member_auth = format!("Bearer {member_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let member_guide: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(member_guide["title"], "Welcome to the lab");

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "enabled": false })).unwrap(),
        ))
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let outsider_uid = Uuid::new_v4();
    let outsider_email = format!("onboarding-outsider-{outsider_uid}@example.com");
    let outsider_username = format!("onboarding_outsider_{}", outsider_uid.as_u128() % 1_000_000);
    let outsider_password = format!("onboarding-credential-{}", Uuid::new_v4().as_simple());
    let (outsider_token, _) = register_user(
        &mut app,
        &outsider_email,
        &outsider_username,
        &outsider_password,
    )
    .await;
    let outsider_auth = format!("Bearer {outsider_token}");
    let req = Request::builder()
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &outsider_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn member_timeout_blocks_and_clear_restores_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("timeout-owner-{owner_uid}@example.com");
    let owner_username = format!("timeout_owner_{}", owner_uid.as_u128() % 1_000_000);
    let (owner_token, _) = register_user(
        &mut app,
        &owner_email,
        &owner_username,
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Timeout {}", owner_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let member_uid = Uuid::new_v4();
    let member_email = format!("timeout-member-{member_uid}@example.com");
    let member_username = format!("timeout_member_{}", member_uid.as_u128() % 1_000_000);
    let (member_token, member_id) = register_user(
        &mut app,
        &member_email,
        &member_username,
        test_credential("default"),
    )
    .await;
    let member_auth = format!("Bearer {member_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position ASC LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/timeout"
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "duration_minutes": 5,
                "reason": "integration test"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "timeout member failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "blocked while timed out" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "timed out member should be blocked: {}",
        String::from_utf8_lossy(&body)
    );
    assert!(
        String::from_utf8_lossy(&body).contains("timed out"),
        "timeout error should be user-facing: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/timeout"
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "clear timeout failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "allowed after timeout clear" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "message should work after timeout clear: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn create_server_seeds_recommended_moderator_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("srvmod-{}@example.com", uid);
    let username = format!("srvmod_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap();
    let creator_user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();
    let auth_header = format!("Bearer {}", token);

    let create_body = json!({ "name": "Moderator Seed Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();

    let moderator_permissions = sqlx::query_scalar::<_, i64>(
        r#"SELECT permissions
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) = 'moderator'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("moderator role should exist for newly created server");

    assert_eq!(
        moderator_permissions, 7024,
        "new server Moderator role should use recommended default permissions"
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT id
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) = 'everyone'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist for newly created server");

    let everyone_permissions: i64 = sqlx::query_scalar(
        r#"SELECT permissions
           FROM server_roles
           WHERE id = $1"#,
    )
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone permissions should be readable");
    assert_eq!(
        everyone_permissions, 1153,
        "new server @everyone role should use baseline default permissions"
    );

    let creator_has_everyone: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_member_roles
           WHERE server_id = $1 AND user_id = $2 AND role_id = $3"#,
    )
    .bind(server_id)
    .bind(creator_user_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("creator @everyone mapping query should succeed");
    assert_eq!(
        creator_has_everyone, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );

    let bootstrap_counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT
               (SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2),
               (SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'text'),
               (SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'voice'),
               (SELECT COUNT(*) FROM server_channel_categories WHERE server_id = $1)"#,
    )
    .bind(server_id)
    .bind(creator_user_id)
    .fetch_one(&state.db)
    .await
    .expect("server bootstrap state should be readable");
    assert_eq!(
        bootstrap_counts,
        (1, 1, 1, 1),
        "server creation must commit its owner, channels, and category together"
    );
}

#[tokio::test]
async fn join_server_auto_assigns_everyone_role() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    // Owner account
    let owner_uid = Uuid::new_v4();
    let owner_email = format!("owner-{}@example.com", owner_uid);
    let owner_username = format!("owner_{}", owner_uid.as_u128() % 1_000_000);
    let owner_register =
        registration_body(&owner_email, &owner_username, test_credential("default"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&owner_register).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let owner_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let owner_token = owner_auth["token"].as_str().unwrap();
    let owner_auth_header = format!("Bearer {}", owner_token);

    // Create server
    let create_body = json!({ "name": "Join Everyone Test" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Member account
    let member_uid = Uuid::new_v4();
    let member_email = format!("member-{}@example.com", member_uid);
    let member_username = format!("member_{}", member_uid.as_u128() % 1_000_000);
    let member_register =
        registration_body(&member_email, &member_username, test_credential("default"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&member_register).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "member register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let member_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let member_token = member_auth["token"].as_str().unwrap();
    let member_id = Uuid::parse_str(member_auth["user"]["id"].as_str().unwrap()).unwrap();
    let member_auth_header = format!("Bearer {}", member_token);

    // Join server by invite code
    let join_body = json!({ "invite_code": invite_code });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&join_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM server_roles
           WHERE server_id = $1 AND LOWER(name) = 'everyone'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist");

    let member_has_everyone: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM server_member_roles
           WHERE server_id = $1 AND user_id = $2 AND role_id = $3"#,
    )
    .bind(server_id)
    .bind(member_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("member role assignment query should succeed");

    assert_eq!(
        member_has_everyone, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );

    // Joined member must still get baseline permissions from implicit @everyone.
    // Verify by checking they can view channels for the joined server.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "joined member should be able to view server channels: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn create_channel_list_channels_send_message_list_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("chan-{}@example.com", uid);
    let username = format!("chanuser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap();
    let auth_header = format!("Bearer {}", token);

    // Create server
    let create_body = json!({ "name": "Channel Test Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    // Create channel (POST /api/channels with server_id, name)
    let channel_body = json!({
        "server_id": server_id,
        "name": format!("general-{}", uid.as_u128() % 1_000_000),
        "channel_type": "text"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&channel_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create channel: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    // List channels for server (GET /api/servers/:id/channels)
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!channels.is_empty());
    assert!(channels
        .iter()
        .any(|c| c["id"].as_str() == Some(channel_id)));

    // Send message
    let msg_body = json!({ "content": "Hello integration test" });
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&msg_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send message: {}",
        String::from_utf8_lossy(&body)
    );
    let msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = msg["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/item/{message_id}/reactions"))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "emoji": "👍" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "add reaction: {}",
        String::from_utf8_lossy(&body)
    );

    // List messages (with limit)
    let req = Request::builder()
        .uri(format!("/api/messages/{}?limit=10", channel_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let messages: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!messages.is_empty());
    assert!(messages
        .iter()
        .any(|m| m["id"].as_str() == Some(message_id)));
    assert!(messages
        .iter()
        .any(|m| m["content"].as_str() == Some("Hello integration test")));
    let listed_message = messages
        .iter()
        .find(|message| message["id"].as_str() == Some(message_id))
        .expect("sent message should be listed");
    assert_eq!(listed_message["reactions"][0]["emoji"], "👍");
    assert_eq!(
        listed_message["reactions"][0]["users"][0]["username"],
        username
    );

    // List messages with before (pagination)
    let req = Request::builder()
        .uri(format!(
            "/api/messages/{}?before={}&limit=5",
            channel_id, message_id
        ))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let older: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    // We only have one message, so older should be empty
    assert!(older.is_empty() || older.len() <= 5);
}

#[tokio::test]
async fn me_unauthorized_without_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let req = Request::builder()
        .uri("/api/auth/me")
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// BOLA/auth: protected friends endpoints must return 401 when no token and no cookie.
#[tokio::test]
async fn friends_endpoints_require_auth() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    for uri in ["/api/friends/requests", "/api/friends"] {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        let (status, _body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{} must return 401 without auth; got {}",
            uri,
            status
        );
    }
}

#[tokio::test]
async fn friend_dm_channel_open_returns_channel_info() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("alice{}", &suffix[..8]);
    let bob_username = format!("bob{}", &suffix[8..16]);
    let alice_credential = format!("{}-{}", alice_username, Uuid::new_v4().simple());
    let bob_credential = format!("{}-{}", bob_username, Uuid::new_v4().simple());
    let (alice_token, _) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        &alice_credential,
    )
    .await;
    let (bob_token, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        &bob_credential,
    )
    .await;

    let alice_auth = format!("Bearer {alice_token}");
    let bob_auth = format!("Bearer {bob_token}");

    let friend_request_body = json!({ "username": bob_username });
    let req = Request::builder()
        .method("POST")
        .uri("/api/friends/requests")
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&friend_request_body).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/friends/requests")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "list friend requests failed: {}",
        String::from_utf8_lossy(&body)
    );
    let requests: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let request_id = requests["incoming"][0]["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/friends/requests/{request_id}/accept"))
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "accept friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "open friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channel["peer_id"].as_str().unwrap(), bob_id.to_string());
    assert_eq!(channel["peer_username"].as_str().unwrap(), bob_username);
    assert_eq!(channel["unread_count"].as_i64().unwrap(), 0);
}

#[tokio::test]
async fn dm_channel_visibility_and_pinning_persist_for_each_user() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("alice{}", &suffix[..8]);
    let bob_username = format!("bob{}", &suffix[8..16]);
    let alice_credential = format!("{}-{}", alice_username, Uuid::new_v4().simple());
    let bob_credential = format!("{}-{}", bob_username, Uuid::new_v4().simple());
    let (alice_token, _) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        &alice_credential,
    )
    .await;
    let (bob_token, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        &bob_credential,
    )
    .await;

    let alice_auth = format!("Bearer {alice_token}");
    let bob_auth = format!("Bearer {bob_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/friends/requests")
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "username": bob_username })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/friends/requests")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "list friend requests failed: {}",
        String::from_utf8_lossy(&body)
    );
    let requests: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let request_id = requests["incoming"][0]["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/friends/requests/{request_id}/accept"))
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "accept friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "open friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{channel_id}/hide"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "hide friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 0);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/messages/{channel_id}"))
        .header("Authorization", &bob_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "new activity reopens the DM" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send DM activity failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);
    assert_eq!(channels[0]["id"].as_str().unwrap(), channel_id);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{channel_id}/hide"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "hide reopened friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reopen hidden friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/dm/channels/{channel_id}/preferences"))
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "pinned": true })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "pin friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(true));
    assert!(channels[0]["pinned_at"].as_str().is_some());

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(false));
    assert!(channels[0]["pinned_at"].is_null());

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/dm/channels/{channel_id}/preferences"))
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "pinned": false })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "unpin friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(false));
    assert!(channels[0]["pinned_at"].is_null());
}

#[tokio::test]
async fn strict_username_validation_rejects_invalid_usernames() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let invalid_usernames = vec![
        "has space",
        ".start_dot",
        "end_dot.",
        "_start_underscore",
        "end_underscore_",
        "consecutive..dots",
        "consecutive__underscores",
        "special!chars",
    ];

    for username in invalid_usernames {
        let uid = Uuid::new_v4();
        let email = format!("test-{}@example.com", uid);

        let register_body = registration_body(&email, username, test_credential("default"));
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/register")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "username '{}' should be rejected but got status {}. body: {}",
            username,
            status,
            String::from_utf8_lossy(&body)
        );
        let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let err_msg = resp["error"].as_str().unwrap_or("");
        assert!(err_msg.contains("Username cannot") || err_msg.contains("Username may only"));
    }
}

#[tokio::test]
async fn usernames_preserve_case_but_remain_case_insensitively_unique() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let suffix = Uuid::new_v4().as_u128() % 1_000_000;
    let username = format!("VoxUser_{suffix}");
    let email = format!("case-{suffix}@example.com");
    let register_body = registration_body(&email, &username, test_credential("case-preserving"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(response["user"]["username"], username);

    let duplicate_email = format!("case-duplicate-{suffix}@example.com");
    let duplicate_username = username.to_lowercase();
    let duplicate_body = registration_body(
        &duplicate_email,
        &duplicate_username,
        test_credential("case-duplicate"),
    );
    let duplicate_req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&duplicate_body).unwrap()))
        .unwrap();
    let (duplicate_status, _) = oneshot(&mut app, duplicate_req).await;
    assert_eq!(duplicate_status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn roles_and_channel_overrides_flow() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("admin-{}@example.com", uid);
    let username = format!("admin_{}", uid.as_u128() % 1_000_000);

    // Register owner
    let register_body = registration_body(&email, &username, test_credential("default"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap();
    let auth_header = format!("Bearer {}", token);

    // Create server
    let create_body = json!({ "name": "Permissions Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    // Create a role
    let role_body = json!({
        "name": "VIP",
        "permissions": 128, // SEND_MESSAGES
        "color": "#ff0000"
    });
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{}/roles", server_id))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&role_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK, "create role failed");
    let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let role_id = role["id"].as_str().unwrap();

    // Create a channel
    let channel_body = json!({
        "server_id": server_id,
        "name": "vip-lounge",
        "channel_type": "text"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&channel_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    // Add channel override
    let override_body = json!({
        "allow": 128, // SEND_MESSAGES
        "deny": 1 // VIEW_SERVER (meaning view channel)
    });
    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/channels/{}/overrides/{}",
            channel_id, role_id
        ))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&override_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "channel override failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Get channel overrides
    let req = Request::builder()
        .uri(format!("/api/channels/{}/overrides", channel_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let overrides: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(overrides.len(), 1);
    assert_eq!(overrides[0]["role_id"], role_id);
    assert_eq!(overrides[0]["allow"], 128);
    assert_eq!(overrides[0]["deny"], 1);
}

#[tokio::test]
async fn category_override_enforces_view_send_and_voice_access() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("owner-cat-{}@example.com", owner_uid);
    let owner_username = format!("owner_cat_{}", owner_uid.as_u128() % 1_000_000);
    let owner_password = Uuid::new_v4().to_string();
    let (owner_token, _owner_id) =
        register_user(&mut app, &owner_email, &owner_username, &owner_password).await;
    let owner_auth = format!("Bearer {}", owner_token);

    let member_uid = Uuid::new_v4();
    let member_email = format!("member-cat-{}@example.com", member_uid);
    let member_username = format!("member_cat_{}", member_uid.as_u128() % 1_000_000);
    let member_password = Uuid::new_v4().to_string();
    let (member_token, _member_id) =
        register_user(&mut app, &member_email, &member_username, &member_password).await;
    let member_auth = format!("Bearer {}", member_token);

    // Create server as owner.
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Category Override Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Join member.
    let join_req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Create text + voice channels under same category.
    let text_req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "secret-text",
                "channel_type": "text",
                "category": "Secret"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, text_req).await;
    assert_eq!(status, StatusCode::OK);
    let text_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let text_channel_id = text_channel["id"].as_str().unwrap().to_string();

    let voice_req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "secret-voice",
                "channel_type": "voice",
                "category": "Secret"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, voice_req).await;
    assert_eq!(status, StatusCode::OK);
    let voice_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let voice_channel_id = voice_channel["id"].as_str().unwrap().to_string();

    // Verify member can initially see channels.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let before: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(before.iter().any(|c| c["id"] == text_channel_id));
    assert!(before.iter().any(|c| c["id"] == voice_channel_id));

    // Deny VIEW + SEND + CONNECT for @everyone in category.
    let everyone_role_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM server_roles WHERE server_id = $1 AND lower(name) = 'everyone' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    let deny_bits = 1_i64 | 128_i64 | 1024_i64; // VIEW_SERVER + SEND_MESSAGES + CONNECT_VOICE

    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/channels/server/{}/categories/{}/overrides/{}",
            server_id, "Secret", everyone_role_id
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "allow": 0, "deny": deny_bits })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "category override failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Member should no longer see channels in that category.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let after: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!after.iter().any(|c| c["id"] == text_channel_id));
    assert!(!after.iter().any(|c| c["id"] == voice_channel_id));

    // Member cannot send message anymore.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", text_channel_id))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "should fail" })).unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Member cannot get voice token anymore.
    let req = Request::builder()
        .uri(format!(
            "/api/webrtc/livekit-token?channel_id={}",
            voice_channel_id
        ))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Owner must still be able to join voice (owner override).
    let req = Request::builder()
        .uri(format!(
            "/api/webrtc/livekit-token?channel_id={}",
            voice_channel_id
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner voice token should succeed: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn role_bits_manage_messages_and_pins_are_enforced() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    // Owner
    let owner_uid = Uuid::new_v4();
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("owner-role-{}@example.com", owner_uid),
        &format!("owner_role_{}", owner_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {}", owner_token);

    // Moderator-like member (custom role)
    let mod_uid = Uuid::new_v4();
    let (mod_token, mod_id) = register_user(
        &mut app,
        &format!("mod-role-{}@example.com", mod_uid),
        &format!("mod_role_{}", mod_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let mod_auth = format!("Bearer {}", mod_token);

    // Plain member
    let user_uid = Uuid::new_v4();
    let (user_token, _user_id) = register_user(
        &mut app,
        &format!("user-role-{}@example.com", user_uid),
        &format!("user_role_{}", user_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let user_auth = format!("Bearer {}", user_token);

    // Create server
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Role Permission Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap().to_string();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Join both members
    for auth in [&mod_auth, &user_auth] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/servers/join")
            .header("Authorization", auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "join failed: {}",
            String::from_utf8_lossy(&body)
        );
    }

    // Create role with MANAGE_MESSAGES + MANAGE_PINS
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{}/roles", server_id))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "name": "ModLite",
                "permissions": (256_i64 | 512_i64),
                "color": "#00aaff"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let role_id = role["id"].as_str().unwrap();

    // Assign role to mod member
    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/servers/{}/members/{}/roles",
            server_id, mod_id
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "role_ids": [role_id] })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "assign role failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Create text channel
    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "general-role-test",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap().to_string();

    // Plain user sends a message.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &user_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "plain message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let user_msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let user_msg_id = user_msg["id"].as_str().unwrap().to_string();

    // Mod role can delete someone else's message (MANAGE_MESSAGES).
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/item/{}", user_msg_id))
        .header("Authorization", &mod_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod delete message failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Mod sends a message for pin checks.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &mod_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "mod message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let mod_msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let mod_msg_id = mod_msg["id"].as_str().unwrap().to_string();

    // Plain user cannot pin (no MANAGE_PINS).
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}/pins", channel_id))
        .header("Authorization", &user_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "message_id": mod_msg_id })).unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Mod can pin.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}/pins", channel_id))
        .header("Authorization", &mod_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "message_id": mod_msg_id })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod pin failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Plain user cannot unpin.
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/{}/pins/{}", channel_id, mod_msg_id))
        .header("Authorization", &user_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Mod can unpin.
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/{}/pins/{}", channel_id, mod_msg_id))
        .header("Authorization", &mod_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod unpin failed: {}",
        String::from_utf8_lossy(&body)
    );

    // owner_id is intentionally unused in assertions, but keeping it ensures register path created owner correctly
    let _ = owner_id;
}

#[tokio::test]
async fn password_change_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("pwchg-{}@example.com", uid);
    let username = format!("pwchg_{}", uid.as_u128() % 1_000_000);
    let old_password = test_credential("default");
    let new_password = test_credential("updated");

    let (old_token, _) = register_user(&mut app, &email, &username, old_password).await;
    let old_auth = format!("Bearer {}", old_token);

    let change_body = json!({
        "old_password": old_password,
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/change-password")
        .header("Authorization", &old_auth)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&change_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "change-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Old token must be rejected immediately.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New password should log in successfully.
    let login_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let login_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let new_token = login_auth["token"].as_str().unwrap();

    // New token should work.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {}", new_token))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn google_only_user_can_set_password_and_login() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let email = format!("oauth-setpw-{}@example.com", uid);
    let username = format!("oauthset_{}", uid.as_u128() % 1_000_000);
    let google_id = format!("google-{}", uid);
    let new_password = test_credential("set");

    sqlx::query(
        r#"INSERT INTO users (id, username, email, password_hash, status, dm_privacy, google_id, created_at, token_version)
           VALUES ($1, $2, $3, 'oauth', 'online', 'friends', $4, NOW(), 0)"#,
    )
    .bind(user_id)
    .bind(&username)
    .bind(&email)
    .bind(&google_id)
    .execute(&state.db)
    .await
    .expect("failed to seed oauth-only test user");

    // Password login must fail before set-password.
    let login_before_body = json!({
        "identifier": email,
        "password": test_credential("unset")
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&login_before_body).expect("serialize login before body"),
        ))
        .expect("build login before request");
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let old_token = generate_token(
        user_id,
        &username,
        0,
        &state.jwt_secret,
        state.jwt_expiration,
    )
    .expect("generate old token");
    let old_auth = format!("Bearer {old_token}");

    let set_password_body = json!({
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/set-password")
        .header("Authorization", &old_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&set_password_body).expect("serialize set-password body"),
        ))
        .expect("build set-password request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "set-password failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value =
        serde_json::from_slice(&body).expect("parse set-password response");
    let new_token = auth["token"].as_str().expect("set-password token");
    assert_eq!(auth["user"]["google_connected"], true);
    assert_eq!(auth["user"]["has_password"], true);

    // Old token must be invalid after token_version bump.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .expect("build old /me request");
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New token must work.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {new_token}"))
        .body(Body::empty())
        .expect("build new /me request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let me: serde_json::Value = serde_json::from_slice(&body).expect("parse /me response");
    assert_eq!(me["has_password"], true);
    assert_eq!(me["google_connected"], true);

    // Password login now succeeds.
    let login_after_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&login_after_body).expect("serialize login after body"),
        ))
        .expect("build login after request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "login after set-password failed: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn google_only_user_can_recover_with_email_and_keep_google_connected() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;

    let uid = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let email = format!("oauth-recovery-{uid}@example.com");
    let username = format!("oauthrecover_{}", uid.as_u128() % 1_000_000);
    let google_id = format!("google-recovery-{uid}");
    let new_password = test_credential("oauth-recovery");

    sqlx::query(
        r#"INSERT INTO users
           (id, username, email, password_hash, status, dm_privacy, google_id, email_verified, created_at, token_version)
           VALUES ($1, $2, $3, 'oauth', 'online', 'friends', $4, TRUE, NOW(), 0)"#,
    )
    .bind(user_id)
    .bind(&username)
    .bind(&email)
    .bind(&google_id)
    .execute(&state.db)
    .await
    .expect("failed to seed OAuth-only recovery user");

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/forgot-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "email": email })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "OAuth-only forgot-password failed: {}",
        String::from_utf8_lossy(&body)
    );
    let reset_token_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        reset_token_count, 1,
        "OAuth-only account needs a recovery token"
    );

    let reset_token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(reset_token_plain.as_bytes());
    let reset_token_hash = BASE64.encode(hasher.finalize());
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    sqlx::query(
        "UPDATE password_reset_tokens SET token_hash = $1, expires_at = $2 WHERE user_id = $3",
    )
    .bind(reset_token_hash)
    .bind(expires_at)
    .bind(user_id)
    .execute(&state.db)
    .await
    .unwrap();

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/reset-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "token": reset_token_plain,
                "new_password": new_password,
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "OAuth-only reset-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    let recovered =
        sqlx::query_as::<_, voxpery_server::models::User>("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_ne!(recovered.password_hash, "oauth");
    assert_eq!(recovered.google_id.as_deref(), Some(google_id.as_str()));

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "identifier": email,
                "password": new_password,
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "recovered OAuth account could not password-login: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn password_reset_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;

    let uid = Uuid::new_v4();
    let email = format!("pwreset-{}@example.com", uid);
    let username = format!("pwreset_{}", uid.as_u128() % 1_000_000);
    let old_password = test_credential("default");
    let new_password = test_credential("updated");

    let (old_token, user_id) = register_user(&mut app, &email, &username, old_password).await;
    let old_auth = format!("Bearer {}", old_token);

    // Seed a known reset token in DB (same hashing logic as backend).
    let reset_token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(reset_token_plain.as_bytes());
    let reset_token_hash = BASE64.encode(hasher.finalize());
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(reset_token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .unwrap();

    let reset_body = json!({
        "token": reset_token_plain,
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/reset-password")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&reset_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reset-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Old token must be rejected immediately.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Old password should fail.
    let old_login_body = json!({
        "identifier": email,
        "password": old_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&old_login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New password should work.
    let new_login_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&new_login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn data_export_returns_user_profile_and_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("export-{}@example.com", uid);
    let username = format!("export_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let profile_req = Request::builder()
        .method("PATCH")
        .uri("/api/auth/profile")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "about_me": "Building a thoughtful community."
            }))
            .unwrap(),
        ))
        .unwrap();
    let (profile_status, profile_body) = oneshot(&mut app, profile_req).await;
    assert_eq!(profile_status, StatusCode::OK);
    let profile: serde_json::Value = serde_json::from_slice(&profile_body).unwrap();
    assert_eq!(profile["about_me"], "Building a thoughtful community.");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Export Server {}", uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": format!("export-chat-{}", uid.as_u128() % 100000),
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let text_channel_id = channel["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", text_channel_id))
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "export me" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "message send failed: {}",
        String::from_utf8_lossy(&body)
    );
    let message: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = message["id"].as_str().unwrap();

    sqlx::query(
        r#"UPDATE messages
           SET attachments = $1
           WHERE id = $2"#,
    )
    .bind(serde_json::json!([{
        "id": Uuid::new_v4().to_string(),
        "url": "https://api.example.test/api/attachments/content/internal?exp=999&sig=secret",
        "type": "image/png",
        "name": "diagram.png",
        "size": 1234,
        "sha256": "internal-sha"
    }]))
    .bind(Uuid::parse_str(message_id).unwrap())
    .execute(&state.db)
    .await
    .unwrap();

    let boundary = format!("----voxperyexport{}", Uuid::new_v4());
    let attachment_bytes = b"private export attachment";
    let upload_body = [
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"private.txt\"\r\nContent-Type: text/plain\r\n\r\n"
        )
        .into_bytes(),
        attachment_bytes.to_vec(),
        format!("\r\n--{boundary}--\r\n").into_bytes(),
    ]
    .concat();
    let upload_req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(upload_body))
        .unwrap();
    let (upload_status, upload_response) = oneshot(&mut app, upload_req).await;
    assert_eq!(
        upload_status,
        StatusCode::OK,
        "attachment upload failed: {}",
        String::from_utf8_lossy(&upload_response)
    );

    let missing_password_req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();
    let (missing_password_status, missing_password_body) =
        oneshot(&mut app, missing_password_req).await;
    assert_eq!(missing_password_status, StatusCode::FORBIDDEN);
    let missing_password_error: serde_json::Value =
        serde_json::from_slice(&missing_password_body).unwrap();
    assert_eq!(missing_password_error["code"], "REAUTH_REQUIRED");

    let wrong_password_req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "password": "definitely-wrong" })).unwrap(),
        ))
        .unwrap();
    let (wrong_password_status, _) = oneshot(&mut app, wrong_password_req).await;
    assert_eq!(wrong_password_status, StatusCode::UNAUTHORIZED);

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "password": password })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "data export failed: {}",
        String::from_utf8_lossy(&body)
    );

    let mut archive = zip::ZipArchive::new(Cursor::new(body.to_vec()))
        .expect("data export response must be a ZIP archive");
    let mut manifest_json = String::new();
    archive
        .by_name("voxpery-data-export.json")
        .expect("export manifest must be present")
        .read_to_string(&mut manifest_json)
        .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&manifest_json).unwrap();
    assert_eq!(payload["export"]["format"], "voxpery-user-data-v3");
    assert_eq!(
        payload["export"]["scope"],
        "self_service_convenience_export"
    );
    assert_eq!(
        payload["export"]["is_complete_data_subject_access_response"],
        false
    );
    assert_eq!(payload["account"]["email"], email);
    assert_eq!(payload["account"]["username"], username);
    assert!(payload["account"].get("id").is_none());
    assert!(payload["account"].get("avatar_url").is_none());
    assert!(payload["account"].get("password_hash").is_none());
    assert!(payload["account"].get("token_version").is_none());
    assert_eq!(payload["profile"]["has_avatar"], false);
    assert_eq!(payload["profile"]["about_me"], "Building a thoughtful community.");
    assert!(payload["servers"].is_array());
    assert!(payload["relationships"]["friends"].is_array());
    assert!(payload["relationships"]["friend_requests"].is_array());
    assert!(payload["messages"]["server"].is_array());
    assert!(payload["messages"]["direct"].is_array());
    if let Some(first_membership) = payload["servers"].as_array().and_then(|rows| rows.first()) {
        assert!(
            first_membership.get("server_id").is_none(),
            "server_id must not be included in export memberships",
        );
    }
    if let Some(first_server_message) = payload["messages"]["server"]
        .as_array()
        .and_then(|rows| rows.first())
    {
        assert!(
            first_server_message.get("server_id").is_none(),
            "server_id must not be included in exported server messages",
        );
        assert!(
            first_server_message.get("channel_id").is_none(),
            "channel_id must not be included in exported server messages",
        );
        assert!(
            first_server_message.get("id").is_none(),
            "message id must not be included in exported server messages",
        );
    }
    let exported_message = payload["messages"]["server"]
        .as_array()
        .and_then(|rows| rows.iter().find(|msg| msg["content"] == "export me"))
        .expect("export payload should include authored message");
    assert_eq!(
        exported_message["attachments"][0]["name"],
        serde_json::json!("diagram.png")
    );
    assert_eq!(
        exported_message["attachments"][0]["content_type"],
        serde_json::json!("image/png")
    );
    assert_eq!(
        exported_message["attachments"][0]["size_bytes"],
        serde_json::json!(1234)
    );
    assert!(exported_message["attachments"][0].get("id").is_none());
    assert!(exported_message["attachments"][0].get("url").is_none());
    assert!(exported_message["attachments"][0].get("sha256").is_none());

    let exported_file = payload["export"]["files"]
        .as_array()
        .and_then(|files| files.iter().find(|file| file["name"] == "private.txt"))
        .expect("owned attachment must be listed in the export manifest");
    let archive_path = exported_file["archive_path"].as_str().unwrap();
    assert!(archive_path.starts_with("files/attachments/"));
    let mut exported_attachment = Vec::new();
    archive
        .by_name(archive_path)
        .expect("owned attachment bytes must be included")
        .read_to_end(&mut exported_attachment)
        .unwrap();
    assert_eq!(exported_attachment, attachment_bytes);

    let export_text = serde_json::to_string(&payload).unwrap();
    for forbidden in [
        "\"password_hash\"",
        "\"access_token\"",
        "\"refresh_token\"",
        "\"session_id\"",
        "\"avatar_url\"",
        "internal-sha",
        "sig=secret",
    ] {
        assert!(
            !export_text.contains(forbidden),
            "export payload must not contain sensitive/internal field: {forbidden}"
        );
    }
    assert!(
        !export_text.contains(&user_id.to_string()),
        "export payload should not expose the account database id"
    );

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM privacy_audit_log
           WHERE user_id = $1 AND event_type = 'data_export_created'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(audit_count, 1, "data export must create one audit event");
}

#[tokio::test]
async fn account_delete_endpoint_enforces_privacy() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    // Permanent delete flow
    let del_uid = Uuid::new_v4();
    let del_email = format!("delete-{}@example.com", del_uid);
    let del_username = format!("delete_{}", del_uid.as_u128() % 1_000_000);
    let del_password = test_credential("default");
    let (del_token, del_user_id) =
        register_user(&mut app, &del_email, &del_username, del_password).await;
    let del_auth = format!("Bearer {}", del_token);

    // Create a server so owner transfer path is exercised.
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &del_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Delete Owner {}", del_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server before delete failed: {}",
        String::from_utf8_lossy(&body)
    );
    let created_server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let created_server_id = Uuid::parse_str(created_server["id"].as_str().unwrap()).unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/auth/account")
        .header("Authorization", &del_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "confirm": "DELETE",
                "password": del_password
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "permanent delete failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &del_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let deleted_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = $1")
        .bind(del_user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(deleted_count, 0, "user row must be removed after delete");

    let owner_after: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(created_server_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_ne!(
        owner_after, del_user_id,
        "server ownership must be transferred away from deleted account"
    );
}

#[tokio::test]
async fn attachment_upload_stores_file_and_returns_signed_url() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("upload-{}@example.com", uid);
    let username = format!("upload_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let boundary = format!("----voxperyboundary{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"hello.txt\"\r\nContent-Type: text/plain\r\n\r\nhello from integration test\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "upload failed: {}",
        String::from_utf8_lossy(&body)
    );

    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let arr = payload.as_array().expect("upload response must be array");
    assert_eq!(arr.len(), 1);
    let uploaded = &arr[0];
    let attachment_id = uploaded["id"]
        .as_str()
        .expect("attachment id must be present in upload response");
    Uuid::parse_str(attachment_id).expect("attachment id must be valid uuid");
    let url = uploaded["url"].as_str().unwrap_or_default();
    assert!(
        url.contains("/api/attachments/content/"),
        "unexpected upload URL: {url}"
    );
    assert!(
        url.contains("exp=") && url.contains("sig="),
        "signed URL must include exp/sig query params: {url}"
    );
    assert_eq!(uploaded["type"], "text/plain");
    assert_eq!(uploaded["name"], "hello.txt");
    assert_eq!(uploaded["size"], 27);

    let row: (String, String, String, i64, String) = sqlx::query_as(
        r#"SELECT storage_backend, content_type, original_name, size_bytes, storage_key
           FROM uploaded_attachments
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(row.0, "local");
    assert_eq!(row.1, "text/plain");
    assert_eq!(row.2, "hello.txt");
    assert_eq!(row.3, 27);

    let signed_path = url
        .strip_prefix("http://localhost:3001")
        .expect("signed URL should use localhost API base")
        .to_string();
    let req = Request::builder()
        .method("GET")
        .uri(&signed_path)
        .header("Authorization", &auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "signed content URL should serve file"
    );
    assert_eq!(
        body,
        bytes::Bytes::from_static(b"hello from integration test")
    );

    let tampered_path = if let Some((prefix, sig)) = signed_path.rsplit_once("sig=") {
        let replacement = if sig.ends_with('0') { '1' } else { '0' };
        let bad_sig = format!("{}{replacement}", &sig[..sig.len().saturating_sub(1)]);
        format!("{prefix}sig={bad_sig}")
    } else {
        panic!("signed URL must include sig param");
    };
    let req = Request::builder()
        .method("GET")
        .uri(&tampered_path)
        .header("Authorization", &auth)
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "tampered signature must be rejected"
    );

    let req = Request::builder()
        .method("GET")
        .uri(format!("/uploads/{}", row.4))
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "legacy public /uploads route must be disabled"
    );
}

#[tokio::test]
async fn attachment_upload_rejects_mime_spoofed_executable() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("upload-spoof-{}@example.com", uid);
    let username = format!("upload_spoof_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let boundary = format!("----voxperyspoof{}", Uuid::new_v4());
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"MZfake-portable-executable");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let (status, response_body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "spoofed executable should be rejected: {}",
        String::from_utf8_lossy(&response_body)
    );

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(stored_count, 0, "rejected content must not be persisted");
}

#[tokio::test]
async fn websocket_rejects_query_token_but_accepts_protocol_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("ws-{}@example.com", uid);
    let username = format!("wsuser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, _) = register_user(&mut app, &email, &username, password).await;

    // Start a real HTTP server for websocket handshake tests.
    let ws_app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, ws_app).await;
    });

    // Legacy query-token flow must fail.
    let mut legacy_req = format!("ws://{}/ws?token={}", addr, token)
        .into_client_request()
        .unwrap();
    legacy_req
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let legacy_err = connect_async(legacy_req)
        .await
        .expect_err("legacy query token must be rejected");
    match legacy_err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED)
        }
        other => panic!("expected HTTP 401 handshake error, got {other:?}"),
    }

    // Protocol token flow must succeed.
    let mut protocol_req = format!("ws://{}/ws", addr).into_client_request().unwrap();
    protocol_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{}", token)).unwrap(),
    );
    let (_ws_stream, response) = connect_async(protocol_req)
        .await
        .expect("protocol token websocket must connect");
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);

    server_handle.abort();
}

#[tokio::test]
async fn forgot_password_rate_limit_blocks_after_three_attempts() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app_with_auth_features(false, true).await;

    let email = format!("forgot-rate-limit-{}@example.com", Uuid::new_v4());
    for attempt in 0..3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/forgot-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "email": email })).unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "forgot-password attempt {} failed unexpectedly: {}",
            attempt + 1,
            String::from_utf8_lossy(&body)
        );
    }

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/forgot-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "email": email })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "forgot-password should be rate-limited on the 4th request: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn attachment_upload_fails_when_user_storage_quota_is_exceeded() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("quota-{}@example.com", uid);
    let username = format!("quota_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    sqlx::query("UPDATE users SET storage_used_bytes = $1 WHERE id = $2")
        .bind(1_073_741_824_i64)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let boundary = format!("----voxperyquota{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"small.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "upload should fail when quota is full: {}",
        String::from_utf8_lossy(&body)
    );
    assert!(
        String::from_utf8_lossy(&body).contains("Storage quota exceeded"),
        "quota error message should be explicit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn attachment_upload_rolls_back_prior_files_when_later_file_exceeds_quota() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("quota-rollback-{}@example.com", uid);
    let username = format!("quota_rollback_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);
    let initial_storage_used = 1_073_741_819_i64;

    sqlx::query("UPDATE users SET storage_used_bytes = $1 WHERE id = $2")
        .bind(initial_storage_used)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let boundary = format!("----voxperyquotarollback{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"first.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"second.txt\"\r\nContent-Type: text/plain\r\n\r\nworld\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, response_body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "second upload should exceed quota: {}",
        String::from_utf8_lossy(&response_body)
    );

    let storage_used: i64 =
        sqlx::query_scalar("SELECT storage_used_bytes FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        storage_used, initial_storage_used,
        "quota reservation must roll back"
    );

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(stored_count, 0, "attachment metadata must roll back");

    let storage_root = state
        .attachment_service
        .local_storage_dir()
        .expect("local attachment storage root");
    assert_eq!(
        count_regular_files(&storage_root).await,
        0,
        "rollback must remove files stored earlier in the request"
    );
}

#[tokio::test]
async fn email_verification_confirm_works_without_existing_session() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(true, false).await;

    let uid = Uuid::new_v4();
    let email = format!("verify-{}@example.com", uid);
    let username = format!("verify_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (_token, user_id) = register_user(&mut app, &email, &username, password).await;

    sqlx::query("UPDATE users SET email_verified = FALSE WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let verification_token = Uuid::new_v4().to_string();
    let token_hash = token_hash_base64(&verification_token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    sqlx::query(
        "INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(&email)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/email/confirm")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "token": verification_token })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "email verification confirm should succeed without auth: {}",
        String::from_utf8_lossy(&body)
    );

    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["message"], "Your email address has been verified.");

    let verified: bool = sqlx::query_scalar("SELECT email_verified FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert!(verified, "user should be marked verified after confirm");

    let remaining_tokens: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_verification_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(remaining_tokens, 0, "verification token should be deleted");
}

#[tokio::test]
async fn channel_create_race_is_serialized_at_500_channel_limit() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, state) = setup_app().await;
    let mut app = app;

    let uid = Uuid::new_v4();
    let email = format!("chan-race-{}@example.com", uid);
    let username = format!("chanrace_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, _) = register_user(&mut app, &email, &username, password).await;
    let auth_header = format!("Bearer {}", token);

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Race Lock {}", uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();

    sqlx::query("DELETE FROM channels WHERE server_id = $1")
        .bind(server_id)
        .execute(&state.db)
        .await
        .unwrap();

    for idx in 0..499 {
        sqlx::query(
            r#"INSERT INTO channels (id, server_id, name, description, channel_type, category, position, created_at)
               VALUES ($1, $2, $3, NULL, 'text', 'General', $4, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .bind(format!("seed-{idx}"))
        .bind(idx)
        .execute(&state.db)
        .await
        .unwrap();
    }

    let req_a = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "race-a",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let req_b = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "race-b",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();

    let (resp_a, resp_b) = tokio::join!(app.clone().oneshot(req_a), app.clone().oneshot(req_b));
    let resp_a = resp_a.expect("channel create request A should resolve");
    let resp_b = resp_b.expect("channel create request B should resolve");
    let status_a = resp_a.status();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let status_b = resp_b.status();
    let body_b = resp_b.into_body().collect().await.unwrap().to_bytes();

    let success_count = [status_a, status_b]
        .iter()
        .filter(|s| **s == StatusCode::OK)
        .count();
    let rejected_count = [status_a, status_b]
        .iter()
        .filter(|s| **s == StatusCode::BAD_REQUEST)
        .count();

    assert_eq!(
        success_count, 1,
        "exactly one concurrent create should succeed, got ({status_a}, {status_b}) with bodies: A={}, B={}",
        String::from_utf8_lossy(&body_a),
        String::from_utf8_lossy(&body_b)
    );
    assert_eq!(
        rejected_count, 1,
        "exactly one concurrent create should be rejected at 500-limit, got ({status_a}, {status_b}) with bodies: A={}, B={}",
        String::from_utf8_lossy(&body_a),
        String::from_utf8_lossy(&body_b)
    );

    let total_channels: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        total_channels, 500,
        "row lock must keep channel count capped at 500"
    );
}

#[tokio::test]
async fn dm_channel_create_race_returns_one_shared_channel() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("dmalice{}", &suffix[..8]);
    let bob_username = format!("dmbob{}", &suffix[8..16]);
    let (alice_token, alice_id) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        test_credential("default"),
    )
    .await;
    let (_, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {alice_token}");

    let request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/dm/channels/{bob_id}"))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    let response_a = response_a.expect("DM create request A should resolve");
    let response_b = response_b.expect("DM create request B should resolve");
    assert_eq!(response_a.status(), StatusCode::OK);
    assert_eq!(response_b.status(), StatusCode::OK);

    let body_a = response_a.into_body().collect().await.unwrap().to_bytes();
    let body_b = response_b.into_body().collect().await.unwrap().to_bytes();
    let channel_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    let channel_b: serde_json::Value = serde_json::from_slice(&body_b).unwrap();
    assert_eq!(channel_a["id"], channel_b["id"]);

    let pair_channel_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM dm_channels c
           WHERE EXISTS (
               SELECT 1 FROM dm_channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $1
           )
             AND EXISTS (
               SELECT 1 FROM dm_channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $2
           )"#,
    )
    .bind(alice_id)
    .bind(bob_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pair_channel_count, 1, "a DM pair must have one channel");
}

#[tokio::test]
async fn concurrent_member_role_replacements_leave_one_complete_state() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("role-owner-{owner_suffix}@example.com"),
        &format!("role_owner_{}", owner_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let member_suffix = Uuid::new_v4();
    let (member_token, member_id) = register_user(
        &mut app,
        &format!("role-member-{member_suffix}@example.com"),
        &format!("role_member_{}", member_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let member_auth = format!("Bearer {member_token}");

    let create_server_request = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Role Race Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_server_request).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "member join failed: {}",
        String::from_utf8_lossy(&body)
    );

    let mut role_ids = Vec::new();
    for name in ["Race Alpha", "Race Beta"] {
        let request = Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/roles"))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "name": name,
                    "permissions": 0,
                    "color": null
                }))
                .unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK);
        let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
        role_ids.push(Uuid::parse_str(role["id"].as_str().unwrap()).unwrap());
    }

    let role_request = |role_id: Uuid| {
        Request::builder()
            .method("PUT")
            .uri(format!(
                "/api/servers/{server_id}/members/{member_id}/roles"
            ))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "role_ids": [role_id] })).unwrap(),
            ))
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(role_request(role_ids[0])),
        app.clone().oneshot(role_request(role_ids[1]))
    );
    assert_eq!(
        response_a.expect("role request A should resolve").status(),
        StatusCode::OK
    );
    assert_eq!(
        response_b.expect("role request B should resolve").status(),
        StatusCode::OK
    );

    let assigned_role_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(member_id)
    .fetch_all(&state.db)
    .await
    .unwrap();
    assert_eq!(assigned_role_ids.len(), 1);
    assert!(role_ids.contains(&assigned_role_ids[0]));

    let invalid_role_request = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/roles"
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "role_ids": [assigned_role_ids[0], Uuid::new_v4()]
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, invalid_role_request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let roles_after_rejection: Vec<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(member_id)
    .fetch_all(&state.db)
    .await
    .unwrap();
    assert_eq!(roles_after_rejection, assigned_role_ids);

    let legacy_role: String =
        sqlx::query_scalar("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(member_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(legacy_role, "member");
}

#[tokio::test]
async fn concurrent_text_channel_deletes_preserve_one_channel() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("delete-race-{suffix}@example.com"),
        &format!("delete_race_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let create_server_request = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Delete Race Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_server_request).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let first_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let create_channel_request = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "second-text",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_channel_request).await;
    assert_eq!(status, StatusCode::OK);
    let second_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let second_channel_id = Uuid::parse_str(second_channel["id"].as_str().unwrap()).unwrap();

    let delete_request = |channel_id: Uuid| {
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/channels/{channel_id}"))
            .header("Authorization", &owner_auth)
            .body(Body::empty())
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(delete_request(first_channel_id)),
        app.clone().oneshot(delete_request(second_channel_id))
    );
    let status_a = response_a
        .expect("delete request A should resolve")
        .status();
    let status_b = response_b
        .expect("delete request B should resolve")
        .status();
    let success_count = [status_a, status_b]
        .iter()
        .filter(|status| **status == StatusCode::OK)
        .count();
    let rejected_count = [status_a, status_b]
        .iter()
        .filter(|status| **status == StatusCode::BAD_REQUEST)
        .count();
    assert_eq!(success_count, 1);
    assert_eq!(rejected_count, 1);

    let remaining_text_channels: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'text'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(remaining_text_channels, 1);

    let delete_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE server_id = $1 AND action = 'channel_delete'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(delete_audit_count, 1);
}

#[tokio::test]
async fn concurrent_pin_and_reaction_requests_preserve_message_limits() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("message-limit-{suffix}@example.com"),
        &format!("message_limit_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (_server_id, channel_id, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &owner_auth,
        "Message Limit Race Server",
    )
    .await;

    sqlx::query(
        r#"INSERT INTO messages (id, channel_id, user_id, content, created_at)
           SELECT uuid_generate_v4(), $1, $2, 'pin limit seed', NOW()
           FROM generate_series(1, 49)"#,
    )
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO channel_pins (channel_id, message_id, pinned_by_id)
           SELECT $1, id, $2
           FROM messages
           WHERE channel_id = $1 AND content = 'pin limit seed'"#,
    )
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();

    let pin_candidate_a = Uuid::new_v4();
    let pin_candidate_b = Uuid::new_v4();
    for message_id in [pin_candidate_a, pin_candidate_b] {
        sqlx::query(
            "INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, 'pin race candidate')",
        )
        .bind(message_id)
        .bind(channel_id)
        .bind(owner_id)
        .execute(&state.db)
        .await
        .unwrap();
    }

    let pin_request = |message_id: Uuid| {
        Request::builder()
            .method("POST")
            .uri(format!("/api/messages/{channel_id}/pins"))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "message_id": message_id })).unwrap(),
            ))
            .unwrap()
    };
    let (pin_a, pin_b) = tokio::join!(
        app.clone().oneshot(pin_request(pin_candidate_a)),
        app.clone().oneshot(pin_request(pin_candidate_b))
    );
    let pin_statuses = [
        pin_a.expect("pin request A should resolve").status(),
        pin_b.expect("pin request B should resolve").status(),
    ];
    assert_eq!(
        pin_statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        pin_statuses
            .iter()
            .filter(|status| **status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    let pin_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channel_pins WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(pin_count, 50);

    let reaction_message_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, 'reaction race target')",
    )
    .bind(reaction_message_id)
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO message_reactions (message_id, user_id, emoji)
           SELECT $1, $2, 'seed-' || seed
           FROM generate_series(1, 19) AS seed"#,
    )
    .bind(reaction_message_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();

    let reaction_request = |emoji: &str| {
        Request::builder()
            .method("POST")
            .uri(format!(
                "/api/messages/item/{reaction_message_id}/reactions"
            ))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "emoji": emoji })).unwrap(),
            ))
            .unwrap()
    };
    let (reaction_a, reaction_b) = tokio::join!(
        app.clone().oneshot(reaction_request("new-a")),
        app.clone().oneshot(reaction_request("new-b"))
    );
    let reaction_statuses = [
        reaction_a
            .expect("reaction request A should resolve")
            .status(),
        reaction_b
            .expect("reaction request B should resolve")
            .status(),
    ];
    assert_eq!(
        reaction_statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        reaction_statuses
            .iter()
            .filter(|status| **status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    let reaction_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT emoji) FROM message_reactions WHERE message_id = $1",
    )
    .bind(reaction_message_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(reaction_count, 20);
}

#[tokio::test]
async fn concurrent_duplicate_reports_create_one_open_report() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let reporter_suffix = Uuid::new_v4();
    let (reporter_token, reporter_id) = register_user(
        &mut app,
        &format!("reporter-{reporter_suffix}@example.com"),
        &format!("reporter_{}", reporter_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let target_suffix = Uuid::new_v4();
    let (target_token, target_id) = register_user(
        &mut app,
        &format!("report-target-{target_suffix}@example.com"),
        &format!("report_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let reporter_auth = format!("Bearer {reporter_token}");
    let target_auth = format!("Bearer {target_token}");
    let (server_id, channel_id, invite_code) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &reporter_auth,
        "Report Race Server",
    )
    .await;

    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &target_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "target join failed: {}",
        String::from_utf8_lossy(&body)
    );

    let user_report_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/reports/user"))
            .header("Authorization", &reporter_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "reported_user_id": target_id,
                    "reason": "spam"
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (user_report_a, user_report_b) = tokio::join!(
        app.clone().oneshot(user_report_request()),
        app.clone().oneshot(user_report_request())
    );
    assert_eq!(
        user_report_a
            .expect("user report A should resolve")
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        user_report_b
            .expect("user report B should resolve")
            .status(),
        StatusCode::OK
    );

    let send_request = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &target_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "report race message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, send_request).await;
    assert_eq!(status, StatusCode::OK);
    let message: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = Uuid::parse_str(message["id"].as_str().unwrap()).unwrap();

    let message_report_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/reports/message"))
            .header("Authorization", &reporter_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "message_id": message_id,
                    "reason": "spam"
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (message_report_a, message_report_b) = tokio::join!(
        app.clone().oneshot(message_report_request()),
        app.clone().oneshot(message_report_request())
    );
    assert_eq!(
        message_report_a
            .expect("message report A should resolve")
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        message_report_b
            .expect("message report B should resolve")
            .status(),
        StatusCode::OK
    );

    let open_report_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_reports
           WHERE server_id = $1
             AND reporter_user_id = $2
             AND reported_user_id = $3
             AND status = 'open'"#,
    )
    .bind(server_id)
    .bind(reporter_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        open_report_count, 2,
        "one user and one message report should remain"
    );

    let duplicate_groups: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM (
               SELECT message_id
               FROM server_reports
               WHERE server_id = $1
                 AND reporter_user_id = $2
                 AND reported_user_id = $3
                 AND status = 'open'
               GROUP BY message_id
               HAVING COUNT(*) > 1
           ) duplicates"#,
    )
    .bind(server_id)
    .bind(reporter_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(duplicate_groups, 0);
}

#[tokio::test]
async fn dm_message_search_rate_limit_matches_server_search() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let user_suffix = Uuid::new_v4();
    let (user_token, user_id) = register_user(
        &mut app,
        &format!("dm-search-limit-{user_suffix}@example.com"),
        &format!("dm_search_{}", user_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let peer_suffix = Uuid::new_v4();
    let (_, peer_id) = register_user(
        &mut app,
        &format!("dm-search-peer-{peer_suffix}@example.com"),
        &format!("dm_peer_{}", peer_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {user_token}");
    let channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO dm_channels (id) VALUES ($1)")
        .bind(channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO dm_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)")
        .bind(channel_id)
        .bind(user_id)
        .bind(peer_id)
        .execute(&state.db)
        .await
        .unwrap();

    let search_request = || {
        Request::builder()
            .uri(format!("/api/dm/messages/{channel_id}/search?q=rate-limit"))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=15 {
        let (status, body) = oneshot(&mut app, search_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "DM search attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, search_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the sixteenth DM search should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn voice_credential_endpoints_rate_limit_token_minting() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("voice-token-limit-{suffix}@example.com"),
        &format!("voice_limit_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {token}");
    let (server_id, _, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &auth_header,
        "Voice Token Limit Server",
    )
    .await;
    let voice_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let turn_request = || {
        Request::builder()
            .uri("/api/webrtc/turn-credentials")
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, turn_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "TURN credential attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, turn_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first TURN request should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );

    let livekit_request = || {
        Request::builder()
            .uri(format!(
                "/api/webrtc/livekit-token?channel_id={voice_channel_id}"
            ))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=20 {
        let (status, body) = oneshot(&mut app, livekit_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "LiveKit token attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, livekit_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the twenty-first LiveKit token request should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );

    let second_suffix = Uuid::new_v4();
    let (second_token, _) = register_user(
        &mut app,
        &format!("voice-global-limit-{second_suffix}@example.com"),
        &format!("voice_global_{}", second_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let second_auth_header = format!("Bearer {second_token}");
    let unauthorized_livekit_request = || {
        Request::builder()
            .uri(format!(
                "/api/webrtc/livekit-token?channel_id={}",
                Uuid::new_v4()
            ))
            .header("Authorization", &second_auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, unauthorized_livekit_request()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "unauthorized LiveKit attempt {attempt} should reach access validation: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, unauthorized_livekit_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first cross-channel LiveKit request should hit the user-wide limit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn attachment_content_rate_limit_runs_before_signature_and_storage_work() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("attachment-read-limit-{suffix}@example.com"),
        &format!("attachment_read_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {token}");
    let attachment_id = Uuid::new_v4();
    let content_request = |requested_attachment_id: Uuid| {
        Request::builder()
            .uri(format!(
                "/api/attachments/content/{requested_attachment_id}?exp=4102444800&sig=invalid"
            ))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };

    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, content_request(attachment_id)).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "attachment attempt {attempt} should reach signature validation: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, content_request(attachment_id)).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first attachment request should be limited before validation: {}",
        String::from_utf8_lossy(&body)
    );

    for attempt in 32..=240 {
        let (status, body) = oneshot(&mut app, content_request(Uuid::new_v4())).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "attachment attempt {attempt} should remain under the user-wide limit: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, content_request(Uuid::new_v4())).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the 241st attachment request should hit the user-wide limit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn message_and_dm_retries_create_one_persistent_message() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-message-{suffix}@example.com"),
        &format!("idem_msg_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let peer_suffix = Uuid::new_v4();
    let (_, peer_id) = register_user(
        &mut app,
        &format!("idempotent-peer-{peer_suffix}@example.com"),
        &format!("idem_peer_{}", peer_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let (_, channel_id, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &auth,
        "Idempotent Message Server",
    )
    .await;

    let message_request_id = format!("message-{suffix}");
    let message_request = |content: &str| {
        Request::builder()
            .method("POST")
            .uri(format!("/api/messages/{channel_id}"))
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "content": content,
                    "client_request_id": message_request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, message_request("send once")).await;
    let (retry_status, retry_body) = oneshot(&mut app, message_request("send once")).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first_message: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retried_message: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first_message["id"], retried_message["id"]);
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND user_id = $2 AND client_request_id = $3",
    )
    .bind(channel_id)
    .bind(user_id)
    .bind(&message_request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(message_count, 1);
    let (conflict_status, _) = oneshot(&mut app, message_request("different content")).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);

    let dm_channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO dm_channels (id) VALUES ($1)")
        .bind(dm_channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO dm_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)")
        .bind(dm_channel_id)
        .bind(user_id)
        .bind(peer_id)
        .execute(&state.db)
        .await
        .unwrap();
    let dm_request_id = format!("dm-{suffix}");
    let dm_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/dm/messages/{dm_channel_id}"))
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "content": "send DM once",
                    "client_request_id": dm_request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, dm_request()).await;
    let (retry_status, retry_body) = oneshot(&mut app, dm_request()).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first_dm: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retried_dm: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first_dm["id"], retried_dm["id"]);
    let dm_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_messages WHERE channel_id = $1 AND user_id = $2 AND client_request_id = $3",
    )
    .bind(dm_channel_id)
    .bind(user_id)
    .bind(&dm_request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(dm_count, 1);
}

#[tokio::test]
async fn server_create_retry_returns_the_original_server() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-server-{suffix}@example.com"),
        &format!("idem_server_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let request_id = format!("server-{suffix}");
    let create_request = |name: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/servers")
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "name": name,
                    "description": "Retry-safe server",
                    "client_request_id": request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, create_request("One Server")).await;
    let (retry_status, retry_body) = oneshot(&mut app, create_request("One Server")).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retry: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first["id"], retry["id"]);
    let server_id = Uuid::parse_str(first["id"].as_str().unwrap()).unwrap();
    let server_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM servers WHERE owner_id = $1 AND client_request_id = $2",
    )
    .bind(user_id)
    .bind(&request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(server_count, 1);
    let channel_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(channel_count, 2);
    let (conflict_status, _) = oneshot(&mut app, create_request("Changed Server")).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn repeated_attachment_upload_reuses_storage_and_quota() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-upload-{suffix}@example.com"),
        &format!("idem_upload_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let upload_request = || {
        let boundary = format!("----voxpery-idempotent-{suffix}");
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"retry.txt\"\r\nContent-Type: text/plain\r\n\r\nretry-safe upload\r\n--{boundary}--\r\n"
        );
        Request::builder()
            .method("POST")
            .uri("/api/attachments/upload")
            .header("Authorization", &auth)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body.into_bytes()))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, upload_request()).await;
    let (retry_status, retry_body) = oneshot(&mut app, upload_request()).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retry: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first[0]["id"], retry[0]["id"]);
    let attachment_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1 AND original_name = 'retry.txt'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(attachment_count, 1);
    let storage_used: i64 =
        sqlx::query_scalar("SELECT storage_used_bytes FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(storage_used, 17);
}

#[tokio::test]
async fn concurrent_friend_requests_create_one_pending_pair() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let sender_suffix = Uuid::new_v4();
    let (sender_token, sender_id) = register_user(
        &mut app,
        &format!("friend-idem-sender-{sender_suffix}@example.com"),
        &format!("friend_sender_{}", sender_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let target_suffix = Uuid::new_v4();
    let (target_token, target_id) = register_user(
        &mut app,
        &format!("friend-idem-target-{target_suffix}@example.com"),
        &format!("friend_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let sender_auth = format!("Bearer {sender_token}");
    let target_auth = format!("Bearer {target_token}");
    let sender_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(sender_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let target_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let friend_request = |auth: &str, username: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/friends/requests")
            .header("Authorization", auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "username": username })).unwrap(),
            ))
            .unwrap()
    };
    let (request_a, request_b) = tokio::join!(
        app.clone()
            .oneshot(friend_request(&sender_auth, &target_username)),
        app.clone()
            .oneshot(friend_request(&target_auth, &sender_username))
    );
    assert_eq!(request_a.unwrap().status(), StatusCode::OK);
    assert_eq!(request_b.unwrap().status(), StatusCode::OK);
    let pending_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM friend_requests
           WHERE status = 'pending'
             AND LEAST(requester_id, receiver_id) = LEAST($1::uuid, $2::uuid)
             AND GREATEST(requester_id, receiver_id) = GREATEST($1::uuid, $2::uuid)"#,
    )
    .bind(sender_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pending_count, 1);
}
