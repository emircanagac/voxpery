//! Web Push (RFC 8030/8291/8292): notifies a user's browsers about direct messages and mentions
//! while the user has no open connection. Optional: without VAPID keys nothing is sent.
//!
//! `web-push-native` only encrypts the payload. The request goes out through a reqwest client
//! pinned to the push service's public addresses, without redirects or retries, and the VAPID
//! token is signed here with jsonwebtoken.

use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use p256::pkcs8::EncodePrivateKey;
use reqwest::{redirect::Policy, StatusCode, Url};
use serde::Serialize;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::errors::AppError;
use crate::services::avatar_images::is_private_or_local_ip;
use crate::services::redact::ShortId;
use crate::AppState;

/// Push services browsers subscribe through. Anything else is refused, so a stored endpoint can
/// never point the server at an arbitrary host.
const PUSH_SERVICE_HOSTS: [&str; 3] = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
];
const PUSH_SERVICE_HOST_SUFFIXES: [&str; 1] = [".notify.windows.com"];

pub const MAX_ENDPOINT_LEN: usize = 2048;
pub const MAX_SUBSCRIPTIONS_PER_USER: i64 = 10;
/// How long a push service keeps a message for a browser that is offline.
const PUSH_TTL: Duration = Duration::from_secs(3600);
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONCURRENT_SENDS: usize = 16;
/// Lifetime of the signed VAPID token; push services accept at most 24 hours.
const VAPID_TOKEN_LIFETIME_SECS: i64 = 12 * 60 * 60;

/// The server's VAPID identity, from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
pub struct WebPushConfig {
    /// Uncompressed P-256 point, base64url without padding; browsers subscribe with it.
    public_key: String,
    signing_key: EncodingKey,
    subject: String,
}

impl std::fmt::Debug for WebPushConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebPushConfig")
            .field("public_key", &self.public_key)
            .field("subject", &self.subject)
            .finish_non_exhaustive()
    }
}

impl WebPushConfig {
    /// `None` when none of the three variables is set; an error when only some are, or when
    /// they do not form a valid key pair.
    pub fn from_env() -> Result<Option<Self>, String> {
        let read = |name: &str| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        };
        match (
            read("VAPID_PUBLIC_KEY"),
            read("VAPID_PRIVATE_KEY"),
            read("VAPID_SUBJECT"),
        ) {
            (None, None, None) => Ok(None),
            (Some(public_key), Some(private_key), Some(subject)) => {
                Self::from_parts(&public_key, &private_key, &subject).map(Some)
            }
            _ => Err(
                "Invalid Web Push configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together"
                    .into(),
            ),
        }
    }

    pub fn from_parts(public_key: &str, private_key: &str, subject: &str) -> Result<Self, String> {
        let invalid = |what: &str| format!("Invalid Web Push configuration: {what}");
        let private_bytes = URL_SAFE_NO_PAD
            .decode(private_key.trim().trim_end_matches('='))
            .map_err(|_| invalid("VAPID_PRIVATE_KEY is not base64url"))?;
        let secret = p256::SecretKey::from_slice(&private_bytes)
            .map_err(|_| invalid("VAPID_PRIVATE_KEY is not a P-256 private key"))?;
        let derived_public = URL_SAFE_NO_PAD.encode(secret.public_key().to_sec1_bytes());
        if derived_public != public_key.trim().trim_end_matches('=') {
            return Err(invalid(
                "VAPID_PUBLIC_KEY does not belong to VAPID_PRIVATE_KEY",
            ));
        }
        let subject = subject.trim();
        let subject_ok = subject
            .strip_prefix("mailto:")
            .is_some_and(|address| address.contains('@'))
            || Url::parse(subject).is_ok_and(|url| url.scheme() == "https");
        if !subject_ok {
            return Err(invalid(
                "VAPID_SUBJECT must be a mailto: address or an https URL",
            ));
        }
        let der = secret
            .to_pkcs8_der()
            .map_err(|_| invalid("VAPID_PRIVATE_KEY could not be encoded"))?;
        Ok(Self {
            public_key: derived_public,
            signing_key: EncodingKey::from_ec_der(der.as_bytes()),
            subject: subject.to_string(),
        })
    }

    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    /// `Authorization` header value for a push service origin (RFC 8292).
    fn authorization(&self, audience: &str) -> Result<String, AppError> {
        #[derive(Serialize)]
        struct Claims<'a> {
            aud: &'a str,
            exp: i64,
            sub: &'a str,
        }
        let claims = Claims {
            aud: audience,
            exp: crate::timestamp::Timestamp::now().timestamp() + VAPID_TOKEN_LIFETIME_SECS,
            sub: &self.subject,
        };
        let token =
            jsonwebtoken::encode(&Header::new(Algorithm::ES256), &claims, &self.signing_key)
                .map_err(|e| AppError::Internal(format!("Failed to sign VAPID token: {e}")))?;
        Ok(format!("vapid t={token}, k={}", self.public_key))
    }
}

fn is_push_service_host(host: &str) -> bool {
    PUSH_SERVICE_HOSTS.contains(&host)
        || PUSH_SERVICE_HOST_SUFFIXES
            .iter()
            .any(|suffix| host.ends_with(suffix) && host.len() > suffix.len())
}

/// Accepts only https endpoints of the known push services, on the default port.
pub fn validate_endpoint(raw: &str) -> Result<Url, AppError> {
    let invalid = || AppError::Validation("Unsupported push subscription endpoint".into());
    if raw.is_empty() || raw.len() > MAX_ENDPOINT_LEN {
        return Err(invalid());
    }
    let url = Url::parse(raw).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err(invalid());
    }
    // `domain` is None for IP addresses.
    match url.domain() {
        Some(host) if is_push_service_host(&host.to_ascii_lowercase()) => Ok(url),
        _ => Err(invalid()),
    }
}

/// Checks the browser's keys: `p256dh` is an uncompressed P-256 point, `auth` 16 bytes.
pub fn validate_keys(p256dh: &str, auth: &str) -> Result<(p256::PublicKey, [u8; 16]), AppError> {
    let invalid = || AppError::Validation("Invalid push subscription keys".into());
    let public = URL_SAFE_NO_PAD
        .decode(p256dh.trim_end_matches('='))
        .ok()
        .and_then(|bytes| p256::PublicKey::from_sec1_bytes(&bytes).ok())
        .ok_or_else(invalid)?;
    let auth: [u8; 16] = URL_SAFE_NO_PAD
        .decode(auth.trim_end_matches('='))
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(invalid)?;
    Ok((public, auth))
}

/// What a push tells the browser. It never carries message text.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PushPayload {
    Dm {
        sender: String,
        channel_id: Uuid,
    },
    Mention {
        sender: String,
        server_id: Uuid,
        channel_id: Uuid,
    },
}

impl PushPayload {
    fn channel_id(&self) -> Uuid {
        match self {
            PushPayload::Dm { channel_id, .. } | PushPayload::Mention { channel_id, .. } => {
                *channel_id
            }
        }
    }
}

fn send_slots() -> &'static Semaphore {
    static SLOTS: OnceLock<Semaphore> = OnceLock::new();
    SLOTS.get_or_init(|| Semaphore::new(MAX_CONCURRENT_SENDS))
}

/// Notifies the given users' browsers in the background, after the message is stored. Users
/// with an open connection anywhere get the message in the app instead and are skipped, as are
/// users in Do Not Disturb and, for mentions, users who muted the server.
pub fn notify_users(state: Arc<AppState>, user_ids: Vec<Uuid>, payload: PushPayload) {
    if state.web_push.is_none() || user_ids.is_empty() {
        return;
    }
    tokio::spawn(async move {
        let offline: Vec<Uuid> = user_ids
            .into_iter()
            .filter(|user_id| !state.is_online(*user_id))
            .collect();
        if offline.is_empty() {
            return;
        }
        let muted_server = match &payload {
            PushPayload::Mention { server_id, .. } => Some(*server_id),
            PushPayload::Dm { .. } => None,
        };
        let subscriptions = sqlx::query_as::<_, (Uuid, String, String, String)>(
            r#"SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
               FROM push_subscriptions ps
               INNER JOIN users u ON u.id = ps.user_id
               WHERE ps.user_id = ANY($1)
                 AND u.status <> 'dnd'
                 AND ($2::uuid IS NULL OR NOT EXISTS (
                     SELECT 1 FROM notification_mutes nm
                     WHERE nm.user_id = ps.user_id AND nm.server_id = $2
                 ))"#,
        )
        .bind(&offline)
        .bind(muted_server)
        .fetch_all(&state.db)
        .await;
        let subscriptions = match subscriptions {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!("Loading push subscriptions failed: {error}");
                return;
            }
        };
        let body = match serde_json::to_vec(&payload) {
            Ok(body) => body,
            Err(_) => return,
        };
        let topic = payload.channel_id().simple().to_string();
        for (id, endpoint, p256dh, auth) in subscriptions {
            let state = state.clone();
            let body = body.clone();
            let topic = topic.clone();
            tokio::spawn(async move {
                let Ok(_slot) = send_slots().acquire().await else {
                    return;
                };
                deliver(&state, id, &endpoint, &p256dh, &auth, body, &topic).await;
            });
        }
    });
}

async fn deliver(
    state: &AppState,
    subscription_id: Uuid,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    body: Vec<u8>,
    topic: &str,
) {
    let Some(config) = state.web_push.as_deref() else {
        return;
    };
    match send(config, endpoint, p256dh, auth, body, topic).await {
        Ok(status) if status.is_success() => {
            let _ = sqlx::query("UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1")
                .bind(subscription_id)
                .execute(&state.db)
                .await;
        }
        // The browser unsubscribed or the subscription expired.
        Ok(StatusCode::NOT_FOUND | StatusCode::GONE) => {
            let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                .bind(subscription_id)
                .execute(&state.db)
                .await;
        }
        Ok(status) => tracing::warn!(
            "Push service refused a notification for subscription {}: {}",
            ShortId(subscription_id),
            status
        ),
        Err(error) => tracing::warn!(
            "Sending a push notification for subscription {} failed: {}",
            ShortId(subscription_id),
            error
        ),
    }
}

/// Encrypts and sends one push. The endpoint is checked again (it comes from the database) and
/// the request is pinned to public addresses of its host.
async fn send(
    config: &WebPushConfig,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    body: Vec<u8>,
    topic: &str,
) -> Result<StatusCode, AppError> {
    let url = validate_endpoint(endpoint)?;
    let (ua_public, ua_auth) = validate_keys(p256dh, auth)?;
    let host = url.host_str().unwrap_or_default().to_string();
    let addrs = resolve_public(&host).await?;

    let request = encrypted_request(endpoint, ua_public, ua_auth, body)?;

    let audience = format!("https://{host}");
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(SEND_TIMEOUT)
        .no_proxy()
        .resolve_to_addrs(&host, &addrs)
        .build()
        .map_err(|e| AppError::Internal(format!("Push client build failed: {e}")))?;
    let (parts, payload) = request.into_parts();
    let response = client
        .post(url)
        .headers(parts.headers)
        .header("Authorization", config.authorization(&audience)?)
        .header("Topic", topic)
        .header("Urgency", "high")
        .body(payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Push request failed: {}", e.without_url())))?;
    Ok(response.status())
}

/// The push request with its payload encrypted for the browser (aes128gcm, RFC 8291) and the
/// TTL set; the caller adds the VAPID authorization.
fn encrypted_request(
    endpoint: &str,
    ua_public: p256::PublicKey,
    ua_auth: [u8; 16],
    body: Vec<u8>,
) -> Result<axum::http::Request<Vec<u8>>, AppError> {
    let uri: axum::http::Uri = endpoint
        .parse()
        .map_err(|_| AppError::Validation("Unsupported push subscription endpoint".into()))?;
    web_push_native::WebPushBuilder::new(uri, ua_public, web_push_native::Auth::from(ua_auth))
        .with_valid_duration(PUSH_TTL)
        .build(body)
        .map_err(|e| AppError::Internal(format!("Failed to encrypt push payload: {e}")))
}

async fn resolve_public(host: &str) -> Result<Vec<SocketAddr>, AppError> {
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|_| AppError::Internal("Push service host could not be resolved".into()))?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|addr| is_private_or_local_ip(&addr.ip())) {
        return Err(AppError::Internal(
            "Push service host resolved to a private address".into(),
        ));
    }
    Ok(addrs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generated_keys() -> (String, String) {
        let secret = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        (
            URL_SAFE_NO_PAD.encode(secret.public_key().to_sec1_bytes()),
            URL_SAFE_NO_PAD.encode(secret.to_bytes()),
        )
    }

    #[test]
    fn accepts_only_known_push_services_over_https() {
        for ok in [
            "https://fcm.googleapis.com/fcm/send/abc",
            "https://updates.push.services.mozilla.com/wpush/v2/abc",
            "https://web.push.apple.com/QGx",
            "https://wns2-db5p.notify.windows.com/w/?token=abc",
        ] {
            assert!(validate_endpoint(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://fcm.googleapis.com/fcm/send/abc",
            "https://fcm.googleapis.com:8443/fcm/send/abc",
            "https://user:pw@fcm.googleapis.com/x",
            "https://evil.example/fcm.googleapis.com",
            "https://fcm.googleapis.com.evil.example/x",
            "https://notify.windows.com/x",
            "https://127.0.0.1/x",
            "https://[::1]/x",
            "not a url",
        ] {
            assert!(validate_endpoint(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn checks_the_key_pair_and_subject() {
        let (public, private) = generated_keys();
        let (other_public, _) = generated_keys();
        assert!(WebPushConfig::from_parts(&public, &private, "mailto:ops@example.com").is_ok());
        assert!(WebPushConfig::from_parts(&public, &private, "https://example.com").is_ok());
        assert!(
            WebPushConfig::from_parts(&other_public, &private, "mailto:ops@example.com").is_err()
        );
        assert!(WebPushConfig::from_parts(&public, &private, "ops@example.com").is_err());
        assert!(WebPushConfig::from_parts(&public, "bm90LWEta2V5", "mailto:a@b.c").is_err());
    }

    #[test]
    fn signs_a_vapid_token_the_public_key_verifies() {
        let (public, private) = generated_keys();
        let config =
            WebPushConfig::from_parts(&public, &private, "mailto:ops@example.com").unwrap();
        let header = config.authorization("https://fcm.googleapis.com").unwrap();
        let token = header
            .strip_prefix("vapid t=")
            .and_then(|rest| rest.split(", k=").next())
            .unwrap();
        let public_bytes = URL_SAFE_NO_PAD.decode(&public).unwrap();
        let key = jsonwebtoken::DecodingKey::from_ec_components(
            &URL_SAFE_NO_PAD.encode(&public_bytes[1..33]),
            &URL_SAFE_NO_PAD.encode(&public_bytes[33..65]),
        )
        .unwrap();
        let mut validation = jsonwebtoken::Validation::new(Algorithm::ES256);
        validation.set_audience(&["https://fcm.googleapis.com"]);
        let decoded = jsonwebtoken::decode::<serde_json::Value>(token, &key, &validation).unwrap();
        assert_eq!(decoded.claims["sub"], "mailto:ops@example.com");
        assert!(header.ends_with(&format!(", k={public}")));
    }

    #[test]
    fn checks_subscription_keys() {
        let (public, _) = generated_keys();
        let auth = URL_SAFE_NO_PAD.encode([7u8; 16]);
        assert!(validate_keys(&public, &auth).is_ok());
        assert!(validate_keys(&public, &URL_SAFE_NO_PAD.encode([7u8; 15])).is_err());
        assert!(validate_keys("AAAA", &auth).is_err());
    }

    #[test]
    fn encrypts_the_payload_for_the_browser_key() {
        let browser_secret = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let auth = [9u8; 16];
        let request = encrypted_request(
            "https://fcm.googleapis.com/fcm/send/abc",
            browser_secret.public_key(),
            auth,
            br#"{"type":"dm"}"#.to_vec(),
        )
        .unwrap();
        assert_eq!(request.headers()["content-encoding"], "aes128gcm");
        assert_eq!(request.headers()["ttl"], "3600");
        let plain = web_push_native::decrypt(
            request.body().clone(),
            &browser_secret,
            &web_push_native::Auth::from(auth),
        )
        .unwrap();
        assert_eq!(plain, br#"{"type":"dm"}"#.to_vec());
    }

    #[test]
    fn the_payload_carries_no_message_text() {
        let payload = PushPayload::Mention {
            sender: "ada".into(),
            server_id: Uuid::nil(),
            channel_id: Uuid::nil(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["type"], "mention");
        assert_eq!(
            json.as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>()
                .len(),
            4
        );
    }
}
