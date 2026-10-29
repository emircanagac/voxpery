//! Audit log, bans, kicks, timeouts and raid events.
use super::*;

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct AuditLogEntry {
    pub(super) id: Uuid,
    pub(super) at: chrono::DateTime<chrono::Utc>,
    pub(super) actor_id: Uuid,
    pub(super) server_id: Option<Uuid>,
    pub(super) action: String,
    pub(super) resource_type: String,
    pub(super) resource_id: Option<Uuid>,
    pub(super) channel_id: Option<Uuid>,
    pub(super) reason: Option<String>,
    pub(super) details: Option<serde_json::Value>,
    /// Who performed the action (from users.username).
    pub(super) actor_username: Option<String>,
    /// Target user display name when resource is a user (e.g. kicked member, role change target).
    pub(super) resource_username: Option<String>,
    /// Channel display name captured through the current channel relationship.
    pub(super) channel_name: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub(super) struct AuditLogPage {
    pub(super) entries: Vec<AuditLogEntry>,
    pub(super) next_before: Option<Uuid>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub(super) struct AuditLogQuery {
    pub(super) action: Option<String>,
    pub(super) actor_id: Option<Uuid>,
    pub(super) target_id: Option<Uuid>,
    pub(super) channel_id: Option<Uuid>,
    pub(super) before: Option<Uuid>,
    pub(super) limit: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct BanMemberRequest {
    pub(super) reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct TimeoutMemberRequest {
    pub(super) duration_minutes: Option<i64>,
    pub(super) reason: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ServerBanEntry {
    pub(super) user_id: Uuid,
    pub(super) banned_by: Uuid,
    pub(super) reason: Option<String>,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
    pub(super) username: String,
    pub(super) banned_by_username: String,
}

pub(super) async fn ensure_moderation_view_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let perms = permissions::get_user_server_permissions(&state.db, server_id, user_id).await?;
    if perms.intersects(
        Permissions::VIEW_AUDIT_LOG | Permissions::BAN_MEMBERS | Permissions::MANAGE_MESSAGES,
    ) {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "Missing permission to view moderation activity".into(),
        ))
    }
}

pub(super) async fn ensure_timeout_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        user_id,
        Permissions::MANAGE_MESSAGES,
    )
    .await
}

pub(super) async fn ensure_member_timeout_target(
    state: &AppState,
    server_id: Uuid,
    actor_id: Uuid,
    target_id: Uuid,
) -> Result<Server, AppError> {
    if actor_id == target_id {
        return Err(AppError::Validation("Cannot timeout yourself".into()));
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    if server.owner_id == target_id {
        return Err(AppError::Forbidden(
            "Cannot timeout the server owner".into(),
        ));
    }

    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await?;
    if is_member == 0 {
        return Err(AppError::NotFound("Member not found".into()));
    }

    let caller_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, actor_id).await?;
    let target_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, target_id).await?;
    if caller_pos >= target_pos {
        return Err(AppError::Forbidden(
            "You cannot timeout a member with an equal or higher role than yourself".into(),
        ));
    }

    Ok(server)
}

pub(super) fn normalize_timeout_reason(reason: Option<&str>) -> Result<Option<String>, AppError> {
    let trimmed = reason.map(str::trim).filter(|value| !value.is_empty());
    if let Some(value) = trimmed {
        if value.len() > 500 {
            return Err(AppError::Validation(
                "Timeout reason must be at most 500 characters".into(),
            ));
        }
        return Ok(Some(value.to_string()));
    }
    Ok(None)
}

/// GET /api/servers/:server_id/audit-log — list audit log for server (owner/admin only).
pub(super) async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(query): Query<AuditLogQuery>,
) -> Result<Json<AuditLogPage>, AppError> {
    // Require VIEW_AUDIT_LOG permission for audit log access.
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_AUDIT_LOG,
    )
    .await?;

    let action = query
        .action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if action.is_some_and(|value| {
        value.len() > 50
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
    }) {
        return Err(AppError::Validation("Invalid audit action filter".into()));
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let mut builder = QueryBuilder::<Postgres>::new(
        r#"SELECT a.id, a.at, a.actor_id, a.server_id, a.action, a.resource_type,
                  a.resource_id, a.channel_id, a.reason, a.details,
                  u_actor.username AS actor_username,
                  u_resource.username AS resource_username,
                  c.name AS channel_name
           FROM audit_log a
           LEFT JOIN users u_actor ON u_actor.id = a.actor_id
           LEFT JOIN users u_resource ON u_resource.id = a.resource_id
           LEFT JOIN channels c ON c.id = a.channel_id
           WHERE a.server_id = "#,
    );
    builder.push_bind(server_id);

    if let Some(action) = action {
        builder.push(" AND a.action = ").push_bind(action);
    }
    if let Some(actor_id) = query.actor_id {
        builder.push(" AND a.actor_id = ").push_bind(actor_id);
    }
    if let Some(target_id) = query.target_id {
        builder.push(" AND a.resource_id = ").push_bind(target_id);
    }
    if let Some(channel_id) = query.channel_id {
        builder.push(" AND a.channel_id = ").push_bind(channel_id);
    }
    if let Some(before) = query.before {
        builder.push(
            " AND (a.at, a.id) < (SELECT cursor.at, cursor.id FROM audit_log cursor WHERE cursor.id = ",
        );
        builder.push_bind(before);
        builder.push(" AND cursor.server_id = ");
        builder.push_bind(server_id);
        builder.push(")");
    }
    builder.push(" ORDER BY a.at DESC, a.id DESC LIMIT ");
    builder.push_bind(limit + 1);

    let mut entries = builder
        .build_query_as::<AuditLogEntry>()
        .fetch_all(&state.db)
        .await?;
    let has_more = entries.len() > limit as usize;
    entries.truncate(limit as usize);
    let mut access = ChannelReadAccess::new(claims.sub);
    for entry in &mut entries {
        let channel_id = entry.channel_id.or_else(|| {
            entry
                .details
                .as_ref()
                .and_then(|details| details.get("channel_id"))
                .and_then(|value| value.as_str())
                .and_then(|value| Uuid::parse_str(value).ok())
        });
        // Quotes whose channel is gone or unknown stay hidden: access can no longer be checked.
        if let Some(channel_id) = channel_id {
            if access.allows(&state.db, channel_id).await {
                continue;
            }
        }
        if let Some(serde_json::Value::Object(details)) = entry.details.as_mut() {
            let mut hidden = false;
            for key in QUOTED_CONTENT_KEYS {
                hidden |= details.remove(key).is_some();
            }
            if hidden {
                details.insert("content_hidden".into(), serde_json::Value::Bool(true));
            }
        }
    }
    let next_before = if has_more {
        entries.last().map(|entry| entry.id)
    } else {
        None
    };

    Ok(Json(AuditLogPage {
        entries,
        next_before,
    }))
}

pub(super) async fn ban_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<BanMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if claims.sub == user_id {
        return Err(AppError::Validation("Cannot ban yourself".into()));
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::BAN_MEMBERS,
    )
    .await?;

    if server.owner_id == user_id {
        return Err(AppError::Forbidden("Cannot ban the server owner".into()));
    }

    let target_exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
    if target_exists == 0 {
        return Err(AppError::NotFound("User not found".into()));
    }

    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if is_member > 0 {
        let caller_pos =
            permissions::get_user_highest_role_position(&state.db, server_id, claims.sub).await?;
        let target_pos =
            permissions::get_user_highest_role_position(&state.db, server_id, user_id).await?;
        if caller_pos >= target_pos {
            return Err(AppError::Forbidden(
                "You cannot ban a member with an equal or higher role than yourself".into(),
            ));
        }
    }

    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if let Some(r) = reason {
        if r.len() > 500 {
            return Err(AppError::Validation(
                "Ban reason must be at most 500 characters".into(),
            ));
        }
    }

    let mut tx = state.db.begin().await?;

    sqlx::query(
        r#"INSERT INTO server_bans (server_id, user_id, banned_by, reason, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (server_id, user_id)
           DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason"#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(claims.sub)
    .bind(reason)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM server_member_roles WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    let removed_member =
        sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            > 0;

    tx.commit().await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_ban",
        "member",
        Some(user_id),
        Some(serde_json::json!({ "reason": reason })),
    )
    .await?;

    if removed_member {
        crate::ws::publish_event(
            &state,
            WsEvent::MemberLeft {
                server_id,
                user_id,
                reason: None,
            },
        )
        .await;
        // The removed account no longer passes the member check for broadcasts, so tell it directly
        // and let every open client drop the server instead of showing a dead channel.
        crate::ws::publish_user_event(
            &state,
            user_id,
            WsEvent::MemberLeft {
                server_id,
                user_id,
                reason: Some("banned".into()),
            },
        )
        .await;
        voice_revoke::revoke_user_voice_access_for_server(
            &state,
            server_id,
            user_id,
            "member banned",
        )
        .await?;
    }

    Ok(Json(serde_json::json!({
        "message": "Member banned",
        "removed_member": removed_member
    })))
}

pub(super) async fn timeout_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<TimeoutMemberRequest>,
) -> Result<Json<ServerTimeoutEntry>, AppError> {
    ensure_timeout_permission(&state, server_id, claims.sub).await?;
    ensure_member_timeout_target(&state, server_id, claims.sub, user_id).await?;

    let duration_minutes = body.duration_minutes.unwrap_or(60);
    if !(1..=10_080).contains(&duration_minutes) {
        return Err(AppError::Validation(
            "Timeout duration must be between 1 minute and 7 days".into(),
        ));
    }
    let reason = normalize_timeout_reason(body.reason.as_deref())?;
    let until = Utc::now() + ChronoDuration::minutes(duration_minutes);

    let entry = sqlx::query_as::<_, ServerTimeoutEntry>(
        r#"WITH upserted AS (
               INSERT INTO server_member_timeouts (
                   server_id, user_id, timed_out_until, timeout_by, reason, created_at, updated_at
               )
               VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
               ON CONFLICT (server_id, user_id)
               DO UPDATE SET
                   timed_out_until = EXCLUDED.timed_out_until,
                   timeout_by = EXCLUDED.timeout_by,
                   reason = EXCLUDED.reason,
                   updated_at = NOW()
               RETURNING server_id, user_id, timed_out_until, timeout_by, reason, created_at, updated_at
           )
           SELECT upserted.server_id,
                  upserted.user_id,
                  target.username,
                  upserted.timed_out_until,
                  upserted.timeout_by,
                  moderator.username AS timeout_by_username,
                  upserted.reason,
                  upserted.created_at,
                  upserted.updated_at
           FROM upserted
           INNER JOIN users target ON target.id = upserted.user_id
           LEFT JOIN users moderator ON moderator.id = upserted.timeout_by"#,
    )
    .bind(server_id)
    .bind(user_id)
    .bind(until)
    .bind(claims.sub)
    .bind(&reason)
    .fetch_one(&state.db)
    .await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_timeout_create",
        "member",
        Some(user_id),
        Some(serde_json::json!({
            "duration_minutes": duration_minutes,
            "timed_out_until": entry.timed_out_until,
            "reason": reason
        })),
    )
    .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MemberTimeoutUpdated {
            server_id,
            user_id,
            timed_out_until: Some(entry.timed_out_until),
        },
    )
    .await;

    Ok(Json(entry))
}

pub(super) async fn clear_member_timeout(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    ensure_timeout_permission(&state, server_id, claims.sub).await?;
    ensure_member_timeout_target(&state, server_id, claims.sub, user_id).await?;

    let deleted = sqlx::query(
        r#"DELETE FROM server_member_timeouts
           WHERE server_id = $1 AND user_id = $2"#,
    )
    .bind(server_id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Timeout not found".into()));
    }

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_timeout_clear",
        "member",
        Some(user_id),
        None,
    )
    .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MemberTimeoutUpdated {
            server_id,
            user_id,
            timed_out_until: None,
        },
    )
    .await;

    Ok(Json(serde_json::json!({ "message": "Timeout cleared" })))
}

pub(super) async fn list_active_timeouts(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerTimeoutEntry>>, AppError> {
    ensure_moderation_view_permission(&state, server_id, claims.sub).await?;
    let rows = moderation::list_active_timeouts(&state.db, server_id).await?;
    Ok(Json(rows))
}

pub(super) async fn list_raid_events(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<RaidEventEntry>>, AppError> {
    ensure_moderation_view_permission(&state, server_id, claims.sub).await?;
    let rows = moderation::list_raid_events(&state.db, server_id).await?;
    Ok(Json(rows))
}

pub(super) async fn list_bans(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerBanEntry>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::BAN_MEMBERS,
    )
    .await?;

    let rows = sqlx::query_as::<_, ServerBanEntry>(
        r#"SELECT sb.user_id, sb.banned_by, sb.reason, sb.created_at,
                  u.username AS username,
                  ub.username AS banned_by_username
           FROM server_bans sb
           INNER JOIN users u ON u.id = sb.user_id
           INNER JOIN users ub ON ub.id = sb.banned_by
           WHERE sb.server_id = $1
           ORDER BY sb.created_at DESC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

pub(super) async fn unban_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::BAN_MEMBERS,
    )
    .await?;

    let result = sqlx::query("DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Ban entry not found".into()));
    }

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_unban",
        "member",
        Some(user_id),
        None,
    )
    .await?;

    Ok(Json(serde_json::json!({ "message": "Member unbanned" })))
}

/// DELETE /api/servers/:server_id/members/:user_id — kick a member (requires KICK_MEMBERS).
pub(super) async fn kick_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if claims.sub == user_id {
        return Err(AppError::Validation("Cannot kick yourself".into()));
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::KICK_MEMBERS,
    )
    .await?;

    // Target must be a member.
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_member {
        return Err(AppError::NotFound("Member not found".into()));
    }

    if server.owner_id == user_id {
        return Err(AppError::Forbidden("Cannot kick the server owner".into()));
    }

    // Role Hierarchy Security:
    // A user can only kick someone if their highest role position is lower (higher rank)
    // than the target's highest role position.
    let caller_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, claims.sub).await?;
    let target_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, user_id).await?;

    if caller_pos >= target_pos {
        return Err(AppError::Forbidden(
            "You cannot kick a member with an equal or higher role than yourself".into(),
        ));
    }

    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_kick",
        "member",
        Some(user_id),
        None,
    )
    .await?;

    crate::ws::publish_event(
        &state,
        WsEvent::MemberLeft {
            server_id,
            user_id,
            reason: None,
        },
    )
    .await;
    // The removed account no longer passes the member check for broadcasts, so tell it directly
    // and let every open client drop the server instead of showing a dead channel.
    crate::ws::publish_user_event(
        &state,
        user_id,
        WsEvent::MemberLeft {
            server_id,
            user_id,
            reason: Some("kicked".into()),
        },
    )
    .await;
    voice_revoke::revoke_user_voice_access_for_server(&state, server_id, user_id, "member kicked")
        .await?;

    Ok(Json(serde_json::json!({ "message": "Member kicked" })))
}
