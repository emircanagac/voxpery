//! The server's Redis connection, shared by every request.

use std::{sync::Arc, time::Duration};

use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use redis::{Client, RedisResult};
use tokio::sync::OnceCell;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);
const RECONNECT_RETRIES: usize = 2;

/// One multiplexed connection, opened on first use. Callers clone it instead of opening a TCP
/// connection per request, and it reconnects on its own after a Redis restart.
#[derive(Clone)]
pub struct SharedRedis {
    client: Client,
    connection: Arc<OnceCell<ConnectionManager>>,
}

impl SharedRedis {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            connection: Arc::new(OnceCell::new()),
        }
    }

    /// For Pub/Sub, which needs a connection of its own.
    pub fn client(&self) -> &Client {
        &self.client
    }

    pub async fn connection(&self) -> RedisResult<ConnectionManager> {
        self.connection
            .get_or_try_init(|| {
                ConnectionManager::new_with_config(
                    self.client.clone(),
                    ConnectionManagerConfig::new()
                        .set_connection_timeout(CONNECT_TIMEOUT)
                        .set_response_timeout(RESPONSE_TIMEOUT)
                        .set_number_of_retries(RECONNECT_RETRIES),
                )
            })
            .await
            .cloned()
    }
}
