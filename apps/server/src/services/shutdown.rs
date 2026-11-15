//! Graceful shutdown: one signal every long-lived task can wait on, and a count of the WebSocket
//! connections that still have to finish their cleanup before the process exits.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

/// How long in-flight HTTP requests may take to finish after the stop signal.
pub const HTTP_DRAIN_TIMEOUT: Duration = Duration::from_secs(20);
/// How long closing WebSocket connections may take to report their departure.
pub const SOCKET_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct Shutdown {
    token: CancellationToken,
    open_sockets: Arc<AtomicUsize>,
}

/// Held by a WebSocket connection until its cleanup has run.
pub struct SocketGuard(Arc<AtomicUsize>);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Shutdown {
    /// Starts the shutdown; every `started()` waiter wakes up.
    pub fn begin(&self) {
        self.token.cancel();
    }

    pub fn is_started(&self) -> bool {
        self.token.is_cancelled()
    }

    /// Resolves once the shutdown has started.
    pub async fn started(&self) {
        self.token.cancelled().await;
    }

    pub fn track_socket(&self) -> SocketGuard {
        self.open_sockets.fetch_add(1, Ordering::SeqCst);
        SocketGuard(self.open_sockets.clone())
    }

    pub fn open_sockets(&self) -> usize {
        self.open_sockets.load(Ordering::SeqCst)
    }

    /// Waits until every tracked WebSocket connection is gone, at most `timeout`. Returns how
    /// many were still open.
    pub async fn wait_for_sockets(&self, timeout: Duration) -> usize {
        let deadline = tokio::time::Instant::now() + timeout;
        while self.open_sockets() > 0 && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        self.open_sockets()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn started_resolves_only_after_begin() {
        let shutdown = Shutdown::default();
        assert!(!shutdown.is_started());
        assert!(
            tokio::time::timeout(Duration::from_millis(20), shutdown.started())
                .await
                .is_err()
        );
        shutdown.begin();
        assert!(shutdown.is_started());
        shutdown.started().await;
    }

    #[tokio::test]
    async fn waits_for_tracked_sockets_until_the_timeout() {
        let shutdown = Shutdown::default();
        let guard = shutdown.track_socket();
        assert_eq!(
            shutdown.wait_for_sockets(Duration::from_millis(60)).await,
            1
        );
        drop(guard);
        assert_eq!(shutdown.wait_for_sockets(Duration::from_secs(1)).await, 0);
    }
}
