use axum::{
    extract::{Path, State},
    middleware,
    routing::get,
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth_and_current_legal_consent, Claims},
    services::rate_limit::enforce_rate_limit,
    AppState,
};

const MAX_NOTE_CHARS: usize = 1000;
const NOTE_WRITES_PER_MINUTE: usize = 30;

#[derive(Debug, serde::Serialize, Default)]
struct UserNoteResponse {
    note: Option<String>,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, serde::Deserialize)]
struct SaveUserNoteRequest {
    note: String,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/{user_id}/note", get(get_user_note).put(save_user_note))
        .route_layer(middleware::from_fn_with_state(
            state,
            require_auth_and_current_legal_consent,
        ))
}

/// GET /api/users/:user_id/note — the caller's own note about a user. Every query is keyed by the
/// caller, so a note can never be read by anyone but its author.
async fn get_user_note(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<UserNoteResponse>, AppError> {
    let row = sqlx::query_as::<_, (String, DateTime<Utc>)>(
        "SELECT note, updated_at FROM user_notes WHERE author_id = $1 AND target_user_id = $2",
    )
    .bind(claims.sub)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(row.map_or_else(
        UserNoteResponse::default,
        |(note, updated_at)| UserNoteResponse {
            note: Some(note),
            updated_at: Some(updated_at),
        },
    )))
}

/// PUT /api/users/:user_id/note — saves the caller's note; an empty note deletes it.
async fn save_user_note(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<SaveUserNoteRequest>,
) -> Result<Json<UserNoteResponse>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("user_notes:write:{}", claims.sub),
        NOTE_WRITES_PER_MINUTE,
        Duration::from_secs(60),
        "Too many note changes. Please wait and try again.",
    )
    .await?;

    let note = body.note.trim();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::Validation(format!(
            "Note must be at most {MAX_NOTE_CHARS} characters"
        )));
    }
    if note.is_empty() {
        sqlx::query("DELETE FROM user_notes WHERE author_id = $1 AND target_user_id = $2")
            .bind(claims.sub)
            .bind(user_id)
            .execute(&state.db)
            .await?;
        return Ok(Json(UserNoteResponse::default()));
    }

    let updated_at = sqlx::query_scalar::<_, DateTime<Utc>>(
        r#"INSERT INTO user_notes (author_id, target_user_id, note)
           SELECT $1, u.id, $3 FROM users u WHERE u.id = $2
           ON CONFLICT (author_id, target_user_id)
           DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
           RETURNING updated_at"#,
    )
    .bind(claims.sub)
    .bind(user_id)
    .bind(note)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("User not found".into()))?;

    Ok(Json(UserNoteResponse {
        note: Some(note.to_string()),
        updated_at: Some(updated_at),
    }))
}
