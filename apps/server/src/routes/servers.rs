use axum::{
    extract::{Path, Query, State},
    middleware,
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    models::{
        Channel, CreateServerRequest, JoinServerRequest, MemberInfo, Server, ServerDetail,
        ServerInvitePreview, ServerWithMembers,
    },
    services::{
        audit,
        auth::generate_invite_code,
        permissions::{self, Permissions},
    },
    ws::WsEvent,
    AppState,
};

// Permission bits (kept here for documentation; must stay in sync with services::permissions::Permissions).
#[allow(dead_code)] // Used when wiring/tweaking permission checks.
const PERM_VIEW_SERVER: i64 = 1 << 0;
const PERM_KICK_MEMBERS: i64 = 1 << 4;
const PERM_BAN_MEMBERS: i64 = 1 << 5;
const PERM_VIEW_AUDIT_LOG: i64 = 1 << 6;
const PERM_SEND_MESSAGES: i64 = 1 << 7;
const PERM_MANAGE_MESSAGES: i64 = 1 << 8;
const PERM_MANAGE_PINS: i64 = 1 << 9;
const PERM_CONNECT_VOICE: i64 = 1 << 10;
const PERM_MUTE_MEMBERS: i64 = 1 << 11;
const PERM_DEAFEN_MEMBERS: i64 = 1 << 12;
const MAX_REORDER_ROLE_IDS: usize = 512;

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct AuditLogEntry {
    id: Uuid,
    at: chrono::DateTime<chrono::Utc>,
    actor_id: Uuid,
    server_id: Option<Uuid>,
    action: String,
    resource_type: String,
    resource_id: Option<Uuid>,
    details: Option<serde_json::Value>,
    /// Who performed the action (from users.username).
    actor_username: Option<String>,
    /// Target user display name when resource is a user (e.g. kicked member, role change target).
    resource_username: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ServerRole {
    id: Uuid,
    name: String,
    color: Option<String>,
    position: i32,
    permissions: i64,
}

#[derive(Debug, serde::Deserialize)]
struct CreateRoleRequest {
    name: String,
    permissions: Option<i64>,
    /// Optional display color (e.g. \"#ff0000\") used in member list.
    color: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct UpdateRoleRequest {
    name: Option<String>,
    permissions: Option<i64>,
    /// Optional display color. When omitted, color stays unchanged.
    /// When provided (empty string from JSON), color is cleared.
    color: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReorderRolesRequest {
    // Use String to avoid JSON deserialization errors on invalid UUIDs; we validate manually.
    role_ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
struct BanMemberRequest {
    reason: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ServerBanEntry {
    user_id: Uuid,
    banned_by: Uuid,
    reason: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    username: String,
    banned_by_username: String,
}

#[derive(Debug, serde::Deserialize)]
struct ReportUserRequest {
    reported_user_id: Uuid,
    reason: String,
    details: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReportMessageRequest {
    message_id: Uuid,
    reason: String,
    details: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ServerReportEntry {
    id: Uuid,
    server_id: Uuid,
    reporter_user_id: Uuid,
    reporter_username: String,
    reported_user_id: Uuid,
    reported_username: String,
    channel_id: Option<Uuid>,
    channel_name: Option<String>,
    message_id: Option<Uuid>,
    message_excerpt: Option<String>,
    reason: String,
    details: Option<String>,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
    resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    resolved_by: Option<Uuid>,
    resolved_by_username: Option<String>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/invite/{invite_code}", get(get_invite_preview))
        .merge(
            Router::new()
                .route("/", get(list_servers).post(create_server))
                .route(
                    "/{server_id}",
                    get(get_server).delete(delete_server).patch(update_server),
                )
                .route("/{server_id}/roles", get(list_roles).post(create_role))
                .route("/{server_id}/roles/reorder", patch(reorder_roles))
                .route(
                    "/{server_id}/roles/{role_id}",
                    patch(update_role).delete(delete_role),
                )
                .route("/{server_id}/channels", get(list_channels))
                .route(
                    "/{server_id}/channels/{channel_id}/members",
                    get(list_channel_visible_members),
                )
                .route(
                    "/{server_id}/members/{user_id}/roles",
                    get(list_member_roles).put(update_member_roles),
                )
                .route(
                    "/{server_id}/members/{user_id}/role",
                    patch(update_member_role),
                )
                .route("/{server_id}/members/{user_id}/ban", post(ban_member))
                .route("/{server_id}/members/{user_id}", delete(kick_member))
                .route("/{server_id}/bans", get(list_bans))
                .route("/{server_id}/bans/{user_id}", delete(unban_member))
                .route("/{server_id}/reports", get(list_reports))
                .route("/{server_id}/reports/user", post(report_user))
                .route("/{server_id}/reports/message", post(report_message))
                .route("/{server_id}/reports/{report_id}/resolve", post(resolve_report))
                .route("/{server_id}/audit-log", get(get_audit_log))
                .route("/join", post(join_server))
                .route("/{server_id}/leave", post(leave_server))
                .route_layer(middleware::from_fn_with_state(state, require_auth)),
        )
}

fn visible_presence(status: &str, has_session: bool) -> String {
    if !has_session {
        return "offline".to_string();
    }
    match status.to_ascii_lowercase().as_str() {
        "dnd" => "dnd".to_string(),
        "invisible" | "offline" => "offline".to_string(),
        _ => "online".to_string(),
    }
}

fn normalize_report_reason(reason: &str) -> Result<String, AppError> {
    let normalized = reason.trim().to_ascii_lowercase();
    let allowed = [
        "spam",
        "harassment",
        "inappropriate_content",
        "impersonation",
        "other",
    ];
    if !allowed.contains(&normalized.as_str()) {
        return Err(AppError::Validation("Invalid report reason".into()));
    }
    Ok(normalized)
}

fn normalize_report_details(details: Option<&str>) -> Result<Option<String>, AppError> {
    let trimmed = details.map(str::trim).filter(|value| !value.is_empty());
    if let Some(value) = trimmed {
        if value.len() > 500 {
            return Err(AppError::Validation(
                "Report details must be at most 500 characters".into(),
            ));
        }
        return Ok(Some(value.to_string()));
    }
    Ok(None)
}

/// GET /api/servers/invite/:invite_code — public preview for invite pages.
async fn get_invite_preview(
    State(state): State<Arc<AppState>>,
    Path(invite_code): Path<String>,
) -> Result<Json<ServerInvitePreview>, AppError> {
    let code = invite_code.trim();
    if code.is_empty() || code.len() > 32 {
        return Err(AppError::Validation(
            "Invite code must be 1-32 characters".into(),
        ));
    }

    let preview = sqlx::query_as::<_, ServerInvitePreview>(
        r#"SELECT s.id, s.name, s.icon_url, s.invite_code, COUNT(sm.user_id) AS member_count
           FROM servers s
           LEFT JOIN server_members sm ON sm.server_id = s.id
           WHERE s.invite_code = $1
           GROUP BY s.id, s.name, s.icon_url, s.invite_code"#,
    )
    .bind(code)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Invalid invite code".into()))?;

    Ok(Json(preview))
}

/// GET /api/servers — list all servers the user is a member of.
/// Uses a single JOIN+GROUP BY query instead of N+1.
async fn list_servers(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ServerWithMembers>>, AppError> {
    let rows = sqlx::query_as::<_, ServerWithMembers>(
        r#"SELECT s.id, s.name, s.icon_url, s.owner_id, s.invite_code, s.created_at,
                  COUNT(sm2.user_id) as member_count
           FROM servers s
           INNER JOIN server_members sm ON s.id = sm.server_id
           INNER JOIN server_members sm2 ON s.id = sm2.server_id
           WHERE sm.user_id = $1
           GROUP BY s.id, s.name, s.icon_url, s.owner_id, s.invite_code, s.created_at
           ORDER BY MIN(sm.joined_at) ASC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// Validates server icon URL (same rules as update_server) to prevent XSS. Returns Ok(Option) for insert.
fn validate_server_icon_url(icon_url: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(url) = icon_url else {
        return Ok(None);
    };
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 3_000_000 {
        return Err(AppError::Validation(
            "Server icon image is too large".into(),
        ));
    }
    let valid_scheme = trimmed.starts_with("data:image/")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://");
    if !valid_scheme {
        return Err(AppError::Validation(
            "Server icon must be an image URL or data URL".into(),
        ));
    }
    if trimmed.to_lowercase().starts_with("data:image/svg+xml") {
        return Err(AppError::Validation(
            "SVG images are not allowed for server icons (security)".into(),
        ));
    }
    Ok(Some(trimmed.to_string()))
}

/// POST /api/servers — create a new server.
async fn create_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<Server>, AppError> {
    if body.name.is_empty() || body.name.len() > 100 {
        return Err(AppError::Validation(
            "Server name must be 1-100 characters".into(),
        ));
    }

    let icon_url = validate_server_icon_url(body.icon_url.as_deref())?;

    let server_id = Uuid::new_v4();
    let invite_code = generate_invite_code();

    let server = sqlx::query_as::<_, Server>(
        r#"INSERT INTO servers (id, name, icon_url, owner_id, invite_code, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           RETURNING *"#,
    )
    .bind(server_id)
    .bind(&body.name)
    .bind(&icon_url)
    .bind(claims.sub)
    .bind(&invite_code)
    .fetch_one(&state.db)
    .await?;

    // Add creator as owner member
    sqlx::query(
        "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', NOW())",
    )
    .bind(server_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    // Create default "general" text channel in a shared category.
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'general', 'text', 'General', 0, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .execute(&state.db)
    .await?;

    // Create default "General" voice channel under the same category.
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'General', 'voice', 'General', 1, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .execute(&state.db)
    .await?;

    sqlx::query(
        r#"INSERT INTO server_channel_categories (server_id, name, position)
           VALUES ($1, 'General', 0)
           ON CONFLICT (server_id, name) DO NOTHING"#,
    )
    .bind(server_id)
    .execute(&state.db)
    .await?;

    // Seed a default "Moderator" role for this server (no members yet).
    // Moderators can handle day-to-day moderation but cannot manage server structure/roles.
    let moderator_perms = PERM_MANAGE_MESSAGES
        | PERM_MANAGE_PINS
        | PERM_KICK_MEMBERS
        | PERM_BAN_MEMBERS
        | PERM_MUTE_MEMBERS
        | PERM_DEAFEN_MEMBERS
        | PERM_VIEW_AUDIT_LOG;
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Moderator', '#5865F2', 0, $3)
           ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(moderator_perms)
    .execute(&state.db)
    .await?;

    // Seed default "@everyone" baseline role.
    // Baseline member access: can view server, send messages, and connect voice.
    let everyone_perms = PERM_VIEW_SERVER | PERM_SEND_MESSAGES | PERM_CONNECT_VOICE;
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Everyone', NULL, 9999, $3)
           ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(everyone_perms)
    .execute(&state.db)
    .await?;

    Ok(Json(server))
}

#[derive(Debug, serde::Deserialize)]
struct ListRolesQuery {
    include_system: Option<bool>,
}

/// GET /api/servers/:server_id — get server details with members.
async fn get_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<ServerDetail>, AppError> {
    // Check membership
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if is_member == 0 {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    let mut members = sqlx::query_as::<_, MemberInfo>(
        r#"SELECT sm.user_id,
                  u.username,
                  u.avatar_url,
                  sm.role,
                  u.status,
                  rc.color AS role_color,
                  rr.role_names AS roles
           FROM server_members sm
           INNER JOIN users u ON sm.user_id = u.id
           LEFT JOIN LATERAL (
               SELECT sr.color
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND sr.color IS NOT NULL
               ORDER BY sr.position ASC
               LIMIT 1
           ) rc ON TRUE
           LEFT JOIN LATERAL (
               SELECT COALESCE(
                   ARRAY_AGG(sr.name ORDER BY sr.position ASC),
                   ARRAY[]::text[]
               ) AS role_names
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND LOWER(sr.name) <> 'everyone'
           ) rr ON TRUE
           WHERE sm.server_id = $1
           ORDER BY sm.role ASC, u.username ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    // Use live WebSocket sessions for online/offline (same as friends list).
    for m in &mut members {
        m.status = visible_presence(&m.status, state.sessions.contains_key(&m.user_id));
    }

    // Compute effective permissions for the current user in this server.
    let perms = permissions::get_user_server_permissions(&state.db, server_id, claims.sub).await?;
    let my_permissions = perms.bits();

    Ok(Json(ServerDetail {
        server,
        my_permissions,
        members,
    }))
}

/// GET /api/servers/:server_id/roles — list roles for a server (owner only for now).
async fn list_roles(
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
async fn create_role(
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

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_ROLES,
    )
    .await?;

    // Next position after existing roles.
    let next_position: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM server_roles WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let permissions = body.permissions.unwrap_or(0);
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

    let _ = state
        .tx
        .send(crate::ws::WsEvent::ServerRolesUpdated { server_id });

    Ok(Json(role))
}

/// PATCH /api/servers/:server_id/roles/reorder — update role positions by drag & drop.
async fn reorder_roles(
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

    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_ROLES,
    )
    .await?;

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

    let _ = state
        .tx
        .send(crate::ws::WsEvent::ServerRolesUpdated { server_id });

    Ok(Json(serde_json::json!({ "message": "Roles reordered" })))
}

/// PATCH /api/servers/:server_id/roles/:role_id — update name/permissions (owner only).
async fn update_role(
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

    let _ = state
        .tx
        .send(crate::ws::WsEvent::ServerRolesUpdated { server_id });

    Ok(Json(role))
}

/// DELETE /api/servers/:server_id/roles/:role_id — delete a role (owner only).
async fn delete_role(
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

    let _ = state
        .tx
        .send(crate::ws::WsEvent::ServerRolesUpdated { server_id });

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /api/servers/:server_id/audit-log — list audit log for server (owner/admin only).
async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<AuditLogEntry>>, AppError> {
    // Require VIEW_AUDIT_LOG permission for audit log access.
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_AUDIT_LOG,
    )
    .await?;

    let rows = sqlx::query_as::<_, AuditLogEntry>(
        r#"SELECT a.id, a.at, a.actor_id, a.server_id, a.action, a.resource_type, a.resource_id, a.details,
                  u_actor.username AS actor_username,
                  u_resource.username AS resource_username
           FROM audit_log a
           LEFT JOIN users u_actor ON u_actor.id = a.actor_id
           LEFT JOIN users u_resource ON u_resource.id = a.resource_id
           WHERE a.server_id = $1 ORDER BY a.at DESC LIMIT 500"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// POST /api/servers/join — join a server via invite code.
async fn join_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<JoinServerRequest>,
) -> Result<Json<Server>, AppError> {
    let invite_code = body.invite_code.trim();
    if invite_code.is_empty() || invite_code.len() > 32 {
        return Err(AppError::Validation(
            "Invite code must be 1-32 characters".into(),
        ));
    }
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE invite_code = $1")
        .bind(invite_code)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Invalid invite code".into()))?;

    let is_banned = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_bans WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server.id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if is_banned > 0 {
        return Err(AppError::Forbidden(
            "You are banned from this server".into(),
        ));
    }

    // Check if already a member
    let already_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server.id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if already_member > 0 {
        return Ok(Json(server));
    }

    sqlx::query(
        "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())",
    )
    .bind(server.id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    // Ensure "@everyone" role exists for baseline permissions.
    let everyone_perms = PERM_VIEW_SERVER | PERM_SEND_MESSAGES | PERM_CONNECT_VOICE;
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Everyone', NULL, 9999, $3)
           ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
    )
    .bind(Uuid::new_v4())
    .bind(server.id)
    .bind(everyone_perms)
    .execute(&state.db)
    .await?;

    // Broadcast MemberJoined event
    let _ = state.tx.send(WsEvent::MemberJoined {
        server_id: server.id,
        user_id: claims.sub,
        username: claims.username.clone(),
    });

    Ok(Json(server))
}

/// POST /api/servers/:server_id/leave — leave a server.
async fn leave_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Check if owner (owner cannot leave, must transfer or delete)
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    if server.owner_id == claims.sub {
        return Err(AppError::Forbidden(
            "Server owner cannot leave. Transfer ownership or delete the server.".into(),
        ));
    }

    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

    // Broadcast MemberLeft event
    let _ = state.tx.send(WsEvent::MemberLeft {
        server_id,
        user_id: claims.sub,
    });

    Ok(Json(serde_json::json!({ "message": "Left server" })))
}

/// DELETE /api/servers/:server_id — delete server (owner only).
/// Relies on ON DELETE CASCADE in the database schema.
async fn delete_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    if server.owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "Only the owner can delete the server".into(),
        ));
    }

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "server_delete",
        "server",
        Some(server_id),
        Some(serde_json::json!({ "name": server.name })),
    )
    .await?;

    // Single DELETE — ON DELETE CASCADE handles channels, members, and messages
    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "message": "Server deleted" })))
}

#[derive(Debug, serde::Deserialize)]
struct UpdateServerRequest {
    name: Option<String>,
    icon_url: Option<String>,
    clear_icon: Option<bool>,
}

/// PATCH /api/servers/:server_id — update server metadata (owner only).
async fn update_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<UpdateServerRequest>,
) -> Result<Json<Server>, AppError> {
    let current = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    // Require MANAGE_SERVER permission for server settings changes.
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let mut next_name = current.name.clone();
    if let Some(name) = body.name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 100 {
            return Err(AppError::Validation(
                "Server name must be 1-100 characters".into(),
            ));
        }
        next_name = trimmed.to_string();
    }

    let mut next_icon = current.icon_url.clone();
    if body.clear_icon.unwrap_or(false) {
        next_icon = None;
    } else if let Some(icon_url) = body.icon_url {
        let trimmed = icon_url.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "Server icon URL cannot be empty".into(),
            ));
        }
        next_icon = validate_server_icon_url(Some(trimmed))?;
    }

    let updated = sqlx::query_as::<_, Server>(
        r#"UPDATE servers
           SET name = $1, icon_url = $2
           WHERE id = $3
           RETURNING *"#,
    )
    .bind(next_name)
    .bind(next_icon)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "server_update",
        "server",
        Some(server_id),
        Some(serde_json::json!({
            "old_name": current.name,
            "new_name": updated.name,
            "old_icon": current.icon_url,
            "new_icon": updated.icon_url
        })),
    )
    .await?;

    Ok(Json(updated))
}

/// GET /api/servers/:server_id/channels — list channels for a server.
async fn list_channels(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ChannelWithPermissions>>, AppError> {
    // Check membership
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if is_member == 0 {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let channels = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE server_id = $1 ORDER BY category, position",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let mut visible = Vec::with_capacity(channels.len());
    for channel in channels {
        let perms =
            permissions::get_user_channel_permissions(&state.db, channel.id, claims.sub).await?;
        if perms.contains(Permissions::VIEW_SERVER) {
            visible.push(ChannelWithPermissions {
                id: channel.id,
                server_id: channel.server_id,
                name: channel.name,
                description: channel.description,
                channel_type: channel.channel_type,
                category: channel.category,
                position: channel.position,
                created_at: channel.created_at,
                my_permissions: perms.bits(),
            });
        }
    }

    Ok(Json(visible))
}

#[derive(Debug, serde::Serialize)]
struct ChannelWithPermissions {
    id: Uuid,
    server_id: Uuid,
    name: String,
    description: Option<String>,
    channel_type: String,
    category: Option<String>,
    position: i32,
    created_at: chrono::DateTime<chrono::Utc>,
    my_permissions: i64,
}

/// GET /api/servers/:server_id/channels/:channel_id/members
/// Returns only members who can view the target channel (effective permission scope).
async fn list_channel_visible_members(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<MemberInfo>>, AppError> {
    let channel_server_id: Option<Uuid> =
        sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await?;
    match channel_server_id {
        Some(actual_server_id) if actual_server_id == server_id => {}
        _ => return Err(AppError::NotFound("Channel not found".into())),
    }

    permissions::ensure_channel_permission(
        &state.db,
        channel_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;

    let members = sqlx::query_as::<_, MemberInfo>(
        r#"SELECT sm.user_id,
                  u.username,
                  u.avatar_url,
                  sm.role,
                  u.status,
                  rc.color AS role_color,
                  rr.role_names AS roles
           FROM server_members sm
           INNER JOIN users u ON sm.user_id = u.id
           LEFT JOIN LATERAL (
               SELECT sr.color
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND sr.color IS NOT NULL
               ORDER BY sr.position ASC
               LIMIT 1
           ) rc ON TRUE
           LEFT JOIN LATERAL (
               SELECT COALESCE(
                   ARRAY_AGG(sr.name ORDER BY sr.position ASC),
                   ARRAY[]::text[]
               ) AS role_names
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND LOWER(sr.name) <> 'everyone'
           ) rr ON TRUE
           WHERE sm.server_id = $1
           ORDER BY sm.role ASC, u.username ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let mut visible_members = Vec::with_capacity(members.len());
    for mut member in members {
        let perms =
            permissions::get_user_channel_permissions(&state.db, channel_id, member.user_id)
                .await?;
        if !perms.contains(Permissions::VIEW_SERVER) {
            continue;
        }
        member.status =
            visible_presence(&member.status, state.sessions.contains_key(&member.user_id));
        visible_members.push(member);
    }

    Ok(Json(visible_members))
}

/// PATCH /api/servers/:server_id/members/:user_id/role — owner can make/remove admins.
#[derive(Debug, serde::Deserialize)]
struct UpdateMemberRoleRequest {
    role: String,
}

/// GET /api/servers/:server_id/members/:user_id/roles — list granular roles for a member.
async fn list_member_roles(
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
struct UpdateMemberRolesRequest {
    role_ids: Vec<Uuid>,
}

/// PUT /api/servers/:server_id/members/:user_id/roles — replace granular roles for a member.
async fn update_member_roles(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateMemberRolesRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_ROLES,
    )
    .await?;

    let owner_id: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;

    // Only the server owner themselves may change the owner's roles.
    if owner_id == Some(user_id) && owner_id != Some(claims.sub) {
        return Err(AppError::Forbidden(
            "Only the server owner can change their own roles".into(),
        ));
    }

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

    // Role Hierarchy Security
    let caller_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, claims.sub).await?;
    let target_pos =
        permissions::get_user_highest_role_position(&state.db, server_id, user_id).await?;

    // 1. Cannot modify someone with a higher or equal role.
    if caller_pos >= target_pos && claims.sub != user_id && owner_id != Some(claims.sub) {
        return Err(AppError::Forbidden(
            "You cannot modify the roles of a member with an equal or higher role".into(),
        ));
    }

    // 2. Cannot assign or remove roles that are higher or equal to the caller's highest role.
    // First, check the new roles being assigned.
    for role_id in &body.role_ids {
        let role_row = sqlx::query_as::<_, (i32, String)>(
            "SELECT position, name FROM server_roles WHERE id = $1 AND server_id = $2",
        )
        .bind(role_id)
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;

        let (pos, name) = role_row
            .ok_or_else(|| AppError::Validation("One or more role_ids are invalid".into()))?;

        if name.eq_ignore_ascii_case("everyone") {
            return Err(AppError::Validation(
                "The Everyone role is system-managed and cannot be assigned manually".into(),
            ));
        }

        if caller_pos >= pos && owner_id != Some(claims.sub) {
            return Err(AppError::Forbidden(
                "You cannot assign a role higher or equal to your own highest role".into(),
            ));
        }
    }

    // Then, check the roles being removed (roles they currently have but aren't in the new list).
    let old_role_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    for old_role_id in &old_role_ids {
        if !body.role_ids.contains(old_role_id) {
            let role_row = sqlx::query_as::<_, (i32, String)>(
                "SELECT position, name FROM server_roles WHERE id = $1 AND server_id = $2",
            )
            .bind(old_role_id)
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;

            if let Some((pos, name)) = role_row {
                if name.eq_ignore_ascii_case("everyone") {
                    continue;
                }
                if caller_pos >= pos && owner_id != Some(claims.sub) {
                    return Err(AppError::Forbidden(
                        "You cannot remove a role higher or equal to your own highest role".into(),
                    ));
                }
            }
        }
    }

    let is_owner = owner_id == Some(user_id);

    // Replace all current roles with the provided set.
    sqlx::query("DELETE FROM server_member_roles WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    for role_id in &body.role_ids {
        sqlx::query(
            "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
        )
        .bind(server_id)
        .bind(user_id)
        .bind(*role_id)
        .execute(&state.db)
        .await?;
    }

    // TEMPORARY BRIDGE: keep legacy server_members.role as a simple owner/member flag.
    // All non-owner users are treated as "member"; fine-grained permissions come from roles.
    let new_legacy_role = if is_owner { "owner" } else { "member" };

    sqlx::query("UPDATE server_members SET role = $1 WHERE server_id = $2 AND user_id = $3")
        .bind(new_legacy_role)
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    // Audit log: record granular role changes.
    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_role_change",
        "member",
        Some(user_id),
        Some(serde_json::json!({
            "old_role_ids": old_role_ids,
            "new_role_ids": body.role_ids,
            "legacy_role": new_legacy_role,
        })),
    )
    .await?;

    // Notify clients via WebSocket so member list / badges update without full reload.
    let _ = state.tx.send(WsEvent::MemberRoleUpdated {
        server_id,
        user_id,
        role: new_legacy_role.to_string(),
    });

    Ok(Json(
        serde_json::json!({ "message": "Member roles updated" }),
    ))
}

async fn update_member_role(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Only owner can manage roles
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    if server.owner_id != claims.sub {
        return Err(AppError::Forbidden(
            "Only the server owner can change member roles".into(),
        ));
    }

    // Do not allow changing the owner role via this endpoint
    if user_id == server.owner_id {
        return Err(AppError::Validation(
            "Cannot change the owner's role via this endpoint".into(),
        ));
    }

    if body.role != "admin" && body.role != "member" {
        return Err(AppError::Validation("Invalid role".into()));
    }

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

    let old_role: String =
        sqlx::query_scalar("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;

    sqlx::query("UPDATE server_members SET role = $1 WHERE server_id = $2 AND user_id = $3")
        .bind(&body.role)
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "member_role_change",
        "member",
        Some(user_id),
        Some(serde_json::json!({ "old_role": old_role, "new_role": body.role })),
    )
    .await?;

    let _ = state.tx.send(WsEvent::MemberRoleUpdated {
        server_id,
        user_id,
        role: body.role.clone(),
    });

    Ok(Json(serde_json::json!({ "message": "Role updated" })))
}

async fn ban_member(
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
        let _ = state.tx.send(WsEvent::MemberLeft { server_id, user_id });
    }

    Ok(Json(serde_json::json!({
        "message": "Member banned",
        "removed_member": removed_member
    })))
}

async fn report_user(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReportUserRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;

    if body.reported_user_id == claims.sub {
        return Err(AppError::Validation("Cannot report yourself".into()));
    }

    let reason = normalize_report_reason(&body.reason)?;
    let details = normalize_report_details(body.details.as_deref())?;

    let member_exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(body.reported_user_id)
    .fetch_one(&state.db)
    .await?;
    if member_exists == 0 {
        return Err(AppError::NotFound("Member not found".into()));
    }

    sqlx::query(
        r#"INSERT INTO server_reports (
                id, server_id, reporter_user_id, reported_user_id, reason, details, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(claims.sub)
    .bind(body.reported_user_id)
    .bind(reason)
    .bind(details)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "message": "Report submitted" })))
}

async fn report_message(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReportMessageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;

    let reason = normalize_report_reason(&body.reason)?;
    let details = normalize_report_details(body.details.as_deref())?;

    let row = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"SELECT m.user_id,
                  m.channel_id,
                  LEFT(m.content, 280) AS excerpt
           FROM messages m
           INNER JOIN channels c ON c.id = m.channel_id
           WHERE m.id = $1 AND c.server_id = $2"#,
    )
    .bind(body.message_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Message not found".into()))?;

    let (reported_user_id, channel_id, message_excerpt) = row;
    if reported_user_id == claims.sub {
        return Err(AppError::Validation("Cannot report your own message".into()));
    }

    sqlx::query(
        r#"INSERT INTO server_reports (
                id, server_id, reporter_user_id, reported_user_id, channel_id, message_id, message_excerpt, reason, details, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(claims.sub)
    .bind(reported_user_id)
    .bind(channel_id)
    .bind(body.message_id)
    .bind(message_excerpt)
    .bind(reason)
    .bind(details)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "message": "Report submitted" })))
}

async fn list_reports(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerReportEntry>>, AppError> {
    if permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_AUDIT_LOG,
    )
    .await
    .is_err()
        && permissions::ensure_server_permission(
            &state.db,
            server_id,
            claims.sub,
            Permissions::BAN_MEMBERS,
        )
        .await
        .is_err()
    {
        return Err(AppError::Forbidden("Missing permission to view reports".into()));
    }

    let rows = sqlx::query_as::<_, ServerReportEntry>(
        r#"SELECT sr.id,
                  sr.server_id,
                  sr.reporter_user_id,
                  reporter.username AS reporter_username,
                  sr.reported_user_id,
                  reported.username AS reported_username,
                  sr.channel_id,
                  c.name AS channel_name,
                  sr.message_id,
                  sr.message_excerpt,
                  sr.reason,
                  sr.details,
                  sr.status,
                  sr.created_at,
                  sr.resolved_at,
                  sr.resolved_by,
                  resolver.username AS resolved_by_username
           FROM server_reports sr
           INNER JOIN users reporter ON reporter.id = sr.reporter_user_id
           INNER JOIN users reported ON reported.id = sr.reported_user_id
           LEFT JOIN users resolver ON resolver.id = sr.resolved_by
           LEFT JOIN channels c ON c.id = sr.channel_id
           WHERE sr.server_id = $1
           ORDER BY
             CASE WHEN sr.status = 'open' THEN 0 ELSE 1 END,
             sr.created_at DESC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

async fn resolve_report(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, report_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_AUDIT_LOG,
    )
    .await
    .is_err()
        && permissions::ensure_server_permission(
            &state.db,
            server_id,
            claims.sub,
            Permissions::BAN_MEMBERS,
        )
        .await
        .is_err()
    {
        return Err(AppError::Forbidden("Missing permission to resolve reports".into()));
    }

    let reported_user_id = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE server_reports
           SET status = 'resolved', resolved_at = NOW(), resolved_by = $3
           WHERE id = $1 AND server_id = $2
           RETURNING reported_user_id"#,
    )
    .bind(report_id)
    .bind(server_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Report not found".into()))?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "report_resolve",
        "report",
        Some(reported_user_id),
        Some(serde_json::json!({ "report_id": report_id })),
    )
    .await?;

    Ok(Json(serde_json::json!({ "message": "Report resolved" })))
}

async fn list_bans(
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

async fn unban_member(
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
async fn kick_member(
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
    let target_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;

    let target_role = match target_role {
        Some(r) => r,
        None => return Err(AppError::NotFound("Member not found".into())),
    };

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
        Some(serde_json::json!({ "target_role": target_role })),
    )
    .await?;

    let _ = state.tx.send(WsEvent::MemberLeft { server_id, user_id });

    Ok(Json(serde_json::json!({ "message": "Member kicked" })))
}
