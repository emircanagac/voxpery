use super::*;

#[tokio::test]
async fn dm_history_paginates_timestamp_ties_without_changing_read_state() {
    if test_db_url().is_none() {
        eprintln!("SKIP: database is not configured");
        return;
    }
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4().simple().to_string();
    let (token, user_id) = register_user(
        &mut app,
        &format!("history-{suffix}@example.com"),
        &format!("history{}", &suffix[..8]),
        test_credential("dm-history"),
    )
    .await;
    let channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO dm_channels (id) VALUES ($1)")
        .bind(channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO dm_channel_members (channel_id, user_id) VALUES ($1, $2)")
        .bind(channel_id)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    let mut ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    ids.sort();
    for id in ids {
        sqlx::query("INSERT INTO dm_messages (id, channel_id, user_id, content, created_at) VALUES ($1, $2, $3, 'history fixture', '2026-01-01T00:00:00Z')")
            .bind(id).bind(channel_id).bind(user_id).execute(&state.db).await.unwrap();
    }
    for (cursor, expected) in [(None, vec![ids[1], ids[2]]), (Some(ids[1]), vec![ids[0]])] {
        let uri = format!(
            "/api/dm/messages/{channel_id}?limit=2{}",
            cursor.map(|id| format!("&before={id}")).unwrap_or_default()
        );
        let (status, body) = oneshot(
            &mut app,
            Request::builder()
                .uri(uri)
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let rows: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
        let actual: Vec<Uuid> = rows
            .iter()
            .map(|row| Uuid::parse_str(row["id"].as_str().unwrap()).unwrap())
            .collect();
        assert_eq!(actual, expected);
    }
    let read_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_channel_reads WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(read_count, 0, "Fetching history must not mark a DM read");
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .method("POST")
            .uri(format!("/api/dm/channels/{channel_id}/read"))
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .uri(format!(
                "/api/dm/messages/{channel_id}?before={}&limit=2",
                ids[1]
            ))
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let last_read: Uuid = sqlx::query_scalar(
        "SELECT last_read_message_id FROM dm_channel_reads WHERE channel_id = $1 AND user_id = $2",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        last_read, ids[2],
        "Older history must not move the read marker backward"
    );
}

/// BOLA/auth: protected friends endpoints must return 401 when no token and no cookie.
#[tokio::test]
async fn friends_endpoints_require_auth() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    for uri in ["/api/friends/requests", "/api/friends"] {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        let (status, _body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{} must return 401 without auth; got {}",
            uri,
            status
        );
    }
}

#[tokio::test]
async fn friend_dm_channel_open_returns_channel_info() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("alice{}", &suffix[..8]);
    let bob_username = format!("bob{}", &suffix[8..16]);
    let alice_credential = format!("{}-{}", alice_username, Uuid::new_v4().simple());
    let bob_credential = format!("{}-{}", bob_username, Uuid::new_v4().simple());
    let (alice_token, _) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        &alice_credential,
    )
    .await;
    let (bob_token, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        &bob_credential,
    )
    .await;

    let alice_auth = format!("Bearer {alice_token}");
    let bob_auth = format!("Bearer {bob_token}");

    let friend_request_body = json!({ "username": bob_username });
    let req = Request::builder()
        .method("POST")
        .uri("/api/friends/requests")
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&friend_request_body).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/friends/requests")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "list friend requests failed: {}",
        String::from_utf8_lossy(&body)
    );
    let requests: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let request_id = requests["incoming"][0]["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/friends/requests/{request_id}/accept"))
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "accept friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "open friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channel["peer_id"].as_str().unwrap(), bob_id.to_string());
    assert_eq!(channel["peer_username"].as_str().unwrap(), bob_username);
    assert_eq!(channel["unread_count"].as_i64().unwrap(), 0);
}

#[tokio::test]
async fn dm_channel_visibility_and_pinning_persist_for_each_user() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("alice{}", &suffix[..8]);
    let bob_username = format!("bob{}", &suffix[8..16]);
    let alice_credential = format!("{}-{}", alice_username, Uuid::new_v4().simple());
    let bob_credential = format!("{}-{}", bob_username, Uuid::new_v4().simple());
    let (alice_token, _) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        &alice_credential,
    )
    .await;
    let (bob_token, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        &bob_credential,
    )
    .await;

    let alice_auth = format!("Bearer {alice_token}");
    let bob_auth = format!("Bearer {bob_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/friends/requests")
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "username": bob_username })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/friends/requests")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "list friend requests failed: {}",
        String::from_utf8_lossy(&body)
    );
    let requests: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let request_id = requests["incoming"][0]["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/friends/requests/{request_id}/accept"))
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "accept friend request failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "open friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{channel_id}/hide"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "hide friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 0);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/messages/{channel_id}"))
        .header("Authorization", &bob_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "new activity reopens the DM" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send DM activity failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);
    assert_eq!(channels[0]["id"].as_str().unwrap(), channel_id);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{channel_id}/hide"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "hide reopened friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/dm/channels/{bob_id}"))
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reopen hidden friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels.as_array().unwrap().len(), 1);

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/dm/channels/{channel_id}/preferences"))
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "pinned": true })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "pin friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(true));
    assert!(channels[0]["pinned_at"].as_str().is_some());

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &bob_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(false));
    assert!(channels[0]["pinned_at"].is_null());

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/dm/channels/{channel_id}/preferences"))
        .header("Authorization", &alice_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "pinned": false })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "unpin friend DM failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/dm/channels")
        .header("Authorization", &alice_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(channels[0]["is_pinned"].as_bool(), Some(false));
    assert!(channels[0]["pinned_at"].is_null());
}

#[tokio::test]
async fn dm_channel_create_race_returns_one_shared_channel() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let suffix = Uuid::new_v4().simple().to_string();
    let alice_username = format!("dmalice{}", &suffix[..8]);
    let bob_username = format!("dmbob{}", &suffix[8..16]);
    let (alice_token, alice_id) = register_user(
        &mut app,
        &format!("{alice_username}@example.com"),
        &alice_username,
        test_credential("default"),
    )
    .await;
    let (_, bob_id) = register_user(
        &mut app,
        &format!("{bob_username}@example.com"),
        &bob_username,
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {alice_token}");

    let request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/dm/channels/{bob_id}"))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    let response_a = response_a.expect("DM create request A should resolve");
    let response_b = response_b.expect("DM create request B should resolve");
    assert_eq!(response_a.status(), StatusCode::OK);
    assert_eq!(response_b.status(), StatusCode::OK);

    let body_a = response_a.into_body().collect().await.unwrap().to_bytes();
    let body_b = response_b.into_body().collect().await.unwrap().to_bytes();
    let channel_a: serde_json::Value = serde_json::from_slice(&body_a).unwrap();
    let channel_b: serde_json::Value = serde_json::from_slice(&body_b).unwrap();
    assert_eq!(channel_a["id"], channel_b["id"]);

    let pair_channel_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM dm_channels c
           WHERE EXISTS (
               SELECT 1 FROM dm_channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $1
           )
             AND EXISTS (
               SELECT 1 FROM dm_channel_members m
               WHERE m.channel_id = c.id AND m.user_id = $2
           )"#,
    )
    .bind(alice_id)
    .bind(bob_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pair_channel_count, 1, "a DM pair must have one channel");
}

#[tokio::test]
async fn dm_message_search_rate_limit_matches_server_search() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let user_suffix = Uuid::new_v4();
    let (user_token, user_id) = register_user(
        &mut app,
        &format!("dm-search-limit-{user_suffix}@example.com"),
        &format!("dm_search_{}", user_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let peer_suffix = Uuid::new_v4();
    let (_, peer_id) = register_user(
        &mut app,
        &format!("dm-search-peer-{peer_suffix}@example.com"),
        &format!("dm_peer_{}", peer_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {user_token}");
    let channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO dm_channels (id) VALUES ($1)")
        .bind(channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO dm_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)")
        .bind(channel_id)
        .bind(user_id)
        .bind(peer_id)
        .execute(&state.db)
        .await
        .unwrap();

    let search_request = || {
        Request::builder()
            .uri(format!("/api/dm/messages/{channel_id}/search?q=rate-limit"))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=15 {
        let (status, body) = oneshot(&mut app, search_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "DM search attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, search_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the sixteenth DM search should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn concurrent_friend_requests_create_one_pending_pair() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let sender_suffix = Uuid::new_v4();
    let (sender_token, sender_id) = register_user(
        &mut app,
        &format!("friend-idem-sender-{sender_suffix}@example.com"),
        &format!("friend_sender_{}", sender_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let target_suffix = Uuid::new_v4();
    let (target_token, target_id) = register_user(
        &mut app,
        &format!("friend-idem-target-{target_suffix}@example.com"),
        &format!("friend_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let sender_auth = format!("Bearer {sender_token}");
    let target_auth = format!("Bearer {target_token}");
    let sender_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(sender_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let target_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    let friend_request = |auth: &str, username: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/friends/requests")
            .header("Authorization", auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "username": username })).unwrap(),
            ))
            .unwrap()
    };
    let (request_a, request_b) = tokio::join!(
        app.clone()
            .oneshot(friend_request(&sender_auth, &target_username)),
        app.clone()
            .oneshot(friend_request(&target_auth, &sender_username))
    );
    assert_eq!(request_a.unwrap().status(), StatusCode::OK);
    assert_eq!(request_b.unwrap().status(), StatusCode::OK);
    let pending_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM friend_requests
           WHERE status = 'pending'
             AND LEAST(requester_id, receiver_id) = LEAST($1::uuid, $2::uuid)
             AND GREATEST(requester_id, receiver_id) = GREATEST($1::uuid, $2::uuid)"#,
    )
    .bind(sender_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pending_count, 1);
}

#[tokio::test]
async fn friends_only_users_can_be_answered_in_dms_they_wrote_in() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (private_auth, private_id, _) = register_named_user(&mut app, "private").await;
    let (open_auth, open_id, _) = register_named_user(&mut app, "open").await;
    sqlx::query("UPDATE users SET dm_privacy = 'friends' WHERE id = $1")
        .bind(private_id)
        .execute(&state.db)
        .await
        .unwrap();

    // A non-friend cannot start a DM with the friends-only user.
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{private_id}"),
        &open_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The friends-only user starts the DM; until they write, the other side still cannot.
    let (status, channel) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{open_id}"),
        &private_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "open DM failed: {channel}");
    let channel_id = channel["id"].as_str().unwrap().to_string();
    let send = |content: &'static str| json!({ "content": content });
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{channel_id}"),
        &open_auth,
        Some(send("hello first")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "no reply before the friends-only user writes"
    );

    // Once they have written, the reply goes through.
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{channel_id}"),
        &private_auth,
        Some(send("hi there")),
    )
    .await;
    assert!(
        status.is_success(),
        "friends-only user could not write: {body}"
    );
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{channel_id}"),
        &open_auth,
        Some(send("hi back")),
    )
    .await;
    assert!(
        status.is_success(),
        "reply to a DM the friends-only user wrote in failed: {body}"
    );

    // Writing in one conversation is not consent for strangers in general.
    let (stranger_auth, _, _) = register_named_user(&mut app, "stranger").await;
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{private_id}"),
        &stranger_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dm_edits_and_deletions_reach_every_member_session() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (author_auth, author_id, _) = register_named_user(&mut app, "dmauthor").await;
    let (peer_auth, peer_id, _) = register_named_user(&mut app, "dmpeer").await;
    befriend(&state, author_id, peer_id).await;
    let (status, channel) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{peer_id}"),
        &author_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{channel}");
    let channel_id = channel["id"].as_str().unwrap().to_string();
    let (status, message) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{channel_id}"),
        &author_auth,
        Some(json!({ "content": "before edit" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{message}");
    let message_id = message["id"].as_str().unwrap().to_string();

    let addr = spawn_ws_app(&state).await;
    let mut peer_ws = connect_ws(addr, &peer_auth).await;
    // The author's other device must stay in sync as well.
    let mut author_other_ws = connect_ws(addr, &author_auth).await;
    ws_barrier(&mut peer_ws).await;
    ws_barrier(&mut author_other_ws).await;

    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/dm/messages/item/{message_id}"),
        &author_auth,
        Some(json!({ "content": "after edit" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for ws in [&mut peer_ws, &mut author_other_ws] {
        let event = receive_ws_event(ws, "MessageUpdated").await;
        assert_eq!(event["data"]["channel_id"], channel_id.as_str());
        assert_eq!(event["data"]["message"]["content"], "after edit");
    }

    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/dm/messages/item/{message_id}"),
        &author_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for ws in [&mut peer_ws, &mut author_other_ws] {
        let event = receive_ws_event(ws, "MessageDeleted").await;
        assert_eq!(event["data"]["channel_id"], channel_id.as_str());
        assert_eq!(event["data"]["message_id"], message_id.as_str());
    }
}

#[tokio::test]
async fn group_dms_are_built_from_friends_and_follow_membership() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, owner_id, _) = register_named_user(&mut app, "gowner").await;
    let (amy_auth, amy_id, _) = register_named_user(&mut app, "gamy").await;
    let (ben_auth, ben_id, _) = register_named_user(&mut app, "gben").await;
    let (_, cara_id, _) = register_named_user(&mut app, "gcara").await;
    let (stranger_auth, stranger_id, _) = register_named_user(&mut app, "gstranger").await;
    for friend in [amy_id, ben_id, cara_id] {
        befriend(&state, owner_id, friend).await;
    }

    // At least two friends; strangers cannot be added.
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/dm/groups",
        &owner_auth,
        Some(json!({ "member_ids": [amy_id] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a group needs at least two friends"
    );
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/dm/groups",
        &owner_auth,
        Some(json!({ "member_ids": [amy_id, stranger_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "only friends can be added");

    let addr = spawn_ws_app(&state).await;
    let mut ben_ws = connect_ws(addr, &ben_auth).await;
    let (status, group) = api_json(
        &mut app,
        "POST",
        "/api/dm/groups",
        &owner_auth,
        Some(json!({ "member_ids": [amy_id, ben_id], "name": "  Weekend  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create group failed: {group}");
    let group_id = group["id"].as_str().unwrap().to_string();
    assert_eq!(group["is_group"], true);
    assert_eq!(group["name"], "Weekend");
    assert_eq!(group["owner_id"], json!(owner_id));
    assert_eq!(group["members"].as_array().unwrap().len(), 3);
    let updated = receive_ws_event(&mut ben_ws, "DmChannelsUpdated").await;
    assert_eq!(updated["data"]["channel_id"], json!(group_id));

    // The group shows up in every member's DM list, not in a stranger's.
    for (auth, expected) in [(&amy_auth, true), (&stranger_auth, false)] {
        let (status, list) = api_json(&mut app, "GET", "/api/dm/channels", auth, None).await;
        assert_eq!(status, StatusCode::OK);
        let listed = list
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == json!(group_id));
        assert_eq!(listed, expected);
    }

    // Members talk to each other (Amy and Ben are not friends); everyone else is refused.
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{group_id}"),
        &amy_auth,
        Some(json!({ "content": "hi group" })),
    )
    .await;
    assert!(status.is_success(), "member could not write: {body}");
    let delivered = receive_ws_event(&mut ben_ws, "NewMessage").await;
    assert_eq!(delivered["data"]["channel_id"], json!(group_id));
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{group_id}"),
        &stranger_auth,
        Some(json!({ "content": "let me in" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Any member renames; a member adds their own friend; the size limit holds.
    let (status, renamed) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/dm/groups/{group_id}"),
        &amy_auth,
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        renamed["name"].is_null(),
        "an empty name falls back to member names"
    );
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/groups/{group_id}/members"),
        &amy_auth,
        Some(json!({ "user_ids": [cara_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Amy is not Cara's friend");
    let (status, grown) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/groups/{group_id}/members"),
        &owner_auth,
        Some(json!({ "user_ids": [cara_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "add member failed: {grown}");
    assert_eq!(grown["members"].as_array().unwrap().len(), 4);

    // Only the owner removes others; anyone can leave; the owner leaving hands the group on.
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/dm/groups/{group_id}/members/{cara_id}"),
        &amy_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/dm/groups/{group_id}/members/{cara_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/dm/groups/{group_id}/members/{owner_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let new_owner: Option<Uuid> =
        sqlx::query_scalar("SELECT owner_id FROM dm_channels WHERE id = $1")
            .bind(Uuid::parse_str(&group_id).unwrap())
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        new_owner,
        Some(amy_id),
        "the longest-standing member becomes owner"
    );
    let (status, _) = api_json(
        &mut app,
        "GET",
        &format!("/api/dm/messages/{group_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a former member loses access"
    );

    // Groups never stand in for the one-to-one DM between two of their members.
    let (status, direct) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{owner_id}"),
        &amy_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{direct}");
    assert_ne!(direct["id"], json!(group_id));
    assert_eq!(direct["is_group"], false);
}
