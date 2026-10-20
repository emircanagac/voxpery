use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::HeaderMap,
    middleware,
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use chrono::{Duration as ChronoDuration, Utc};
use sqlx::{Postgres, QueryBuilder};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::{net::SocketAddr, time::Duration};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth_and_current_legal_consent, Claims},
    models::{
        Channel, CreateServerRequest, JoinServerRequest, MemberInfo, Server, ServerDetail,
        ServerInvitePreview, ServerOnboardingGuide, ServerRule, ServerWithMembers,
        UpdateServerOnboardingGuideRequest, UpdateServerRuleRequest,
    },
    routes::auth::DEFAULT_SERVER_INVITE_CODE,
    services::{
        audit,
        auth::generate_invite_code,
        automod::AutoModRule,
        avatar_images::validate_server_icon_image_url,
        client_ip::resolve_client_ip,
        idempotency::{acquire_transaction_lock, normalize_client_request_id},
        moderation::{self, RaidEventEntry, ServerTimeoutEntry},
        permissions::{self, Permissions},
        rate_limit::enforce_rate_limit,
        voice_revoke,
    },
    ws::WsEvent,
    AppState,
};

#[path = "servers_roles.rs"]
mod roles;
use roles::*;
#[path = "servers_member_moderation.rs"]
mod member_moderation;
use member_moderation::*;
#[path = "servers_automod.rs"]
mod automod;
use automod::*;
#[path = "servers_reports.rs"]
mod reports;
use reports::*;
#[path = "servers_onboarding.rs"]
mod onboarding;
use onboarding::*;

// Permission bits (kept here for documentation; must stay in sync with services::permissions::Permissions).
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
const PERM_MOVE_MEMBERS: i64 = 1 << 13;
const MAX_REORDER_ROLE_IDS: usize = 512;
const MAX_ONBOARDING_CHANNELS: usize = 6;
const MAX_ONBOARDING_TASKS: usize = 6;
const MAX_ONBOARDING_TITLE_CHARS: usize = 80;
const MAX_ONBOARDING_BODY_CHARS: usize = 1000;
const MAX_ONBOARDING_TASK_CHARS: usize = 120;
const REPORT_SUBMIT_RATE_LIMIT_MAX: usize = 5;
const REPORT_SUBMIT_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const REPORT_LIST_LIMIT: i64 = 200;

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/invite/{invite_code}", get(get_invite_preview))
        .route("/invite/{invite_code}/rules", get(list_invite_rules))
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
                .route("/{server_id}/members/{user_id}/ban", post(ban_member))
                .route(
                    "/{server_id}/members/{user_id}/timeout",
                    post(timeout_member).delete(clear_member_timeout),
                )
                .route("/{server_id}/members/{user_id}", delete(kick_member))
                .route("/{server_id}/bans", get(list_bans))
                .route("/{server_id}/bans/{user_id}", delete(unban_member))
                .route("/{server_id}/timeouts", get(list_active_timeouts))
                .route("/{server_id}/raid-events", get(list_raid_events))
                .route("/{server_id}/reports", get(list_reports))
                .route("/{server_id}/reports/user", post(report_user))
                .route("/{server_id}/reports/message", post(report_message))
                .route(
                    "/{server_id}/automod-rules",
                    get(list_automod_rules).post(create_automod_rule),
                )
                .route(
                    "/{server_id}/automod-rules/{rule_id}",
                    patch(update_automod_rule).delete(delete_automod_rule),
                )
                .route(
                    "/{server_id}/rules",
                    get(list_server_rules).post(create_server_rule),
                )
                .route(
                    "/{server_id}/onboarding",
                    get(get_server_onboarding_guide).patch(update_server_onboarding_guide),
                )
                .route(
                    "/{server_id}/rules/{rule_id}",
                    patch(update_server_rule).delete(delete_server_rule),
                )
                .route(
                    "/{server_id}/reports/{report_id}/resolve",
                    post(resolve_report),
                )
                .route("/{server_id}/audit-log", get(get_audit_log))
                .route("/join", post(join_server))
                .route("/{server_id}/leave", post(leave_server))
                .route_layer(middleware::from_fn_with_state(
                    state,
                    require_auth_and_current_legal_consent,
                )),
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

fn extract_client_ip(
    state: &AppState,
    headers: &HeaderMap,
    connect_info: Option<&ConnectInfo<SocketAddr>>,
) -> Option<String> {
    resolve_client_ip(
        headers,
        connect_info.map(|info| info.ip()),
        &state.trusted_proxies,
    )
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

    let mut preview = sqlx::query_as::<_, ServerInvitePreview>(
        r#"SELECT s.id, s.name, s.icon_url, s.description, s.invite_code, COUNT(sm.user_id) AS member_count
           FROM servers s
           LEFT JOIN server_members sm ON sm.server_id = s.id
           WHERE s.invite_code = $1
           GROUP BY s.id, s.name, s.icon_url, s.description, s.invite_code"#,
    )
    .bind(code)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Invalid invite code".into()))?;
    preview.icon_grant = preview.icon_url.as_deref().map(|icon_url| {
        crate::services::image_proxy_grant::current_image_grant(&state.jwt_secret, icon_url)
    });

    Ok(Json(preview))
}

/// GET /api/servers — list all servers the user is a member of.
/// Uses a single JOIN+GROUP BY query instead of N+1.
async fn list_servers(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ServerWithMembers>>, AppError> {
    let rows = sqlx::query_as::<_, ServerWithMembers>(
        r#"SELECT s.id, s.name, s.icon_url, s.description, s.owner_id, s.invite_code, s.created_at,
                  COUNT(sm2.user_id) as member_count
           FROM servers s
           INNER JOIN server_members sm ON s.id = sm.server_id
           INNER JOIN server_members sm2 ON s.id = sm2.server_id
           WHERE sm.user_id = $1
           GROUP BY s.id, s.name, s.icon_url, s.description, s.owner_id, s.invite_code, s.created_at
           ORDER BY MIN(sm.joined_at) ASC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows))
}

/// Validates server icon URL to prevent XSS, SSRF, and oversized stored image payloads.
fn validate_server_icon_url(icon_url: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(url) = icon_url else {
        return Ok(None);
    };
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Ok(Some(validate_server_icon_image_url(trimmed)?))
}

/// POST /api/servers — create a new server.
async fn create_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<Server>, AppError> {
    if body.name.is_empty() || body.name.chars().count() > 100 {
        return Err(AppError::Validation(
            "Server name must be 1-100 characters".into(),
        ));
    }

    let icon_url = validate_server_icon_url(body.icon_url.as_deref())?;
    let client_request_id = normalize_client_request_id(body.client_request_id.as_deref())?;

    let server_id = Uuid::new_v4();
    let invite_code = generate_invite_code();
    let mut tx = state.db.begin().await?;

    if let Some(request_id) = client_request_id.as_deref() {
        acquire_transaction_lock(
            &mut tx,
            &format!("server-create:{}:{}", claims.sub, request_id),
        )
        .await?;
        let existing = sqlx::query_as::<_, Server>(
            "SELECT * FROM servers WHERE owner_id = $1 AND client_request_id = $2",
        )
        .bind(claims.sub)
        .bind(request_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing {
            if existing.name != body.name
                || existing.icon_url != icon_url
                || existing.description != body.description
            {
                return Err(AppError::Conflict(
                    "client_request_id was already used for a different server".into(),
                ));
            }
            tx.commit().await?;
            return Ok(Json(existing));
        }
    }

    let server = sqlx::query_as::<_, Server>(
        r#"INSERT INTO servers (
               id, name, icon_url, description, owner_id, invite_code, client_request_id, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING *"#,
    )
    .bind(server_id)
    .bind(&body.name)
    .bind(&icon_url)
    .bind(&body.description)
    .bind(claims.sub)
    .bind(&invite_code)
    .bind(&client_request_id)
    .fetch_one(&mut *tx)
    .await?;

    // Add creator as owner member
    sqlx::query(
        "INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, NOW())",
    )
    .bind(server_id)
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    // Create default "general" text channel in a shared category.
    let text_channel_id = Uuid::new_v4();
    let voice_channel_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'general', 'text', 'General', 0, NOW())"#,
    )
    .bind(text_channel_id)
    .bind(server_id)
    .execute(&mut *tx)
    .await?;

    // Create default "General" voice channel under the same category.
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'General', 'voice', 'General', 1, NOW())"#,
    )
    .bind(voice_channel_id)
    .bind(server_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO server_onboarding_guides
           (server_id, enabled, title, body, recommended_channel_ids, starter_tasks, updated_at)
           VALUES ($1, FALSE, '', '', ARRAY[]::UUID[], ARRAY[]::TEXT[], NOW())"#,
    )
    .bind(server_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"INSERT INTO server_channel_categories (server_id, name, position)
           VALUES ($1, 'General', 0)
           ON CONFLICT (server_id, name) DO NOTHING"#,
    )
    .bind(server_id)
    .execute(&mut *tx)
    .await?;

    // Seed a default "Moderator" role for this server (no members yet).
    // Moderators can handle day-to-day moderation but cannot manage server structure/roles.
    let moderator_perms = PERM_MANAGE_MESSAGES
        | PERM_MANAGE_PINS
        | PERM_KICK_MEMBERS
        | PERM_BAN_MEMBERS
        | PERM_MUTE_MEMBERS
        | PERM_DEAFEN_MEMBERS
        | PERM_MOVE_MEMBERS
        | PERM_VIEW_AUDIT_LOG;
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Moderator', '#5865F2', 0, $3)
           ON CONFLICT (server_id, LOWER(name)) DO NOTHING"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(moderator_perms)
    .execute(&mut *tx)
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
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

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
        r#"SELECT sm.user_id,
                  u.username,
                  public_avatar_url(u.id, u.avatar_version, u.avatar_url) AS avatar_url,
                  u.about_me,
                  CASE WHEN sm.user_id = $2 THEN 'owner' ELSE 'member' END AS role,
                  u.status,
                  u.created_at AS account_created_at,
                  sm.joined_at AS server_joined_at,
                  rc.color AS role_color,
                  rr.role_names AS roles,
                  CASE
                      WHEN sm.user_id = $2 THEN -1
                      ELSE COALESCE(rp.highest_role_position, 2147483647)
                  END AS highest_role_position,
                  tm.timed_out_until
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
           LEFT JOIN LATERAL (
               SELECT MIN(sr.position) AS highest_role_position
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND LOWER(sr.name) <> 'everyone'
           ) rp ON TRUE
           LEFT JOIN server_member_timeouts tm
               ON tm.server_id = sm.server_id
              AND tm.user_id = sm.user_id
              AND tm.timed_out_until > NOW()
           WHERE sm.server_id = $1
           ORDER BY sm.user_id = $2 ASC, u.username ASC"#,
    )
    .bind(server_id)
    .bind(server.owner_id)
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

/// POST /api/servers/join — join a server via invite code.
async fn join_server(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<JoinServerRequest>,
) -> Result<Json<Server>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("servers:join:user:{}", claims.sub),
        5,
        Duration::from_secs(60),
        "Too many invite join attempts. Please wait a moment and try again.",
    )
    .await?;

    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );
    if let Some(ref ip) = client_ip {
        enforce_rate_limit(
            &state.redis,
            format!("servers:join:ip:{ip}"),
            5,
            Duration::from_secs(60),
            "Too many invite join attempts from this IP. Please wait and try again.",
        )
        .await?;
    }

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
        "INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, NOW())",
    )
    .bind(server.id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    if let Err(err) = moderation::record_join_raid_signal(
        &state.redis,
        &state.db,
        server.id,
        claims.sub,
        client_ip.clone(),
    )
    .await
    {
        tracing::warn!("Failed to record join raid signal: {err}");
    }

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

    // Claims can outlive a profile rename; broadcast the current display casing.
    let current_username =
        sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
            .bind(claims.sub)
            .fetch_one(&state.db)
            .await?;

    // Broadcast MemberJoined event
    crate::ws::publish_event(
        &state,
        WsEvent::MemberJoined {
            server_id: server.id,
            user_id: claims.sub,
            username: current_username,
        },
    )
    .await;

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

    if server.invite_code == DEFAULT_SERVER_INVITE_CODE {
        return Err(AppError::Forbidden(
            "Members cannot leave the Voxpery community server".into(),
        ));
    }

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
    crate::ws::publish_event(
        &state,
        WsEvent::MemberLeft {
            server_id,
            user_id: claims.sub,
            reason: None,
        },
    )
    .await;
    // The leaving account's other clients (e.g. desktop while leaving on the web) drop it too.
    crate::ws::publish_user_event(
        &state,
        claims.sub,
        WsEvent::MemberLeft {
            server_id,
            user_id: claims.sub,
            reason: Some("left".into()),
        },
    )
    .await;
    // Membership is gone, so voice in this server ends as well.
    if let Err(error) = voice_revoke::revoke_user_voice_access_for_server(
        &state,
        server_id,
        claims.sub,
        "member left server",
    )
    .await
    {
        tracing::warn!(
            "Voice revoke after leaving server {} failed: {}",
            server_id,
            error
        );
    }

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

    // Collected first: the cascade below removes the channels and memberships.
    let voice_channel_ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice'",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let member_ids =
        sqlx::query_scalar::<_, Uuid>("SELECT user_id FROM server_members WHERE server_id = $1")
            .bind(server_id)
            .fetch_all(&state.db)
            .await?;

    // Single DELETE — ON DELETE CASCADE handles channels, members, and messages
    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&state.db)
        .await?;

    voice_revoke::close_voice_rooms(&state, &voice_channel_ids, "server deleted").await;
    // Every former member drops the server, as after leaving it.
    for user_id in member_ids {
        crate::ws::publish_user_event(
            &state,
            user_id,
            WsEvent::MemberLeft {
                server_id,
                user_id,
                reason: Some("deleted".into()),
            },
        )
        .await;
    }

    Ok(Json(serde_json::json!({ "message": "Server deleted" })))
}

#[derive(Debug, serde::Deserialize)]
struct UpdateServerRequest {
    name: Option<String>,
    icon_url: Option<String>,
    description: Option<String>,
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
        if trimmed.is_empty() || trimmed.chars().count() > 100 {
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

    let mut next_description = current.description.clone();
    if let Some(description) = body.description {
        let trimmed = description.trim();
        if trimmed.len() > 500 {
            return Err(AppError::Validation(
                "Server description must be under 500 characters".into(),
            ));
        }
        next_description = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    let updated = sqlx::query_as::<_, Server>(
        r#"UPDATE servers
           SET name = $1, icon_url = $2, description = $3
           WHERE id = $4
           RETURNING *"#,
    )
    .bind(next_name)
    .bind(next_icon)
    .bind(next_description)
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

    let snapshot =
        permissions::ServerPermissionSnapshot::load(&state.db, server_id, Some(&[claims.sub]))
            .await?;
    let mut visible = Vec::with_capacity(channels.len());
    for channel in channels {
        let perms = snapshot.channel_permissions(channel.id, claims.sub);
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
                  public_avatar_url(u.id, u.avatar_version, u.avatar_url) AS avatar_url,
                  u.about_me,
                  CASE WHEN sm.user_id = s.owner_id THEN 'owner' ELSE 'member' END AS role,
                  u.status,
                  u.created_at AS account_created_at,
                  sm.joined_at AS server_joined_at,
                  rc.color AS role_color,
                  rr.role_names AS roles,
                  CASE
                      WHEN sm.user_id = s.owner_id THEN -1
                      ELSE COALESCE(rp.highest_role_position, 2147483647)
                  END AS highest_role_position,
                  tm.timed_out_until
           FROM server_members sm
           INNER JOIN servers s ON s.id = sm.server_id
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
           LEFT JOIN LATERAL (
               SELECT MIN(sr.position) AS highest_role_position
               FROM server_member_roles smr2
               INNER JOIN server_roles sr ON sr.id = smr2.role_id
               WHERE smr2.server_id = sm.server_id
                 AND smr2.user_id = sm.user_id
                 AND LOWER(sr.name) <> 'everyone'
           ) rp ON TRUE
           LEFT JOIN server_member_timeouts tm
               ON tm.server_id = sm.server_id
              AND tm.user_id = sm.user_id
              AND tm.timed_out_until > NOW()
           WHERE sm.server_id = $1
           ORDER BY sm.user_id = s.owner_id ASC, u.username ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let snapshot = permissions::ServerPermissionSnapshot::load(&state.db, server_id, None).await?;
    let mut visible_members = Vec::with_capacity(members.len());
    for mut member in members {
        let perms = snapshot.channel_permissions(channel_id, member.user_id);
        if !perms.contains(Permissions::VIEW_SERVER) {
            continue;
        }
        member.status =
            visible_presence(&member.status, state.sessions.contains_key(&member.user_id));
        visible_members.push(member);
    }

    Ok(Json(visible_members))
}
