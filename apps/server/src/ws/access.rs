//! WebSocket authorization: verify user can subscribe to a channel or join a voice channel.

use crate::errors::AppError;
use crate::services::permissions::{self, Permissions};
use sqlx::PgPool;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// How long one connection reuses a channel permission result. Role, channel and membership
/// events clear the cache at once; this only bounds changes that publish no event.
pub const CHANNEL_ACCESS_CACHE_TTL: Duration = Duration::from_secs(5);

/// Per-connection memo of "can this user see this channel", so a busy channel does not cost
/// a permission lookup for every subscriber on every message.
#[derive(Default)]
pub struct ChannelAccessCache {
    entries: HashMap<Uuid, (bool, Instant)>,
}

impl ChannelAccessCache {
    pub fn get(&self, channel_id: Uuid, now: Instant) -> Option<bool> {
        self.entries
            .get(&channel_id)
            .filter(|(_, checked_at)| now.duration_since(*checked_at) < CHANNEL_ACCESS_CACHE_TTL)
            .map(|(allowed, _)| *allowed)
    }

    pub fn insert(&mut self, channel_id: Uuid, allowed: bool, now: Instant) {
        // Drop expired entries now and then so a long session does not grow without bound.
        if self.entries.len() >= 256 {
            self.entries
                .retain(|_, (_, checked_at)| now.duration_since(*checked_at) < CHANNEL_ACCESS_CACHE_TTL);
        }
        self.entries.insert(channel_id, (allowed, now));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Minimum gap between relayed typing updates of one kind, per connection and channel.
pub const TYPING_RELAY_INTERVAL: Duration = Duration::from_secs(3);

/// Thins out typing updates before they cost a permission check and a fan-out to every
/// subscriber; a start and a stop are throttled separately so a stop is never swallowed by a
/// recent start.
#[derive(Default)]
pub struct TypingThrottle {
    last_relayed: HashMap<(Uuid, bool), Instant>,
}

impl TypingThrottle {
    pub fn allow(&mut self, channel_id: Uuid, is_typing: bool, now: Instant) -> bool {
        if let Some(last) = self.last_relayed.get(&(channel_id, is_typing)) {
            if now.duration_since(*last) < TYPING_RELAY_INTERVAL {
                return false;
            }
        }
        if self.last_relayed.len() >= 256 {
            self.last_relayed
                .retain(|_, last| now.duration_since(*last) < TYPING_RELAY_INTERVAL);
        }
        self.last_relayed.insert((channel_id, is_typing), now);
        true
    }
}

/// Returns true if the user has access to subscribe to this channel:
/// - Server channel: user is a member of the server that owns the channel.
/// - DM channel: user is a participant in the DM channel.
pub async fn can_subscribe_to_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, AppError> {
    // Server channel: require effective VIEW_SERVER permission (includes category/channel overrides).
    let server_channel_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_one(db)
            .await?;

    if server_channel_exists > 0 {
        let perms = permissions::get_user_channel_permissions(db, channel_id, user_id).await?;
        return Ok(perms.contains(Permissions::VIEW_SERVER));
    }

    // DM channel: dm_channel_members
    let dm_access: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_channel_members WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;

    Ok(dm_access > 0)
}

/// Narrows requested ids to channels the user could possibly subscribe to (a server channel
/// in a server they belong to, or a DM they are part of) with one query, so unknown or foreign
/// ids never reach the per-channel permission check.
pub async fn subscribable_channel_candidates(
    db: &PgPool,
    user_id: Uuid,
    channel_ids: &[Uuid],
) -> Result<Vec<Uuid>, AppError> {
    if channel_ids.is_empty() {
        return Ok(Vec::new());
    }
    let candidates = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT c.id
           FROM channels c
           JOIN server_members m ON m.server_id = c.server_id AND m.user_id = $2
           WHERE c.id = ANY($1)
           UNION
           SELECT d.channel_id
           FROM dm_channel_members d
           WHERE d.channel_id = ANY($1) AND d.user_id = $2"#,
    )
    .bind(channel_ids)
    .bind(user_id)
    .fetch_all(db)
    .await?;
    Ok(candidates)
}

/// Returns true if the user can join this voice channel:
/// - Channel exists, is type 'voice', and user is a member of the channel's server.
pub async fn can_join_voice_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<bool, AppError> {
    let channel_type: Option<String> =
        sqlx::query_scalar("SELECT channel_type FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(db)
            .await?;

    if channel_type.as_deref() != Some("voice") {
        return Ok(false);
    }

    let perms = permissions::get_user_channel_permissions(db, channel_id, user_id).await?;
    Ok(perms.contains(Permissions::VIEW_SERVER) && perms.contains(Permissions::CONNECT_VOICE))
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn channel_access_results_expire_and_clear() {
        let mut cache = ChannelAccessCache::default();
        let channel = Uuid::new_v4();
        let start = Instant::now();
        assert_eq!(cache.get(channel, start), None);
        cache.insert(channel, true, start);
        assert_eq!(cache.get(channel, start + Duration::from_secs(1)), Some(true));
        assert_eq!(cache.get(channel, start + CHANNEL_ACCESS_CACHE_TTL), None, "results expire");
        cache.insert(channel, false, start);
        cache.clear();
        assert_eq!(cache.get(channel, start), None, "a permission event clears every result");
    }

    #[test]
    fn typing_updates_are_thinned_per_channel_and_kind() {
        let mut throttle = TypingThrottle::default();
        let (general, random) = (Uuid::new_v4(), Uuid::new_v4());
        let start = Instant::now();
        assert!(throttle.allow(general, true, start));
        assert!(!throttle.allow(general, true, start + Duration::from_secs(1)));
        assert!(throttle.allow(general, false, start + Duration::from_secs(1)), "a stop still goes out");
        assert!(throttle.allow(random, true, start + Duration::from_secs(1)), "other channels are separate");
        assert!(throttle.allow(general, true, start + TYPING_RELAY_INTERVAL));
    }
}
