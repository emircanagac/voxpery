use std::{sync::Arc, time::Duration};

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;

use super::WsEvent;

const WS_EVENTS_CHANNEL: &str = "voxpery:ws-events:v1";

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
enum WsBusEnvelope {
    Broadcast {
        origin: Uuid,
        event: WsEvent,
    },
    User {
        origin: Uuid,
        user_id: Uuid,
        event: WsEvent,
    },
}

fn deliver_user_event(state: &AppState, user_id: Uuid, event: WsEvent) {
    if let Some(session_senders) = state.sessions.get(&user_id) {
        for sender in session_senders.iter() {
            let _ = sender.send(event.clone());
        }
    }
}

async fn publish_envelope(state: &AppState, envelope: WsBusEnvelope) {
    let payload = match serde_json::to_string(&envelope) {
        Ok(payload) => payload,
        Err(e) => {
            tracing::warn!("Failed to serialize WS bus envelope: {}", e);
            return;
        }
    };

    let mut conn = match state.redis.get_multiplexed_async_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!(
                "Failed to open Redis connection for WS event publish: {}",
                e
            );
            return;
        }
    };

    let publish_result: Result<i64, redis::RedisError> = redis::cmd("PUBLISH")
        .arg(WS_EVENTS_CHANNEL)
        .arg(payload)
        .query_async(&mut conn)
        .await;
    if let Err(e) = publish_result {
        tracing::warn!("Failed to publish WS event to Redis: {}", e);
    }
}

pub async fn publish_event(state: &Arc<AppState>, event: WsEvent) {
    let _ = state.tx.send(event.clone());
    publish_envelope(
        state,
        WsBusEnvelope::Broadcast {
            origin: state.instance_id,
            event,
        },
    )
    .await;
}

pub async fn publish_user_event(state: &Arc<AppState>, user_id: Uuid, event: WsEvent) {
    deliver_user_event(state, user_id, event.clone());
    publish_envelope(
        state,
        WsBusEnvelope::User {
            origin: state.instance_id,
            user_id,
            event,
        },
    )
    .await;
}

pub fn spawn_redis_event_bridge(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            let mut pubsub = match state.redis.get_async_pubsub().await {
                Ok(pubsub) => pubsub,
                Err(e) => {
                    tracing::warn!("Failed to open Redis Pub/Sub for WS events: {}", e);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };

            if let Err(e) = pubsub.subscribe(WS_EVENTS_CHANNEL).await {
                tracing::warn!("Failed to subscribe to WS event bus: {}", e);
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }

            tracing::info!(
                "WS event bus subscribed on {} for instance {}",
                WS_EVENTS_CHANNEL,
                state.instance_id
            );

            let mut stream = pubsub.on_message();
            while let Some(message) = stream.next().await {
                let payload: String = match message.get_payload() {
                    Ok(payload) => payload,
                    Err(e) => {
                        tracing::warn!("Failed to read WS event bus payload: {}", e);
                        continue;
                    }
                };

                let envelope: WsBusEnvelope = match serde_json::from_str(&payload) {
                    Ok(envelope) => envelope,
                    Err(e) => {
                        tracing::warn!("Failed to parse WS event bus payload: {}", e);
                        continue;
                    }
                };

                match envelope {
                    WsBusEnvelope::Broadcast { origin, event } => {
                        if origin != state.instance_id {
                            let _ = state.tx.send(event);
                        }
                    }
                    WsBusEnvelope::User {
                        origin,
                        user_id,
                        event,
                    } => {
                        if origin != state.instance_id {
                            deliver_user_event(&state, user_id, event);
                        }
                    }
                }
            }

            tracing::warn!("WS event bus stream ended; reconnecting");
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
