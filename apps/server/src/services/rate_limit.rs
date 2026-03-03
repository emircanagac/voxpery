use std::time::{Duration, Instant};

use dashmap::DashMap;

use crate::errors::AppError;

pub fn enforce_rate_limit(
    store: &DashMap<String, Vec<Instant>>,
    key: String,
    max_requests: usize,
    window: Duration,
    message: &str,
) -> Result<(), AppError> {
    let now = Instant::now();

    if store.len() > 10_000 {
        store.retain(|_, hits| {
            hits.retain(|hit_at| now.duration_since(*hit_at) < window);
            !hits.is_empty()
        });
    }

    let mut bucket = store.entry(key).or_default();
    bucket.retain(|hit_at| now.duration_since(*hit_at) < window);
    if bucket.len() >= max_requests {
        return Err(AppError::TooManyRequests(message.to_string()));
    }
    bucket.push(now);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn allows_requests_under_limit() {
        let store = DashMap::new();
        let key = "test:under_limit".to_string();
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            enforce_rate_limit(&store, key.clone(), 5, window, "limit").unwrap();
        }
        assert_eq!(store.get(&key).unwrap().len(), 3);
    }

    #[test]
    fn rejects_over_limit() {
        let store = DashMap::new();
        let key = "test:over_limit".to_string();
        let window = Duration::from_secs(60);
        let max = 2usize;
        enforce_rate_limit(&store, key.clone(), max, window, "limit").unwrap();
        enforce_rate_limit(&store, key.clone(), max, window, "limit").unwrap();
        let err = enforce_rate_limit(&store, key.clone(), max, window, "limit").unwrap_err();
        match &err {
            crate::errors::AppError::TooManyRequests(msg) => assert_eq!(msg, "limit"),
            _ => panic!("expected TooManyRequests"),
        }
    }

    #[test]
    fn window_expires_old_entries() {
        let store = DashMap::new();
        let key = "test:window".to_string();
        let window = Duration::from_millis(50);
        enforce_rate_limit(&store, key.clone(), 1, window, "limit").unwrap();
        std::thread::sleep(Duration::from_millis(60));
        // After window, one more request should be allowed
        enforce_rate_limit(&store, key.clone(), 1, window, "limit").unwrap();
        let bucket = store.get(&key).unwrap();
        assert_eq!(bucket.len(), 1);
    }
}
