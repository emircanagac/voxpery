//! Operational metrics in the Prometheus text format.
//!
//! The values are process-wide totals: no label ever holds a path, user, channel or address, so
//! nothing here identifies a person. They are served only by the separate listener that
//! `METRICS_BIND` enables, never by the public router.

use std::fmt::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};

use crate::AppState;

const DURATION_BUCKETS_MS: [u64; 9] = [5, 10, 25, 50, 100, 250, 500, 1000, 5000];
const REDIS_PING_TIMEOUT: Duration = Duration::from_secs(1);

static HTTP_BY_CLASS: [AtomicU64; 5] = [const { AtomicU64::new(0) }; 5];
static HTTP_DURATION_BUCKETS: [AtomicU64; DURATION_BUCKETS_MS.len()] =
    [const { AtomicU64::new(0) }; DURATION_BUCKETS_MS.len()];
static HTTP_DURATION_COUNT: AtomicU64 = AtomicU64::new(0);
static HTTP_DURATION_SUM_MS: AtomicU64 = AtomicU64::new(0);
static LIVEKIT_RETRIES: AtomicU64 = AtomicU64::new(0);
static LIVEKIT_RETRIES_EXHAUSTED: AtomicU64 = AtomicU64::new(0);

/// A failed background LiveKit call was tried again.
pub fn record_livekit_retry() {
    LIVEKIT_RETRIES.fetch_add(1, Ordering::Relaxed);
}

/// A background LiveKit call ran out of retries.
pub fn record_livekit_retries_exhausted() {
    LIVEKIT_RETRIES_EXHAUSTED.fetch_add(1, Ordering::Relaxed);
}

fn record_http(status: u16, elapsed: Duration) {
    if let Some(class) = HTTP_BY_CLASS.get(usize::from(status / 100).wrapping_sub(1)) {
        class.fetch_add(1, Ordering::Relaxed);
    }
    let elapsed_ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX);
    for (bucket, limit) in HTTP_DURATION_BUCKETS.iter().zip(DURATION_BUCKETS_MS) {
        if elapsed_ms <= limit {
            bucket.fetch_add(1, Ordering::Relaxed);
        }
    }
    HTTP_DURATION_COUNT.fetch_add(1, Ordering::Relaxed);
    HTTP_DURATION_SUM_MS.fetch_add(elapsed_ms, Ordering::Relaxed);
}

/// Middleware for the public router.
pub async fn record_http_request(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let response = next.run(request).await;
    record_http(response.status().as_u16(), started.elapsed());
    response
}

fn write_metric(out: &mut String, name: &str, kind: &str, help: &str, value: u64) {
    let _ = writeln!(
        out,
        "# HELP {name} {help}\n# TYPE {name} {kind}\n{name} {value}"
    );
}

fn render_http(out: &mut String) {
    out.push_str("# HELP voxpery_http_requests_total HTTP responses by status class.\n");
    out.push_str("# TYPE voxpery_http_requests_total counter\n");
    for (index, class) in HTTP_BY_CLASS.iter().enumerate() {
        let _ = writeln!(
            out,
            "voxpery_http_requests_total{{status=\"{}xx\"}} {}",
            index + 1,
            class.load(Ordering::Relaxed)
        );
    }

    let count = HTTP_DURATION_COUNT.load(Ordering::Relaxed);
    out.push_str("# HELP voxpery_http_request_duration_ms HTTP handling time.\n");
    out.push_str("# TYPE voxpery_http_request_duration_ms histogram\n");
    for (bucket, limit) in HTTP_DURATION_BUCKETS.iter().zip(DURATION_BUCKETS_MS) {
        let _ = writeln!(
            out,
            "voxpery_http_request_duration_ms_bucket{{le=\"{limit}\"}} {}",
            bucket.load(Ordering::Relaxed)
        );
    }
    let _ = writeln!(
        out,
        "voxpery_http_request_duration_ms_bucket{{le=\"+Inf\"}} {count}\nvoxpery_http_request_duration_ms_sum {}\nvoxpery_http_request_duration_ms_count {count}",
        HTTP_DURATION_SUM_MS.load(Ordering::Relaxed)
    );
}

async fn redis_is_up(state: &AppState) -> bool {
    let ping = async {
        let mut connection = state.redis.connection().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut connection)
            .await
    };
    matches!(
        tokio::time::timeout(REDIS_PING_TIMEOUT, ping).await,
        Ok(Ok(_))
    )
}

/// `(used_memory, maxmemory)` from `INFO memory`.
fn parse_redis_memory(info: &str) -> Option<(u64, u64)> {
    let value = |name: &str| {
        info.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(':'))?
            .trim()
            .parse()
            .ok()
    };
    Some((value("used_memory")?, value("maxmemory")?))
}

async fn redis_memory(state: &AppState) -> Option<(u64, u64)> {
    let info = async {
        let mut connection = state.redis.connection().await?;
        redis::cmd("INFO")
            .arg("memory")
            .query_async::<String>(&mut connection)
            .await
    };
    let info = tokio::time::timeout(REDIS_PING_TIMEOUT, info)
        .await
        .ok()?
        .ok()?;
    parse_redis_memory(&info)
}

/// The current metrics of this server instance.
pub async fn render(state: &AppState) -> String {
    let mut out = String::with_capacity(2048);
    render_http(&mut out);

    let users = state.sessions.len() as u64;
    let connections: usize = state.sessions.iter().map(|entry| entry.value().len()).sum();
    write_metric(
        &mut out,
        "voxpery_ws_users",
        "gauge",
        "Users with a WebSocket connection on this instance.",
        users,
    );
    write_metric(
        &mut out,
        "voxpery_ws_connections",
        "gauge",
        "WebSocket connections on this instance.",
        connections as u64,
    );
    write_metric(
        &mut out,
        "voxpery_voice_sessions",
        "gauge",
        "Voice sessions on this instance.",
        state.voice_session_connections.len() as u64,
    );
    write_metric(
        &mut out,
        "voxpery_db_pool_connections",
        "gauge",
        "Open database connections.",
        u64::from(state.db.size()),
    );
    write_metric(
        &mut out,
        "voxpery_db_pool_idle",
        "gauge",
        "Idle database connections.",
        state.db.num_idle() as u64,
    );
    write_metric(
        &mut out,
        "voxpery_redis_up",
        "gauge",
        "1 when Redis answers a ping.",
        u64::from(redis_is_up(state).await),
    );
    if let Some((used, limit)) = redis_memory(state).await {
        write_metric(
            &mut out,
            "voxpery_redis_memory_used_bytes",
            "gauge",
            "Memory Redis reports in use.",
            used,
        );
        write_metric(
            &mut out,
            "voxpery_redis_memory_limit_bytes",
            "gauge",
            "Redis maxmemory; 0 means no limit.",
            limit,
        );
    }
    write_metric(
        &mut out,
        "voxpery_livekit_retries_total",
        "counter",
        "Background LiveKit calls tried again.",
        LIVEKIT_RETRIES.load(Ordering::Relaxed),
    );
    write_metric(
        &mut out,
        "voxpery_livekit_retries_exhausted_total",
        "counter",
        "Background LiveKit calls that ran out of retries.",
        LIVEKIT_RETRIES_EXHAUSTED.load(Ordering::Relaxed),
    );
    out
}

async fn metrics_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        render(&state).await,
    )
}

/// The router of the internal metrics listener.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/metrics", get(metrics_handler))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_redis_memory_from_info() {
        let info =
            "# Memory\r\nused_memory:1024\r\nused_memory_human:1.00K\r\nmaxmemory:536870912\r\n";
        assert_eq!(parse_redis_memory(info), Some((1024, 536870912)));
        assert_eq!(parse_redis_memory("# Memory\r\n"), None);
    }

    #[test]
    fn http_requests_are_counted_by_class_and_duration() {
        let before = HTTP_BY_CLASS[3].load(Ordering::Relaxed);
        let bucket_before = HTTP_DURATION_BUCKETS[3].load(Ordering::Relaxed);
        record_http(404, Duration::from_millis(40));
        assert!(HTTP_BY_CLASS[3].load(Ordering::Relaxed) > before);
        assert!(HTTP_DURATION_BUCKETS[3].load(Ordering::Relaxed) > bucket_before);
    }

    #[test]
    fn unknown_status_classes_are_ignored() {
        record_http(0, Duration::from_millis(1));
        record_http(700, Duration::from_millis(1));
    }

    #[test]
    fn output_uses_the_prometheus_text_format_without_identifiers() {
        let mut out = String::new();
        render_http(&mut out);
        assert!(out.contains("# TYPE voxpery_http_requests_total counter"));
        assert!(out.contains("voxpery_http_requests_total{status=\"2xx\"}"));
        assert!(out.contains("voxpery_http_request_duration_ms_bucket{le=\"+Inf\"}"));
        assert!(!out.contains("path="));
        assert!(!out.contains("user"));
    }
}
