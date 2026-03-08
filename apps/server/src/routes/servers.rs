use axum::{
    extract::{Path, State},
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
        ServerWithMembers,
    },
    services::{audit, auth::generate_invite_code},
    ws::WsEvent,
    AppState,
};

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
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_servers).post(create_server))
        .route("/{server_id}", get(get_server).delete(delete_server).patch(update_server))
        .route("/{server_id}/channels", get(list_channels))
        .route("/{server_id}/members/{user_id}/role", patch(update_member_role))
        .route("/{server_id}/members/{user_id}", delete(kick_member))
        .route("/{server_id}/audit-log", get(get_audit_log))
        .route("/join", post(join_server))
        .route("/{server_id}/leave", post(leave_server))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
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
        return Err(AppError::Validation("Server icon image is too large".into()));
    }
    let valid_scheme =
        trimmed.starts_with("data:image/") || trimmed.starts_with("http://") || trimmed.starts_with("https://");
    if !valid_scheme {
        return Err(AppError::Validation("Server icon must be an image URL or data URL".into()));
    }
    if trimmed.to_lowercase().starts_with("data:image/svg+xml") {
        return Err(AppError::Validation("SVG images are not allowed for server icons (security)".into()));
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

    // Create default "general" text channel
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'general', 'text', 'Text Channels', 0, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .execute(&state.db)
    .await?;

    // Create default "General" voice channel
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'General', 'voice', 'Voice Channels', 0, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .execute(&state.db)
    .await?;

    Ok(Json(server))
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
        r#"SELECT sm.user_id, u.username, u.avatar_url, sm.role, u.status
           FROM server_members sm
           INNER JOIN users u ON sm.user_id = u.id
           WHERE sm.server_id = $1
           ORDER BY sm.role ASC, u.username ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    // Use live WebSocket sessions for online/offline (same as friends list).
    for m in &mut members {
        if !state.sessions.contains_key(&m.user_id) {
            m.status = "offline".to_string();
        }
    }

    Ok(Json(ServerDetail { server, members }))
}

/// GET /api/servers/:server_id/audit-log — list audit log for server (owner/admin only).
async fn get_audit_log(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<AuditLogEntry>>, AppError> {
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;

    let role = role.ok_or(AppError::Forbidden("Not a member of this server".into()))?;
    if role != "owner" && role != "moderator" {
        return Err(AppError::Forbidden(
            "Only server owner or moderator can view audit log".into(),
        ));
    }

    let rows = sqlx::query_as::<_, AuditLogEntry>(
        "SELECT id, at, actor_id, server_id, action, resource_type, resource_id, details
         FROM audit_log WHERE server_id = $1 ORDER BY at DESC LIMIT 500",
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
        return Err(AppError::Validation("Invite code must be 1-32 characters".into()));
    }
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE invite_code = $1")
        .bind(invite_code)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Invalid invite code".into()))?;

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
        return Err(AppError::Forbidden("Only the owner can delete the server".into()));
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

    if current.owner_id != claims.sub {
        return Err(AppError::Forbidden("Only the owner can update server settings".into()));
    }

    let mut next_name = current.name.clone();
    if let Some(name) = body.name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 100 {
            return Err(AppError::Validation("Server name must be 1-100 characters".into()));
        }
        next_name = trimmed.to_string();
    }

    let mut next_icon = current.icon_url.clone();
    if body.clear_icon.unwrap_or(false) {
        next_icon = None;
    } else if let Some(icon_url) = body.icon_url {
        let trimmed = icon_url.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("Server icon URL cannot be empty".into()));
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

    Ok(Json(updated))
}

/// GET /api/servers/:server_id/channels — list channels for a server.
async fn list_channels(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Channel>>, AppError> {
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

    Ok(Json(channels))
}

/// PATCH /api/servers/:server_id/members/:user_id/role — owner can make/remove admins.
#[derive(Debug, serde::Deserialize)]
struct UpdateMemberRoleRequest {
    role: String,
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

    if body.role != "moderator" && body.role != "member" {
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

    let old_role: String = sqlx::query_scalar(
        "SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "UPDATE server_members SET role = $1 WHERE server_id = $2 AND user_id = $3",
    )
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

/// DELETE /api/servers/:server_id/members/:user_id — kick a member (owner or moderator).
async fn kick_member(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    if claims.sub == user_id {
        return Err(AppError::Validation("Cannot kick yourself".into()));
    }

    let _server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Server not found".into()))?;

    let caller_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;

    let caller_role = caller_role.ok_or(AppError::Forbidden("Not a member of this server".into()))?;

    if caller_role != "owner" && caller_role != "moderator" {
        return Err(AppError::Forbidden(
            "Only the owner or a moderator can kick members".into(),
        ));
    }

    let target_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    let target_role = match target_role {
        Some(r) => r,
        None => return Err(AppError::NotFound("Member not found".into())),
    };

    if target_role == "owner" {
        return Err(AppError::Forbidden("Cannot kick the server owner".into()));
    }

    if caller_role == "moderator" && target_role != "member" {
        return Err(AppError::Forbidden(
            "Moderators can only kick members, not other moderators".into(),
        ));
    }

    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let _ = state.tx.send(WsEvent::MemberLeft {
        server_id,
        user_id,
    });

    Ok(Json(serde_json::json!({ "message": "Member kicked" })))
}
