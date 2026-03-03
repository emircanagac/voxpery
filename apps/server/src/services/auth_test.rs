// Unit tests for auth service
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_password() {
        let password = "TestPassword123!";
        let hash = hash_password(password).expect("Should hash password");

        assert!(!hash.is_empty());
        assert!(hash.starts_with("$argon2"));
        assert_ne!(hash, password);
    }

    #[test]
    fn test_verify_password_correct() {
        let password = "MySecurePass123";
        let hash = hash_password(password).expect("Should hash password");

        let result = verify_password(password, &hash);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_verify_password_incorrect() {
        let password = "CorrectPassword";
        let wrong_password = "WrongPassword";
        let hash = hash_password(password).expect("Should hash password");

        let result = verify_password(wrong_password, &hash);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_generate_token() {
        let user_id = uuid::Uuid::new_v4();
        let username = "testuser";
        let secret = "test_jwt_secret_32_characters!!";
        let expiration = 3600; // 1 hour

        let token = generate_token(user_id, username, secret, expiration);
        assert!(token.is_ok());

        let token_str = token.unwrap();
        assert!(!token_str.is_empty());
        assert!(token_str.contains('.'));  // JWT format has dots
    }

    #[test]
    fn test_generate_token_decodes_correctly() {
        use jsonwebtoken::{decode, DecodingKey, Validation};
        use crate::middleware::auth::Claims;

        let user_id = uuid::Uuid::new_v4();
        let username = "decodetest";
        let secret = "test_decoding_secret_32_chars!!";
        let expiration = 3600;

        let token = generate_token(user_id, username, secret, expiration).unwrap();

        let decoded = decode::<Claims>(
            &token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::default(),
        );

        assert!(decoded.is_ok());
        let claims = decoded.unwrap().claims;
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.username, username);
    }
}
