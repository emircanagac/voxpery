//! Personal data export and account deletion.
use super::*;

#[derive(Debug, serde::Deserialize)]
pub(super) struct DeleteAccountRequest {
    pub(super) confirm: String,
    pub(super) password: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct DataExportRequest {
    pub(super) password: Option<String>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportAccountRow {
    pub(super) username: String,
    pub(super) email: String,
    pub(super) avatar_url: Option<String>,
    pub(super) about_me: String,
    pub(super) status: String,
    pub(super) dm_privacy: String,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
    pub(super) google_connected: bool,
    pub(super) password_hash: String,
}

#[derive(Debug, sqlx::FromRow)]
pub(super) struct ExportAttachmentRow {
    pub(super) storage_backend: String,
    pub(super) storage_key: String,
    pub(super) original_name: String,
    pub(super) content_type: String,
    pub(super) size_bytes: i64,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportMembershipRow {
    pub(super) server_name: String,
    pub(super) joined_at: chrono::DateTime<chrono::Utc>,
    pub(super) role: String,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportFriendRow {
    pub(super) username: String,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportFriendRequestRow {
    pub(super) direction: String,
    pub(super) other_username: String,
    pub(super) status: String,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportServerMessageRow {
    pub(super) channel_name: String,
    pub(super) server_name: String,
    pub(super) content: String,
    pub(super) attachments: Option<serde_json::Value>,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
    pub(super) edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub(super) struct ExportDmMessageRow {
    pub(super) peer_username: Option<String>,
    pub(super) content: String,
    pub(super) attachments: Option<serde_json::Value>,
    pub(super) created_at: chrono::DateTime<chrono::Utc>,
    pub(super) edited_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub(super) fn summarize_export_attachments(
    attachments: &Option<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let Some(serde_json::Value::Array(items)) = attachments else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| item.as_object())
        .map(|obj| {
            let name = obj
                .get("name")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("Attachment");
            serde_json::json!({
                "name": name,
                "content_type": obj.get("type").and_then(serde_json::Value::as_str),
                "size_bytes": obj.get("size").and_then(serde_json::Value::as_i64),
            })
        })
        .collect()
}

pub(super) async fn ensure_deleted_placeholder_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Uuid, AppError> {
    let existing = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind("deleted@system.local")
        .fetch_optional(&mut **tx)
        .await?;
    if let Some(id) = existing {
        return Ok(id);
    }

    let base = "deleted_system";
    let mut username = base.to_string();
    let mut n = 0u32;
    loop {
        let taken = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1)",
        )
        .bind(&username)
        .fetch_one(&mut **tx)
        .await?;
        if taken == 0 {
            break;
        }
        n += 1;
        username = format!("{base}{n}");
    }

    let id = Uuid::new_v4();
    let password_hash = hash_password(&Uuid::new_v4().to_string())?;
    sqlx::query(
        r#"INSERT INTO users
           (id, username, email, password_hash, avatar_url, status, dm_privacy, email_verified, created_at, google_id, username_changed_at, token_version)
           VALUES ($1, $2, $3, $4, NULL, 'invisible', 'friends', TRUE, NOW(), NULL, NULL, 0)"#,
    )
    .bind(id)
    .bind(username)
    .bind("deleted@system.local")
    .bind(password_hash)
    .execute(&mut **tx)
    .await?;

    Ok(id)
}

pub(super) fn safe_export_filename(name: &str, fallback: &str) -> String {
    let sanitized: String = name
        .chars()
        .filter_map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => Some('_'),
            ch if ch.is_control() => None,
            ch => Some(ch),
        })
        .take(96)
        .collect();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized.to_string()
    }
}

pub(super) fn export_avatar_file(avatar_url: Option<&str>) -> Option<(String, Vec<u8>)> {
    let raw = avatar_url?.trim();
    let (mime, encoded) = raw.strip_prefix("data:")?.split_once(";base64,")?;
    let extension = match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        _ => return None,
    };
    let bytes = BASE64.decode(encoded.as_bytes()).ok()?;
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    Some((format!("files/avatar.{extension}"), bytes))
}

pub(super) fn build_data_export_zip(
    payload: &serde_json::Value,
    files: Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, AppError> {
    let json = serde_json::to_vec_pretty(payload)
        .map_err(|error| AppError::Internal(format!("Failed to serialize data export: {error}")))?;
    let total_uncompressed_bytes = files
        .iter()
        .try_fold(json.len(), |total, (_, bytes)| {
            total.checked_add(bytes.len())
        })
        .ok_or_else(|| {
            AppError::Conflict("The export archive is too large to create safely".into())
        })?;
    if total_uncompressed_bytes > DATA_EXPORT_MAX_ARCHIVE_BYTES as usize {
        return Err(AppError::Conflict(
            "The self-service archive exceeds 256 MB. Use the formal privacy request process for a complete export".into(),
        ));
    }

    let cursor = Cursor::new(Vec::new());
    let mut archive = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    archive
        .start_file("voxpery-data-export.json", options)
        .and_then(|_| archive.write_all(&json).map_err(zip::result::ZipError::Io))
        .map_err(|error| AppError::Internal(format!("Failed to create data export: {error}")))?;

    for (path, bytes) in files {
        archive
            .start_file(path, options)
            .and_then(|_| archive.write_all(&bytes).map_err(zip::result::ZipError::Io))
            .map_err(|error| {
                AppError::Internal(format!("Failed to create data export: {error}"))
            })?;
    }

    archive
        .finish()
        .map(Cursor::into_inner)
        .map_err(|error| AppError::Internal(format!("Failed to finalize data export: {error}")))
}

/// POST /api/auth/data-export
/// Creates a bounded self-service archive after recent identity verification.
pub(super) async fn export_my_data(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<DataExportRequest>,
) -> Result<Response, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:data_export:{}", claims.sub),
        3,
        Duration::from_secs(15 * 60),
        "Too many data export requests. Please wait and try again.",
    )
    .await?;

    let account = sqlx::query_as::<_, ExportAccountRow>(
        r#"SELECT username, email, avatar_url, about_me, status, dm_privacy, created_at,
                  (google_id IS NOT NULL) AS google_connected,
                  password_hash
           FROM users
           WHERE id = $1"#,
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("User not found".into()))?;

    if account.password_hash == "oauth" {
        let now = chrono::Utc::now().timestamp().max(0) as usize;
        if now.saturating_sub(claims.iat) > DATA_EXPORT_REAUTH_MAX_AGE_SECS {
            return Err(AppError::ReauthenticationRequired(
                "Sign in with Google again before creating a data export".into(),
            ));
        }
    } else {
        let password = body
            .password
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::ReauthenticationRequired(
                    "Enter your current password before creating a data export".into(),
                )
            })?;
        if !verify_password(password, &account.password_hash)? {
            return Err(AppError::InvalidCredentials);
        }
    }

    let memberships = sqlx::query_as::<_, ExportMembershipRow>(
        r#"SELECT s.name AS server_name,
                  sm.joined_at,
                  CASE WHEN s.owner_id = sm.user_id THEN 'owner' ELSE 'member' END AS role
           FROM server_members sm
           INNER JOIN servers s ON s.id = sm.server_id
           WHERE sm.user_id = $1
           ORDER BY sm.joined_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let friends = sqlx::query_as::<_, ExportFriendRow>(
        r#"SELECT u.username,
                  f.created_at
           FROM friendships f
           INNER JOIN users u
                   ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
           WHERE f.user_a = $1 OR f.user_b = $1
           ORDER BY f.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let friend_requests = sqlx::query_as::<_, ExportFriendRequestRow>(
        r#"SELECT CASE WHEN fr.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
                  CASE WHEN fr.requester_id = $1 THEN ur.username ELSE uq.username END AS other_username,
                  fr.status,
                  fr.created_at
           FROM friend_requests fr
           INNER JOIN users uq ON uq.id = fr.requester_id
           INNER JOIN users ur ON ur.id = fr.receiver_id
           WHERE fr.requester_id = $1 OR fr.receiver_id = $1
           ORDER BY fr.created_at DESC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let server_messages = sqlx::query_as::<_, ExportServerMessageRow>(
        r#"SELECT c.name AS channel_name,
                  s.name AS server_name,
                  m.content,
                  m.attachments,
                  m.created_at,
                  m.edited_at
           FROM messages m
           INNER JOIN channels c ON c.id = m.channel_id
           INNER JOIN servers s ON s.id = c.server_id
           WHERE m.user_id = $1
           ORDER BY m.created_at DESC
           LIMIT $2"#,
    )
    .bind(claims.sub)
    .bind(DATA_EXPORT_MESSAGE_LIMIT)
    .fetch_all(&state.db)
    .await?;

    let dm_messages = sqlx::query_as::<_, ExportDmMessageRow>(
        r#"SELECT peer.username AS peer_username,
                  m.content,
                  m.attachments,
                  m.created_at,
                  m.edited_at
           FROM dm_messages m
           LEFT JOIN LATERAL (
               SELECT u.id, u.username
               FROM dm_channel_members dcm
               INNER JOIN users u ON u.id = dcm.user_id
               WHERE dcm.channel_id = m.channel_id AND dcm.user_id <> $1
               LIMIT 1
           ) AS peer ON TRUE
           WHERE m.user_id = $1
           ORDER BY m.created_at DESC
           LIMIT $2"#,
    )
    .bind(claims.sub)
    .bind(DATA_EXPORT_MESSAGE_LIMIT)
    .fetch_all(&state.db)
    .await?;

    let server_messages: Vec<_> = server_messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "server": message.server_name,
                "channel": message.channel_name,
                "content": message.content,
                "attachments": summarize_export_attachments(&message.attachments),
                "sent_at": message.created_at,
                "edited_at": message.edited_at,
            })
        })
        .collect();

    let dm_messages: Vec<_> = dm_messages
        .iter()
        .map(|message| {
            serde_json::json!({
                "conversation_with": message.peer_username.as_deref().unwrap_or("Unknown user"),
                "content": message.content,
                "attachments": summarize_export_attachments(&message.attachments),
                "sent_at": message.created_at,
                "edited_at": message.edited_at,
            })
        })
        .collect();

    let attachments = sqlx::query_as::<_, ExportAttachmentRow>(
        r#"SELECT storage_backend, storage_key, original_name, content_type, size_bytes
           FROM uploaded_attachments
           WHERE user_id = $1 AND scan_status = 'clean'
           ORDER BY created_at ASC"#,
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let total_file_bytes = attachments
        .iter()
        .try_fold(0i64, |total, item| total.checked_add(item.size_bytes))
        .ok_or_else(|| {
            AppError::Conflict("The export archive is too large to create safely".into())
        })?;
    if total_file_bytes > DATA_EXPORT_MAX_ARCHIVE_BYTES {
        return Err(AppError::Conflict(
            "The self-service archive exceeds 256 MB. Use the formal privacy request process for a complete export".into(),
        ));
    }

    let mut archive_files = Vec::with_capacity(attachments.len() + 1);
    let mut file_manifest = Vec::with_capacity(attachments.len() + 1);
    if let Some((path, bytes)) = export_avatar_file(account.avatar_url.as_deref()) {
        file_manifest.push(serde_json::json!({
            "archive_path": path,
            "kind": "profile_avatar",
            "size_bytes": bytes.len()
        }));
        archive_files.push((path, bytes));
    }
    for (index, attachment) in attachments.iter().enumerate() {
        if attachment.storage_backend != "local" {
            return Err(AppError::Conflict(
                "A stored file is not available to the self-service exporter. Use the formal privacy request process".into(),
            ));
        }
        let safe_name = safe_export_filename(&attachment.original_name, "attachment");
        let path = format!("files/attachments/{:04}-{safe_name}", index + 1);
        let bytes = state
            .attachment_service
            .read_local_attachment_bytes(&attachment.storage_key)
            .await?;
        file_manifest.push(serde_json::json!({
            "archive_path": path,
            "kind": "uploaded_attachment",
            "name": attachment.original_name,
            "content_type": attachment.content_type,
            "size_bytes": attachment.size_bytes
        }));
        archive_files.push((path, bytes));
    }

    let payload = serde_json::json!({
        "export": {
            "format": "voxpery-user-data-v3",
            "scope": "self_service_convenience_export",
            "is_complete_data_subject_access_response": false,
            "generated_at": chrono::Utc::now().to_rfc3339(),
            "description": "A user-readable, bounded convenience archive of your Voxpery account and authored content.",
            "formal_request": {
                "contact": "voxpery@gmail.com",
                "instructions": "See DATA_SUBJECT_REQUESTS.md or the hosted Privacy Notice to request all applicable personal data after identity verification."
            },
            "privacy_notes": [
                "Internal database identifiers, password hashes, sessions, tokens, and infrastructure values are not included.",
                "Other users are represented with minimal display context needed to understand your relationships and conversations.",
                "Message attachment entries contain no signed download URLs or storage identifiers.",
                "This ZIP file is not encrypted. Store it securely and delete it when it is no longer needed."
            ],
            "limits": {
                "server_messages": "Most recent 20000 authored server messages.",
                "direct_messages": "Most recent 20000 authored direct messages."
            },
            "files": file_manifest
        },
        "account": {
            "username": account.username,
            "email": account.email,
            "status": account.status,
            "dm_privacy": account.dm_privacy,
            "created_at": account.created_at,
            "google_connected": account.google_connected
        },
        "profile": {
            "has_avatar": account.avatar_url.is_some(),
            "about_me": account.about_me,
        },
        "servers": memberships.iter().map(|membership| {
            serde_json::json!({
                "name": membership.server_name,
                "role": membership.role,
                "joined_at": membership.joined_at,
            })
        }).collect::<Vec<_>>(),
        "relationships": {
            "friends": friends.iter().map(|friend| {
                serde_json::json!({
                    "username": friend.username,
                    "friends_since": friend.created_at,
                })
            }).collect::<Vec<_>>(),
            "friend_requests": friend_requests.iter().map(|request| {
                serde_json::json!({
                    "direction": request.direction,
                    "username": request.other_username,
                    "status": request.status,
                    "created_at": request.created_at,
                })
            }).collect::<Vec<_>>()
        },
        "messages": {
            "server": server_messages,
            "direct": dm_messages
        }
    });

    let archive = build_data_export_zip(&payload, archive_files)?;

    let mut tx = state.db.begin().await?;
    record_privacy_event(&mut tx, claims.sub, "data_export_created", None, None, None).await?;
    tx.commit().await?;

    let date = chrono::Utc::now().format("%Y-%m-%d");
    let filename = format!("voxpery-data-export-{date}.zip");
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    Ok((headers, Body::from(archive)).into_response())
}

/// DELETE /api/auth/account
/// GDPR/KVKK:
/// - permanently remove account + authored content.
pub(super) async fn delete_my_account(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<DeleteAccountRequest>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:delete_account:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60),
        "Too many account deletion attempts. Please wait and try again.",
    )
    .await?;

    if body.confirm.trim() != "DELETE" {
        return Err(AppError::Validation(
            "Confirmation text must be exactly DELETE".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let is_oauth_only = user.google_id.is_some() && user.password_hash == "oauth";
    if is_oauth_only {
        // Like the data export: an old session alone must not be able to delete the account.
        let now = chrono::Utc::now().timestamp().max(0) as usize;
        if now.saturating_sub(claims.iat) > DATA_EXPORT_REAUTH_MAX_AGE_SECS {
            return Err(AppError::ReauthenticationRequired(
                "Sign in with Google again before deleting your account".into(),
            ));
        }
    } else {
        let password = body
            .password
            .as_deref()
            .ok_or_else(|| AppError::Validation("Password is required".into()))?;
        if !verify_password(password, &user.password_hash)? {
            return Err(AppError::InvalidCredentials);
        }
    }

    // Collected first: the transaction below removes the memberships.
    let member_server_ids =
        sqlx::query_scalar::<_, Uuid>("SELECT server_id FROM server_members WHERE user_id = $1")
            .bind(claims.sub)
            .fetch_all(&state.db)
            .await?;

    let mut tx = state.db.begin().await?;
    let deleted_placeholder_id = ensure_deleted_placeholder_user(&mut tx).await?;

    // Files are removed from disk after the commit; the rows go with the user.
    let uploaded_storage_keys = sqlx::query_scalar::<_, String>(
        "SELECT storage_key FROM uploaded_attachments WHERE user_id = $1 AND storage_backend = 'local'",
    )
    .bind(claims.sub)
    .fetch_all(&mut *tx)
    .await?;

    // A server that still has members goes to the highest-ranked one (the earliest to join on
    // a tie), so it stays manageable; only servers left without members go to the placeholder.
    let owned_server_ids =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM servers WHERE owner_id = $1 FOR UPDATE")
            .bind(claims.sub)
            .fetch_all(&mut *tx)
            .await?;
    let mut transferred_server_ids = Vec::new();
    for server_id in owned_server_ids {
        let successor = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT sm.user_id
               FROM server_members sm
               LEFT JOIN server_member_roles smr
                 ON smr.server_id = sm.server_id AND smr.user_id = sm.user_id
               LEFT JOIN server_roles sr
                 ON sr.id = smr.role_id AND LOWER(sr.name) <> 'everyone'
               WHERE sm.server_id = $1 AND sm.user_id NOT IN ($2, $3)
               GROUP BY sm.user_id, sm.joined_at
               ORDER BY MIN(sr.position) ASC NULLS LAST, sm.joined_at ASC, sm.user_id ASC
               LIMIT 1"#,
        )
        .bind(server_id)
        .bind(claims.sub)
        .bind(deleted_placeholder_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(successor) = successor else {
            continue;
        };
        sqlx::query("UPDATE servers SET owner_id = $1 WHERE id = $2")
            .bind(successor)
            .bind(server_id)
            .execute(&mut *tx)
            .await?;
        transferred_server_ids.push(server_id);
    }

    sqlx::query("UPDATE servers SET owner_id = $1 WHERE owner_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"INSERT INTO server_members (server_id, user_id, joined_at)
           SELECT id, $1, NOW()
           FROM servers
           WHERE owner_id = $1
           ON CONFLICT (server_id, user_id) DO NOTHING"#,
    )
    .bind(deleted_placeholder_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE audit_log SET actor_id = $1 WHERE actor_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE server_bans SET banned_by = $1 WHERE banned_by = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE channel_pins SET pinned_by_id = $1 WHERE pinned_by_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE dm_channel_pins SET pinned_by_id = $1 WHERE pinned_by_id = $2")
        .bind(deleted_placeholder_id)
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM message_reactions WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_message_reactions WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM messages WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_messages WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM friend_requests WHERE requester_id = $1 OR receiver_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM friendships WHERE user_a = $1 OR user_b = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_channel_members WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM dm_channels c WHERE NOT EXISTS (SELECT 1 FROM dm_channel_members m WHERE m.channel_id = c.id)")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_member_roles WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_members WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM server_bans WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    for storage_key in &uploaded_storage_keys {
        if let Err(error) = state
            .attachment_service
            .delete_local_file_by_storage_key(storage_key)
            .await
        {
            tracing::warn!("Attachment file cleanup after account deletion failed: {error}");
        }
    }
    for server_id in transferred_server_ids {
        crate::ws::publish_event(&state, WsEvent::ServerRolesUpdated { server_id }).await;
    }

    if let Some(token) = token_from_request(&headers, &state.cookie_name) {
        let _ =
            crate::services::jwt_blacklist::blacklist_until_exp(&state.redis, &token, claims.exp)
                .await;
    }

    state.sessions.remove(&claims.sub);
    if let Some(channel_id) = state.voice_sessions.get(&claims.sub).map(|entry| *entry) {
        crate::services::voice_revoke::clear_local_voice_session(
            &state,
            claims.sub,
            channel_id,
            "account deleted",
        )
        .await;
    }
    state.voice_participant_sids.remove(&claims.sub);
    state.voice_controls.remove(&claims.sub);
    // End the LiveKit connection in every server the account was in, outside the request.
    let voice_state = state.clone();
    let deleted_user_id = claims.sub;
    tokio::spawn(async move {
        for server_id in member_server_ids {
            if let Err(error) = crate::services::voice_revoke::revoke_user_voice_access_for_server(
                &voice_state,
                server_id,
                deleted_user_id,
                "account deleted",
            )
            .await
            {
                tracing::warn!("Voice revoke after account deletion failed: {}", error);
            }
        }
    });
    crate::ws::publish_event(
        &state,
        WsEvent::PresenceUpdate {
            user_id: claims.sub,
            status: "offline".to_string(),
        },
    )
    .await;

    let out_headers = clear_auth_cookie_header(&state);
    Ok((
        out_headers,
        Json(serde_json::json!({
            "message": "Account permanently deleted"
        })),
    ))
}
