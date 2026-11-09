//! A broadcast event as the connections of this instance share it. Who may receive it and its
//! JSON are worked out once per event, so an event costs a fixed number of queries however many
//! clients are connected. The answer is still read fresh for every event, which keeps the
//! re-check at delivery.

use std::{
    collections::HashSet,
    sync::{Arc, OnceLock},
};

use axum::extract::ws::Utf8Bytes;
use sqlx::PgPool;
use tokio::sync::OnceCell;
use uuid::Uuid;

use super::{access::can_subscribe_to_channel, WsEvent};
use crate::errors::AppError;
use crate::services::permissions::{Permissions, ServerPermissionSnapshot};

enum Audience {
    /// Everyone allowed to see the event.
    Users(HashSet<Uuid>),
    /// A voice event: members of the server, whose channel permissions also decide.
    Server(Box<ServerPermissionSnapshot>),
    /// The event needs no lookup, or the lookup failed and delivery fails closed.
    Nobody,
}

struct SharedEvent {
    event: WsEvent,
    audience: OnceCell<Audience>,
    json: OnceLock<Option<Utf8Bytes>>,
}

#[derive(Clone)]
pub struct BroadcastEvent(Arc<SharedEvent>);

/// Users who share a server with `user_id` or are friends with them.
async fn related_users(db: &PgPool, user_id: Uuid) -> Result<HashSet<Uuid>, AppError> {
    let mut users: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        r#"WITH shared AS (
               SELECT server_id FROM server_members WHERE user_id = $1
               UNION
               SELECT id FROM servers WHERE owner_id = $1
           )
           SELECT user_id FROM server_members WHERE server_id IN (SELECT server_id FROM shared)
           UNION
           SELECT owner_id FROM servers WHERE id IN (SELECT server_id FROM shared)
           UNION
           SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END
           FROM friendships
           WHERE user_a = $1 OR user_b = $1"#,
    )
    .bind(user_id)
    .fetch_all(db)
    .await?
    .into_iter()
    .collect();
    users.insert(user_id);
    Ok(users)
}

async fn server_users(db: &PgPool, server_id: Uuid) -> Result<HashSet<Uuid>, AppError> {
    let users = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT user_id FROM server_members WHERE server_id = $1
           UNION
           SELECT owner_id FROM servers WHERE id = $1"#,
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    Ok(users.into_iter().collect())
}

impl BroadcastEvent {
    pub fn new(event: WsEvent) -> Self {
        Self(Arc::new(SharedEvent {
            event,
            audience: OnceCell::new(),
            json: OnceLock::new(),
        }))
    }

    pub fn event(&self) -> &WsEvent {
        &self.0.event
    }

    /// The event as sent to clients; `None` when it cannot be serialized.
    pub fn json(&self) -> Option<Utf8Bytes> {
        self.0
            .json
            .get_or_init(|| match serde_json::to_string(&self.0.event) {
                Ok(json) => Some(json.into()),
                Err(error) => {
                    tracing::warn!("WS broadcast serialization failed: {}", error);
                    None
                }
            })
            .clone()
    }

    async fn lookup(&self, db: &PgPool) -> Result<Audience, AppError> {
        Ok(match &self.0.event {
            WsEvent::PresenceUpdate { user_id, .. } => {
                Audience::Users(related_users(db, *user_id).await?)
            }
            WsEvent::UserUpdated { user } => Audience::Users(related_users(db, user.id).await?),
            WsEvent::MemberJoined { server_id, .. }
            | WsEvent::MemberLeft { server_id, .. }
            | WsEvent::MemberRoleUpdated { server_id, .. }
            | WsEvent::MemberTimeoutUpdated { server_id, .. }
            | WsEvent::ServerRolesUpdated { server_id }
            | WsEvent::ServerChannelsUpdated { server_id }
            | WsEvent::ServerUpdated { server_id, .. } => {
                Audience::Users(server_users(db, *server_id).await?)
            }
            WsEvent::VoiceStateUpdate {
                server_id: Some(server_id),
                ..
            }
            | WsEvent::VoiceControlUpdate {
                server_id: Some(server_id),
                ..
            }
            | WsEvent::ScreenShareViewerUpdate {
                server_id: Some(server_id),
                ..
            } => Audience::Server(Box::new(
                ServerPermissionSnapshot::load(db, *server_id, None).await?,
            )),
            _ => Audience::Nobody,
        })
    }

    async fn audience(&self, db: &PgPool) -> &Audience {
        self.0
            .audience
            .get_or_init(|| async {
                self.lookup(db).await.unwrap_or_else(|error| {
                    tracing::warn!("WS event audience lookup failed: {}", error);
                    Audience::Nobody
                })
            })
            .await
    }

    /// Whether `user_id` is in the audience: related to the user the event is about, or a
    /// member of the server it is about.
    pub async fn reaches(&self, db: &PgPool, user_id: Uuid) -> bool {
        match self.audience(db).await {
            Audience::Users(users) => users.contains(&user_id),
            Audience::Server(snapshot) => snapshot.is_member(user_id),
            Audience::Nobody => false,
        }
    }

    /// Whether `channel_id` belongs to the server a voice event is about.
    pub async fn is_channel_of_server(&self, db: &PgPool, channel_id: Uuid) -> bool {
        matches!(
            self.audience(db).await,
            Audience::Server(snapshot) if snapshot.has_channel(channel_id)
        )
    }

    /// Whether `user_id` can see `channel_id`, answered from the event's server when it can be.
    pub async fn can_view_channel(&self, db: &PgPool, user_id: Uuid, channel_id: Uuid) -> bool {
        if let Audience::Server(snapshot) = self.audience(db).await {
            if snapshot.has_channel(channel_id) {
                return snapshot
                    .channel_permissions(channel_id, user_id)
                    .contains(Permissions::VIEW_SERVER);
            }
        }
        matches!(
            can_subscribe_to_channel(db, user_id, channel_id).await,
            Ok(true)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_an_event_once_for_every_connection() {
        let event = BroadcastEvent::new(WsEvent::FriendUpdate {
            user_id: Uuid::new_v4(),
        });
        let copy = event.clone();
        let first = event.json().unwrap();
        let second = copy.json().unwrap();
        assert_eq!(first.as_str().as_ptr(), second.as_str().as_ptr());
        assert!(first.as_str().contains("FriendUpdate"));
    }
}
