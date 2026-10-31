use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        SaltString,
    },
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use jsonwebtoken::{encode, EncodingKey, Header};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::Claims;
use crate::models::User;

/// Google proves ownership of the address. A password set on an account whose email was
/// never verified was not proven to belong to that owner (someone may have registered the
/// address first), so it is removed; verified accounts keep their password. Existing
/// sessions end either way.
pub(crate) const LINK_GOOGLE_IDENTITY_SQL: &str = "UPDATE users
     SET google_id = $1,
         password_hash = CASE WHEN email_verified THEN password_hash ELSE 'oauth' END,
         email_verified = TRUE,
         token_version = token_version + 1
     WHERE id = $2 AND google_id IS NULL AND lower(email) = $3";

/// The account a Google sign-in belongs to: the one already linked to this identity or, failing
/// that, an unlinked account with the same address. Both can exist once a linked account has
/// moved to another address and someone registered the old one.
pub async fn find_google_account(
    db: &sqlx::PgPool,
    google_id: &str,
    email: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "SELECT * FROM users
         WHERE google_id = $1 OR (google_id IS NULL AND lower(email) = $2)
         ORDER BY google_id IS NULL
         LIMIT 1",
    )
    .bind(google_id)
    .bind(email)
    .fetch_optional(db)
    .await
}

/// Link a Google identity to an existing local account with the same email address. Returns
/// false when the account no longer has that address or already has a Google identity.
pub async fn link_google_identity(
    db: &sqlx::PgPool,
    user_id: Uuid,
    google_id: &str,
    email: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let linked = sqlx::query(LINK_GOOGLE_IDENTITY_SQL)
        .bind(google_id)
        .bind(user_id)
        .bind(email)
        .execute(&mut *tx)
        .await?
        .rows_affected()
        > 0;
    if linked {
        revoke_pending_account_tokens(&mut tx, user_id).await?;
    }
    tx.commit().await?;
    Ok(linked)
}

/// Verification and reset links issued before a change of who controls the account must stop
/// working with that change. Call it in the transaction that makes the change.
pub(crate) async fn revoke_pending_account_tokens(
    conn: &mut sqlx::PgConnection,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Longest accepted password. It only bounds request-controlled work; longer passwords gain
/// nothing and none can be stored, so verification treats them as wrong.
pub(crate) const MAX_PASSWORD_BYTES: usize = 1024;
/// Each Argon2 call uses about 19 MiB, so bursts wait here instead of filling the blocking pool.
const MAX_CONCURRENT_PASSWORD_WORK: usize = 8;
static PASSWORD_WORK: Semaphore = Semaphore::const_new(MAX_CONCURRENT_PASSWORD_WORK);

/// Reject a new password over the length limit; callers keep their own minimum-length message.
pub(crate) fn ensure_password_within_limit(password: &str) -> Result<(), AppError> {
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(AppError::Validation(format!(
            "Password must be at most {MAX_PASSWORD_BYTES} characters"
        )));
    }
    Ok(())
}

/// Run Argon2 work off the async runtime, so request threads keep serving other connections.
pub(crate) async fn run_password_work<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let _permit = PASSWORD_WORK
        .acquire()
        .await
        .map_err(|e| AppError::Internal(format!("Password work queue closed: {e}")))?;
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| AppError::Internal(format!("Password work failed: {e}")))?
}

/// [`hash_password`] for request handlers.
pub async fn hash_password_async(password: &str) -> Result<String, AppError> {
    let password = password.to_string();
    run_password_work(move || hash_password(&password)).await
}

/// [`verify_password`] for request handlers.
pub async fn verify_password_async(password: &str, hash: &str) -> Result<bool, AppError> {
    if password.len() > MAX_PASSWORD_BYTES {
        return Ok(false);
    }
    let password = password.to_string();
    let hash = hash.to_string();
    run_password_work(move || verify_password(&password, &hash)).await
}

/// Hash a password using Argon2id.
pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Failed to hash password: {}", e)))?
        .to_string();
    Ok(hash)
}

/// Verify a password against a stored hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid password hash: {}", e)))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Generate a JWT token for a user.
pub fn generate_token(
    user_id: Uuid,
    username: &str,
    token_version: i64,
    secret: &str,
    expiration_secs: i64,
) -> Result<String, AppError> {
    let now = chrono::Utc::now();
    let claims = Claims {
        sub: user_id,
        username: username.to_string(),
        exp: (now + chrono::Duration::seconds(expiration_secs)).timestamp() as usize,
        iat: now.timestamp() as usize,
        ver: token_version,
        jti: Some(Uuid::new_v4().simple().to_string()),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to generate token: {}", e)))
}

/// Generate a random invite code for servers.
pub fn generate_invite_code() -> String {
    const INVITE_CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const INVITE_LEN: usize = 10;

    let mut rng = OsRng;
    let mut code = String::with_capacity(INVITE_LEN);
    let range = INVITE_CHARSET.len() as u32;
    let max_acceptable = u32::MAX - (u32::MAX % range);

    while code.len() < INVITE_LEN {
        let value = rng.next_u32();
        if value >= max_acceptable {
            continue;
        }
        let idx = (value % range) as usize;
        code.push(INVITE_CHARSET[idx] as char);
    }

    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_password_roundtrip() {
        let password = format!("test-password-{}", Uuid::new_v4());
        let wrong_password = format!("wrong-password-{}", Uuid::new_v4());
        let hash = hash_password(&password).expect("hash should succeed");
        assert!(verify_password(&password, &hash).unwrap());
        assert!(!verify_password(&wrong_password, &hash).unwrap());
    }

    #[test]
    fn generate_token_and_decode() {
        use jsonwebtoken::{decode, DecodingKey, Validation};
        let user_id = Uuid::new_v4();
        let username = "testuser";
        let secret = format!("test-secret-{}", Uuid::new_v4());
        let expiration_secs = 3600i64;
        let token =
            generate_token(user_id, username, 0, &secret, expiration_secs).expect("token gen");
        assert!(!token.is_empty());
        let mut validation = Validation::default();
        validation.validate_exp = true;
        let decoded = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        )
        .expect("decode should succeed");
        assert_eq!(decoded.claims.sub, user_id);
        assert_eq!(decoded.claims.username, username);
    }

    #[test]
    fn generate_invite_code_format() {
        let code = generate_invite_code();
        assert_eq!(code.len(), 10);
        let allowed: std::collections::HashSet<char> =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
                .chars()
                .collect();
        for c in code.chars() {
            assert!(allowed.contains(&c), "invite code must use allowed charset");
        }
    }
}
