use std::time::Duration;

use uuid::Uuid;

use crate::errors::AppError;

const RATE_LIMIT_SCRIPT: &str = r#"
local key = KEYS[1]
local cutoff_ms = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local member = ARGV[3]
local max_requests = tonumber(ARGV[4])
local ttl_secs = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff_ms)

local current = redis.call('ZCARD', key)
if current >= max_requests then
  redis.call('EXPIRE', key, ttl_secs)
  return 0
end

redis.call('ZADD', key, now_ms, member)
redis.call('EXPIRE', key, ttl_secs)
return 1
"#;

fn rate_limit_key(key: &str) -> String {
    format!("rate:{}", key)
}

fn rate_limit_member(now_ms: i64, request_id: Uuid) -> String {
    format!("{now_ms}:{request_id}")
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
/// - Uses a Redis Lua script so cleanup, count, insert, and expiry are atomic.
/// - Stores a unique member for each hit so same-millisecond requests cannot collapse.
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
    let member = rate_limit_member(now_ms, Uuid::new_v4());
    let ttl_secs = window.as_secs().saturating_add(60).max(1);

    let allowed: i64 = redis::Script::new(RATE_LIMIT_SCRIPT)
        .key(&redis_key)
        .arg(cutoff)
        .arg(now_ms)
        .arg(member)
        .arg(max_requests as i64)
        .arg(ttl_secs as i64)
        .invoke_async(&mut conn)
        .await
        .map_err(|e| AppError::Internal(format!("Rate limit script failed: {e}")))?;

    if allowed == 0 {
        return Err(AppError::TooManyRequests(message.to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use redis::AsyncCommands;

    fn redis_test_client() -> Option<redis::Client> {
        let url = std::env::var("TEST_REDIS_URL").ok()?;
        Some(redis::Client::open(url).expect("TEST_REDIS_URL must be a valid Redis URL"))
    }

    #[test]
    fn rate_limit_members_are_unique_per_request() {
        let now_ms = 1_700_000_000_000;
        let first = rate_limit_member(now_ms, Uuid::from_u128(1));
        let second = rate_limit_member(now_ms, Uuid::from_u128(2));

        assert_ne!(first, second);
        assert!(first.starts_with(&format!("{now_ms}:")));
        assert!(second.starts_with(&format!("{now_ms}:")));
    }

    #[tokio::test]
    async fn allows_requests_under_limit() {
        let Some(client) = redis_test_client() else {
            return;
        };
        let key = format!("test:under_limit:{}", now_epoch_millis());
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            enforce_rate_limit(&client, key.clone(), 5, window, "limit")
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn rejects_over_limit() {
        let Some(client) = redis_test_client() else {
            return;
        };
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

    #[tokio::test]
    async fn window_expires_old_entries() {
        let Some(client) = redis_test_client() else {
            return;
        };
        let key = format!("test:window:{}", now_epoch_millis());
        let window = Duration::from_millis(200);
        enforce_rate_limit(&client, key.clone(), 1, window, "limit")
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        // After window, one more request should be allowed
        enforce_rate_limit(&client, key.clone(), 1, window, "limit")
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_requests_are_capped_atomically() {
        let Some(client) = redis_test_client() else {
            return;
        };
        let key = format!("test:concurrent:{}", now_epoch_millis());
        let window = Duration::from_secs(60);
        let max = 5usize;

        let attempts = (0..32).map(|_| {
            let client = client.clone();
            let key = key.clone();
            tokio::spawn(async move {
                enforce_rate_limit(&client, key, max, window, "limit")
                    .await
                    .is_ok()
            })
        });

        let results = futures::future::join_all(attempts).await;
        let allowed = results
            .into_iter()
            .filter(|result| result.as_ref().is_ok_and(|allowed| *allowed))
            .count();

        assert_eq!(allowed, max);

        let mut conn = client.get_multiplexed_async_connection().await.unwrap();
        let stored: isize = conn.zcard(rate_limit_key(&key)).await.unwrap();
        assert_eq!(stored, max as isize);
    }
}
