use sqlx::PgPool;
use uuid::Uuid;

use super::audit::{self, VoiceModerationAuditEntry};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ServerVoiceModeration {
    pub muted: bool,
    pub deafened: bool,
}

impl ServerVoiceModeration {
    pub fn can_publish(self) -> bool {
        !self.muted && !self.deafened
    }

    pub fn can_subscribe(self) -> bool {
        !self.deafened
    }
}

pub async fn for_channel(
    db: &PgPool,
    user_id: Uuid,
    channel_id: Uuid,
) -> Result<Option<ServerVoiceModeration>, sqlx::Error> {
    let row: Option<(bool, bool)> = sqlx::query_as(
        "SELECT sm.voice_server_muted, sm.voice_server_deafened
         FROM server_members sm
         JOIN channels c ON c.server_id = sm.server_id
         WHERE sm.user_id = $1 AND c.id = $2 AND c.channel_type = 'voice'",
    )
    .bind(user_id)
    .bind(channel_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|(muted, deafened)| ServerVoiceModeration { muted, deafened }))
}

pub async fn set_for_member(
    db: &PgPool,
    actor_id: Uuid,
    server_id: Uuid,
    target_user_id: Uuid,
    channel_id: Uuid,
    channel_name: &str,
    reason: Option<&str>,
    next: ServerVoiceModeration,
    can_mute: bool,
    can_deafen: bool,
) -> Result<Option<ServerVoiceModeration>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let current: Option<(bool, bool)> = sqlx::query_as(
        "SELECT voice_server_muted, voice_server_deafened
         FROM server_members WHERE server_id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(server_id)
    .bind(target_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((muted, deafened)) = current else {
        return Ok(None);
    };
    if actor_id == target_user_id && ((next.muted && !muted) || (next.deafened && !deafened)) {
        return Ok(None);
    }
    if (muted != next.muted && !can_mute) || (deafened != next.deafened && !can_deafen) {
        return Ok(None);
    }
    if muted == next.muted && deafened == next.deafened {
        return Ok(None);
    }

    sqlx::query(
        "UPDATE server_members SET voice_server_muted = $3, voice_server_deafened = $4
         WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(target_user_id)
    .bind(next.muted)
    .bind(next.deafened)
    .execute(&mut *tx)
    .await?;

    let mut entries = Vec::with_capacity(2);
    if muted != next.muted {
        entries.push(VoiceModerationAuditEntry {
            action: if next.muted {
                audit::VOICE_MEMBER_MUTE
            } else {
                audit::VOICE_MEMBER_UNMUTE
            },
            details: serde_json::json!({
                "channel_name": channel_name,
                "previous_server_muted": muted,
                "server_muted": next.muted,
            }),
        });
    }
    if deafened != next.deafened {
        entries.push(VoiceModerationAuditEntry {
            action: if next.deafened {
                audit::VOICE_MEMBER_DEAFEN
            } else {
                audit::VOICE_MEMBER_UNDEAFEN
            },
            details: serde_json::json!({
                "channel_name": channel_name,
                "previous_server_deafened": deafened,
                "server_deafened": next.deafened,
            }),
        });
    }
    audit::log_voice_moderation_in_transaction(
        &mut tx,
        actor_id,
        server_id,
        target_user_id,
        channel_id,
        reason,
        &entries,
    )
    .await?;
    tx.commit().await?;
    Ok(Some(next))
}

#[cfg(test)]
mod tests {
    use super::ServerVoiceModeration;

    #[test]
    fn voice_permissions_follow_server_moderation_flags() {
        for (muted, deafened, can_publish, can_subscribe) in [
            (false, false, true, true),
            (true, false, false, true),
            (false, true, false, false),
            (true, true, false, false),
        ] {
            let moderation = ServerVoiceModeration { muted, deafened };
            assert_eq!(moderation.can_publish(), can_publish);
            assert_eq!(moderation.can_subscribe(), can_subscribe);
        }
    }
}
