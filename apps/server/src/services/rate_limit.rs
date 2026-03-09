use std::time::Duration;

use redis::AsyncCommands;

use crate::errors::AppError;

fn rate_limit_key(key: &str) -> String {
    format!("rate:{}", key)
}

fn now_epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Enforce a sliding-window rate limit using Redis sorted sets.
///
/// - Stores each hit as a member in a ZSET with score = timestamp (ms since epoch).
/// - On each call:
///   - Remove entries older than the configured window.
///   - Count remaining hits; if >= max_requests, return TooManyRequests.
///   - Otherwise, insert the current hit and set an expiry slightly longer than the window.
pub async fn enforce_rate_limit(
    redis: &redis::Client,
    key: String,
    max_requests: usize,
    window: Duration,
    message: &str,
) -> Result<(), AppError> {
    let mut conn = redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit Redis connection failed: {e}")))?;

    let now_ms = now_epoch_millis();
    let window_ms = window.as_millis() as i64;
    let cutoff = now_ms.saturating_sub(window_ms);
    let redis_key = rate_limit_key(&key);

    // 1) Drop all hits that are outside the sliding window.
    let _: () = conn
        .zrembyscore(&redis_key, "-inf", cutoff)
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit cleanup failed: {e}")))?;

    // 2) Count remaining hits in the window.
    let current: isize = conn
        .zcard(&redis_key)
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit count failed: {e}")))?;

    if current >= max_requests as isize {
        return Err(AppError::TooManyRequests(message.to_string()));
    }

    // 3) Record this hit.
    let _: () = conn
        .zadd(&redis_key, now_ms, now_ms)
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit record failed: {e}")))?;

    // 4) Ensure the key expires eventually (defensive: window + 60s).
    let ttl_secs = window.as_secs().saturating_add(60).max(1);
    let _: () = conn
        .expire(&redis_key, ttl_secs as i64)
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit expire failed: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests require a local Redis instance on redis://127.0.0.1:6379.
    #[ignore]
    #[tokio::test]
    async fn allows_requests_under_limit() {
        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let key = format!("test:under_limit:{}", now_epoch_millis());
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            enforce_rate_limit(&client, key.clone(), 5, window, "limit")
                .await
                .unwrap();
        }
    }

    #[ignore]
    #[tokio::test]
    async fn rejects_over_limit() {
        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let key = format!("test:over_limit:{}", now_epoch_millis());
        let window = Duration::from_secs(60);
        let max = 2usize;
        enforce_rate_limit(&client, key.clone(), max, window, "limit")
            .await
            .unwrap();
        enforce_rate_limit(&client, key.clone(), max, window, "limit")
            .await
            .unwrap();
        let err = enforce_rate_limit(&client, key.clone(), max, window, "limit")
            .await
            .unwrap_err();
        match &err {
            crate::errors::AppError::TooManyRequests(msg) => assert_eq!(msg, "limit"),
            _ => panic!("expected TooManyRequests"),
        }
    }

    #[ignore]
    #[tokio::test]
    async fn window_expires_old_entries() {
        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let key = format!("test:window:{}", now_epoch_millis());
        let window = Duration::from_millis(50);
        enforce_rate_limit(&client, key.clone(), 1, window, "limit")
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(60)).await;
        // After window, one more request should be allowed
        enforce_rate_limit(&client, key.clone(), 1, window, "limit")
            .await
            .unwrap();
    }
}
