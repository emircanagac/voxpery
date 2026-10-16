//! AutoMod rules.
use super::*;

#[derive(Debug, serde::Deserialize)]
pub(super) struct CreateAutoModRuleRequest {
    pub(super) name: String,
    pub(super) trigger_type: String,
    pub(super) pattern: Option<String>,
    pub(super) mention_limit: Option<i32>,
    pub(super) enabled: Option<bool>,
    pub(super) exempt_role_ids: Option<Vec<Uuid>>,
    pub(super) exempt_channel_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct UpdateAutoModRuleRequest {
    pub(super) name: Option<String>,
    pub(super) trigger_type: Option<String>,
    pub(super) pattern: Option<String>,
    pub(super) mention_limit: Option<i32>,
    pub(super) enabled: Option<bool>,
    pub(super) exempt_role_ids: Option<Vec<Uuid>>,
    pub(super) exempt_channel_ids: Option<Vec<Uuid>>,
}

pub(super) fn normalize_automod_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 80 {
        return Err(AppError::Validation(
            "AutoMod rule name must be 1-80 characters".into(),
        ));
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_automod_trigger(trigger_type: &str) -> Result<String, AppError> {
    match trigger_type.trim() {
        "blocked_keyword" | "invite_filter" | "link_filter" | "mention_spam" => {
            Ok(trigger_type.trim().to_string())
        }
        _ => Err(AppError::Validation(
            "Unsupported AutoMod trigger type".into(),
        )),
    }
}

pub(super) fn normalize_automod_rule_values(
    trigger_type: &str,
    pattern: Option<String>,
    mention_limit: Option<i32>,
) -> Result<(Option<String>, Option<i32>), AppError> {
    match trigger_type {
        "blocked_keyword" => {
            let pattern = pattern
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or(AppError::Validation(
                    "Blocked keyword rules require a keyword".into(),
                ))?;
            if pattern.len() < 2 || pattern.len() > 128 {
                return Err(AppError::Validation(
                    "Blocked keyword must be 2-128 characters".into(),
                ));
            }
            Ok((Some(pattern), None))
        }
        "mention_spam" => {
            let limit = mention_limit.unwrap_or(5);
            if !(2..=50).contains(&limit) {
                return Err(AppError::Validation(
                    "Mention spam limit must be between 2 and 50".into(),
                ));
            }
            Ok((None, Some(limit)))
        }
        "invite_filter" | "link_filter" => Ok((None, None)),
        _ => Err(AppError::Validation(
            "Unsupported AutoMod trigger type".into(),
        )),
    }
}

pub(super) fn validate_automod_exemptions(
    role_ids: &[Uuid],
    channel_ids: &[Uuid],
) -> Result<(), AppError> {
    if role_ids.len() > 100 || channel_ids.len() > 100 {
        return Err(AppError::Validation(
            "AutoMod rule exemptions cannot include more than 100 roles or channels".into(),
        ));
    }
    Ok(())
}

pub(super) async fn ensure_automod_manage_permission(
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

pub(super) async fn list_automod_rules(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<AutoModRule>>, AppError> {
    ensure_automod_manage_permission(&state, server_id, claims.sub).await?;

    let rules = sqlx::query_as::<_, AutoModRule>(
        r#"SELECT id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                  exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at
           FROM server_automod_rules
           WHERE server_id = $1
           ORDER BY created_at ASC"#,
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rules))
}

pub(super) async fn create_automod_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateAutoModRuleRequest>,
) -> Result<Json<AutoModRule>, AppError> {
    ensure_automod_manage_permission(&state, server_id, claims.sub).await?;

    let name = normalize_automod_name(&body.name)?;
    let trigger_type = normalize_automod_trigger(&body.trigger_type)?;
    let (pattern, mention_limit) =
        normalize_automod_rule_values(&trigger_type, body.pattern, body.mention_limit)?;
    let exempt_role_ids = body.exempt_role_ids.unwrap_or_default();
    let exempt_channel_ids = body.exempt_channel_ids.unwrap_or_default();
    validate_automod_exemptions(&exempt_role_ids, &exempt_channel_ids)?;

    let rule = sqlx::query_as::<_, AutoModRule>(
        r#"INSERT INTO server_automod_rules (
                id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW(), NOW())
           RETURNING id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                     exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at"#,
    )
    .bind(Uuid::new_v4())
    .bind(server_id)
    .bind(name)
    .bind(trigger_type)
    .bind(pattern)
    .bind(mention_limit)
    .bind(body.enabled.unwrap_or(true))
    .bind(exempt_role_ids)
    .bind(exempt_channel_ids)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "automod_rule_create",
        "automod_rule",
        Some(rule.id),
        Some(serde_json::json!({
            "name": &rule.name,
            "trigger_type": &rule.trigger_type,
            "enabled": rule.enabled
        })),
    )
    .await?;

    Ok(Json(rule))
}

pub(super) async fn update_automod_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, rule_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateAutoModRuleRequest>,
) -> Result<Json<AutoModRule>, AppError> {
    ensure_automod_manage_permission(&state, server_id, claims.sub).await?;

    let current = sqlx::query_as::<_, AutoModRule>(
        r#"SELECT id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                  exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at
           FROM server_automod_rules
           WHERE id = $1 AND server_id = $2"#,
    )
    .bind(rule_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("AutoMod rule not found".into()))?;

    let name = match body.name {
        Some(value) => normalize_automod_name(&value)?,
        None => current.name,
    };
    let trigger_type = match body.trigger_type {
        Some(value) => normalize_automod_trigger(&value)?,
        None => current.trigger_type,
    };
    let (pattern, mention_limit) = normalize_automod_rule_values(
        &trigger_type,
        body.pattern.or(current.pattern),
        body.mention_limit.or(current.mention_limit),
    )?;
    let exempt_role_ids = body.exempt_role_ids.unwrap_or(current.exempt_role_ids);
    let exempt_channel_ids = body
        .exempt_channel_ids
        .unwrap_or(current.exempt_channel_ids);
    validate_automod_exemptions(&exempt_role_ids, &exempt_channel_ids)?;

    let rule = sqlx::query_as::<_, AutoModRule>(
        r#"UPDATE server_automod_rules
           SET name = $3,
               trigger_type = $4,
               pattern = $5,
               mention_limit = $6,
               enabled = $7,
               exempt_role_ids = $8,
               exempt_channel_ids = $9,
               updated_by = $10,
               updated_at = NOW()
           WHERE id = $1 AND server_id = $2
           RETURNING id, server_id, name, trigger_type, pattern, mention_limit, enabled,
                     exempt_role_ids, exempt_channel_ids, created_by, updated_by, created_at, updated_at"#,
    )
    .bind(rule_id)
    .bind(server_id)
    .bind(name)
    .bind(trigger_type)
    .bind(pattern)
    .bind(mention_limit)
    .bind(body.enabled.unwrap_or(current.enabled))
    .bind(exempt_role_ids)
    .bind(exempt_channel_ids)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "automod_rule_update",
        "automod_rule",
        Some(rule.id),
        Some(serde_json::json!({
            "name": &rule.name,
            "trigger_type": &rule.trigger_type,
            "enabled": rule.enabled
        })),
    )
    .await?;

    Ok(Json(rule))
}

pub(super) async fn delete_automod_rule(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path((server_id, rule_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    ensure_automod_manage_permission(&state, server_id, claims.sub).await?;

    let deleted = sqlx::query_scalar::<_, String>(
        r#"DELETE FROM server_automod_rules
           WHERE id = $1 AND server_id = $2
           RETURNING name"#,
    )
    .bind(rule_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("AutoMod rule not found".into()))?;

    audit::log(
        &state.db,
        claims.sub,
        Some(server_id),
        "automod_rule_delete",
        "automod_rule",
        Some(rule_id),
        Some(serde_json::json!({ "name": deleted })),
    )
    .await?;

    Ok(Json(
        serde_json::json!({ "message": "AutoMod rule deleted" }),
    ))
}
