use redis::AsyncCommands;

fn blacklist_key(token: &str) -> String {
    format!("jwt:blacklist:{token}")
}

fn now_epoch_secs() -> usize {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as usize
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
    let now = now_epoch_secs();
    let ttl = exp.saturating_sub(now);
    if ttl == 0 {
        return Ok(());
    }
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let _: () = conn.set_ex(blacklist_key(token), 1u8, ttl as u64).await?;
    Ok(())
}
