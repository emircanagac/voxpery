//! Signed-in account settings: status, profile, username check, email change and passwords.
use super::*;

#[derive(Debug, serde::Deserialize)]
pub(super) struct UpdateStatusRequest {
    pub(super) status: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct UpdateProfileRequest {
    pub(super) avatar_url: Option<String>,
    pub(super) clear_avatar: Option<bool>,
    pub(super) dm_privacy: Option<String>,
    pub(super) username: Option<String>,
    pub(super) about_me: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct ChangePasswordRequest {
    pub(super) old_password: String,
    pub(super) new_password: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct SetPasswordRequest {
    pub(super) new_password: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct RequestEmailVerificationRequest {
    pub(super) email: Option<String>,
    /// Required to change the address of an account that has a password.
    pub(super) current_password: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct ConfirmEmailVerificationRequest {
    pub(super) token: String,
}

#[derive(Debug, serde::Serialize)]
pub(super) struct ConfirmEmailVerificationResponse {
    pub(super) message: String,
}

/// POST /api/auth/set-password
/// Allows Google-only users to add a local password for the first time.
pub(super) async fn set_password(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SetPasswordRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:set_password:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60),
        "Too many password set attempts. Please wait.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }
    ensure_password_within_limit(&body.new_password)?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    if user.google_id.is_none() {
        return Err(AppError::Validation(
            "This account is not connected to Google Sign-In.".into(),
        ));
    }
    if user.password_hash != "oauth" {
        return Err(AppError::Validation(
            "Password is already set. Use change password.".into(),
        ));
    }
    // A first password is a lasting second way into the account, so a stolen older session
    // must not be able to add one: like a data export, it needs a recent Google sign-in.
    let now = chrono::Utc::now().timestamp().max(0) as usize;
    if now.saturating_sub(claims.iat) > DATA_EXPORT_REAUTH_MAX_AGE_SECS {
        return Err(AppError::ReauthenticationRequired(
            "Sign in with Google again before setting a password".into(),
        ));
    }

    let password_hash = hash_password_async(&body.new_password).await?;
    // Only replaces the Google-only marker, so two concurrent requests cannot both set one.
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        r#"UPDATE users
           SET password_hash = $1, token_version = token_version + 1
           WHERE id = $2 AND password_hash = 'oauth'"#,
    )
    .bind(&password_hash)
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::Validation(
            "Password is already set. Use change password.".into(),
        ));
    }
    revoke_pending_account_tokens(&mut tx, claims.sub).await?;
    tx.commit().await?;

    let updated = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    let token = generate_token(
        updated.id,
        &updated.username,
        updated.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;
    let headers = auth_cookie_header(&state, &token);

    Ok((
        headers,
        Json(AuthResponse {
            token,
            user: UserPublic::from(updated),
        }),
    ))
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct CheckUsernameQuery {
    pub(super) username: Option<String>,
}

/// GET /api/auth/check-username?username=xxx — returns { "available": bool } (true if no other user has that username).
/// Rate limited to prevent user enumeration (brute-force discovery of registered usernames).
pub(super) async fn check_username(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<CheckUsernameQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:check_username:{}", claims.sub),
        10,
        Duration::from_secs(60),
        "Too many username checks. Please wait a moment.",
    )
    .await?;
    let username = q
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("Missing username query".into()))?;
    if validate_username(username).is_err() {
        return Ok(Json(serde_json::json!({ "available": false })));
    }
    let taken = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1) AND id <> $2",
    )
    .bind(username)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "available": taken == 0 })))
}

/// PATCH /api/auth/status
pub(super) async fn update_status(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateStatusRequest>,
) -> Result<Json<UserPublic>, AppError> {
    let input = body.status.trim().to_lowercase();
    let status = match input.as_str() {
        "online" => "online",
        "dnd" => "dnd",
        "invisible" | "offline" => "invisible", // backward-compatible old client value
        _ => {
            return Err(AppError::Validation(
                "Status must be one of: online, dnd, invisible".into(),
            ))
        }
    };
    if !matches!(status, "online" | "dnd" | "invisible") {
        return Err(AppError::Validation(
            "Status must be one of: online, dnd, invisible".into(),
        ));
    }

    let user = sqlx::query_as::<_, User>(
        r#"UPDATE users
           SET status = $1
           WHERE id = $2
           RETURNING *"#,
    )
    .bind(status)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let visible_presence = visible_presence_from_preference(status).to_string();
    crate::ws::publish_event(
        &state,
        WsEvent::PresenceUpdate {
            user_id: claims.sub,
            status: visible_presence,
        },
    )
    .await;

    Ok(Json(UserPublic::from(user)))
}

/// PATCH /api/auth/profile
pub(super) async fn update_profile(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:profile:{}", claims.sub),
        12,
        Duration::from_secs(60),
        "Too many profile update attempts. Please wait and try again.",
    )
    .await?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let mut next_avatar = user.avatar_url.clone();
    let mut next_dm_privacy = user.dm_privacy.clone();
    let mut next_username = user.username.clone();
    let mut next_about_me = user.about_me.clone();

    if let Some(raw_username) = body.username {
        let username = raw_username.trim();
        if username != user.username {
            // Enforce at most one username change per 7 days.
            if let Some(changed_at) = user.username_changed_at {
                let since = chrono::Utc::now().signed_duration_since(changed_at);
                if since.num_days() < 7 {
                    return Err(AppError::Validation(
                        "You can only change your username once every 7 days. Please try again later.".into(),
                    ));
                }
            }
            validate_username(username).map_err(|message| AppError::Validation(message.into()))?;
            let taken = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM users WHERE lower(username) = lower($1) AND id <> $2",
            )
            .bind(username)
            .bind(claims.sub)
            .fetch_one(&state.db)
            .await?;
            if taken > 0 {
                return Err(AppError::Validation(
                    "That username is already taken".into(),
                ));
            }
            next_username = username.to_string();
        }
    }

    if body.clear_avatar.unwrap_or(false) {
        next_avatar = None;
    } else if let Some(url) = body.avatar_url {
        next_avatar = Some(validate_profile_avatar_url(&url)?);
    }

    if let Some(dm_privacy) = body.dm_privacy {
        let value = dm_privacy.trim().to_lowercase();
        if !matches!(value.as_str(), "everyone" | "friends") {
            return Err(AppError::Validation(
                "DM privacy must be one of: everyone, friends".into(),
            ));
        }
        next_dm_privacy = value;
    }

    if let Some(about_me) = body.about_me {
        next_about_me = validate_profile_text(about_me, "About me", 190)?;
    }

    let username_changed = next_username != user.username;
    let updated = sqlx::query_as::<_, User>(
        r#"UPDATE users
            SET avatar_url = $1, dm_privacy = $2, username = $3, about_me = $4,
                username_changed_at = CASE WHEN $6 THEN NOW() ELSE username_changed_at END
            WHERE id = $5
           RETURNING *"#,
    )
    .bind(next_avatar)
    .bind(next_dm_privacy)
    .bind(&next_username)
    .bind(next_about_me)
    .bind(claims.sub)
    .bind(username_changed)
    .fetch_one(&state.db)
    .await?;

    let public_user = UserPublic::from(updated);
    crate::ws::publish_event(
        &state,
        WsEvent::UserUpdated {
            user: UserBroadcastProfile::from(&public_user),
        },
    )
    .await;

    Ok(Json(public_user))
}

/// POST /api/auth/email/request-verification
pub(super) async fn request_email_verification(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<RequestEmailVerificationRequest>,
) -> Result<Json<UserPublic>, AppError> {
    if !state.email_verification_enabled {
        return Err(feature_disabled(
            "Email verification is disabled because email delivery is not configured",
        ));
    }

    enforce_rate_limit(
        &state.redis,
        format!("auth:email_verification_request:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60),
        "Too many email verification requests. Please try again later.",
    )
    .await?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let requested_email = body.email.unwrap_or_else(|| user.email.clone());
    let next_email = requested_email.trim().to_lowercase();
    if !is_valid_email(&next_email) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
        ));
    }

    let email_changed = next_email != user.email;
    if email_changed {
        // A session alone must not be enough to move the account to another address: that
        // address could then reset the password and take the account over.
        if user.password_hash == "oauth" {
            let now = chrono::Utc::now().timestamp().max(0) as usize;
            if now.saturating_sub(claims.iat) > DATA_EXPORT_REAUTH_MAX_AGE_SECS {
                return Err(AppError::ReauthenticationRequired(
                    "Sign in with Google again before changing your email address".into(),
                ));
            }
        } else {
            let password = body
                .current_password
                .as_deref()
                .filter(|password| !password.is_empty())
                .ok_or_else(|| {
                    AppError::Validation(
                        "Enter your current password to change your email address".into(),
                    )
                })?;
            if !verify_password_async(password, &user.password_hash).await? {
                return Err(AppError::InvalidCredentials);
            }
        }
        let taken = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE lower(email) = lower($1) AND id <> $2",
        )
        .bind(&next_email)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
        if taken > 0 {
            return Err(AppError::Validation(
                "That email address is already in use".into(),
            ));
        }
    }

    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    if !email_changed && user.email_verified {
        tx.commit().await?;
        return Ok(Json(UserPublic::from(user)));
    }

    let token_plain = Uuid::new_v4().to_string();
    let token_hash = token_hash_base64(&token_plain);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    // The new address only replaces the current one once its link is confirmed; until then
    // it waits in the verification token. Locking the row orders this against anything that
    // ends the session: such a change either waits and then revokes this token, or runs first
    // and no token is created.
    let created = sqlx::query(
        r#"INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
           SELECT id, $2, $3, $4 FROM users WHERE id = $1 AND token_version = $5 FOR UPDATE"#,
    )
    .bind(claims.sub)
    .bind(&next_email)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(claims.ver)
    .execute(&mut *tx)
    .await?;
    if created.rows_affected() == 0 {
        return Err(AppError::Unauthorized);
    }
    tx.commit().await?;
    let updated = user;

    let (Some(host), Some(smtp_user), Some(smtp_pass)) =
        (&state.smtp_host, &state.smtp_user, &state.smtp_password)
    else {
        tracing::warn!("SMTP is not configured! Email verification email not sent.");
        return Err(feature_disabled(
            "Email verification is disabled because email delivery is not configured",
        ));
    };

    let verify_link = format!(
        "{}/verify-email?token={}",
        frontend_base_url(&state),
        token_plain
    );
    if let Err(e) = crate::services::email::send_email_verification_email(
        &next_email,
        &verify_link,
        host,
        smtp_user,
        smtp_pass,
    )
    .await
    {
        tracing::error!("Failed to send email verification email: {}", e);
        let _ = sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
            .bind(claims.sub)
            .execute(&state.db)
            .await;
        return Err(AppError::Internal(
            "Email verification delivery failed".into(),
        ));
    }

    Ok(Json(UserPublic::from(updated)))
}

/// POST /api/auth/email/confirm
pub(super) async fn confirm_email_verification(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<ConfirmEmailVerificationRequest>,
) -> Result<Json<ConfirmEmailVerificationResponse>, AppError> {
    if !state.email_verification_enabled {
        return Err(feature_disabled(
            "Email verification is disabled because email delivery is not configured",
        ));
    }

    if let Some(ip) = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    ) {
        enforce_rate_limit(
            &state.redis,
            format!("auth:email_confirm_ip:{ip}"),
            10,
            Duration::from_secs(60),
            "Too many verification attempts. Please wait and try again.",
        )
        .await?;
    }

    let token = body.token.trim();
    if token.is_empty() {
        return Err(AppError::Validation(
            "Verification token is required".into(),
        ));
    }
    // Verification tokens are UUIDs; anything else cannot match and never reaches the database.
    if Uuid::parse_str(token).is_err() {
        return Err(AppError::Validation(
            "Invalid email verification token".into(),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct EmailVerificationTokenRow {
        user_id: Uuid,
        email: String,
        expires_at: chrono::DateTime<chrono::Utc>,
    }

    // Claim the link by deleting it: a concurrent request with the same link waits on the row
    // and then finds nothing, and a revocation either runs first or waits for this transaction.
    let token_hash = token_hash_base64(token);
    let mut tx = state.db.begin().await?;
    let token_row = sqlx::query_as::<_, EmailVerificationTokenRow>(
        r#"DELETE FROM email_verification_tokens WHERE token_hash = $1
           RETURNING user_id, email, expires_at"#,
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = token_row else {
        return Err(AppError::Validation(
            "Invalid email verification token".into(),
        ));
    };

    if chrono::Utc::now() > row.expires_at {
        // Keep the deletion: an expired link is spent either way.
        tx.commit().await?;
        return Err(AppError::Validation(
            "Email verification token has expired".into(),
        ));
    }

    let current_email =
        sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1 FOR UPDATE")
            .bind(row.user_id)
            .fetch_one(&mut *tx)
            .await?;
    let email_changed = !current_email.eq_ignore_ascii_case(&row.email);

    // Another account may have taken the pending address since the link was sent.
    let taken = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(email) = lower($1) AND id <> $2",
    )
    .bind(&row.email)
    .bind(row.user_id)
    .fetch_one(&mut *tx)
    .await?;
    if taken > 0 {
        return Err(AppError::Conflict(
            "That email address is already in use".into(),
        ));
    }
    // Moving the account to another address ends its sessions, like a password change.
    let updated = sqlx::query_as::<_, User>(
        r#"UPDATE users
           SET email = $1,
               email_verified = TRUE,
               token_version = token_version + CASE WHEN $3 THEN 1 ELSE 0 END
           WHERE id = $2
           RETURNING *"#,
    )
    .bind(&row.email)
    .bind(row.user_id)
    .bind(email_changed)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(database) if database.is_unique_violation() => {
            AppError::Conflict("That email address is already in use".into())
        }
        _ => AppError::from(error),
    })?;

    if email_changed {
        revoke_pending_account_tokens(&mut tx, row.user_id).await?;
    }

    tx.commit().await?;

    let public_user = UserPublic::from(updated);
    crate::ws::publish_event(
        &state,
        WsEvent::UserUpdated {
            user: UserBroadcastProfile::from(&public_user),
        },
    )
    .await;

    Ok(Json(ConfirmEmailVerificationResponse {
        message: if email_changed {
            "Your email address has been changed. Please sign in again.".to_string()
        } else {
            "Your email address has been verified.".to_string()
        },
    }))
}

/// POST /api/auth/change-password
pub(super) async fn change_password(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<(HeaderMap, Json<serde_json::Value>), AppError> {
    enforce_rate_limit(
        &state.redis,
        format!("auth:change_password:{}", claims.sub),
        5,
        Duration::from_secs(60 * 60), // max 5 attempts per hour
        "Too many password change attempts. Please wait.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }
    ensure_password_within_limit(&body.new_password)?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("User not found".into()))?;

    if !verify_password_async(&body.old_password, &user.password_hash).await? {
        return Err(AppError::InvalidCredentials);
    }

    let password_hash = hash_password_async(&body.new_password).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
    )
    .bind(&password_hash)
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;
    revoke_pending_account_tokens(&mut tx, claims.sub).await?;
    tx.commit().await?;

    // Invalidate the current token if it can be extracted
    if let Some(token) = crate::middleware::auth::token_from_request(&headers, &state.cookie_name) {
        crate::services::jwt_blacklist::blacklist_until_exp(&state.redis, &token, claims.exp)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to revoke JWT token: {e}")))?;
    }

    let out_headers = clear_auth_cookie_header(&state);
    Ok((
        out_headers,
        Json(serde_json::json!({ "message": "Password changed successfully" })),
    ))
}
