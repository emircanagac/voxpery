//! Voxpery server library. Exposes app state and router for integration tests and binary.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    body::{to_bytes, Body},
    extract::{DefaultBodyLimit, State},
    http::{header, Method, StatusCode},
    middleware::map_response,
    response::{IntoResponse, Response},
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

pub fn should_sanitize_client_error(body: &str) -> bool {
    let text = body.to_ascii_lowercase();
    let patterns = [
        "uuid parsing failed",
        "number too large to fit",
        "failed to deserialize",
        "failed to parse",
        "invalid type",
        "expected `",
        "at line",
        "at column",
    ];
    patterns.iter().any(|pattern| text.contains(pattern))
}

async fn sanitize_verbose_client_errors(response: Response) -> Response {
    if response.status() != StatusCode::BAD_REQUEST
        && response.status() != StatusCode::UNPROCESSABLE_ENTITY
    {
        return response;
    }

    let (parts, body) = response.into_parts();
    let bytes = match to_bytes(body, 64 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return Response::from_parts(parts, Body::from("Bad Request"));
        }
    };

    let body_text = String::from_utf8_lossy(&bytes);
    if should_sanitize_client_error(&body_text) {
        tracing::warn!("Sanitized verbose client error response");
        let mut sanitized = (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid request" })),
        )
            .into_response();
        if let Some(request_id) = parts.headers.get("x-request-id") {
            sanitized
                .headers_mut()
                .insert("x-request-id", request_id.clone());
        }
        return sanitized;
    }

    Response::from_parts(parts, Body::from(bytes))
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
        .layer(map_response(sanitize_verbose_client_errors))
        .layer(cors)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::{validate_security_config, should_sanitize_client_error};

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

    #[test]
    fn detects_verbose_client_error_patterns() {
        assert!(should_sanitize_client_error("UUID parsing failed: invalid length"));
        assert!(should_sanitize_client_error("number too large to fit in target type"));
        assert!(should_sanitize_client_error("failed to deserialize JSON body"));
        assert!(!should_sanitize_client_error("Invalid credentials"));
    }
}
