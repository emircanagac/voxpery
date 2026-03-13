use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;

bitflags::bitflags! {
    /// Granular permissions for servers and channels.
    ///
    /// Backed by BIGINT (i64) in the database.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub struct Permissions: i64 {
        const VIEW_SERVER      = 1 << 0;
        const MANAGE_SERVER    = 1 << 1;
        const MANAGE_ROLES     = 1 << 2;
        const MANAGE_CHANNELS  = 1 << 3;
        const KICK_MEMBERS     = 1 << 4;
        const BAN_MEMBERS      = 1 << 5;
        const VIEW_AUDIT_LOG   = 1 << 6;
        const SEND_MESSAGES    = 1 << 7;
        const MANAGE_MESSAGES  = 1 << 8;
        const MANAGE_PINS      = 1 << 9;
        const CONNECT_VOICE    = 1 << 10;
        const MUTE_MEMBERS     = 1 << 11;
        const DEAFEN_MEMBERS   = 1 << 12;
        const MANAGE_WEBHOOKS  = 1 << 13;
    }
}

/// Compute the base (server-level) permissions for a user in a server by
/// combining all roles assigned to that user.
pub async fn get_user_server_permissions(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    // Owner always has all permissions.
    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(db)
        .await?;

    if owner_id.map(|id| id == user_id).unwrap_or(false) {
        return Ok(Permissions::all());
    }

    // Non-members have no server permissions.
    let is_member: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;
    if is_member == 0 {
        return Ok(Permissions::empty());
    }

    // Sum all role permissions with bitwise OR.
    // "@everyone" is always implicit for all members, even if it's not explicitly assigned.
    let rows: Vec<i64> = sqlx::query_scalar(
        r#"SELECT sr.permissions
           FROM server_roles sr
           WHERE sr.server_id = $1
             AND LOWER(sr.name) = 'everyone'
           UNION ALL
           SELECT sr.permissions
           FROM server_member_roles smr
           INNER JOIN server_roles sr ON sr.id = smr.role_id
           WHERE smr.server_id = $1
             AND smr.user_id = $2
             AND LOWER(sr.name) <> 'everyone'"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(db)
    .await?;

    let mut perms = Permissions::empty();
    for bits in rows {
        if let Some(p) = Permissions::from_bits(bits) {
            perms |= p;
        }
    }

    Ok(perms)
}

/// Compute the effective permissions for a user in a specific channel.
///
/// Algorithm (Discord-like):
/// 1. Start from server-level permissions.
/// 2. Apply channel role overrides: first DENY, then ALLOW.
pub async fn get_user_channel_permissions(
    db: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    // Resolve server_id and category from channel.
    let channel_row: Option<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT server_id, category FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(db)
            .await?;

    let (server_id, category) = match channel_row {
        Some(row) => row,
        None => return Ok(Permissions::empty()),
    };

    let mut perms: Permissions = get_user_server_permissions(db, server_id, user_id).await?;

    if let Some(category_name) = category.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        let category_overrides: Vec<(i64, i64)> = sqlx::query_as(
            r#"WITH effective_roles AS (
                   SELECT sr.id AS role_id
                   FROM server_roles sr
                   WHERE sr.server_id = $1
                     AND LOWER(sr.name) = 'everyone'
                   UNION
                   SELECT smr.role_id
                   FROM server_member_roles smr
                   WHERE smr.server_id = $1
                     AND smr.user_id = $2
               )
               SELECT co.allow, co.deny
               FROM effective_roles er
               INNER JOIN channel_category_role_overrides co
                 ON co.role_id = er.role_id
               WHERE co.server_id = $1
                 AND co.category = $3"#,
        )
        .bind(server_id)
        .bind(user_id)
        .bind(category_name)
        .fetch_all(db)
        .await?;

        let mut deny_mask = Permissions::empty();
        let mut allow_mask = Permissions::empty();
        for (allow_bits, deny_bits) in category_overrides {
            if let Some(d) = Permissions::from_bits(deny_bits) {
                deny_mask |= d;
            }
            if let Some(a) = Permissions::from_bits(allow_bits) {
                allow_mask |= a;
            }
        }
        perms.remove(deny_mask);
        perms |= allow_mask;
    }

    // Gather all role overrides for roles the user has in this server.
    let overrides: Vec<(i64, i64)> = sqlx::query_as(
        r#"WITH effective_roles AS (
               SELECT sr.id AS role_id
               FROM server_roles sr
               WHERE sr.server_id = $1
                 AND LOWER(sr.name) = 'everyone'
               UNION
               SELECT smr.role_id
               FROM server_member_roles smr
               WHERE smr.server_id = $1
                 AND smr.user_id = $2
           )
           SELECT cro.allow, cro.deny
           FROM effective_roles er
           INNER JOIN channel_role_overrides cro
             ON cro.role_id = er.role_id
           WHERE cro.channel_id = $3"#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(channel_id)
    .fetch_all(db)
    .await?;

    let mut deny_mask = Permissions::empty();
    let mut allow_mask = Permissions::empty();

    for (allow_bits, deny_bits) in overrides {
        if let Some(d) = Permissions::from_bits(deny_bits) {
            deny_mask |= d;
        }
        if let Some(a) = Permissions::from_bits(allow_bits) {
            allow_mask |= a;
        }
    }

    // Apply deny first, then allow.
    perms.remove(deny_mask);
    perms |= allow_mask;

    Ok(perms)
}

pub async fn ensure_server_permission(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<(), AppError> {
    let perms: Permissions = get_user_server_permissions(db, server_id, user_id).await?;
    if perms.contains(required) {
        Ok(())
    } else {
        Err(AppError::Forbidden("Missing required permission".into()))
    }
}

pub async fn ensure_channel_permission(
    db: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<(), AppError> {
    let perms: Permissions = get_user_channel_permissions(db, channel_id, user_id).await?;
    if perms.contains(required) {
        Ok(())
    } else {
        Err(AppError::Forbidden("Missing required permission".into()))
    }
}

/// Returns the highest role position (lowest numerical value) for a user in a server.
/// If the user is the server owner, returns -1 (highest possible).
/// If the user has no roles, returns i32::MAX (lowest possible).
pub async fn get_user_highest_role_position(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<i32, AppError> {
    let is_owner = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM servers WHERE id = $1 AND owner_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;

    if is_owner > 0 {
        return Ok(-1);
    }

    let highest_position = sqlx::query_scalar::<_, Option<i32>>(
        r#"SELECT MIN(sr.position)
           FROM server_roles sr
           INNER JOIN server_member_roles smr ON sr.id = smr.role_id
           WHERE smr.server_id = $1 AND smr.user_id = $2"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?
    .flatten();

    Ok(highest_position.unwrap_or(i32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permissions_roundtrip_bits() {
        let p = Permissions::MANAGE_SERVER | Permissions::SEND_MESSAGES;
        let bits = p.bits();
        let restored = Permissions::from_bits(bits).unwrap();
        assert!(restored.contains(Permissions::MANAGE_SERVER));
        assert!(restored.contains(Permissions::SEND_MESSAGES));
        assert!(!restored.contains(Permissions::KICK_MEMBERS));
    }

    #[test]
    fn permissions_all_bits() {
        let p = Permissions::all();
        assert!(p.contains(Permissions::VIEW_SERVER));
        assert!(p.contains(Permissions::MANAGE_SERVER));
        assert!(p.contains(Permissions::MANAGE_WEBHOOKS));
    }

    #[test]
    fn permissions_empty_bits() {
        let p = Permissions::empty();
        assert!(!p.contains(Permissions::VIEW_SERVER));
        assert_eq!(p.bits(), 0);
    }
}
