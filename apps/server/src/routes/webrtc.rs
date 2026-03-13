//! WebRTC-related API: TURN credentials from server env (not in frontend bundle).

use axum::{
    extract::{Query, State},
    middleware,
    routing::get,
    Extension, Json, Router,
};
use base64::Engine;
use hmac::{Hmac, Mac};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    ws::access::can_join_voice_channel,
    AppState,
};

#[derive(Debug, Serialize)]
pub struct TurnCredentialsResponse {
    pub urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/turn-credentials", get(turn_credentials))
        .route("/livekit-token", get(livekit_token))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

type HmacSha1 = Hmac<Sha1>;

fn generate_turn_credentials(
    shared_secret: &str,
    user_id: uuid::Uuid,
    ttl_secs: u64,
) -> Result<(String, String), AppError> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs();
    let expiry = now + ttl_secs.max(60);
    let username = format!("{}:{}", expiry, user_id);

    let mut mac = HmacSha1::new_from_slice(shared_secret.as_bytes())
        .map_err(|e| AppError::Internal(format!("Invalid TURN shared secret: {e}")))?;
    mac.update(username.as_bytes());
    let signature = mac.finalize().into_bytes();
    let credential = base64::engine::general_purpose::STANDARD.encode(signature);

    Ok((username, credential))
}

/// GET /api/webrtc/turn-credentials — returns TURN config from server env (auth required).
async fn turn_credentials(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<TurnCredentialsResponse>, AppError> {
    tracing::info!(
        "User {} ({}) requested TURN credentials",
        claims.username,
        claims.sub
    );

    let urls: Vec<String> = state
        .turn_urls
        .as_ref()
        .map(|s| {
            s.split(',')
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();

    if urls.is_empty() {
        return Ok(Json(TurnCredentialsResponse {
            urls,
            username: None,
            credential: None,
        }));
    }

    let shared_secret = state
        .turn_shared_secret
        .as_deref()
        .ok_or_else(|| AppError::Internal("TURN_SHARED_SECRET not configured".into()))?;
    let (username, credential) =
        generate_turn_credentials(shared_secret, claims.sub, state.turn_credential_ttl_secs)?;

    Ok(Json(TurnCredentialsResponse {
        urls,
        username: Some(username),
        credential: Some(credential),
    }))
}

#[derive(Debug, Deserialize)]
struct LivekitTokenQuery {
    channel_id: String,
}

#[derive(Debug, Serialize)]
struct LivekitTokenResponse {
    ws_url: String,
    token: String,
    room: String,
    identity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitVideoGrant {
    room: String,
    room_join: bool,
    can_publish: bool,
    can_subscribe: bool,
}

#[derive(Debug, Serialize)]
struct LivekitClaims {
    iss: String,
    sub: String,
    name: String,
    nbf: usize,
    exp: usize,
    video: LivekitVideoGrant,
}

/// GET /api/webrtc/livekit-token?channel_id=... — returns LiveKit access token (auth required).
async fn livekit_token(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LivekitTokenQuery>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<LivekitTokenResponse>, AppError> {
    let channel_id = uuid::Uuid::parse_str(&query.channel_id)
        .map_err(|_| AppError::Validation("Invalid channel_id".into()))?;

    let can_join = can_join_voice_channel(&state.db, claims.sub, channel_id).await?;
    if !can_join {
        return Err(AppError::Forbidden("Voice access denied".into()));
    }

    let ws_url = state
        .livekit_ws_url
        .clone()
        .ok_or_else(|| AppError::Internal("LiveKit WS URL not configured".into()))?;
    let api_key = state
        .livekit_api_key
        .clone()
        .ok_or_else(|| AppError::Internal("LiveKit API key not configured".into()))?;
    let api_secret = state
        .livekit_api_secret
        .clone()
        .ok_or_else(|| AppError::Internal("LiveKit API secret not configured".into()))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs() as usize;
    let exp = now + 60 * 60;
    let nbf = now;

    let room = query.channel_id;
    let identity = claims.sub.to_string();

    let token = encode(
        &Header::default(),
        &LivekitClaims {
            iss: api_key,
            sub: identity.clone(),
            name: claims.username.clone(),
            nbf,
            exp,
            video: LivekitVideoGrant {
                room: room.clone(),
                room_join: true,
                can_publish: true,
                can_subscribe: true,
            },
        },
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to sign LiveKit token: {e}")))?;

    Ok(Json(LivekitTokenResponse {
        ws_url,
        token,
        room,
        identity,
    }))
}
