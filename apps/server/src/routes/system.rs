use std::sync::Arc;

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct SystemFeaturesResponse {
    pub google_oauth_enabled: bool,
    pub email_delivery_enabled: bool,
    pub email_verification_enabled: bool,
    pub email_verification_required: bool,
    pub password_reset_enabled: bool,
}

pub fn router(_state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new().route("/features", get(get_features))
}

async fn get_features(State(state): State<Arc<AppState>>) -> Json<SystemFeaturesResponse> {
    Json(SystemFeaturesResponse {
        google_oauth_enabled: state.google_oauth_enabled,
        email_delivery_enabled: state.email_delivery_enabled,
        email_verification_enabled: state.email_verification_enabled,
        email_verification_required: state.email_verification_required,
        password_reset_enabled: state.password_reset_enabled,
    })
}
