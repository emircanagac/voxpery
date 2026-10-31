use super::*;

/// Creates a category and a text channel in it, both as the owner.
async fn create_channel_in_category(
    app: &mut axum::Router,
    owner_auth: &str,
    server_id: Uuid,
    category: &str,
    name: &str,
) -> Uuid {
    let (status, body) = api_json(
        app,
        "POST",
        &format!("/api/channels/server/{server_id}/categories"),
        owner_auth,
        Some(json!({ "name": category })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "category create failed: {body}");
    let (status, channel) = api_json(
        app,
        "POST",
        "/api/channels",
        owner_auth,
        Some(json!({ "server_id": server_id, "name": name, "category": category })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "channel create failed: {channel}");
    channel["id"].as_str().unwrap().parse().unwrap()
}

async fn category_override_count(state: &AppState, server_id: Uuid, category: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM channel_category_role_overrides WHERE server_id = $1 AND category = $2",
    )
    .bind(server_id)
    .bind(category)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

#[tokio::test]
async fn channel_managers_cannot_lift_category_restrictions_by_moving_channels() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "catowner").await;
    let (manager_auth, manager_id, _) = register_named_user(&mut app, "catmanager").await;
    let (member_auth, _, _) = register_named_user(&mut app, "catmember").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Category Guild")
            .await;
    join_with_invite(&mut app, &manager_auth, &invite_code).await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    grant_role_with_permissions(
        &state,
        server_id,
        manager_id,
        "Channel managers",
        1,
        PERM_VIEW | PERM_SEND | PERM_MANAGE_CHANNELS,
    )
    .await;
    let secret_channel_id =
        create_channel_in_category(&mut app, &owner_auth, server_id, "Secret", "plans").await;
    let open_channel_id =
        create_channel_in_category(&mut app, &owner_auth, server_id, "Lobby", "chat").await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/Secret/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_VIEW })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "owner override failed: {body}");
    let (status, _) = api_json(
        &mut app,
        "GET",
        &format!("/api/messages/{secret_channel_id}"),
        &member_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "the member cannot read Secret"
    );

    // Moving the restricted channel out, into an unrestricted or a brand-new category, changes
    // its permissions and is therefore owner-only.
    for target in ["Lobby", "Fresh"] {
        let (status, body) = api_json(
            &mut app,
            "PATCH",
            &format!("/api/channels/{secret_channel_id}"),
            &manager_auth,
            Some(json!({ "name": "plans", "category": target })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "move to {target}: {body}");
    }
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/server/{server_id}/categories/Secret?move_to=Lobby"),
        &manager_auth,
        None,
    )
    .await;
    // Secret is hidden from this manager, so it looks missing to them.
    assert_eq!(status, StatusCode::NOT_FOUND, "category delete: {body}");
    let (status, _) = api_json(
        &mut app,
        "GET",
        &format!("/api/messages/{secret_channel_id}"),
        &member_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Secret stays closed");

    // Managers still move channels between categories with the same permissions.
    let (status, body) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/channels/{open_channel_id}"),
        &manager_auth,
        Some(json!({ "name": "chat", "category": "Fresh" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "same-permission move failed: {body}"
    );

    // The owner may delete the category; its overrides go with it, so a new category with the
    // same name starts without them.
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/server/{server_id}/categories/Secret?move_to=Lobby"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "owner category delete: {body}");
    assert_eq!(
        category_override_count(&state, server_id, "Secret").await,
        0
    );
}

#[tokio::test]
async fn report_quotes_stay_hidden_after_their_channel_is_deleted() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "reportowner").await;
    let (member_auth, _, _) = register_named_user(&mut app, "reportmember").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Report Guild")
            .await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let channel_id =
        create_channel_in_category(&mut app, &owner_auth, server_id, "Staff", "staff").await;
    let (status, message) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        &member_auth,
        Some(json!({ "content": "quoted secret" })),
    )
    .await;
    assert!(status.is_success(), "send failed: {message}");
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/reports/message"),
        &owner_auth,
        Some(json!({ "message_id": message["id"], "reason": "other" })),
    )
    .await;
    assert!(status.is_success(), "report failed: {body}");
    let reports_uri = format!("/api/servers/{server_id}/reports");
    let (_, reports) = api_json(&mut app, "GET", &reports_uri, &owner_auth, None).await;
    assert_eq!(reports[0]["message_excerpt"], "quoted secret");

    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/{channel_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert!(status.is_success(), "channel delete failed: {body}");
    let (status, reports) = api_json(&mut app, "GET", &reports_uri, &owner_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        reports[0]["message_excerpt"].is_null(),
        "who could read a deleted channel can no longer be checked: {reports}"
    );
}

#[tokio::test]
async fn the_deleted_account_placeholder_address_cannot_be_registered() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    for email in ["deleted@system.local", "someone@SYSTEM.LOCAL"] {
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/register")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&registration_body(
                    email,
                    &format!("squatter_{}", Uuid::new_v4().as_u128() % 1_000_000),
                    test_credential("squatter"),
                ))
                .unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, request).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{email} was accepted: {}",
            String::from_utf8_lossy(&body)
        );
    }

    // Deleting an account hands its history to the flagged system account, never to a user.
    let (leaver_auth, _, password) = register_named_user(&mut app, "placeholderleaver").await;
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &leaver_auth,
        Some(json!({ "confirm": "DELETE", "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "account delete failed: {body}");
    let system_accounts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE is_system")
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(system_accounts, 1);
}

#[tokio::test]
async fn voice_tokens_always_name_the_canonical_room() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "roomowner").await;
    let (server_id, _, _) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Room Guild").await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    for spelling in [
        voice_channel_id.to_string().to_uppercase(),
        voice_channel_id.simple().to_string(),
        voice_channel_id.urn().to_string(),
    ] {
        let request = Request::builder()
            .uri(format!("/api/webrtc/livekit-token?channel_id={spelling}"))
            .header("Authorization", &owner_auth)
            .body(Body::empty())
            .unwrap();
        let (status, body) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
        let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(response["room"], voice_channel_id.to_string(), "{spelling}");
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(
                response["token"]
                    .as_str()
                    .unwrap()
                    .split('.')
                    .nth(1)
                    .unwrap(),
            )
            .unwrap();
        let claims: serde_json::Value = serde_json::from_slice(&claims).unwrap();
        assert_eq!(claims["video"]["room"], voice_channel_id.to_string());
    }
}

#[tokio::test]
async fn a_first_password_needs_a_recent_google_sign_in() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (_, user_id, _) = register_named_user(&mut app, "googlesetter").await;
    sqlx::query("UPDATE users SET password_hash = 'oauth', google_id = $2 WHERE id = $1")
        .bind(user_id)
        .bind(format!("google-{user_id}"))
        .execute(&state.db)
        .await
        .unwrap();
    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let token_issued = |seconds_ago: i64| {
        let now = chrono::Utc::now().timestamp();
        jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &json!({
                "sub": user_id,
                "username": username,
                "iat": now - seconds_ago,
                "exp": now + 3600,
                "ver": 0
            }),
            &jsonwebtoken::EncodingKey::from_secret(state.jwt_secret.as_bytes()),
        )
        .unwrap()
    };
    let body = json!({ "new_password": test_credential("first-password") });
    let (status, error) = api_json(
        &mut app,
        "POST",
        "/api/auth/set-password",
        &format!("Bearer {}", token_issued(60 * 60)),
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error["code"], "REAUTH_REQUIRED", "{error}");
    let (status, response) = api_json(
        &mut app,
        "POST",
        "/api/auth/set-password",
        &format!("Bearer {}", token_issued(30)),
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let new_auth = format!("Bearer {}", response["token"].as_str().unwrap());
    let (status, error) = api_json(
        &mut app,
        "POST",
        "/api/auth/set-password",
        &new_auth,
        Some(body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "only one first password: {error}"
    );
}

#[tokio::test]
async fn required_email_verification_keeps_unverified_accounts_out_of_app_data() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_requiring_email_verification().await;
    let (auth, user_id, _) = register_named_user(&mut app, "unverified").await;
    let (status, error) = api_json(&mut app, "GET", "/api/servers", &auth, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error["code"], "EMAIL_VERIFICATION_REQUIRED", "{error}");

    // The session and account routes stay reachable, so the user can verify or leave.
    let (status, session) = api_json(&mut app, "GET", "/api/auth/session", &auth, None).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    let (status, body) = api_json(
        &mut app,
        "PATCH",
        "/api/auth/status",
        &auth,
        Some(json!({ "status": "online" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "account routes stay usable: {body}");

    sqlx::query("UPDATE users SET email_verified = TRUE WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, body) = api_json(&mut app, "GET", "/api/servers", &auth, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn friend_requests_cannot_be_canceled_after_they_were_accepted() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (requester_auth, requester_id, _) = register_named_user(&mut app, "requester").await;
    let (receiver_auth, receiver_id, _) = register_named_user(&mut app, "receiver").await;
    let request_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO friend_requests (id, requester_id, receiver_id, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
    )
    .bind(request_id)
    .bind(requester_id)
    .bind(receiver_id)
    .execute(&state.db)
    .await
    .unwrap();
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/friends/requests/{request_id}/accept"),
        &receiver_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "accept failed: {body}");
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/friends/requests/{request_id}/reject"),
        &requester_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "late cancel: {body}");
    let status: String = sqlx::query_scalar("SELECT status FROM friend_requests WHERE id = $1")
        .bind(request_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(status, "accepted");
}

#[tokio::test]
async fn oversized_group_dm_lists_are_refused_before_any_work() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let (auth, _, _) = register_named_user(&mut app, "groupflooder").await;
    let many: Vec<Uuid> = (0..5_000).map(|_| Uuid::new_v4()).collect();
    let started = std::time::Instant::now();
    let (status, error) = api_json(
        &mut app,
        "POST",
        "/api/dm/groups",
        &auth,
        Some(json!({ "member_ids": many })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "rejection took {:?}",
        started.elapsed()
    );
    let (status, error) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/groups/{}/members", Uuid::new_v4()),
        &auth,
        Some(json!({ "user_ids": many })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
}

/// The only regular file under `root`.
fn single_stored_file(root: &Path) -> std::path::PathBuf {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                found.push(path);
            }
        }
    }
    assert_eq!(found.len(), 1, "{found:?}");
    found.remove(0)
}

#[tokio::test]
async fn failed_file_removals_after_account_deletion_are_retried() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (auth, _, password) = register_named_user(&mut app, "fileleaver").await;
    upload_text_file(&mut app, &auth, "notes.txt", b"private notes").await;
    let root = state.attachment_service.local_storage_dir().unwrap();
    let stored = single_stored_file(&root);
    let storage_key: String = sqlx::query_scalar(
        "SELECT storage_key FROM uploaded_attachments ORDER BY created_at DESC LIMIT 1",
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    // A directory where the file was makes the removal fail.
    std::fs::remove_file(&stored).unwrap();
    std::fs::create_dir(&stored).unwrap();

    let (status, body) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &auth,
        Some(json!({ "confirm": "DELETE", "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "account delete failed: {body}");
    assert_eq!(body["files_pending_removal"], 1, "{body}");
    let queued: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_file_deletions WHERE storage_key = $1")
            .bind(&storage_key)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(queued, 1, "the failed removal stays queued");

    std::fs::remove_dir(&stored).unwrap();
    std::fs::write(&stored, b"private notes").unwrap();
    voxpery_server::services::attachment_release::retry_pending_file_deletions(
        &state.db,
        &state.attachment_service,
    )
    .await
    .unwrap();
    assert!(!stored.exists(), "the retry removed the file");
    let queued: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_file_deletions WHERE storage_key = $1")
            .bind(&storage_key)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(queued, 0);
}

async fn pending_link_count(state: &AppState, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        r#"SELECT (SELECT COUNT(*) FROM email_verification_tokens WHERE user_id = $1)
                + (SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1)"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

/// Leaves a pending email change and password reset on the account; returns the email token.
async fn seed_pending_links(state: &AppState, user_id: Uuid, email: &str) -> String {
    let token = Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
           ON CONFLICT (user_id) DO UPDATE SET
               email = EXCLUDED.email, token_hash = EXCLUDED.token_hash"#,
    )
    .bind(user_id)
    .bind(email)
    .bind(token_hash_base64(&token))
    .execute(&state.db)
    .await
    .unwrap();
    seed_password_reset_token(
        state,
        user_id,
        chrono::Utc::now() + chrono::Duration::hours(1),
    )
    .await;
    token
}

async fn account_email(state: &AppState, user_id: Uuid) -> String {
    sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap()
}

#[tokio::test]
async fn account_takeover_and_password_changes_revoke_pending_links() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    // Someone registered the address first and left an email change waiting; the real owner
    // then signs in with Google.
    let (_, squatter_id, _) = register_named_user(&mut app, "squatter").await;
    let email = account_email(&state, squatter_id).await;
    seed_pending_links(&state, squatter_id, "attacker@example.com").await;
    let google_id = format!("google-{squatter_id}");
    assert!(!voxpery_server::services::auth::link_google_identity(
        &state.db,
        squatter_id,
        &google_id,
        "another-address@example.com",
    )
    .await
    .unwrap());
    assert_eq!(pending_link_count(&state, squatter_id).await, 2);
    assert!(voxpery_server::services::auth::link_google_identity(
        &state.db,
        squatter_id,
        &google_id,
        &email,
    )
    .await
    .unwrap());
    assert_eq!(pending_link_count(&state, squatter_id).await, 0);

    let (auth, user_id, password) = register_named_user(&mut app, "rotator").await;
    seed_pending_links(&state, user_id, "elsewhere@example.com").await;
    let (status, body) = api_json(
        &mut app,
        "POST",
        "/api/auth/change-password",
        &auth,
        Some(json!({ "old_password": password, "new_password": test_credential("rotated") })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "change failed: {body}");
    assert_eq!(pending_link_count(&state, user_id).await, 0);
}

#[tokio::test]
async fn a_password_reset_revokes_a_pending_email_change() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;
    let (_, user_id, _) = register_named_user(&mut app, "resetter").await;
    seed_pending_links(&state, user_id, "elsewhere@example.com").await;
    let token = seed_password_reset_token(
        &state,
        user_id,
        chrono::Utc::now() + chrono::Duration::hours(1),
    )
    .await;
    let (status, _) = oneshot(
        &mut app,
        reset_password_request(&token, test_credential("after-reset")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pending_link_count(&state, user_id).await, 0);
}

#[tokio::test]
async fn confirming_a_new_address_ends_sessions_but_verifying_the_current_one_does_not() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(true, false).await;
    let (auth, user_id, _) = register_named_user(&mut app, "mover").await;

    let current = account_email(&state, user_id).await;
    let token = seed_pending_links(&state, user_id, &current).await;
    let (status, body) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/confirm",
        "",
        Some(json!({ "token": token })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "confirm failed: {body}");
    let (status, _) = api_json(&mut app, "GET", "/api/auth/me", &auth, None).await;
    assert_eq!(status, StatusCode::OK, "verifying changes no session");
    assert_eq!(
        pending_link_count(&state, user_id).await,
        1,
        "the reset link survives a plain verification"
    );

    let next_email = format!("moved-{user_id}@example.com");
    let token = seed_pending_links(&state, user_id, &next_email).await;
    let (status, body) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/confirm",
        "",
        Some(json!({ "token": token })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "confirm failed: {body}");
    assert_eq!(account_email(&state, user_id).await, next_email);
    assert_eq!(pending_link_count(&state, user_id).await, 0);
    let (status, _) = api_json(&mut app, "GET", "/api/auth/me", &auth, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "old sessions end");

    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/confirm",
        "",
        Some(json!({ "token": token })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a link works only once");
}

#[tokio::test]
async fn the_google_identity_wins_over_a_local_account_with_the_same_address() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (_, linked_id, _) = register_named_user(&mut app, "linked").await;
    let (_, local_id, _) = register_named_user(&mut app, "local").await;
    let google_id = format!("google-{linked_id}");
    let old_address = account_email(&state, local_id).await;
    sqlx::query("UPDATE users SET google_id = $1 WHERE id = $2")
        .bind(&google_id)
        .bind(linked_id)
        .execute(&state.db)
        .await
        .unwrap();

    let found =
        voxpery_server::services::auth::find_google_account(&state.db, &google_id, &old_address)
            .await
            .unwrap()
            .expect("both accounts match");
    assert_eq!(found.id, linked_id);
}

#[tokio::test]
async fn image_grants_wait_for_current_legal_consent() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (auth, user_id, _) = register_named_user(&mut app, "stale").await;
    let (status, session) = api_json(&mut app, "GET", "/api/auth/session", &auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(session["image_proxy"]["grant"].is_string());

    sqlx::query("UPDATE users SET terms_version = 'outdated' WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, session) = api_json(&mut app, "GET", "/api/auth/session", &auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(session.get("image_proxy").is_none());
    let (status, _) = api_json(&mut app, "GET", "/api/images/grant", &auth, None).await;
    assert_eq!(status, StatusCode::PRECONDITION_REQUIRED);
}

#[tokio::test]
async fn oversized_passwords_and_request_bodies_are_refused() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _state) = setup_app().await;
    let (auth, user_id, password) = register_named_user(&mut app, "lengthy").await;
    let too_long = "x".repeat(1025);

    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/change-password",
        &auth,
        Some(json!({ "old_password": password, "new_password": too_long })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/login",
        "",
        Some(json!({ "identifier": format!("{user_id}@example.com"), "password": too_long })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/change-password",
        &auth,
        Some(json!({ "old_password": "y".repeat(70 * 1024), "new_password": "z" })),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn failed_logins_count_against_the_account_whichever_identifier_is_used() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (_, user_id, password) = register_named_user(&mut app, "locked").await;
    let email = account_email(&state, user_id).await;
    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    for attempt in 0..state.login_failure_max_attempts {
        let identifier = if attempt % 2 == 0 { &email } else { &username };
        let (status, _) = api_json(
            &mut app,
            "POST",
            "/api/auth/login",
            "",
            Some(json!({ "identifier": identifier, "password": "wrong-password" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/login",
        "",
        Some(json!({ "identifier": email, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn no_sign_up_decides_who_owns_the_official_server() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let parked = format!("parked-{}", Uuid::new_v4().simple());
    let parked = &parked[..16];
    sqlx::query("UPDATE servers SET invite_code = $1 WHERE invite_code = 'voxpery'")
        .bind(parked)
        .execute(&state.db)
        .await
        .unwrap();

    let (_, user_id, _) = register_named_user(&mut app, "firstcomer").await;
    let created: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE invite_code = 'voxpery'")
            .fetch_one(&state.db)
            .await
            .unwrap();
    let owned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE owner_id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    sqlx::query("UPDATE servers SET invite_code = 'voxpery' WHERE invite_code = $1")
        .bind(parked)
        .execute(&state.db)
        .await
        .unwrap();
    assert_eq!(created, 0);
    assert_eq!(owned, 0);
}

async fn member_role_count(state: &AppState, server_id: Uuid, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

#[tokio::test]
async fn leaving_a_server_ends_roles_but_not_server_voice_moderation() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "roleowner").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "rolemember").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Role Guild").await;

    for how in ["kick", "leave"] {
        join_with_invite(&mut app, &member_auth, &invite_code).await;
        grant_role_with_permissions(
            &state,
            server_id,
            member_id,
            &format!("Trusted {how}"),
            1,
            PERM_VIEW | PERM_KICK,
        )
        .await;
        sqlx::query(
            r#"UPDATE server_members SET voice_server_muted = TRUE, voice_server_deafened = TRUE
               WHERE server_id = $1 AND user_id = $2"#,
        )
        .bind(server_id)
        .bind(member_id)
        .execute(&state.db)
        .await
        .unwrap();

        let (status, body) = if how == "kick" {
            api_json(
                &mut app,
                "DELETE",
                &format!("/api/servers/{server_id}/members/{member_id}"),
                &owner_auth,
                None,
            )
            .await
        } else {
            api_json(
                &mut app,
                "POST",
                &format!("/api/servers/{server_id}/leave"),
                &member_auth,
                None,
            )
            .await
        };
        assert_eq!(status, StatusCode::OK, "{how} failed: {body}");
        assert_eq!(member_role_count(&state, server_id, member_id).await, 0);

        join_with_invite(&mut app, &member_auth, &invite_code).await;
        assert_eq!(member_role_count(&state, server_id, member_id).await, 0);
        let moderation: (bool, bool) = sqlx::query_as(
            r#"SELECT voice_server_muted, voice_server_deafened FROM server_members
               WHERE server_id = $1 AND user_id = $2"#,
        )
        .bind(server_id)
        .bind(member_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(moderation, (true, true), "after {how} and rejoin");

        sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(member_id)
            .execute(&state.db)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a_ban_and_a_join_at_the_same_moment_never_leave_a_banned_member() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "banowner").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Race Guild").await;

    // Joining is limited to five attempts a minute per account, so each round uses a new one.
    for round in 0..10 {
        let (target_auth, target_id, _) =
            register_named_user(&mut app, &format!("banrace{round}")).await;
        let mut join_app = app.clone();
        let mut ban_app = app.clone();
        let join = api_json(
            &mut join_app,
            "POST",
            "/api/servers/join",
            &target_auth,
            Some(json!({ "invite_code": invite_code })),
        );
        let ban_path = format!("/api/servers/{server_id}/members/{target_id}/ban");
        let ban = api_json(
            &mut ban_app,
            "POST",
            &ban_path,
            &owner_auth,
            Some(json!({})),
        );
        let (_, (ban_status, ban_body)) = tokio::join!(join, ban);
        assert_eq!(ban_status, StatusCode::OK, "ban failed: {ban_body}");
        let still_member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        )
        .bind(server_id)
        .bind(target_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert!(!still_member, "round {round} left a banned member");
    }
}

#[tokio::test]
async fn category_restrictions_bind_server_wide_channel_managers() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "hideowner").await;
    let (manager_auth, manager_id, _) = register_named_user(&mut app, "hidemanager").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Hidden Guild")
            .await;
    join_with_invite(&mut app, &manager_auth, &invite_code).await;
    grant_role_with_permissions(
        &state,
        server_id,
        manager_id,
        "Channel managers",
        1,
        PERM_VIEW | PERM_SEND | PERM_MANAGE_CHANNELS,
    )
    .await;
    create_channel_in_category(&mut app, &owner_auth, server_id, "Secret", "plans").await;
    create_channel_in_category(&mut app, &owner_auth, server_id, "Lobby", "chat").await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/Secret/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_VIEW })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "override failed: {body}");

    let (status, categories) = api_json(
        &mut app,
        "GET",
        &format!("/api/channels/server/{server_id}/categories"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let visible: Vec<String> = categories
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap().to_string())
        .collect();
    assert!(!visible.contains(&"Secret".to_string()), "{visible:?}");
    assert!(visible.contains(&"Lobby".to_string()), "{visible:?}");

    for (method, path, payload) in [
        (
            "PATCH",
            format!("/api/channels/server/{server_id}/categories/secret"),
            Some(json!({ "name": "Open" })),
        ),
        (
            "DELETE",
            format!("/api/channels/server/{server_id}/categories/Secret"),
            None,
        ),
        (
            "GET",
            format!("/api/channels/server/{server_id}/categories/Secret/overrides"),
            None,
        ),
    ] {
        let (status, body) = api_json(&mut app, method, &path, &manager_auth, payload).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}: {body}");
    }
    let (status, body) = api_json(
        &mut app,
        "POST",
        "/api/channels",
        &manager_auth,
        Some(json!({ "server_id": server_id, "name": "spy", "category": "SECRET" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "create in hidden: {body}");

    // The manager reorders what they see; the hidden category stays where it was.
    let position = |name: &'static str| {
        let db = state.db.clone();
        async move {
            sqlx::query_scalar::<_, i32>(
                "SELECT position FROM server_channel_categories WHERE server_id = $1 AND name = $2",
            )
            .bind(server_id)
            .bind(name)
            .fetch_one(&db)
            .await
            .unwrap()
        }
    };
    let secret_position = position("Secret").await;
    let mut reordered = visible.clone();
    reordered.reverse();
    let (status, body) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/channels/server/{server_id}/categories/reorder"),
        &manager_auth,
        Some(json!({ "category_names": reordered })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "reorder failed: {body}");
    assert_eq!(position("Secret").await, secret_position);
}

#[tokio::test]
async fn only_the_owner_deletes_an_empty_category_with_overrides() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "emptyowner").await;
    let (manager_auth, manager_id, _) = register_named_user(&mut app, "emptymanager").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Empty Guild").await;
    join_with_invite(&mut app, &manager_auth, &invite_code).await;
    grant_role_with_permissions(
        &state,
        server_id,
        manager_id,
        "Channel managers",
        1,
        PERM_VIEW | PERM_SEND | PERM_MANAGE_CHANNELS,
    )
    .await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    let channel_id =
        create_channel_in_category(&mut app, &owner_auth, server_id, "Quiet", "room").await;
    let (status, _) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/Quiet/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_SEND })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let path = format!("/api/channels/server/{server_id}/categories/Quiet");
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("{path}?move_to=Elsewhere"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "moving its channels: {body}");
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/{channel_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = api_json(&mut app, "DELETE", &path, &manager_auth, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(category_override_count(&state, server_id, "Quiet").await, 1);
    let (status, _) = api_json(&mut app, "DELETE", &path, &owner_auth, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn moving_a_voice_channel_to_a_stricter_category_ends_unauthorized_sessions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "voicecatowner").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "voicecatmember").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Voice Guild").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    create_channel_in_category(&mut app, &owner_auth, server_id, "Staff", "desk").await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, _) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/Staff/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_VIEW })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    state.voice_sessions.insert(member_id, voice_channel_id);
    let (status, body) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/channels/{voice_channel_id}"),
        &owner_auth,
        Some(json!({ "name": "General", "category": "Staff" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "move failed: {body}");
    assert!(!state.voice_sessions.contains_key(&member_id));
}

#[tokio::test]
async fn editing_a_message_needs_the_permission_to_send_one() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "editowner").await;
    let (member_auth, _, _) = register_named_user(&mut app, "editmember").await;
    let (server_id, channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Edit Guild").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let (status, message) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        &member_auth,
        Some(json!({ "content": "first words" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "send failed: {message}");
    let message_id = message["id"].as_str().unwrap();
    let path = format!("/api/messages/item/{message_id}");

    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &path,
        &member_auth,
        Some(json!({ "content": "second words" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let everyone_id = everyone_role_id(&state, server_id).await;
    put_channel_override_row(&state, channel_id, everyone_id, 0, PERM_SEND).await;
    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &path,
        &member_auth,
        Some(json!({ "content": "third words" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ending_a_friendship_closes_a_friends_only_conversation() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (private_auth, private_id, _) = register_named_user(&mut app, "dmprivate").await;
    let (other_auth, other_id, _) = register_named_user(&mut app, "dmother").await;
    befriend(&state, private_id, other_id).await;
    sqlx::query("UPDATE users SET dm_privacy = 'friends' WHERE id = $1")
        .bind(private_id)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, channel) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{other_id}"),
        &private_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "open failed: {channel}");
    let channel_id = channel["id"].as_str().unwrap().to_string();
    let messages = format!("/api/dm/messages/{channel_id}");
    let mut send = async |auth: &str, content: &str| {
        api_json(
            &mut app,
            "POST",
            &messages,
            auth,
            Some(json!({ "content": content })),
        )
        .await
    };
    let (status, _) = send(&private_auth, "hello").await;
    assert_eq!(status, StatusCode::OK);
    let (status, mine) = send(&other_auth, "hello back").await;
    assert_eq!(status, StatusCode::OK);
    let my_message_id = mine["id"].as_str().unwrap().to_string();

    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/friends/{other_id}"),
        &private_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;

    let item = format!("/api/dm/messages/item/{my_message_id}");
    for (method, path, payload) in [
        (
            "POST",
            messages.clone(),
            json!({ "content": "still there?" }),
        ),
        ("PATCH", item.clone(), json!({ "content": "edited" })),
        (
            "POST",
            format!("{item}/reactions"),
            json!({ "emoji": "👍" }),
        ),
        (
            "POST",
            format!("/api/dm/channels/{channel_id}/pins"),
            json!({ "message_id": my_message_id }),
        ),
    ] {
        let (status, body) = api_json(&mut app, method, &path, &other_auth, Some(payload)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
    }

    // Writing again reopens the conversation.
    let (status, _) = api_json(
        &mut app,
        "POST",
        &messages,
        &private_auth,
        Some(json!({ "content": "one more thing" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = api_json(
        &mut app,
        "POST",
        &messages,
        &other_auth,
        Some(json!({ "content": "go ahead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn typing_needs_what_sending_needs() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "typingowner").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "typingmember").await;
    let (server_id, channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Typing Guild")
            .await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let addr = spawn_ws_app(&state).await;
    let mut owner_ws = connect_ws(addr, &owner_auth).await;
    ws_subscribe(&mut owner_ws, &[channel_id]).await;
    let mut member_ws = connect_ws(addr, &member_auth).await;
    let typing = json!({
        "type": "Typing",
        "data": { "channel_id": channel_id, "is_typing": true },
    });

    ws_send(&mut member_ws, typing.clone()).await;
    let event = receive_ws_event(&mut owner_ws, "Typing").await;
    assert_eq!(event["data"]["user_id"], member_id.to_string());

    let everyone_id = everyone_role_id(&state, server_id).await;
    put_channel_override_row(&state, channel_id, everyone_id, 0, PERM_SEND).await;
    ws_send(
        &mut member_ws,
        json!({
            "type": "Typing",
            "data": { "channel_id": channel_id, "is_typing": false },
        }),
    )
    .await;
    receive_ws_event(&mut owner_ws, "Typing").await;
    ws_send(&mut member_ws, typing).await;
    ws_barrier(&mut member_ws).await;
    assert_no_ws_event_mentioning(
        &mut owner_ws,
        "Typing",
        &member_id.to_string(),
        std::time::Duration::from_millis(500),
    )
    .await;
}

/// Serves the LiveKit room API with one participant and records removals as room/identity.
async fn spawn_livekit_with_participant(
    sid: &'static str,
) -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
    let removed = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = removed.clone();
    let livekit_app = axum::Router::new()
        .route(
            "/twirp/livekit.RoomService/GetParticipant",
            axum::routing::post(
                move |axum::Json(body): axum::Json<serde_json::Value>| async move {
                    axum::Json(json!({ "sid": sid, "identity": body["identity"] }))
                },
            ),
        )
        .route(
            "/twirp/livekit.RoomService/RemoveParticipant",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let recorded = recorded.clone();
                async move {
                    recorded
                        .lock()
                        .unwrap()
                        .push(format!("{}/{}", body["room"], body["identity"]));
                    axum::Json(json!({}))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(listener, livekit_app).await;
    });
    (format!("http://{addr}"), removed)
}

#[tokio::test]
async fn livekit_participants_without_a_voice_session_are_removed() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (api_url, removed) = spawn_livekit_with_participant("PA_real").await;
    let (_app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://client-livekit.example.test".to_string(),
        Some(api_url),
    )
    .await;
    let check = voxpery_server::services::voice_revoke::end_unclaimed_participant;
    let channel_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    // A newer connection answers to another SID.
    check(state.clone(), channel_id, user_id, Some("PA_old".into())).await;
    assert!(removed.lock().unwrap().is_empty());

    // With a session the participant stays, and the SID LiveKit knows replaces the reported one.
    state.voice_sessions.insert(user_id, channel_id);
    state
        .voice_participant_sids
        .insert(user_id, "PA_claimed".to_string());
    check(state.clone(), channel_id, user_id, Some("PA_real".into())).await;
    assert!(removed.lock().unwrap().is_empty());
    assert_eq!(
        state.voice_participant_sids.get(&user_id).unwrap().as_str(),
        "PA_real"
    );

    // A join reported to another backend instance counts as a session.
    state.voice_sessions.remove(&user_id);
    voxpery_server::services::voice_revoke::record_voice_claim(&state, user_id, channel_id).await;
    check(state.clone(), channel_id, user_id, Some("PA_real".into())).await;
    assert!(removed.lock().unwrap().is_empty());

    voxpery_server::services::voice_revoke::clear_voice_claim(&state, user_id, channel_id).await;
    check(state.clone(), channel_id, user_id, Some("PA_real".into())).await;
    assert_eq!(removed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn switching_voice_channels_removes_the_participant_from_the_previous_room() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (api_url, removed) = spawn_livekit_with_participant("PA_first").await;
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://client-livekit.example.test".to_string(),
        Some(api_url),
    )
    .await;
    let (owner_auth, owner_id, _) = register_named_user(&mut app, "switcher").await;
    let (server_id, _, _) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Switch Guild")
            .await;
    let first_channel = voice_channel_of(&state, server_id).await;
    let (status, second) = api_json(
        &mut app,
        "POST",
        "/api/channels",
        &owner_auth,
        Some(json!({ "server_id": server_id, "name": "Second", "channel_type": "voice" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create failed: {second}");
    let second_channel = second["id"].as_str().unwrap();

    let addr = spawn_ws_app(&state).await;
    let mut ws = connect_ws(addr, &owner_auth).await;
    ws_send(
        &mut ws,
        json!({
            "type": "JoinVoice",
            "data": { "channel_id": first_channel, "participant_sid": "PA_first" },
        }),
    )
    .await;
    ws_barrier(&mut ws).await;
    ws_send(
        &mut ws,
        json!({ "type": "JoinVoice", "data": { "channel_id": second_channel } }),
    )
    .await;
    ws_barrier(&mut ws).await;
    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    assert_eq!(
        *removed.lock().unwrap(),
        vec![format!("\"{first_channel}\"/\"{owner_id}\"")]
    );
}

#[tokio::test]
async fn voice_moves_reveal_nothing_before_the_permission_checks() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "moveowner").await;
    let (target_auth, target_id, _) = register_named_user(&mut app, "movetarget").await;
    let (outsider_auth, _, _) = register_named_user(&mut app, "moveoutsider").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Move Guild").await;
    join_with_invite(&mut app, &target_auth, &invite_code).await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let (other_server_id, _, _) =
        create_server_with_default_text_channel(&mut app, &state, &outsider_auth, "Own Guild")
            .await;
    let own_voice_channel = voice_channel_of(&state, other_server_id).await;

    let addr = spawn_ws_app(&state).await;
    let mut outsider_ws = connect_ws(addr, &outsider_auth).await;
    let move_result = async |ws: &mut TestWs, channel_id: Uuid, target: Uuid| {
        ws_send(
            ws,
            json!({
                "type": "MoveVoiceMember",
                "data": { "target_user_id": target, "channel_id": channel_id },
            }),
        )
        .await;
        receive_ws_event(ws, "VoiceMemberMoveResult").await["data"]["message"]
            .as_str()
            .unwrap()
            .to_string()
    };

    let denied = move_result(&mut outsider_ws, voice_channel_id, target_id).await;
    assert_eq!(denied, "You do not have permission to move this member.");

    // In the moderator's own server, a member elsewhere looks the same as one not in voice.
    let absent = move_result(&mut outsider_ws, own_voice_channel, target_id).await;
    state.voice_sessions.insert(target_id, voice_channel_id);
    let elsewhere = move_result(&mut outsider_ws, own_voice_channel, target_id).await;
    state.voice_sessions.remove(&target_id);
    assert_eq!(absent, "The member is no longer connected to voice.");
    assert_eq!(elsewhere, absent);
}
