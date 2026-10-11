use sqlx::{PgConnection, PgPool};
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
        const MOVE_MEMBERS     = 1 << 13;
    }
}

impl Permissions {
    /// Bits a channel or category override may allow or deny. Server-wide powers (server
    /// settings, roles, kick, ban, audit log) are never granted or removed per channel.
    pub const CHANNEL_OVERRIDABLE: Permissions = Permissions::VIEW_SERVER
        .union(Permissions::MANAGE_CHANNELS)
        .union(Permissions::SEND_MESSAGES)
        .union(Permissions::MANAGE_MESSAGES)
        .union(Permissions::MANAGE_PINS)
        .union(Permissions::CONNECT_VOICE)
        .union(Permissions::MUTE_MEMBERS)
        .union(Permissions::DEAFEN_MEMBERS)
        .union(Permissions::MOVE_MEMBERS);
}

/// Rejects override bits outside [`Permissions::CHANNEL_OVERRIDABLE`].
pub fn validate_override_bits(allow: i64, deny: i64) -> Result<(), AppError> {
    let within_scope = |bits: i64| {
        Permissions::from_bits(bits)
            .is_some_and(|perms| Permissions::CHANNEL_OVERRIDABLE.contains(perms))
    };
    if within_scope(allow) && within_scope(deny) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "Channel permission overrides can only change channel permissions".into(),
        ))
    }
}

/// Role and permission management (roles, role assignment, channel and category
/// overrides) is limited to the server owner. See docs/ARCHITECTURE.md for the rules
/// that apply if delegation is reintroduced.
pub async fn ensure_server_owner(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(db)
        .await?;
    match owner_id {
        None => Err(AppError::NotFound("Server not found".into())),
        Some(owner_id) if owner_id == user_id => Ok(()),
        Some(_) => Err(AppError::Forbidden(
            "Only the server owner can manage roles and permissions".into(),
        )),
    }
}

/// Compute the base (server-level) permissions for a user in a server by
/// combining all roles assigned to that user.
pub async fn get_user_server_permissions(
    db: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    let mut connection = db.acquire().await?;
    get_user_server_permissions_on_connection(&mut connection, server_id, user_id).await
}

pub async fn get_user_server_permissions_on_connection(
    db: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    Ok(member_server_permissions_on_connection(db, server_id, user_id)
        .await?
        .unwrap_or_else(Permissions::empty))
}

/// Server-level permissions, or `None` when the user is neither the owner nor a member.
async fn member_server_permissions_on_connection(
    db: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<Option<Permissions>, AppError> {
    // Owner always has all permissions.
    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&mut *db)
        .await?;

    if owner_id.map(|id| id == user_id).unwrap_or(false) {
        return Ok(Some(Permissions::all()));
    }

    // Non-members have no server permissions.
    let is_member: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&mut *db)
    .await?;
    if is_member == 0 {
        return Ok(None);
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
    .fetch_all(&mut *db)
    .await?;

    let mut perms = Permissions::empty();
    for bits in rows {
        if let Some(p) = Permissions::from_bits(bits) {
            perms |= p;
        }
    }

    Ok(Some(perms))
}

/// Compute the effective permissions for a user in a specific channel.
///
/// Algorithm (Discord-like):
/// 1. Start from server-level permissions.
/// 2. Apply category, then channel overrides; at each level the Everyone override first,
///    then the member's role overrides (each DENY before ALLOW).
pub async fn get_user_channel_permissions(
    db: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    let mut connection = db.acquire().await?;
    get_user_channel_permissions_on_connection(&mut connection, channel_id, user_id).await
}

pub async fn get_user_channel_permissions_on_connection(
    db: &mut PgConnection,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    // Resolve server_id and category from channel.
    let channel_row: Option<(Uuid, Option<String>)> =
        sqlx::query_as("SELECT server_id, category FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&mut *db)
            .await?;

    let (server_id, category) = match channel_row {
        Some(row) => row,
        None => return Ok(Permissions::empty()),
    };

    // Non-members get nothing, not even the Everyone role's channel or category overrides.
    let Some(mut perms) =
        member_server_permissions_on_connection(&mut *db, server_id, user_id).await?
    else {
        return Ok(Permissions::empty());
    };
    // Full admin (MANAGE_SERVER) bypasses channel/category overrides.
    if perms.contains(Permissions::MANAGE_SERVER) {
        return Ok(Permissions::all());
    }

    if let Some(category_name) = category.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        let category_overrides: Vec<(bool, i64, i64)> = sqlx::query_as(
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
               SELECT LOWER(sr.name) = 'everyone' AS is_everyone, co.allow, co.deny
               FROM effective_roles er
               INNER JOIN server_roles sr ON sr.id = er.role_id
               INNER JOIN channel_category_role_overrides co
                 ON co.role_id = er.role_id
               WHERE co.server_id = $1
                 AND co.category = $3"#,
        )
        .bind(server_id)
        .bind(user_id)
        .bind(category_name)
        .fetch_all(&mut *db)
        .await?;

        apply_overrides(&mut perms, category_overrides);
    }

    // Gather all role overrides for roles the user has in this server.
    let overrides: Vec<(bool, i64, i64)> = sqlx::query_as(
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
           SELECT LOWER(sr.name) = 'everyone' AS is_everyone, cro.allow, cro.deny
           FROM effective_roles er
           INNER JOIN server_roles sr ON sr.id = er.role_id
           INNER JOIN channel_role_overrides cro
             ON cro.role_id = er.role_id
           WHERE cro.channel_id = $3"#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(channel_id)
    .fetch_all(&mut *db)
    .await?;

    apply_overrides(&mut perms, overrides);

    Ok(perms)
}

/// Applies override rows `(is_everyone, allow, deny)` in Discord's order: the Everyone
/// override first, then the member's role overrides together, each step deny before allow.
/// So an Everyone allow cannot undo a deny on one of the member's roles, while one role's
/// allow still lifts another role's deny.
fn apply_overrides(perms: &mut Permissions, rows: Vec<(bool, i64, i64)>) {
    let (everyone, roles): (Vec<_>, Vec<_>) = rows
        .into_iter()
        .partition(|(is_everyone, _, _)| *is_everyone);
    for layer in [everyone, roles] {
        let (allow_mask, deny_mask) = override_masks(
            layer
                .into_iter()
                .map(|(_, allow, deny)| (allow, deny))
                .collect(),
        );
        perms.remove(deny_mask);
        *perms |= allow_mask;
    }
}

/// Combines override rows into (allow, deny), keeping only channel-scoped bits so rows
/// stored before validation existed cannot grant server-wide powers.
fn override_masks(rows: Vec<(i64, i64)>) -> (Permissions, Permissions) {
    let mut allow_mask = Permissions::empty();
    let mut deny_mask = Permissions::empty();
    for (allow_bits, deny_bits) in rows {
        if let Some(d) = Permissions::from_bits(deny_bits) {
            deny_mask |= d;
        }
        if let Some(a) = Permissions::from_bits(allow_bits) {
            allow_mask |= a;
        }
    }
    (
        allow_mask & Permissions::CHANNEL_OVERRIDABLE,
        deny_mask & Permissions::CHANNEL_OVERRIDABLE,
    )
}

/// Compute effective permissions for a user in a category scope.
///
/// Algorithm:
/// 1. Start from server-level permissions.
/// 2. Apply category overrides: the Everyone override first, then the member's role
///    overrides (each DENY before ALLOW).
pub async fn get_user_category_permissions(
    db: &PgPool,
    server_id: Uuid,
    category: &str,
    user_id: Uuid,
) -> Result<Permissions, AppError> {
    let mut connection = db.acquire().await?;
    let Some(mut perms) =
        member_server_permissions_on_connection(&mut connection, server_id, user_id).await?
    else {
        return Ok(Permissions::empty());
    };
    drop(connection);
    // Full admin (MANAGE_SERVER) bypasses category overrides.
    if perms.contains(Permissions::MANAGE_SERVER) {
        return Ok(Permissions::all());
    }
    let category_name = category.trim();
    if category_name.is_empty() {
        return Ok(perms);
    }

    let category_overrides: Vec<(bool, i64, i64)> = sqlx::query_as(
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
           SELECT LOWER(sr.name) = 'everyone' AS is_everyone, co.allow, co.deny
           FROM effective_roles er
           INNER JOIN server_roles sr ON sr.id = er.role_id
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

    apply_overrides(&mut perms, category_overrides);
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

pub async fn ensure_server_permission_on_connection(
    db: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<(), AppError> {
    let perms = get_user_server_permissions_on_connection(db, server_id, user_id).await?;
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

pub async fn ensure_channel_permission_on_connection(
    db: &mut PgConnection,
    channel_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<(), AppError> {
    let perms = get_user_channel_permissions_on_connection(db, channel_id, user_id).await?;
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
           WHERE smr.server_id = $1
             AND smr.user_id = $2
             AND LOWER(sr.name) <> 'everyone'"#,
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
        assert!(p.contains(Permissions::DEAFEN_MEMBERS));
        assert!(p.contains(Permissions::MOVE_MEMBERS));
    }

    #[test]
    fn permissions_empty_bits() {
        let p = Permissions::empty();
        assert!(!p.contains(Permissions::VIEW_SERVER));
        assert_eq!(p.bits(), 0);
    }
}
