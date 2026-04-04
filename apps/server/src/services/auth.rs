use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use jsonwebtoken::{encode, EncodingKey, Header};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::Claims;

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
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
        .chars()
        .collect();
    (0..8)
        .map(|_| chars[rng.gen_range(0..chars.len())])
        .collect()
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
        assert_eq!(code.len(), 8);
        let allowed: std::collections::HashSet<char> =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
                .chars()
                .collect();
        for c in code.chars() {
            assert!(allowed.contains(&c), "invite code must use allowed charset");
        }
    }
}
