use axum::{
    extract::{Path, State},
    middleware,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    services::rate_limit::enforce_rate_limit,
    ws::WsEvent,
    AppState,
};

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct FriendUser {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct FriendRequestInfo {
    pub id: Uuid,
    pub requester_id: Uuid,
    pub receiver_id: Uuid,
    pub requester_username: String,
    pub receiver_username: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize)]
pub struct FriendRequestsResponse {
    pub incoming: Vec<FriendRequestInfo>,
    pub outgoing: Vec<FriendRequestInfo>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SendFriendRequestBody {
    pub username: String,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_friends))
        .route("/{friend_id}", delete(remove_friend))
        .route(
            "/requests",
            get(list_friend_requests).post(send_friend_request),
        )
        .route("/requests/{request_id}/accept", post(accept_friend_request))
        .route("/requests/{request_id}/reject", post(reject_friend_request))
        .route_layer(middleware::from_fn_with_state(state, require_auth))
}

fn notify_friend_update(state: &AppState, user_id: Uuid) {
    if let Some(sessions) = state.sessions.get(&user_id) {
        for sender in sessions.iter() {
            let _ = sender.send(WsEvent::FriendUpdate { user_id });
        }
    }
}

async fn list_friends(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<FriendUser>>, AppError> {
    let rows = sqlx::query_as::<_, FriendUser>(
        r#"SELECT u.id, u.username, u.avatar_url, u.status
           FROM friendships f
           INNER JOIN users u
             ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
           WHERE f.user_a = $1 OR f.user_b = $1
           ORDER BY u.username ASC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    // Use live WebSocket sessions for online/offline; DB can be stale (tab close, crash, etc.).
    let with_presence: Vec<FriendUser> = rows
        .into_iter()
        .map(|r| {
            let status = if state.sessions.contains_key(&r.id) {
                r.status
            } else {
                "offline".to_string()
            };
            FriendUser { status, ..r }
        })
        .collect();

    Ok(Json(with_presence))
}

async fn list_friend_requests(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<FriendRequestsResponse>, AppError> {
    let incoming = sqlx::query_as::<_, FriendRequestInfo>(
        r#"SELECT fr.id, fr.requester_id, fr.receiver_id,
                  req.username as requester_username,
                  rec.username as receiver_username,
                  fr.status, fr.created_at
           FROM friend_requests fr
           INNER JOIN users req ON req.id = fr.requester_id
           INNER JOIN users rec ON rec.id = fr.receiver_id
           WHERE fr.receiver_id = $1 AND fr.status = 'pending'
           ORDER BY fr.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let outgoing = sqlx::query_as::<_, FriendRequestInfo>(
        r#"SELECT fr.id, fr.requester_id, fr.receiver_id,
                  req.username as requester_username,
                  rec.username as receiver_username,
                  fr.status, fr.created_at
           FROM friend_requests fr
           INNER JOIN users req ON req.id = fr.requester_id
           INNER JOIN users rec ON rec.id = fr.receiver_id
           WHERE fr.requester_id = $1 AND fr.status = 'pending'
           ORDER BY fr.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(FriendRequestsResponse { incoming, outgoing }))
}

async fn send_friend_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SendFriendRequestBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("friend_request:{}", claims.sub),
        10,
        std::time::Duration::from_secs(60),
        "Too many friend requests sent recently. Please slow down.",
    )
    .await?;

    let username = body.username.trim();
    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::Validation(
            "Username must be 3-32 characters".into(),
        ));
    }
    let target = sqlx::query_as::<_, FriendUser>(
        "SELECT id, username, avatar_url, status FROM users WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("User not found".into()))?;

    if target.id == claims.sub {
        return Err(AppError::Validation("You cannot add yourself".into()));
    }

    let (a, b) = if claims.sub < target.id {
        (claims.sub, target.id)
    } else {
        (target.id, claims.sub)
    };

    let already_friends = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM friendships WHERE user_a = $1 AND user_b = $2",
    )
    .bind(a)
    .bind(b)
    .fetch_one(&state.db)
    .await?;

    if already_friends > 0 {
        return Err(AppError::Validation("You are already friends".into()));
    }

    let pending = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM friend_requests
           WHERE status = 'pending'
             AND ((requester_id = $1 AND receiver_id = $2)
               OR (requester_id = $2 AND receiver_id = $1))"#,
    )
    .bind(claims.sub)
    .bind(target.id)
    .fetch_one(&state.db)
    .await?;

    if pending > 0 {
        return Err(AppError::Validation(
            "A pending request already exists".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO friend_requests (id, requester_id, receiver_id, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(claims.sub)
    .bind(target.id)
    .execute(&state.db)
    .await?;

    notify_friend_update(&state, claims.sub);
    notify_friend_update(&state, target.id);

    Ok(Json(
        serde_json::json!({ "message": "Friend request sent" }),
    ))
}

async fn accept_friend_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(request_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let req = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT requester_id, receiver_id, status FROM friend_requests WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Friend request not found".into()))?;

    let (requester_id, receiver_id, status) = req;
    if receiver_id != claims.sub {
        return Err(AppError::Forbidden(
            "Not allowed to accept this request".into(),
        ));
    }
    if status != "pending" {
        return Err(AppError::Validation("Request is not pending".into()));
    }

    sqlx::query(
        "UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1",
    )
    .bind(request_id)
    .execute(&state.db)
    .await?;

    let (a, b) = if requester_id < receiver_id {
        (requester_id, receiver_id)
    } else {
        (receiver_id, requester_id)
    };
    sqlx::query(
        "INSERT INTO friendships (user_a, user_b, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_a, user_b) DO NOTHING",
    )
    .bind(a)
    .bind(b)
    .execute(&state.db)
    .await?;

    notify_friend_update(&state, requester_id);
    notify_friend_update(&state, receiver_id);

    Ok(Json(
        serde_json::json!({ "message": "Friend request accepted" }),
    ))
}

async fn reject_friend_request(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(request_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let req = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT requester_id, receiver_id, status FROM friend_requests WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Friend request not found".into()))?;

    let (_requester_id, receiver_id, status) = req;
    if receiver_id != claims.sub {
        return Err(AppError::Forbidden(
            "Not allowed to reject this request".into(),
        ));
    }
    if status != "pending" {
        return Err(AppError::Validation("Request is not pending".into()));
    }

    sqlx::query(
        "UPDATE friend_requests SET status = 'rejected', responded_at = NOW() WHERE id = $1",
    )
    .bind(request_id)
    .execute(&state.db)
    .await?;

    notify_friend_update(&state, claims.sub);
    notify_friend_update(&state, _requester_id);

    Ok(Json(
        serde_json::json!({ "message": "Friend request rejected" }),
    ))
}

async fn remove_friend(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Path(friend_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    if friend_id == claims.sub {
        return Err(AppError::Validation("You cannot remove yourself".into()));
    }

    let (a, b) = if claims.sub < friend_id {
        (claims.sub, friend_id)
    } else {
        (friend_id, claims.sub)
    };

    let removed = sqlx::query("DELETE FROM friendships WHERE user_a = $1 AND user_b = $2")
        .bind(a)
        .bind(b)
        .execute(&state.db)
        .await?
        .rows_affected();

    if removed == 0 {
        return Err(AppError::NotFound("Friendship not found".into()));
    }

    // Clean up any stale pending requests between the same users.
    sqlx::query(
        r#"DELETE FROM friend_requests
           WHERE status = 'pending'
             AND ((requester_id = $1 AND receiver_id = $2)
               OR (requester_id = $2 AND receiver_id = $1))"#,
    )
    .bind(claims.sub)
    .bind(friend_id)
    .execute(&state.db)
    .await?;

    notify_friend_update(&state, claims.sub);
    notify_friend_update(&state, friend_id);

    Ok(Json(serde_json::json!({ "message": "Friend removed" })))
}
