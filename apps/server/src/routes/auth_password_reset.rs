//! Forgotten-password email and password reset.
use super::*;

/// POST /api/auth/forgot-password
pub(super) async fn forgot_password(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.password_reset_enabled {
        return Err(feature_disabled(
            "Password reset is disabled because email delivery is not configured",
        ));
    }

    let email = body.email.trim().to_lowercase();
    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );
    let generic_ok = || {
        Json(
            serde_json::json!({ "message": "If an account with that email exists, we have sent a password reset link." }),
        )
    };

    // 1) IP-based rate limit to reduce brute-force / flood attempts.
    if let Some(ip) = client_ip.as_deref() {
        enforce_rate_limit(
            &state.redis,
            format!("auth:forgot_password_ip:{ip}"),
            10,
            Duration::from_secs(60), // max 10 attempts per minute per IP
            "Too many password reset requests. Please check your email or try again later.",
        )
        .await?;
    }

    // No account can have a malformed email; answer as usual without touching Redis.
    if email.len() > MAX_EMAIL_LEN || !is_valid_email(&email) {
        return Ok(generic_ok());
    }

    // 2) Per-email rate limit.
    enforce_rate_limit(
        &state.redis,
        format!("auth:forgot_password:{}", email),
        3,
        Duration::from_secs(3600), // max 3 attempts per hour
        "Too many password reset requests. Please check your email or try again later.",
    )
    .await?;

    #[derive(sqlx::FromRow)]
    struct ResetCandidate {
        id: Uuid,
        email: String,
    }

    let user =
        sqlx::query_as::<_, ResetCandidate>("SELECT id, email FROM users WHERE lower(email) = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;

    // Always return generic success to prevent account enumeration.
    let Some(user) = user else {
        return Ok(generic_ok());
    };

    // Generate token
    let token_plain = Uuid::new_v4().to_string();
    let token_hash = token_hash_base64(&token_plain);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    // Delete any existing token for this user to respect UNIQUE(user_id) constraint
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    // Insert new token
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user.id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    // Send email
    if let (Some(host), Some(smtp_user), Some(smtp_pass)) =
        (&state.smtp_host, &state.smtp_user, &state.smtp_password)
    {
        let frontend_url = frontend_base_url(&state);
        let reset_link = format!("{}/reset-password?token={}", frontend_url, token_plain);

        if let Err(e) = crate::services::email::send_password_reset_email(
            &user.email,
            &reset_link,
            host,
            smtp_user,
            smtp_pass,
        )
        .await
        {
            tracing::error!("Failed to send password reset email: {}", e);
        }
    } else {
        tracing::warn!("SMTP is not configured! Password reset email not sent.");
    }

    Ok(generic_ok())
}

/// POST /api/auth/reset-password
pub(super) async fn reset_password(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.password_reset_enabled {
        return Err(feature_disabled(
            "Password reset is disabled because email delivery is not configured",
        ));
    }

    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );
    if let Some(ip) = client_ip.as_deref() {
        enforce_rate_limit(
            &state.redis,
            format!("auth:reset_password_ip:{ip}"),
            10,
            Duration::from_secs(60),
            "Too many password reset attempts. Please wait and try again.",
        )
        .await?;
    }

    // Reset tokens are UUIDs; anything else cannot match and never reaches Redis.
    if body.token.len() != 36 || Uuid::parse_str(&body.token).is_err() {
        return Err(AppError::Validation("Invalid password reset token".into()));
    }

    enforce_rate_limit(
        &state.redis,
        format!("auth:reset_password_attempt:{}", body.token), // limit attempts per token to prevent brute force
        5,
        Duration::from_secs(3600),
        "Too many password reset attempts. Please request a new token.",
    )
    .await?;

    if body.new_password.len() < 8 {
        return Err(AppError::Validation(
            "New password must be at least 8 characters".into(),
        ));
    }

    let mut hasher = Sha256::new();
    hasher.update(body.token.as_bytes());
    let token_hash = BASE64.encode(hasher.finalize());

    #[derive(sqlx::FromRow)]
    struct TokenRow {
        user_id: Uuid,
        expires_at: chrono::DateTime<chrono::Utc>,
    }

    // Claim the token by deleting it: a concurrent request with the same token waits on the
    // row and then finds nothing, so each token resets the password at most once.
    let mut tx = state.db.begin().await?;
    let token_row = sqlx::query_as::<_, TokenRow>(
        "DELETE FROM password_reset_tokens WHERE token_hash = $1 RETURNING user_id, expires_at",
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = token_row else {
        return Err(AppError::Validation("Invalid password reset token".into()));
    };
    if chrono::Utc::now() > row.expires_at {
        // Keep the deletion: an expired token is spent either way.
        tx.commit().await?;
        return Err(AppError::Validation(
            "Password reset token has expired".into(),
        ));
    }

    let password_hash = hash_password(&body.new_password)?;
    sqlx::query(
        "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
    )
    .bind(&password_hash)
    .bind(row.user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(
        serde_json::json!({ "message": "Password has been successfully reset. You can now log in." }),
    ))
}
