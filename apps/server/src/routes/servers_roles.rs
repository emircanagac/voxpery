//! Server roles and member role assignment.
use super::*;

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ServerRole {
    pub(super) id: Uuid,
    pub(super) name: String,
    pub(super) color: Option<String>,
    pub(super) position: i32,
    pub(super) permissions: i64,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct CreateRoleRequest {
    pub(super) name: String,
    pub(super) permissions: Option<i64>,
    /// Optional display color (e.g. \"#ff0000\") used in member list.
    pub(super) color: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct UpdateRoleRequest {
    pub(super) name: Option<String>,
    pub(super) permissions: Option<i64>,
    /// Optional display color. When omitted, color stays unchanged.
    /// When provided (empty string from JSON), color is cleared.
    pub(super) color: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct ReorderRolesRequest {
    // Use String to avoid JSON deserialization errors on invalid UUIDs; we validate manually.
    pub(super) role_ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct ListRolesQuery {
    pub(super) include_system: Option<bool>,
}

/// GET /api/servers/:server_id/roles — list roles for a server (owner only for now).
pub(super) async fn list_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(query): Query<ListRolesQuery>,
) -> Result<Json<Vec<ServerRole>>, AppError> {
    // Require MANAGE_ROLES permission (owner implicitly has all permissions).
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_ROLES,
    )
    .await?;

    let include_system = query.include_system.unwrap_or(false);
    let roles = if include_system {
        sqlx::query_as::<_, ServerRole>(
            r#"SELECT id, name, color, position, permissions
               FROM server_roles
               WHERE server_id = $1
               ORDER BY position ASC, name ASC"#,
        )
        .bind(server_id)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, ServerRole>(
            r#"SELECT id, name, color, position, permissions
               FROM server_roles
               WHERE server_id = $1
                 AND LOWER(name) <> 'everyone'
               ORDER BY position ASC, name ASC"#,
        )
        .bind(server_id)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(roles))
}

/// POST /api/servers/:server_id/roles — create a new role (owner only).
pub(super) async fn create_role(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateRoleRequest>,
) -> Result<Json<ServerRole>, AppError> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::Validation(
            "Role name must be 1-64 characters".into(),
        ));
    }
    if name.eq_ignore_ascii_case("everyone") {
        return Err(AppError::Validation(
            "Role name 'Everyone' is reserved".into(),
        ));
    }

    // Role management is owner-only; see permissions::ensure_server_owner.
    permissions::ensure_server_owner(&state.db, server_id, claims.sub).await?;

    // Keep custom roles above the implicit Everyone role. Existing servers use a
    // large fixed position for Everyone, so including it in MAX would create new
    // roles below every ordinary member in the moderation hierarchy.
    let next_position: i32 = sqlx::query_scalar(
        r#"SELECT COALESCE(MAX(position) + 1, 0)
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) <> 'everyone'
             AND position < COALESCE(
                 (SELECT position
                  FROM server_roles
                  WHERE server_id = $1 AND LOWER(name) = 'everyone'),
                 2147483647
             )"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let permissions = body.permissions.unwrap_or(0);
    if Permissions::from_bits(permissions).is_none() {
        return Err(AppError::Validation("Unknown permission bits".into()));
    }
    let color_opt = body
        .color
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let role = sqlx::query_as::<_, ServerRole>(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, color, position, permissions"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(name)
    .bind(color_opt)
    .bind(next_position)
    .bind(permissions)
    .fetch_one(&state.db)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err)
            if db_err.code().as_deref() == Some("23505")
                && db_err.constraint().unwrap_or_default() == "idx_server_roles_server_name" =>
        {
            AppError::Validation("A role with that name already exists for this server".into())
        }
        _ => AppError::from(e),
    })?;

    crate::ws::publish_event(&state, crate::ws::WsEvent::ServerRolesUpdated { server_id }).await;

    Ok(Json(role))
}

/// PATCH /api/servers/:server_id/roles/reorder — update role positions by drag & drop.
pub(super) async fn reorder_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReorderRolesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.role_ids.is_empty() {
        return Ok(Json(serde_json::json!({ "message": "Nothing to reorder" })));
    }
    if body.role_ids.len() > MAX_REORDER_ROLE_IDS {
        return Err(AppError::Validation(format!(
            "Too many role ids in reorder request (max {MAX_REORDER_ROLE_IDS})"
        )));
    }

    // Role management is owner-only; see permissions::ensure_server_owner.
    permissions::ensure_server_owner(&state.db, server_id, claims.sub).await?;

    // Parse role IDs and remember order.
    let mut parsed_ids = Vec::<Uuid>::new();
    for raw in &body.role_ids {
        let id = Uuid::parse_str(raw)
            .map_err(|_| AppError::Validation("Invalid role id in reorder request".into()))?;
        parsed_ids.push(id);
    }

    // "Everyone" is implicit and not reorderable.
    let expected_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) <> 'everyone'"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    if expected_ids.len() != parsed_ids.len() {
        return Err(AppError::Validation(
            "role_ids must include all non-system roles exactly once".into(),
        ));
    }
    let expected_set: std::collections::HashSet<Uuid> = expected_ids.into_iter().collect();
    let parsed_set: std::collections::HashSet<Uuid> = parsed_ids.iter().copied().collect();
    if expected_set != parsed_set {
        return Err(AppError::Validation(
            "role_ids contains unknown or missing roles".into(),
        ));
    }

    let mut tx = state.db.begin().await?;

    for (idx, role_id) in parsed_ids.iter().enumerate() {
        sqlx::query("UPDATE server_roles SET position = $1 WHERE id = $2 AND server_id = $3")
            .bind(idx as i32)
            .bind(role_id)
            .bind(server_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    crate::ws::publish_event(&state, crate::ws::WsEvent::ServerRolesUpdated { server_id }).await;

    Ok(Json(serde_json::json!({ "message": "Roles reordered" })))
}

/// PATCH /api/servers/:server_id/roles/:role_id — update name/permissions (owner only).
pub(super) async fn update_role(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<Json<ServerRole>, AppError> {
    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;
    if owner_id.is_none() {
        return Err(AppError::NotFound("Server not found".into()));
    }
    if owner_id != Some(claims.sub) {
        return Err(AppError::Forbidden(
            "Only the server owner can manage roles".into(),
        ));
    }

    // Ensure role belongs to this server.
    let role_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM server_roles WHERE id = $1 AND server_id = $2")
            .bind(role_id)
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;
    let role_name = match role_name {
        Some(name) => name,
        None => return Err(AppError::NotFound("Role not found".into())),
    };
    if role_name.eq_ignore_ascii_case("everyone") {
        return Err(AppError::Validation(
            "The Everyone role is system-managed and cannot be edited".into(),
        ));
    }

    if let Some(name) = body.name.as_deref().map(str::trim) {
        if name.eq_ignore_ascii_case("everyone") {
            return Err(AppError::Validation(
                "Role name 'Everyone' is reserved".into(),
            ));
        }
    }

    let mut new_name_opt: Option<String> = None;
    if let Some(name) = body.name.as_deref() {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 64 {
            return Err(AppError::Validation(
                "Role name must be 1-64 characters".into(),
            ));
        }
        new_name_opt = Some(trimmed.to_string());
    }

    let permissions_opt = body.permissions;
    if permissions_opt.is_some_and(|bits| Permissions::from_bits(bits).is_none()) {
        return Err(AppError::Validation("Unknown permission bits".into()));
    }
    // Interpret color field:
    // If body.color is None, it means the field wasn't sent (don't update).
    // If it's Some(""), clear the color (set to NULL in DB).
    // Otherwise, set to the new color.
    let (update_color, color_val): (bool, Option<String>) = match &body.color {
        None => (false, None),
        Some(s) if s.trim().is_empty() => (true, None),
        Some(s) => (true, Some(s.trim().to_string())),
    };

    let role = sqlx::query_as::<_, ServerRole>(
        r#"UPDATE server_roles
           SET name = COALESCE($3, name),
               permissions = COALESCE($4, permissions),
               color = CASE WHEN $5 THEN $6 ELSE color END
           WHERE id = $1 AND server_id = $2
           RETURNING id, name, color, position, permissions"#,
    )
    .bind(role_id)
    .bind(server_id)
    .bind(new_name_opt)
    .bind(permissions_opt)
    .bind(update_color)
    .bind(color_val)
    .fetch_one(&state.db)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err)
            if db_err.code().as_deref() == Some("23505")
                && db_err.constraint().unwrap_or_default() == "idx_server_roles_server_name" =>
        {
            AppError::Validation("A role with that name already exists for this server".into())
        }
        _ => AppError::from(e),
    })?;

    crate::ws::publish_event(&state, crate::ws::WsEvent::ServerRolesUpdated { server_id }).await;

    if permissions_opt.is_some() {
        voice_revoke::revoke_invalid_voice_sessions_for_server(
            &state,
            server_id,
            "role permissions updated",
        )
        .await?;
    }

    Ok(Json(role))
}

/// DELETE /api/servers/:server_id/roles/:role_id — delete a role (owner only).
pub(super) async fn delete_role(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;
    if owner_id.is_none() {
        return Err(AppError::NotFound("Server not found".into()));
    }
    if owner_id != Some(claims.sub) {
        return Err(AppError::Forbidden(
            "Only the server owner can manage roles".into(),
        ));
    }

    let role_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM server_roles WHERE id = $1 AND server_id = $2")
            .bind(role_id)
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;
    let role_name = match role_name {
        Some(name) => name,
        None => return Err(AppError::NotFound("Role not found".into())),
    };
    if role_name.eq_ignore_ascii_case("everyone") {
        return Err(AppError::Validation(
            "The Everyone role is system-managed and cannot be deleted".into(),
        ));
    }

    let result = sqlx::query(
        "DELETE FROM server_roles WHERE id = $1 AND server_id = $2 AND LOWER(name) <> 'everyone'",
    )
    .bind(role_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Role not found".into()));
    }

    crate::ws::publish_event(&state, crate::ws::WsEvent::ServerRolesUpdated { server_id }).await;

    voice_revoke::revoke_invalid_voice_sessions_for_server(&state, server_id, "role deleted")
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /api/servers/:server_id/members/:user_id/roles — list granular roles for a member.
pub(super) async fn list_member_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Uuid>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_ROLES,
    )
    .await?;

    // Ensure target user is a member of this server.
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if exists == 0 {
        return Err(AppError::NotFound("Member not found".into()));
    }

    let role_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT smr.role_id
           FROM server_member_roles smr
           INNER JOIN server_roles sr ON sr.id = smr.role_id
           WHERE smr.server_id = $1
             AND smr.user_id = $2
             AND LOWER(sr.name) <> 'everyone'"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(role_ids))
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct UpdateMemberRolesRequest {
    pub(super) role_ids: Vec<Uuid>,
}

/// PUT /api/servers/:server_id/members/:user_id/roles — replace granular roles for a member.
pub(super) async fn update_member_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateMemberRolesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.role_ids.len() > MAX_REORDER_ROLE_IDS {
        return Err(AppError::Validation("Too many role_ids".into()));
    }
    let requested_role_ids = body.role_ids;
    let requested_role_set: HashSet<Uuid> = requested_role_ids.iter().copied().collect();
    if requested_role_set.len() != requested_role_ids.len() {
        return Err(AppError::Validation(
            "Duplicate role_ids are not allowed".into(),
        ));
    }

    let mut tx = state.db.begin().await?;
    let owner_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner_id FROM servers WHERE id = $1 FOR NO KEY UPDATE",
    )
    .bind(server_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    // Role assignment is owner-only, like the rest of role management. The hierarchy checks
    // below remain for the delegation rules documented in docs/ARCHITECTURE.md.
    if owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "Only the server owner can manage roles and permissions".into(),
        ));
    }

    let target_membership = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM server_members WHERE server_id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if target_membership.is_none() {
        return Err(AppError::NotFound("Member not found".into()));
    }

    let (caller_role_pos, target_role_pos): (Option<i32>, Option<i32>) = sqlx::query_as(
        r#"SELECT
               (SELECT MIN(sr.position)
                FROM server_member_roles smr
                INNER JOIN server_roles sr ON sr.id = smr.role_id
                WHERE smr.server_id = $1 AND smr.user_id = $2),
               (SELECT MIN(sr.position)
                FROM server_member_roles smr
                INNER JOIN server_roles sr ON sr.id = smr.role_id
                WHERE smr.server_id = $1 AND smr.user_id = $3)"#,
    )
    .bind(server_id)
    .bind(claims.sub)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    let caller_pos = if owner_id == claims.sub {
        -1
    } else {
        caller_role_pos.unwrap_or(i32::MAX)
    };
    let target_pos = if owner_id == user_id {
        -1
    } else {
        target_role_pos.unwrap_or(i32::MAX)
    };

    // 1. Cannot modify someone with a higher or equal role.
    if caller_pos >= target_pos && claims.sub != user_id && owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "You cannot modify the roles of a member with an equal or higher role".into(),
        ));
    }

    let requested_roles: Vec<(Uuid, i32, String)> = if requested_role_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT id, position, name FROM server_roles WHERE server_id = $1 AND id = ANY($2)",
        )
        .bind(server_id)
        .bind(requested_role_ids.as_slice())
        .fetch_all(&mut *tx)
        .await?
    };
    if requested_roles.len() != requested_role_ids.len() {
        return Err(AppError::Validation(
            "One or more role_ids are invalid".into(),
        ));
    }
    for (_, pos, name) in &requested_roles {
        if name.eq_ignore_ascii_case("everyone") {
            return Err(AppError::Validation(
                "The Everyone role is system-managed and cannot be assigned manually".into(),
            ));
        }
        if caller_pos >= *pos && owner_id != claims.sub {
            return Err(AppError::Forbidden(
                "You cannot assign a role higher or equal to your own highest role".into(),
            ));
        }
    }

    let old_roles: Vec<(Uuid, i32, String)> = sqlx::query_as(
        r#"SELECT smr.role_id, sr.position, sr.name
           FROM server_member_roles smr
           INNER JOIN server_roles sr ON sr.id = smr.role_id
           WHERE smr.server_id = $1 AND smr.user_id = $2"#,
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(&mut *tx)
    .await?;
    let old_role_ids: Vec<Uuid> = old_roles.iter().map(|(id, _, _)| *id).collect();
    for (old_role_id, pos, name) in &old_roles {
        if !requested_role_set.contains(old_role_id)
            && !name.eq_ignore_ascii_case("everyone")
            && caller_pos >= *pos
            && owner_id != claims.sub
        {
            return Err(AppError::Forbidden(
                "You cannot remove a role higher or equal to your own highest role".into(),
            ));
        }
    }

    // Replace all current roles with the provided set.
    sqlx::query("DELETE FROM server_member_roles WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    if !requested_role_ids.is_empty() {
        sqlx::query(
            r#"INSERT INTO server_member_roles (server_id, user_id, role_id)
               SELECT $1, $2, requested.role_id
               FROM UNNEST($3::uuid[]) AS requested(role_id)"#,
        )
        .bind(server_id)
        .bind(user_id)
        .bind(requested_role_ids.as_slice())
        .execute(&mut *tx)
        .await?;
    }

    // Audit log: record granular role changes.
    audit::log_in_transaction(
        &mut tx,
        claims.sub,
        Some(server_id),
        "member_role_change",
        "member",
        Some(user_id),
        Some(serde_json::json!({
            "old_role_ids": old_role_ids,
            "new_role_ids": requested_role_ids,
        })),
    )
    .await?;

    tx.commit().await?;

    // Notify clients via WebSocket so member list / badges update without full reload.
    crate::ws::publish_event(&state, WsEvent::MemberRoleUpdated { server_id, user_id }).await;

    if let Err(error) = voice_revoke::revoke_invalid_voice_sessions_for_server(
        &state,
        server_id,
        "member roles updated",
    )
    .await
    {
        tracing::error!(
            "Post-commit voice permission reconciliation failed for server {}: {}",
            server_id,
            error
        );
    }

    Ok(Json(
        serde_json::json!({ "message": "Member roles updated" }),
    ))
}
