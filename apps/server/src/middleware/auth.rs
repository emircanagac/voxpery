use axum::{
    extract::{Request, State},
    http::header,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{errors::AppError, AppState};

/// JWT claims stored in the token.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,         // user id
    pub username: String,
    pub exp: usize,        // expiration timestamp
    pub iat: usize,        // issued at
}

/// Extract JWT from Cookie header (e.g. "voxpery_token=eyJ..."). Supports cookie-based auth for web.
fn token_from_cookie<'a>(headers: &'a axum::http::HeaderMap, cookie_name: &str) -> Option<&'a str> {
    let cookie_header = headers.get(header::COOKIE).and_then(|v| v.to_str().ok())?;
    let prefix = format!("{}=", cookie_name);
    for part in cookie_header.split(';').map(str::trim) {
        if part.starts_with(&prefix) {
            let value = part.strip_prefix(&prefix).unwrap_or_default().trim();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Returns JWT from Authorization Bearer or from cookie. Used by require_auth and WebSocket upgrade.
pub(crate) fn token_from_request(headers: &axum::http::HeaderMap, cookie_name: &str) -> Option<String> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|s| !s.is_empty());
    bearer
        .map(ToString::to_string)
        .or_else(|| token_from_cookie(headers, cookie_name).map(ToString::to_string))
}

/// Middleware that validates the JWT and injects Claims into request extensions.
/// Accepts token from Authorization Bearer (desktop) or from httpOnly cookie (web).
pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = token_from_request(req.headers(), &state.cookie_name).ok_or(AppError::Unauthorized)?;

    match crate::services::jwt_blacklist::is_blacklisted(&state.redis, &token).await {
        Ok(true) => return Err(AppError::Unauthorized),
        Ok(false) => {}
        Err(e) => {
            tracing::warn!("Redis JWT blacklist check failed: {}", e);
            return Err(AppError::Unauthorized);
        }
    }

    let claims = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AppError::Unauthorized)?
    .claims;

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}

/// Helper to extract claims from request extensions in handlers.
#[allow(dead_code)]
pub fn get_claims(extensions: &axum::http::Extensions) -> Result<&Claims, AppError> {
    extensions.get::<Claims>().ok_or(AppError::Unauthorized)
}
