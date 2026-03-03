//! Voxpery server library. Exposes app state and router for integration tests and binary.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, Method, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use dashmap::DashMap;
use serde_json::json;
use tokio::sync::broadcast;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub mod config;
pub mod errors;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;
pub mod ws;

/// Shared application state passed to all handlers.
pub struct AppState {
    pub db: sqlx::PgPool,
    pub redis: redis::Client,
    pub jwt_secret: String,
    pub jwt_expiration: i64,
    /// Broadcast channel for real-time events (messages, presence, etc.)
    pub tx: broadcast::Sender<ws::WsEvent>,
    /// Connected WebSocket sessions: user_id -> list of sender handles
    pub sessions: DashMap<uuid::Uuid, Vec<tokio::sync::mpsc::UnboundedSender<ws::WsEvent>>>,
    /// Voice sessions: user_id -> channel_id
    pub voice_sessions: DashMap<uuid::Uuid, uuid::Uuid>,
    /// Voice controls: user_id -> (muted, deafened, screen_sharing)
    pub voice_controls: DashMap<uuid::Uuid, (bool, bool, bool)>,
    /// Rolling in-memory counters for basic route rate limits.
    pub rate_limits: DashMap<String, Vec<Instant>>,
    pub auth_rate_limit_max: usize,
    pub auth_rate_limit_window_secs: u64,
    pub message_rate_limit_max: usize,
    pub message_rate_limit_window_secs: u64,
    pub cookie_secure: bool,
    pub cookie_name: String,
    pub cors_origins: Vec<String>,
    pub turn_urls: Option<String>,
    pub turn_shared_secret: Option<String>,
    pub turn_credential_ttl_secs: u64,
    pub livekit_ws_url: Option<String>,
    pub livekit_api_key: Option<String>,
    pub livekit_api_secret: Option<String>,
}

/// GET /health — liveness/readiness for load balancers and k8s.
async fn health_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "status": "ok",
                "database": "connected"
            })),
        )
            .into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "unhealthy",
                "database": "disconnected"
            })),
        )
            .into_response(),
    }
}

fn is_local_origin(origin: &str) -> bool {
    origin.starts_with("http://localhost")
        || origin.starts_with("https://localhost")
        || origin.starts_with("http://127.0.0.1")
        || origin.starts_with("https://127.0.0.1")
        || origin.starts_with("tauri://localhost")
        || origin.starts_with("tauri://127.0.0.1")
}

/// Validates CORS and cookie security configuration (used at startup).
pub fn validate_security_config(cors_origins: &[String], cookie_secure: bool) -> Result<(), String> {
    if cors_origins.iter().any(|o| o == "*") {
        return Err(
            "Invalid CORS configuration: CORS_ORIGINS cannot contain '*' when credentials are enabled"
                .into(),
        );
    }
    let has_non_local_origin = cors_origins.iter().any(|o| !is_local_origin(o));
    if has_non_local_origin && !cookie_secure {
        return Err(
            "Invalid cookie security configuration: COOKIE_SECURE must be true for non-local origins"
                .into(),
        );
    }
    Ok(())
}

/// Run database migrations. Used by the binary and by integration tests.
pub async fn run_migrations(pool: &sqlx::PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// Build the application router. Used by the binary and by integration tests.
/// `cors_origins`: allowed CORS origins (e.g. from config or test defaults).
pub fn build_app(state: Arc<AppState>, cors_origins: Vec<String>) -> Router {
    let origins: Vec<header::HeaderValue> = cors_origins
        .iter()
        .filter_map(|o| o.parse::<header::HeaderValue>().ok())
        .collect();
    let allow_origin = AllowOrigin::list(origins);
    let cors = CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_credentials(true);

    const BODY_LIMIT: usize = 10 * 1024 * 1024;

    Router::new()
        .route("/health", get(health_handler))
        .nest("/api/auth", routes::auth::router(state.clone()))
        .nest("/api/friends", routes::friends::router(state.clone()))
        .nest("/api/dm", routes::dm::router(state.clone()))
        .nest("/api/servers", routes::servers::router(state.clone()))
        .nest("/api/channels", routes::channels::router(state.clone()))
        .nest("/api/messages", routes::messages::router(state.clone()))
        .nest("/api/webrtc", routes::webrtc::router(state.clone()))
        .route("/ws", axum::routing::get(ws::handler::ws_handler))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(cors)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::validate_security_config;

    #[test]
    fn rejects_wildcard_cors() {
        let origins = vec!["*".to_string()];
        let result = validate_security_config(&origins, true);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_non_local_without_secure_cookie() {
        let origins = vec!["https://voxpery.com".to_string()];
        let result = validate_security_config(&origins, false);
        assert!(result.is_err());
    }

    #[test]
    fn allows_local_without_secure_cookie() {
        let origins = vec!["http://localhost:5173".to_string()];
        let result = validate_security_config(&origins, false);
        assert!(result.is_ok());
    }

    #[test]
    fn allows_tauri_local_without_secure_cookie() {
        let origins = vec!["tauri://localhost".to_string()];
        let result = validate_security_config(&origins, false);
        assert!(result.is_ok());
    }

    #[test]
    fn allows_non_local_with_secure_cookie() {
        let origins = vec!["https://voxpery.com".to_string()];
        let result = validate_security_config(&origins, true);
        assert!(result.is_ok());
    }
}
