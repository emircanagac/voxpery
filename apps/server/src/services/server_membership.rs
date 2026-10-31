//! Membership changes that must stay consistent with bans and server voice moderation.
use sqlx::PgConnection;
use uuid::Uuid;

/// Serializes changes to one person's membership of one server until the transaction ends, so a
/// join cannot slip past a ban or a kick that is committing at the same moment.
pub async fn lock_membership(
    conn: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))")
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Whether the user is banned. Reliable only after [`lock_membership`].
pub async fn is_banned(
    conn: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
}

/// Adds the user, restoring a server mute or deafen they left with. Returns false when they
/// were already a member. Check [`is_banned`] first, after [`lock_membership`].
pub async fn add_member(
    conn: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let added = sqlx::query(
        r#"WITH held AS (
               DELETE FROM server_voice_moderation_holds
               WHERE server_id = $1 AND user_id = $2
               RETURNING voice_server_muted, voice_server_deafened
           )
           INSERT INTO server_members
               (server_id, user_id, joined_at, voice_server_muted, voice_server_deafened)
           SELECT $1, $2, NOW(),
                  COALESCE((SELECT voice_server_muted FROM held), FALSE),
                  COALESCE((SELECT voice_server_deafened FROM held), FALSE)
           ON CONFLICT (server_id, user_id) DO NOTHING"#,
    )
    .bind(server_id)
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    Ok(added.rows_affected() > 0)
}

/// Removes the member; their roles go with the membership. A server mute or deafen outlives it,
/// so leaving and rejoining cannot shake one off. Returns whether they were a member.
pub async fn remove_member(
    conn: &mut PgConnection,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH removed AS (
               DELETE FROM server_members
               WHERE server_id = $1 AND user_id = $2
               RETURNING voice_server_muted, voice_server_deafened
           ), held AS (
               INSERT INTO server_voice_moderation_holds
                   (server_id, user_id, voice_server_muted, voice_server_deafened)
               SELECT $1, $2, voice_server_muted, voice_server_deafened
               FROM removed
               WHERE voice_server_muted OR voice_server_deafened
               ON CONFLICT (server_id, user_id) DO UPDATE
               SET voice_server_muted = EXCLUDED.voice_server_muted,
                   voice_server_deafened = EXCLUDED.voice_server_deafened
           )
           SELECT EXISTS(SELECT 1 FROM removed)"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
}

/// The server's owner, read under a share lock that holds off an ownership transfer until the
/// transaction ends. `None` when the server is gone.
pub async fn lock_server_owner(
    conn: &mut PgConnection,
    server_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1 FOR SHARE")
        .bind(server_id)
        .fetch_optional(&mut *conn)
        .await
}
