//! Signed grants for the image proxy. `<img>` requests cannot carry the desktop Bearer token, so
//! signed-in clients receive a short-lived grant to append to proxy URLs, and logged-out pages
//! such as invite previews receive a grant bound to one image URL.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Grants are issued per window and stay valid through the next one, so a client that refreshes
/// within each window always holds a grant with at least a window left, and proxy URLs (and the
/// browser cache keyed by them) stay stable within a window.
const GRANT_WINDOW_SECS: i64 = 12 * 60 * 60;

fn expiry_for(now: i64) -> i64 {
    (now.div_euclid(GRANT_WINDOW_SECS) + 2) * GRANT_WINDOW_SECS
}

fn mac_for(secret: &str, message: &str) -> HmacSha256 {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any size");
    mac.update(message.as_bytes());
    mac
}

fn user_message(user_id: Uuid, exp: i64) -> String {
    format!("image-proxy:user:{user_id}:{exp}")
}

fn image_message(image_url: &str, exp: i64) -> String {
    format!("image-proxy:image:{exp}:{image_url}")
}

fn sign(secret: &str, message: &str) -> String {
    URL_SAFE_NO_PAD.encode(mac_for(secret, message).finalize().into_bytes())
}

/// Grant for any proxied image, for a signed-in user. Returns the grant and its expiry.
pub fn user_grant(secret: &str, user_id: Uuid, now: i64) -> (String, i64) {
    let exp = expiry_for(now);
    let sig = sign(secret, &user_message(user_id, exp));
    (format!("u.{}.{exp}.{sig}", user_id.simple()), exp)
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

pub fn current_user_grant(secret: &str, user_id: Uuid) -> ImageProxyGrant {
    let (grant, expires_at) = user_grant(secret, user_id, chrono::Utc::now().timestamp());
    ImageProxyGrant { grant, expires_at }
}

pub fn current_image_grant(secret: &str, image_url: &str) -> String {
    image_grant(secret, image_url, chrono::Utc::now().timestamp())
}

/// True when `grant` was issued by this server, has not expired and covers `image_url`.
pub fn verify(secret: &str, grant: &str, image_url: &str, now: i64) -> bool {
    let parts: Vec<&str> = grant.split('.').collect();
    let (message, exp, sig) = match parts.as_slice() {
        ["u", user, exp, sig] => {
            let (Ok(user_id), Ok(exp)) = (Uuid::try_parse(user), exp.parse::<i64>()) else {
                return false;
            };
            (user_message(user_id, exp), exp, *sig)
        }
        ["i", exp, sig] => {
            let Ok(exp) = exp.parse::<i64>() else {
                return false;
            };
            (image_message(image_url, exp), exp, *sig)
        }
        _ => return false,
    };
    if exp < now || exp > expiry_for(now) {
        return false;
    }
    let Ok(sig) = URL_SAFE_NO_PAD.decode(sig) else {
        return false;
    };
    mac_for(secret, &message).verify_slice(&sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test-secret-with-at-least-32-characters";
    const NOW: i64 = 1_800_000_000;
    const IMAGE: &str = "https://cdn.example.com/a.png";

    #[test]
    fn user_grants_cover_any_image_until_they_expire() {
        let (grant, exp) = user_grant(SECRET, Uuid::new_v4(), NOW);
        assert!(exp - NOW > GRANT_WINDOW_SECS && exp - NOW <= 2 * GRANT_WINDOW_SECS);
        assert!(verify(SECRET, &grant, IMAGE, NOW));
        assert!(verify(
            SECRET,
            &grant,
            "https://other.example.com/b.gif",
            exp
        ));
        assert!(!verify(SECRET, &grant, IMAGE, exp + 1));
        assert!(!verify(
            "another-secret-with-at-least-32-chars",
            &grant,
            IMAGE,
            NOW
        ));
    }

    #[test]
    fn grants_are_stable_within_a_window() {
        let user = Uuid::new_v4();
        let window_start = NOW - NOW.rem_euclid(GRANT_WINDOW_SECS);
        assert_eq!(
            user_grant(SECRET, user, window_start),
            user_grant(SECRET, user, window_start + GRANT_WINDOW_SECS - 1)
        );
    }

    #[test]
    fn image_grants_cover_only_their_image() {
        let grant = image_grant(SECRET, IMAGE, NOW);
        assert!(verify(SECRET, &grant, IMAGE, NOW));
        assert!(!verify(
            SECRET,
            &grant,
            "https://cdn.example.com/b.png",
            NOW
        ));
    }

    #[test]
    fn rejects_tampered_or_malformed_grants() {
        let user = Uuid::new_v4();
        let (grant, exp) = user_grant(SECRET, user, NOW);
        let sig = grant.rsplit('.').next().unwrap();
        let other_user = format!("u.{}.{exp}.{sig}", Uuid::new_v4().simple());
        let later = format!("u.{}.{}.{sig}", user.simple(), exp + GRANT_WINDOW_SECS);
        for bad in [
            other_user.as_str(),
            later.as_str(),
            "",
            "u",
            "i.1.x",
            "x.1.2.3",
        ] {
            assert!(!verify(SECRET, bad, IMAGE, NOW), "{bad}");
        }
        // A grant from the far future is refused even when correctly signed.
        let (future, _) = user_grant(SECRET, user, NOW + 10 * GRANT_WINDOW_SECS);
        assert!(!verify(SECRET, &future, IMAGE, NOW));
    }
}
