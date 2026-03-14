//! API integration tests. Require a running PostgreSQL and env vars:
//! - DATABASE_URL
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
use sha1::{Digest, Sha1};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tower::ServiceExt;
use uuid::Uuid;
use voxpery_server::{build_app, run_migrations, AppState};

fn test_db_url() -> Option<String> {
    dotenvy::dotenv().ok();
    std::env::var("DATABASE_URL").ok()
}

fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "test-jwt-secret-change-in-production".into())
}

fn redis_client() -> redis::Client {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
    redis::Client::open(redis_url).expect("Failed to create Redis client for integration tests")
}

async fn setup_app() -> (axum::Router, Arc<AppState>) {
    let database_url = test_db_url().expect("DATABASE_URL must be set for integration tests");
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to test database");

    run_migrations(&db).await.expect("Failed to run migrations");

    let (tx, _rx) = broadcast::channel(256);
    let state = Arc::new(AppState {
        db,
        redis: redis_client(),
        jwt_secret: jwt_secret(),
        jwt_expiration: 86400,
        tx,
        sessions: DashMap::new(),
        voice_sessions: DashMap::new(),
        voice_controls: DashMap::new(),
        auth_rate_limit_max: 100,
        auth_rate_limit_window_secs: 60,
        message_rate_limit_max: 100,
        message_rate_limit_window_secs: 10,
        cookie_secure: false,
        cookie_name: "voxpery_token".to_string(),
        cors_origins: vec!["http://localhost:5173".to_string()],
        turn_urls: None,
        turn_shared_secret: None,
        turn_credential_ttl_secs: 3600,
        livekit_ws_url: None,
        livekit_api_key: None,
        livekit_api_secret: None,
        google_client_id: None,
        google_client_secret: None,
        public_api_url: None,
        turnstile_secret_key: None,
        smtp_host: None,
        smtp_password: None,
        smtp_user: None,
    });

    let app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    (app, state)
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
    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
    assert_eq!(json["database"], "connected");
}

#[tokio::test]
async fn register_login_me_flow() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("test-{}@example.com", uid);
    let username = format!("user_{}", uid.as_u128() % 1_000_000);
    let password = "password123";

    // Register
    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
async fn default_voxpery_server_has_moderator_role_after_register() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("mod-{}@example.com", uid);
    let username = format!("moduser_{}", uid.as_u128() % 1_000_000);
    let password = "password123";

    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
        moderator_permissions, 6992,
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
        has_everyone_role, 1,
        "newly joined default member must get @everyone role"
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
    let password = "password123";

    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
async fn create_server_seeds_recommended_moderator_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("srvmod-{}@example.com", uid);
    let username = format!("srvmod_{}", uid.as_u128() % 1_000_000);
    let password = "password123";

    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
        moderator_permissions, 6992,
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
        creator_has_everyone, 1,
        "server creator must get @everyone role"
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
    let owner_register = json!({
        "email": owner_email,
        "username": owner_username,
        "password": "password123"
    });
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
    let member_register = json!({
        "email": member_email,
        "username": member_username,
        "password": "password123"
    });
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
        member_has_everyone, 1,
        "joined member should auto-receive @everyone role"
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
    let password = "password123";

    let register_body = json!({
        "email": email,
        "username": username,
        "password": password
    });
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
        "name": "general",
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
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{} must return 401 without auth; got {} body: {}",
            uri,
            status,
            String::from_utf8_lossy(&body)
        );
    }
}

#[tokio::test]
async fn strict_username_validation_rejects_invalid_usernames() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let invalid_usernames = vec![
        "UPPERCASE",
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

        let register_body = json!({
            "email": email,
            "username": username,
            "password": "password123"
        });
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
    let register_body = json!({
        "email": email,
        "username": username,
        "password": "password123"
    });
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
async fn password_change_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("pwchg-{}@example.com", uid);
    let username = format!("pwchg_{}", uid.as_u128() % 1_000_000);
    let old_password = "password123";
    let new_password = "password456";

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
async fn password_reset_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("pwreset-{}@example.com", uid);
    let username = format!("pwreset_{}", uid.as_u128() % 1_000_000);
    let old_password = "password123";
    let new_password = "password456";

    let (old_token, user_id) = register_user(&mut app, &email, &username, old_password).await;
    let old_auth = format!("Bearer {}", old_token);

    // Seed a known reset token in DB (same hashing logic as backend).
    let reset_token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha1::new();
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
async fn websocket_rejects_query_token_but_accepts_protocol_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("ws-{}@example.com", uid);
    let username = format!("wsuser_{}", uid.as_u128() % 1_000_000);
    let password = "password123";
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
    legacy_req.headers_mut().insert(
        "Origin",
        HeaderValue::from_static("http://localhost:5173"),
    );
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
