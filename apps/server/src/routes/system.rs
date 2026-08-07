use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    services::{
        client_ip::resolve_client_ip,
        observability::{
            log_client_event, rate_limit_fingerprint, ClientObservabilityEvent, ObservabilityClient,
        },
        rate_limit::enforce_rate_limit,
    },
    AppState,
};

#[derive(Debug, Serialize)]
pub struct SystemFeaturesResponse {
    pub google_oauth_enabled: bool,
    pub email_delivery_enabled: bool,
    pub email_verification_enabled: bool,
    pub email_verification_required: bool,
    pub password_reset_enabled: bool,
    pub observability_enabled: bool,
}

pub fn router(_state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/features", get(get_features))
        .route("/observability/events", post(record_observability_event))
}

async fn get_features(State(state): State<Arc<AppState>>) -> Json<SystemFeaturesResponse> {
    Json(SystemFeaturesResponse {
        google_oauth_enabled: state.google_oauth_enabled,
        email_delivery_enabled: state.email_delivery_enabled,
        email_verification_enabled: state.email_verification_enabled,
        email_verification_required: state.email_verification_required,
        password_reset_enabled: state.password_reset_enabled,
        observability_enabled: state.observability_enabled,
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ObservabilityEventRequest {
    event: ClientObservabilityEvent,
    client: ObservabilityClient,
}

async fn record_observability_event(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    Json(body): Json<ObservabilityEventRequest>,
) -> axum::http::StatusCode {
    if !state.observability_enabled {
        return axum::http::StatusCode::NO_CONTENT;
    }

    let peer_ip = connect_info
        .as_ref()
        .map(|Extension(ConnectInfo(addr))| addr.ip());
    let client_ip = resolve_client_ip(&headers, peer_ip, &state.trusted_proxies)
        .unwrap_or_else(|| "unknown".into());
    let fingerprint = rate_limit_fingerprint(&state.jwt_secret, &client_ip);
    let rate_result = enforce_rate_limit(
        &state.redis,
        format!("observability:{fingerprint}"),
        state.observability_rate_limit_max,
        Duration::from_secs(state.observability_rate_limit_window_secs),
        "Too many observability events",
    )
    .await;

    if rate_result.is_ok() {
        log_client_event(body.event, body.client);
    }

    // Observability must never alter product behavior or reveal rate-limit state.
    axum::http::StatusCode::NO_CONTENT
}
