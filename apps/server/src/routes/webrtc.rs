//! WebRTC-related API: TURN credentials from server env (not in frontend bundle).

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    middleware,
    routing::{get, post},
    Extension, Json, Router,
};
use base64::Engine;
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{
    errors::AppError,
    middleware::auth::{require_auth_and_current_legal_consent, Claims},
    services::rate_limit::enforce_rate_limit,
    services::voice_revoke::clear_local_voice_session,
    ws::access::can_join_voice_channel,
    AppState,
};

const TURN_CREDENTIAL_RATE_LIMIT_MAX: usize = 30;
const LIVEKIT_TOKEN_USER_RATE_LIMIT_MAX: usize = 30;
const LIVEKIT_TOKEN_RATE_LIMIT_MAX: usize = 20;
const MEDIA_TOKEN_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const LIVEKIT_WEBHOOK_BODY_LIMIT: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct TurnCredentialsResponse {
    pub urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    let authenticated = Router::new()
        .route("/turn-credentials", get(turn_credentials))
        .route("/livekit-token", get(livekit_token))
        .route_layer(middleware::from_fn_with_state(
            state,
            require_auth_and_current_legal_consent,
        ));

    let webhook = Router::new()
        .route("/livekit-webhook", post(livekit_webhook))
        .layer(DefaultBodyLimit::max(LIVEKIT_WEBHOOK_BODY_LIMIT));

    Router::new().merge(webhook).merge(authenticated)
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
    enforce_rate_limit(
        &state.redis,
        format!("webrtc:turn-credentials:{}", claims.sub),
        TURN_CREDENTIAL_RATE_LIMIT_MAX,
        MEDIA_TOKEN_RATE_LIMIT_WINDOW,
        "TURN credential rate limit exceeded. Please retry shortly.",
    )
    .await?;

    tracing::info!("User {} requested TURN credentials", claims.sub);

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

#[derive(Debug, Deserialize)]
struct LivekitWebhookClaims {
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct LivekitWebhookEvent {
    event: String,
    room: Option<LivekitWebhookRoom>,
    participant: Option<LivekitWebhookParticipant>,
}

#[derive(Debug, Deserialize)]
struct LivekitWebhookRoom {
    name: String,
}

#[derive(Debug, Deserialize)]
struct LivekitWebhookParticipant {
    identity: String,
    sid: Option<String>,
}

fn webhook_matches_active_participant(
    active_participant_sid: Option<&str>,
    event_participant_sid: Option<&str>,
) -> bool {
    active_participant_sid.is_some() && active_participant_sid == event_participant_sid
}

fn verify_livekit_webhook(
    body: &[u8],
    authorization: &str,
    api_key: &str,
    api_secret: &str,
) -> Result<LivekitWebhookEvent, AppError> {
    let token = authorization
        .strip_prefix("Bearer ")
        .unwrap_or(authorization)
        .trim();
    if token.is_empty() {
        return Err(AppError::Unauthorized);
    }

    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&[api_key]);
    validation.set_required_spec_claims(&["exp", "iss", "sha256"]);
    validation.validate_nbf = true;
    let claims = decode::<LivekitWebhookClaims>(
        token,
        &DecodingKey::from_secret(api_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized)?
    .claims;

    let signed_hash = base64::engine::general_purpose::STANDARD
        .decode(claims.sha256)
        .map_err(|_| AppError::Unauthorized)?;
    let body_hash = Sha256::digest(body);
    if signed_hash.as_slice() != &body_hash[..] {
        return Err(AppError::Unauthorized);
    }

    serde_json::from_slice(body).map_err(|_| AppError::Unauthorized)
}

async fn livekit_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let api_key = state
        .livekit_api_key
        .as_deref()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let api_secret = state
        .livekit_api_secret
        .as_deref()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let event = verify_livekit_webhook(&body, authorization, api_key, api_secret)?;

    if event.event != "participant_left" {
        return Ok(StatusCode::NO_CONTENT);
    }

    let (Some(room), Some(participant)) = (event.room, event.participant) else {
        tracing::warn!("Ignoring incomplete LiveKit participant_left webhook");
        return Ok(StatusCode::NO_CONTENT);
    };
    let Ok(channel_id) = uuid::Uuid::parse_str(&room.name) else {
        tracing::warn!("Ignoring LiveKit participant_left webhook with a non-Voxpery room");
        return Ok(StatusCode::NO_CONTENT);
    };
    let Ok(user_id) = uuid::Uuid::parse_str(&participant.identity) else {
        tracing::warn!("Ignoring LiveKit participant_left webhook with an invalid identity");
        return Ok(StatusCode::NO_CONTENT);
    };
    let active_participant_sid = state
        .voice_participant_sids
        .get(&user_id)
        .map(|entry| entry.clone());
    if !webhook_matches_active_participant(
        active_participant_sid.as_deref(),
        participant.sid.as_deref(),
    ) {
        tracing::debug!(
            "Ignoring stale LiveKit participant_left webhook for rejoined user {}",
            user_id
        );
        return Ok(StatusCode::NO_CONTENT);
    }

    clear_local_voice_session(&state, user_id, channel_id, "LiveKit participant left").await;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/webrtc/livekit-token?channel_id=... — returns LiveKit access token (auth required).
async fn livekit_token(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LivekitTokenQuery>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<LivekitTokenResponse>, AppError> {
    let channel_id = uuid::Uuid::parse_str(&query.channel_id)
        .map_err(|_| AppError::Validation("Invalid channel_id".into()))?;
    enforce_rate_limit(
        &state.redis,
        format!("webrtc:livekit-token:{}", claims.sub),
        LIVEKIT_TOKEN_USER_RATE_LIMIT_MAX,
        MEDIA_TOKEN_RATE_LIMIT_WINDOW,
        "Voice token rate limit exceeded. Please retry shortly.",
    )
    .await?;
    enforce_rate_limit(
        &state.redis,
        format!("webrtc:livekit-token:{}:{}", claims.sub, channel_id),
        LIVEKIT_TOKEN_RATE_LIMIT_MAX,
        MEDIA_TOKEN_RATE_LIMIT_WINDOW,
        "Voice token rate limit exceeded. Please retry shortly.",
    )
    .await?;

    let can_join = can_join_voice_channel(&state.db, claims.sub, channel_id).await?;
    if !can_join {
        return Err(AppError::Forbidden("Voice access denied".into()));
    }

    let ws_url = state
        .livekit_ws_url
        .clone()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let api_key = state
        .livekit_api_key
        .clone()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;
    let api_secret = state
        .livekit_api_secret
        .clone()
        .ok_or_else(|| AppError::FeatureDisabled("Voice service is not configured.".into()))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs() as usize;
    let exp = now + 60 * 60;
    let nbf = now;

    let room = query.channel_id;
    let identity = claims.sub.to_string();
    let current_username =
        sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
            .bind(claims.sub)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    // Enforce server moderation over media publish in voice.
    // Tuple shape: (self_muted, self_deafened, server_muted, server_deafened, screen_sharing, camera_on)
    let can_publish = !state
        .voice_controls
        .get(&claims.sub)
        .map(|control| control.2 || control.3)
        .unwrap_or(false);

    let token = encode(
        &Header::default(),
        &LivekitClaims {
            iss: api_key,
            sub: identity.clone(),
            name: current_username,
            nbf,
            exp,
            video: LivekitVideoGrant {
                room: room.clone(),
                room_join: true,
                can_publish,
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

#[cfg(test)]
mod tests {
    use super::{verify_livekit_webhook, webhook_matches_active_participant};
    use base64::Engine;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::Serialize;
    use sha2::{Digest, Sha256};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    #[derive(Serialize)]
    struct TestWebhookClaims {
        iss: String,
        sha256: String,
        nbf: usize,
        exp: usize,
    }

    fn signed_webhook(body: &[u8], api_key: &str, api_secret: &str) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs() as usize;
        let sha256 = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body));
        encode(
            &Header::default(),
            &TestWebhookClaims {
                iss: api_key.to_string(),
                sha256,
                nbf: now.saturating_sub(1),
                exp: now + 60,
            },
            &EncodingKey::from_secret(api_secret.as_bytes()),
        )
        .expect("test webhook token should encode")
    }

    #[test]
    fn verifies_signed_livekit_webhook_and_decodes_event() {
        let api_key = format!("test-key-{}", Uuid::new_v4());
        let api_secret = format!("test-secret-{}", Uuid::new_v4());
        let body = br#"{"event":"participant_left","room":{"name":"room"},"participant":{"identity":"user","sid":"PA_test"}}"#;
        let token = signed_webhook(body, &api_key, &api_secret);

        let event = verify_livekit_webhook(body, &format!("Bearer {token}"), &api_key, &api_secret)
            .expect("signed webhook should verify");

        assert_eq!(event.event, "participant_left");
        assert_eq!(event.room.expect("room").name, "room");
        let participant = event.participant.expect("participant");
        assert_eq!(participant.identity, "user");
        assert_eq!(participant.sid.as_deref(), Some("PA_test"));
    }

    #[test]
    fn rejects_livekit_webhook_when_body_is_tampered() {
        let api_key = format!("test-key-{}", Uuid::new_v4());
        let api_secret = format!("test-secret-{}", Uuid::new_v4());
        let original = br#"{"event":"participant_left"}"#;
        let tampered = br#"{"event":"participant_joined"}"#;
        let token = signed_webhook(original, &api_key, &api_secret);

        assert!(verify_livekit_webhook(tampered, &token, &api_key, &api_secret).is_err());
    }

    #[test]
    fn rejects_livekit_webhook_signed_for_another_api_key() {
        let api_key = format!("test-key-{}", Uuid::new_v4());
        let other_api_key = format!("other-key-{}", Uuid::new_v4());
        let api_secret = format!("test-secret-{}", Uuid::new_v4());
        let body = br#"{"event":"participant_left"}"#;
        let token = signed_webhook(body, &other_api_key, &api_secret);

        assert!(verify_livekit_webhook(body, &token, &api_key, &api_secret).is_err());
    }

    #[test]
    fn ignores_leave_webhook_for_an_older_participant_session() {
        assert!(!webhook_matches_active_participant(None, Some("PA_old")));
        assert!(webhook_matches_active_participant(
            Some("PA_current"),
            Some("PA_current")
        ));
        assert!(!webhook_matches_active_participant(
            Some("PA_current"),
            Some("PA_old")
        ));
        assert!(!webhook_matches_active_participant(
            Some("PA_current"),
            None
        ));
    }
}
