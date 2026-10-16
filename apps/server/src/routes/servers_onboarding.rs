//! Server onboarding guide and server rules.
use super::*;

pub(super) fn default_onboarding_guide(server_id: Uuid) -> ServerOnboardingGuide {
    ServerOnboardingGuide {
        server_id,
        enabled: false,
        title: String::new(),
        body: String::new(),
        recommended_channel_ids: Vec::new(),
        starter_tasks: Vec::new(),
        updated_at: Utc::now(),
    }
}

pub(super) fn validate_onboarding_text(
    value: Option<String>,
    fallback: String,
    max_chars: usize,
    field_name: &str,
) -> Result<String, AppError> {
    let value = value.unwrap_or(fallback).trim().to_string();
    if value.chars().count() > max_chars {
        return Err(AppError::Validation(format!(
            "{field_name} must be {max_chars} characters or fewer"
        )));
    }
    Ok(value)
}

pub(super) fn validate_onboarding_tasks(
    tasks: Option<Vec<String>>,
    fallback: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let raw_tasks = tasks.unwrap_or(fallback);
    if raw_tasks.len() > MAX_ONBOARDING_TASKS {
        return Err(AppError::Validation(format!(
            "Starter tasks cannot include more than {MAX_ONBOARDING_TASKS} items"
        )));
    }

    let mut normalized = Vec::new();
    for task in raw_tasks {
        let trimmed = task.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_ONBOARDING_TASK_CHARS {
            return Err(AppError::Validation(format!(
                "Starter tasks must be {MAX_ONBOARDING_TASK_CHARS} characters or fewer"
            )));
        }
        normalized.push(trimmed.to_string());
    }

    Ok(normalized)
}

pub(super) async fn validate_onboarding_channels(
    state: &AppState,
    server_id: Uuid,
    channel_ids: Option<Vec<Uuid>>,
    fallback: Vec<Uuid>,
) -> Result<Vec<Uuid>, AppError> {
    let raw_channel_ids = channel_ids.unwrap_or(fallback);
    if raw_channel_ids.len() > MAX_ONBOARDING_CHANNELS {
        return Err(AppError::Validation(format!(
            "Recommended channels cannot include more than {MAX_ONBOARDING_CHANNELS} channels"
        )));
    }

    let mut deduped = Vec::new();
    for channel_id in raw_channel_ids {
        if !deduped.contains(&channel_id) {
            deduped.push(channel_id);
        }
    }

    if deduped.is_empty() {
        return Ok(deduped);
    }

    let valid_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = $1 AND id = ANY($2)")
            .bind(server_id)
            .bind(&deduped)
            .fetch_one(&state.db)
            .await?;

    if valid_count as usize != deduped.len() {
        return Err(AppError::Validation(
            "Recommended channels must belong to this server".into(),
        ));
    }

    Ok(deduped)
}

pub(super) async fn load_onboarding_guide(
    state: &AppState,
    server_id: Uuid,
) -> Result<ServerOnboardingGuide, AppError> {
    let guide = sqlx::query_as::<_, ServerOnboardingGuide>(
        r#"SELECT server_id, enabled, title, body, recommended_channel_ids, starter_tasks, updated_at
           FROM server_onboarding_guides
           WHERE server_id = $1"#,
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;

    Ok(guide.unwrap_or_else(|| default_onboarding_guide(server_id)))
}

/// GET /api/servers/:server_id/onboarding - get the server welcome guide for members.
pub(super) async fn get_server_onboarding_guide(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<ServerOnboardingGuide>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;

    Ok(Json(load_onboarding_guide(&state, server_id).await?))
}

/// PATCH /api/servers/:server_id/onboarding - update the server welcome guide.
pub(super) async fn update_server_onboarding_guide(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<UpdateServerOnboardingGuideRequest>,
) -> Result<Json<ServerOnboardingGuide>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let existing = load_onboarding_guide(&state, server_id).await?;
    let title = validate_onboarding_text(
        body.title,
        existing.title,
        MAX_ONBOARDING_TITLE_CHARS,
        "Welcome title",
    )?;
    let body_text = validate_onboarding_text(
        body.body,
        existing.body,
        MAX_ONBOARDING_BODY_CHARS,
        "Welcome text",
    )?;
    let starter_tasks = validate_onboarding_tasks(body.starter_tasks, existing.starter_tasks)?;
    let recommended_channel_ids = validate_onboarding_channels(
        &state,
        server_id,
        body.recommended_channel_ids,
        existing.recommended_channel_ids,
    )
    .await?;
    let enabled = body.enabled.unwrap_or(existing.enabled);

    let guide = sqlx::query_as::<_, ServerOnboardingGuide>(
        r#"INSERT INTO server_onboarding_guides (
               server_id, enabled, title, body, recommended_channel_ids, starter_tasks, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (server_id) DO UPDATE SET
               enabled = EXCLUDED.enabled,
               title = EXCLUDED.title,
               body = EXCLUDED.body,
               recommended_channel_ids = EXCLUDED.recommended_channel_ids,
               starter_tasks = EXCLUDED.starter_tasks,
               updated_at = NOW()
           RETURNING server_id, enabled, title, body, recommended_channel_ids, starter_tasks, updated_at"#,
    )
    .bind(server_id)
    .bind(enabled)
    .bind(&title)
    .bind(&body_text)
    .bind(&recommended_channel_ids)
    .bind(&starter_tasks)
    .fetch_one(&state.db)
    .await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "server_onboarding_update",
        "server",
        Some(server_id),
        Some(serde_json::json!({ "enabled": guide.enabled })),
    )
    .await?;

    Ok(Json(guide))
}

/// GET /api/servers/:server_id/rules — list server rules (members only).
pub(super) async fn list_server_rules(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<ServerRule>>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::VIEW_SERVER,
    )
    .await?;
    load_server_rules(&state, server_id).await.map(Json)
}

/// GET /api/servers/invite/:invite_code/rules — rules shown on an invite page before joining;
/// the invite code is what grants access.
pub(super) async fn list_invite_rules(
    State(state): State<Arc<AppState>>,
    Path(invite_code): Path<String>,
) -> Result<Json<Vec<ServerRule>>, AppError> {
    let code = invite_code.trim();
    if code.is_empty() || code.len() > 32 {
        return Err(AppError::Validation(
            "Invite code must be 1-32 characters".into(),
        ));
    }
    let server_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM servers WHERE invite_code = $1")
        .bind(code)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Invalid invite code".into()))?;
    load_server_rules(&state, server_id).await.map(Json)
}

pub(super) async fn load_server_rules(
    state: &AppState,
    server_id: Uuid,
) -> Result<Vec<ServerRule>, AppError> {
    let rules = sqlx::query_as::<_, ServerRule>(
        r#"SELECT id, server_id, rule_text, position, created_at
           FROM server_rules
           WHERE server_id = $1
           ORDER BY position ASC, created_at ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(rules)
}

/// POST /api/servers/:server_id/rules — create a server rule (owner only).
pub(super) async fn create_server_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<crate::models::CreateServerRuleRequest>,
) -> Result<Json<ServerRule>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let trimmed = body.rule_text.trim();
    if trimmed.is_empty() || trimmed.len() > 1000 {
        return Err(AppError::Validation(
            "Rule text must be 1-1000 characters".into(),
        ));
    }

    let max_position: Option<i32> =
        sqlx::query_scalar("SELECT MAX(position) FROM server_rules WHERE server_id = $1")
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?
            .flatten();

    let position = body
        .position
        .unwrap_or(max_position.map(|p| p + 1).unwrap_or(0));

    let rule = sqlx::query_as::<_, ServerRule>(
        r#"INSERT INTO server_rules (id, server_id, rule_text, position, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(trimmed)
    .bind(position)
    .fetch_one(&state.db)
    .await?;

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "server_rule_create",
        "server",
        Some(server_id),
        Some(serde_json::json!({ "rule_id": rule.id, "position": rule.position })),
    )
    .await?;

    Ok(Json(rule))
}

/// PATCH /api/servers/:server_id/rules/:rule_id — update a server rule (owner only).
pub(super) async fn update_server_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, rule_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateServerRuleRequest>,
) -> Result<Json<ServerRule>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let existing = sqlx::query_as::<_, ServerRule>(
        "SELECT * FROM server_rules WHERE id = $1 AND server_id = $2",
    )
    .bind(rule_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Rule not found".into()))?;

    let next_text = match &body.rule_text {
        Some(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.len() > 1000 {
                return Err(AppError::Validation(
                    "Rule text must be 1-1000 characters".into(),
                ));
            }
            trimmed.to_string()
        }
        None => existing.rule_text,
    };

    let next_position = body.position.unwrap_or(existing.position);

    let updated = sqlx::query_as::<_, ServerRule>(
        r#"UPDATE server_rules SET rule_text = $1, position = $2 WHERE id = $3 RETURNING *"#,
    )
    .bind(next_text)
    .bind(next_position)
    .bind(rule_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(updated))
}

/// DELETE /api/servers/:server_id/rules/:rule_id — delete a server rule (owner only).
pub(super) async fn delete_server_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, rule_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    permissions::ensure_server_permission(
        &state.db,
        server_id,
        claims.sub,
        Permissions::MANAGE_SERVER,
    )
    .await?;

    let deleted = sqlx::query("DELETE FROM server_rules WHERE id = $1 AND server_id = $2")
        .bind(rule_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Rule not found".into()));
    }

    crate::services::audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "server_rule_delete",
        "server",
        Some(server_id),
        Some(serde_json::json!({ "rule_id": rule_id })),
    )
    .await?;

    Ok(Json(serde_json::json!({ "message": "Rule deleted" })))
}
