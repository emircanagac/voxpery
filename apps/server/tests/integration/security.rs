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
    assert_eq!(status, StatusCode::FORBIDDEN, "category delete: {body}");
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
