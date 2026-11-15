//! Web Push subscriptions of the signed-in account's browsers.

use axum::{extract::State, http::StatusCode, middleware, routing::post, Extension, Json, Router};
use std::{sync::Arc, time::Duration};

use crate::{
    errors::AppError,
    middleware::auth::{require_auth_and_current_legal_consent, Claims},
    services::{rate_limit::enforce_rate_limit, web_push},
    AppState,
};

const SUBSCRIPTION_CHANGES_PER_HOUR: usize = 30;

#[derive(Debug, serde::Deserialize)]
struct SubscriptionKeys {
    p256dh: String,
    auth: String,
}

/// The browser's `PushSubscription.toJSON()`; other fields are ignored.
#[derive(Debug, serde::Deserialize)]
struct SubscribeRequest {
    endpoint: String,
    keys: SubscriptionKeys,
}

#[derive(Debug, serde::Deserialize)]
struct UnsubscribeRequest {
    endpoint: String,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/subscriptions", post(subscribe).delete(unsubscribe))
        .route_layer(middleware::from_fn_with_state(
            state,
            require_auth_and_current_legal_consent,
        ))
}

async fn limit(state: &AppState, user_id: uuid::Uuid) -> Result<(), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("push:subscriptions:user:{user_id}"),
        SUBSCRIPTION_CHANGES_PER_HOUR,
        Duration::from_secs(60 * 60),
        "Too many notification changes. Please try again later.",
    )
    .await
}

/// POST /api/push/subscriptions — store this browser's subscription for the caller. A browser
/// has one row: when another account signs in on it, the row moves to that account. An account
/// keeps its newest 10 browsers.
async fn subscribe(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SubscribeRequest>,
) -> Result<StatusCode, AppError> {
    if state.web_push.is_none() {
        return Err(AppError::FeatureDisabled(
            "Push notifications are not configured on this server".into(),
        ));
    }
    limit(&state, claims.sub).await?;
    web_push::validate_endpoint(&body.endpoint)?;
    web_push::validate_keys(&body.keys.p256dh, &body.keys.auth)?;

    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (endpoint) DO UPDATE
               SET user_id = EXCLUDED.user_id,
                   p256dh = EXCLUDED.p256dh,
                   auth = EXCLUDED.auth,
                   created_at = NOW(),
                   last_used_at = NULL"#,
    )
    .bind(claims.sub)
    .bind(&body.endpoint)
    .bind(&body.keys.p256dh)
    .bind(&body.keys.auth)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"DELETE FROM push_subscriptions
           WHERE id IN (
               SELECT id FROM push_subscriptions
               WHERE user_id = $1
               ORDER BY created_at DESC, id
               OFFSET $2
           )"#,
    )
    .bind(claims.sub)
    .bind(web_push::MAX_SUBSCRIPTIONS_PER_USER)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/push/subscriptions — forget this browser for the caller (sign-out, or turning the
/// setting off). Works without VAPID keys too, so a server that dropped them can still clean up.
async fn unsubscribe(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UnsubscribeRequest>,
) -> Result<StatusCode, AppError> {
    limit(&state, claims.sub).await?;
    sqlx::query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2")
        .bind(claims.sub)
        .bind(&body.endpoint)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
