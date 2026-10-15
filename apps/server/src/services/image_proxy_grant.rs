//! Signed grants for the image proxy. `<img>` requests cannot carry the desktop Bearer token, so
//! signed-in clients receive a short-lived grant to append to proxy URLs, and logged-out pages
//! such as invite previews receive a grant bound to one image URL.
//!
//! A user grant names the session it was issued to (user, token version and the token's sign-in
//! id). The proxy refuses it once that session ends: logout marks the session as revoked, and a
//! password change or account deletion changes or removes the token version.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use redis::AsyncCommands;
use sha2::Sha256;
use uuid::Uuid;

use crate::middleware::auth::Claims;

type HmacSha256 = Hmac<Sha256>;

/// Grants are issued per window and stay valid through the next one, so a client that refreshes
/// within each window always holds a grant with at least a window left, and proxy URLs (and the
/// browser cache keyed by them) stay stable within a window.
const GRANT_WINDOW_SECS: i64 = 2 * 60 * 60;

fn expiry_for(now: i64) -> i64 {
    (now.div_euclid(GRANT_WINDOW_SECS) + 2) * GRANT_WINDOW_SECS
}

fn mac_for(secret: &str, message: &str) -> HmacSha256 {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any size");
    mac.update(message.as_bytes());
    mac
}

/// The session a user grant belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantSession {
    pub user_id: Uuid,
    pub token_version: i64,
    /// The token's sign-in id (`jti`), or `t<issue time>` for tokens issued before v0.4.6.
    pub sign_in: String,
}

impl GrantSession {
    pub fn from_claims(claims: &Claims) -> Self {
        Self {
            user_id: claims.sub,
            token_version: claims.ver,
            sign_in: sign_in_id(claims),
        }
    }
}

/// Names one sign-in for grant revocation. The id is part of a dot-separated grant, so anything
/// other than a plain alphanumeric `jti` falls back to the issue time.
pub fn sign_in_id(claims: &Claims) -> String {
    match claims.jti.as_deref() {
        Some(jti)
            if !jti.is_empty()
                && jti.len() <= 64
                && jti.bytes().all(|b| b.is_ascii_alphanumeric()) =>
        {
            jti.to_string()
        }
        _ => format!("t{}", claims.iat),
    }
}

fn user_message(session: &GrantSession, exp: i64) -> String {
    format!(
        "image-proxy:user:{}:{}:{}:{exp}",
        session.user_id, session.token_version, session.sign_in
    )
}

fn image_message(image_url: &str, exp: i64) -> String {
    format!("image-proxy:image:{exp}:{image_url}")
}

fn sign(secret: &str, message: &str) -> String {
    URL_SAFE_NO_PAD.encode(mac_for(secret, message).finalize().into_bytes())
}

/// Grant for any proxied image, for one signed-in session. Returns the grant and its expiry.
pub fn user_grant(secret: &str, session: &GrantSession, now: i64) -> (String, i64) {
    let exp = expiry_for(now);
    let sig = sign(secret, &user_message(session, exp));
    (
        format!(
            "u.{}.{}.{}.{exp}.{sig}",
            session.user_id.simple(),
            session.token_version,
            session.sign_in
        ),
        exp,
    )
}

/// Grant for exactly one image URL, for pages shown before sign-in.
pub fn image_grant(secret: &str, image_url: &str, now: i64) -> String {
    let exp = expiry_for(now);
    let sig = sign(secret, &image_message(image_url, exp));
    format!("i.{exp}.{sig}")
}

/// The grant a signed-in client appends to proxy URLs, as returned by the API.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImageProxyGrant {
    pub grant: String,
    /// Unix seconds; clients fetch a new grant well before this.
    pub expires_at: i64,
}

pub fn current_user_grant(secret: &str, claims: &Claims) -> ImageProxyGrant {
    let (grant, expires_at) = user_grant(
        secret,
        &GrantSession::from_claims(claims),
        chrono::Utc::now().timestamp(),
    );
    ImageProxyGrant { grant, expires_at }
}

pub fn current_image_grant(secret: &str, image_url: &str) -> String {
    image_grant(secret, image_url, chrono::Utc::now().timestamp())
}

/// What a correctly signed, unexpired grant allows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifiedGrant {
    /// Any image, while the session is still signed in (see [`session_is_active`]).
    User(GrantSession),
    /// The one image URL it was issued for.
    Image,
}

/// Checks the signature and expiry of `grant` for `image_url`. A user grant still needs
/// [`session_is_active`] before it is honoured.
pub fn verify(secret: &str, grant: &str, image_url: &str, now: i64) -> Option<VerifiedGrant> {
    let parts: Vec<&str> = grant.split('.').collect();
    let (message, verified, exp, sig) = match parts.as_slice() {
        ["u", user, version, sign_in, exp, sig] => {
            let session = GrantSession {
                user_id: Uuid::try_parse(user).ok()?,
                token_version: version.parse().ok()?,
                sign_in: sign_in.to_string(),
            };
            let exp = exp.parse::<i64>().ok()?;
            (
                user_message(&session, exp),
                VerifiedGrant::User(session),
                exp,
                *sig,
            )
        }
        ["i", exp, sig] => {
            let exp = exp.parse::<i64>().ok()?;
            (
                image_message(image_url, exp),
                VerifiedGrant::Image,
                exp,
                *sig,
            )
        }
        _ => return None,
    };
    if exp < now || exp > expiry_for(now) {
        return None;
    }
    let sig = URL_SAFE_NO_PAD.decode(sig).ok()?;
    mac_for(secret, &message)
        .verify_slice(&sig)
        .is_ok()
        .then_some(verified)
}

fn revoked_key(user_id: Uuid, sign_in: &str) -> String {
    format!("image-proxy:revoked:{user_id}:{sign_in}")
}

/// Ends the image grants of one session (on logout). The mark outlives every grant the session
/// could hold.
pub async fn revoke_session(
    redis: &redis::Client,
    claims: &Claims,
) -> Result<(), redis::RedisError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    conn.set_ex(
        revoked_key(claims.sub, &sign_in_id(claims)),
        1u8,
        (2 * GRANT_WINDOW_SECS) as u64,
    )
    .await
}

/// True while the grant's session is signed in: not logged out, and the account still exists
/// with the same token version (a password change or account deletion ends every grant). Fails
/// closed when the database or Redis cannot answer.
pub async fn session_is_active(
    db: &sqlx::PgPool,
    redis: &redis::Client,
    session: &GrantSession,
) -> bool {
    match crate::middleware::auth::claims_match_current_token_version(
        db,
        session.user_id,
        session.token_version,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return false,
        Err(e) => {
            tracing::warn!("Image grant session check failed: {}", e);
            return false;
        }
    }
    let revoked = match redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => {
            conn.exists::<_, bool>(revoked_key(session.user_id, &session.sign_in))
                .await
        }
        Err(e) => Err(e),
    };
    match revoked {
        Ok(revoked) => !revoked,
        Err(e) => {
            tracing::warn!("Image grant revocation check failed: {}", e);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-with-at-least-32-characters";
    const NOW: i64 = 1_800_000_000;
    const IMAGE: &str = "https://cdn.example.com/a.png";

    fn session() -> GrantSession {
        GrantSession {
            user_id: Uuid::new_v4(),
            token_version: 3,
            sign_in: Uuid::new_v4().simple().to_string(),
        }
    }

    #[test]
    fn user_grants_cover_any_image_until_they_expire() {
        let session = session();
        let (grant, exp) = user_grant(SECRET, &session, NOW);
        assert!(exp - NOW > GRANT_WINDOW_SECS && exp - NOW <= 2 * GRANT_WINDOW_SECS);
        assert_eq!(
            verify(SECRET, &grant, IMAGE, NOW),
            Some(VerifiedGrant::User(session))
        );
        assert!(verify(SECRET, &grant, "https://other.example.com/b.gif", exp).is_some());
        assert!(verify(SECRET, &grant, IMAGE, exp + 1).is_none());
        assert!(verify("another-secret-with-at-least-32-chars", &grant, IMAGE, NOW).is_none());
    }

    #[test]
    fn grants_live_a_few_hours_at_most() {
        let (_, exp) = user_grant(SECRET, &session(), NOW);
        assert!(exp - NOW <= 4 * 60 * 60);
    }

    #[test]
    fn grants_are_stable_within_a_window() {
        let session = session();
        let window_start = NOW - NOW.rem_euclid(GRANT_WINDOW_SECS);
        assert_eq!(
            user_grant(SECRET, &session, window_start),
            user_grant(SECRET, &session, window_start + GRANT_WINDOW_SECS - 1)
        );
    }

    #[test]
    fn image_grants_cover_only_their_image() {
        let grant = image_grant(SECRET, IMAGE, NOW);
        assert_eq!(
            verify(SECRET, &grant, IMAGE, NOW),
            Some(VerifiedGrant::Image)
        );
        assert!(verify(SECRET, &grant, "https://cdn.example.com/b.png", NOW).is_none());
    }

    #[test]
    fn rejects_tampered_or_malformed_grants() {
        let session = session();
        let (grant, exp) = user_grant(SECRET, &session, NOW);
        let sig = grant.rsplit('.').next().unwrap();
        let user = session.user_id.simple();
        let (version, sign_in) = (session.token_version, session.sign_in.clone());
        let other_user = format!(
            "u.{}.{version}.{sign_in}.{exp}.{sig}",
            Uuid::new_v4().simple()
        );
        let other_version = format!("u.{user}.{}.{sign_in}.{exp}.{sig}", version + 1);
        let other_session = format!("u.{user}.{version}.other.{exp}.{sig}");
        let later = format!(
            "u.{user}.{version}.{sign_in}.{}.{sig}",
            exp + GRANT_WINDOW_SECS
        );
        // The pre-0.4.6 user grant format is no longer accepted.
        let old_format = format!("u.{user}.{exp}.{sig}");
        for bad in [
            other_user.as_str(),
            other_version.as_str(),
            other_session.as_str(),
            later.as_str(),
            old_format.as_str(),
            "",
            "u",
            "i.1.x",
            "x.1.2.3",
        ] {
            assert!(verify(SECRET, bad, IMAGE, NOW).is_none(), "{bad}");
        }
        // A grant from the far future is refused even when correctly signed.
        let (future, _) = user_grant(SECRET, &session, NOW + 10 * GRANT_WINDOW_SECS);
        assert!(verify(SECRET, &future, IMAGE, NOW).is_none());
    }
}
