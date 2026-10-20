use redis::AsyncCommands;

/// jsonwebtoken's default leeway: tokens still validate this long after `exp`. A revoked token
/// must stay blacklisted until the leeway has passed too, or it is accepted again.
pub const JWT_VALIDATION_LEEWAY_SECS: usize = 60;

fn blacklist_key(token: &str) -> String {
    format!("jwt:blacklist:{token}")
}

fn now_epoch_secs() -> usize {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
}

/// Seconds a revoked token must stay blacklisted: until `exp` plus the validation leeway.
fn blacklist_ttl_secs(exp: usize, now: usize) -> usize {
    exp.saturating_add(JWT_VALIDATION_LEEWAY_SECS)
        .saturating_sub(now)
}

pub async fn is_blacklisted(redis: &redis::Client, token: &str) -> Result<bool, redis::RedisError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    conn.exists(blacklist_key(token)).await
}

pub async fn blacklist_until_exp(
    redis: &redis::Client,
    token: &str,
    exp: usize,
) -> Result<(), redis::RedisError> {
    let ttl = blacklist_ttl_secs(exp, now_epoch_secs());
    if ttl == 0 {
        return Ok(());
    }
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let _: () = conn.set_ex(blacklist_key(token), 1u8, ttl as u64).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_revoked_tokens_blacklisted_through_the_validation_leeway() {
        // A token revoked at its expiry stays blacklisted for the whole leeway window.
        assert_eq!(blacklist_ttl_secs(1_000, 1_000), JWT_VALIDATION_LEEWAY_SECS);
        assert_eq!(
            blacklist_ttl_secs(1_000, 400),
            600 + JWT_VALIDATION_LEEWAY_SECS
        );
        // Already past exp but still inside the leeway: blacklist for the rest of it.
        assert_eq!(blacklist_ttl_secs(1_000, 1_030), 30);
        // Past exp plus leeway the token no longer validates, so nothing is stored.
        assert_eq!(
            blacklist_ttl_secs(1_000, 1_000 + JWT_VALIDATION_LEEWAY_SECS),
            0
        );
    }

    #[test]
    fn leeway_matches_the_jwt_validation_default() {
        let validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
        assert_eq!(validation.leeway as usize, JWT_VALIDATION_LEEWAY_SECS);
    }
}
