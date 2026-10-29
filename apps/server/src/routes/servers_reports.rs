//! User and message reports.
use super::*;

#[derive(Debug, serde::Deserialize)]
pub(super) struct ReportUserRequest {
    pub(super) reported_user_id: Uuid,
    pub(super) reason: String,
    pub(super) details: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct ReportMessageRequest {
    pub(super) message_id: Uuid,
    pub(super) reason: String,
    pub(super) details: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ServerReportEntry {
    pub(super) id: Uuid,
    pub(super) server_id: Uuid,
    pub(super) reporter_user_id: Uuid,
    pub(super) reporter_username: String,
    pub(super) reported_user_id: Uuid,
    pub(super) reported_username: String,
    pub(super) channel_id: Option<Uuid>,
    pub(super) channel_name: Option<String>,
    pub(super) message_id: Option<Uuid>,
    pub(super) message_excerpt: Option<String>,
    pub(super) reason: String,
    pub(super) details: Option<String>,
    pub(super) status: String,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
    pub(super) resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub(super) resolved_by: Option<Uuid>,
    pub(super) resolved_by_username: Option<String>,
}

pub(super) fn normalize_report_reason(reason: &str) -> Result<String, AppError> {
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

pub(super) fn normalize_report_details(details: Option<&str>) -> Result<Option<String>, AppError> {
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

pub(super) async fn enforce_report_submit_rate_limit(
    state: &Arc<AppState>,
    server_id: Uuid,
    reporter_user_id: Uuid,
) -> Result<(), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("reports:submit:{server_id}:{reporter_user_id}"),
        REPORT_SUBMIT_RATE_LIMIT_MAX,
        REPORT_SUBMIT_RATE_LIMIT_WINDOW,
        "Too many report submissions. Please wait a moment and try again.",
    )
    .await
}

pub(super) async fn report_user(
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

    enforce_report_submit_rate_limit(&state, server_id, claims.sub).await?;

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

    let inserted_report_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO server_reports (
                id, server_id, reporter_user_id, reported_user_id, reason, details, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(claims.sub)
    .bind(body.reported_user_id)
    .bind(reason)
    .bind(details)
    .fetch_optional(&state.db)
    .await?;

    let message = if inserted_report_id.is_some() {
        "Report submitted"
    } else {
        "Report already submitted"
    };
    Ok(Json(serde_json::json!({ "message": message })))
}

pub(super) async fn report_message(
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

    enforce_report_submit_rate_limit(&state, server_id, claims.sub).await?;

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
    // A message in a channel the reporter cannot see is reported as missing, so the endpoint
    // neither confirms it exists nor copies its text into the report.
    if !permissions::get_user_channel_permissions(&state.db, channel_id, claims.sub)
        .await?
        .contains(Permissions::VIEW_SERVER)
    {
        return Err(AppError::NotFound("Message not found".into()));
    }
    if reported_user_id == claims.sub {
        return Err(AppError::Validation(
            "Cannot report your own message".into(),
        ));
    }

    let inserted_report_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO server_reports (
                id, server_id, reporter_user_id, reported_user_id, channel_id, message_id, message_excerpt, reason, details, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id"#,
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
    .fetch_optional(&state.db)
    .await?;

    let message = if inserted_report_id.is_some() {
        "Report submitted"
    } else {
        "Report already submitted"
    };
    Ok(Json(serde_json::json!({ "message": message })))
}

/// Audit fields that quote message text.
pub(super) const QUOTED_CONTENT_KEYS: [&str; 3] =
    ["before_preview", "after_preview", "content_preview"];

/// Whether a moderator may read message text quoted from a channel. Each distinct channel is
/// checked once per request.
pub(super) struct ChannelReadAccess {
    pub(super) user_id: Uuid,
    pub(super) known: HashMap<Uuid, bool>,
}

impl ChannelReadAccess {
    pub(super) fn new(user_id: Uuid) -> Self {
        Self {
            user_id,
            known: HashMap::new(),
        }
    }

    pub(super) async fn allows(&mut self, db: &sqlx::PgPool, channel_id: Uuid) -> bool {
        if let Some(allowed) = self.known.get(&channel_id) {
            return *allowed;
        }
        // A deleted channel keeps its restrictions: who could read it can no longer be
        // checked, so what was quoted from it stays hidden.
        let allowed = matches!(
            permissions::get_user_channel_permissions(db, channel_id, self.user_id).await,
            Ok(perms) if perms.contains(Permissions::VIEW_SERVER)
        );
        self.known.insert(channel_id, allowed);
        allowed
    }
}

pub(super) async fn list_reports(
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
        return Err(AppError::Forbidden(
            "Missing permission to view reports".into(),
        ));
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
             sr.created_at DESC
           LIMIT $2"#,
    )
    .bind(server_id)
    .bind(REPORT_LIST_LIMIT)
    .fetch_all(&state.db)
    .await?;

    let mut rows = rows;
    let mut access = ChannelReadAccess::new(claims.sub);
    for row in &mut rows {
        // Deleting the channel clears `channel_id`; its quote is hidden like any unreadable one.
        let readable = match row.channel_id {
            Some(channel_id) => access.allows(&state.db, channel_id).await,
            None => false,
        };
        if !readable {
            row.message_excerpt = None;
        }
    }

    Ok(Json(rows))
}

pub(super) async fn resolve_report(
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
        return Err(AppError::Forbidden(
            "Missing permission to resolve reports".into(),
        ));
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
