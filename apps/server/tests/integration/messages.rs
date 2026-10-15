use super::*;

#[tokio::test]
async fn create_channel_list_channels_send_message_list_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("chan-{}@example.com", uid);
    let username = format!("chanuser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().unwrap();
    let auth_header = format!("Bearer {}", token);

    // Create server
    let create_body = json!({ "name": "Channel Test Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    // Create channel (POST /api/channels with server_id, name)
    let channel_body = json!({
        "server_id": server_id,
        "name": format!("general-{}", uid.as_u128() % 1_000_000),
        "channel_type": "text"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&channel_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create channel: {}",
        String::from_utf8_lossy(&body)
    );
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    // List channels for server (GET /api/servers/:id/channels)
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channels: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!channels.is_empty());
    assert!(channels
        .iter()
        .any(|c| c["id"].as_str() == Some(channel_id)));

    // Send message
    let msg_body = json!({ "content": "Hello integration test" });
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&msg_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "send message: {}",
        String::from_utf8_lossy(&body)
    );
    let msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = msg["id"].as_str().unwrap();

    for (content, expected_status) in [
        ("😀".repeat(4000), StatusCode::OK),
        ("😀".repeat(4001), StatusCode::BAD_REQUEST),
    ] {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/messages/{channel_id}"))
            .header("Authorization", &auth_header)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "content": content })).unwrap(),
            ))
            .unwrap();
        let (status, _) = oneshot(&mut app, req).await;
        assert_eq!(status, expected_status);
    }

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/item/{message_id}/reactions"))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "emoji": "👍" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "add reaction: {}",
        String::from_utf8_lossy(&body)
    );

    // List messages (with limit)
    let req = Request::builder()
        .uri(format!("/api/messages/{}?limit=10", channel_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let messages: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!messages.is_empty());
    assert!(messages
        .iter()
        .any(|m| m["id"].as_str() == Some(message_id)));
    assert!(messages
        .iter()
        .any(|m| m["content"].as_str() == Some("Hello integration test")));
    let listed_message = messages
        .iter()
        .find(|message| message["id"].as_str() == Some(message_id))
        .expect("sent message should be listed");
    assert_eq!(listed_message["reactions"][0]["emoji"], "👍");
    assert_eq!(
        listed_message["reactions"][0]["users"][0]["username"],
        username
    );

    // List messages with before (pagination)
    let req = Request::builder()
        .uri(format!(
            "/api/messages/{}?before={}&limit=5",
            channel_id, message_id
        ))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let older: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    // We only have one message, so older should be empty
    assert!(older.is_empty() || older.len() <= 5);
}

#[tokio::test]
async fn server_message_jump_loads_old_target_and_rejects_unavailable_or_private_targets() {
    if test_db_url().is_none() {
        eprintln!("SKIP: database is not configured");
        return;
    }
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4().simple().to_string();
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("jump-owner-{suffix}@example.com"),
        &format!("jumpowner{}", &suffix[..8]),
        test_credential("message-jump"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (_, channel_id, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &owner_auth,
        "Pinned Jump Server",
    )
    .await;
    let (_, other_channel_id, _) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Other Jump Server")
            .await;
    let mut tied_ids = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    tied_ids.sort();
    let target_id = tied_ids[0];
    for (index, id) in tied_ids.iter().enumerate() {
        sqlx::query(
            "INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(channel_id)
        .bind(owner_id)
        .bind(if index == 0 { "old pinned target" } else { "same time message" })
        .execute(&state.db)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, created_at) SELECT uuid_generate_v4(), $1, $2, 'newer message', NOW() - INTERVAL '1 day' + n * INTERVAL '1 second' FROM generate_series(1, 60) AS n",
    )
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();

    let request = Request::builder()
        .uri(format!("/api/messages/{channel_id}?limit=10"))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(status, StatusCode::OK);
    let latest: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!latest
        .iter()
        .any(|message| message["id"] == target_id.to_string()));

    let request = Request::builder()
        .uri(format!(
            "/api/messages/{channel_id}?around={target_id}&limit=5"
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let page: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(page.len(), 5);
    assert_eq!(page[0]["id"], target_id.to_string());

    let request = Request::builder()
        .uri(format!(
            "/api/messages/{channel_id}?before={}&limit=5",
            tied_ids[2]
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(status, StatusCode::OK);
    let older: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(older.len(), 2);
    assert_eq!(older[0]["id"], tied_ids[0].to_string());
    assert_eq!(older[1]["id"], tied_ids[1].to_string());

    let (outsider_token, _) = register_user(
        &mut app,
        &format!("jump-outsider-{suffix}@example.com"),
        &format!("jumpguest{}", &suffix[..8]),
        test_credential("message-jump"),
    )
    .await;
    let request = Request::builder()
        .uri(format!("/api/messages/{channel_id}?around={target_id}"))
        .header("Authorization", format!("Bearer {outsider_token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(oneshot(&mut app, request).await.0, StatusCode::FORBIDDEN);

    for (channel, target) in [(other_channel_id, target_id), (channel_id, Uuid::new_v4())] {
        let request = Request::builder()
            .uri(format!("/api/messages/{channel}?around={target}"))
            .header("Authorization", &owner_auth)
            .body(Body::empty())
            .unwrap();
        assert_eq!(oneshot(&mut app, request).await.0, StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn role_bits_manage_messages_and_pins_are_enforced() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    // Owner
    let owner_uid = Uuid::new_v4();
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("owner-role-{}@example.com", owner_uid),
        &format!("owner_role_{}", owner_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {}", owner_token);

    // Moderator-like member (custom role)
    let mod_uid = Uuid::new_v4();
    let (mod_token, mod_id) = register_user(
        &mut app,
        &format!("mod-role-{}@example.com", mod_uid),
        &format!("mod_role_{}", mod_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let mod_auth = format!("Bearer {}", mod_token);

    // Plain member
    let user_uid = Uuid::new_v4();
    let (user_token, _user_id) = register_user(
        &mut app,
        &format!("user-role-{}@example.com", user_uid),
        &format!("user_role_{}", user_uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let user_auth = format!("Bearer {}", user_token);

    // Create server
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Role Permission Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap().to_string();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Join both members
    for auth in [&mod_auth, &user_auth] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/servers/join")
            .header("Authorization", auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "join failed: {}",
            String::from_utf8_lossy(&body)
        );
    }

    // Create role with MANAGE_MESSAGES + MANAGE_PINS
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{}/roles", server_id))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "name": "ModLite",
                "permissions": (256_i64 | 512_i64),
                "color": "#00aaff"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let role_id = role["id"].as_str().unwrap();

    // Assign role to mod member
    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/servers/{}/members/{}/roles",
            server_id, mod_id
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "role_ids": [role_id] })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "assign role failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Create text channel
    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "general-role-test",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap().to_string();

    // Plain user sends a message.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &user_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "plain message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let user_msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let user_msg_id = user_msg["id"].as_str().unwrap().to_string();

    // Mod role can delete someone else's message (MANAGE_MESSAGES).
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/item/{}", user_msg_id))
        .header("Authorization", &mod_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod delete message failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Mod sends a message for pin checks.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", channel_id))
        .header("Authorization", &mod_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "mod message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let mod_msg: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let mod_msg_id = mod_msg["id"].as_str().unwrap().to_string();

    // Plain user cannot pin (no MANAGE_PINS).
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}/pins", channel_id))
        .header("Authorization", &user_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "message_id": mod_msg_id })).unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Mod can pin.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}/pins", channel_id))
        .header("Authorization", &mod_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "message_id": mod_msg_id })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod pin failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Plain user cannot unpin.
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/{}/pins/{}", channel_id, mod_msg_id))
        .header("Authorization", &user_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Mod can unpin.
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/messages/{}/pins/{}", channel_id, mod_msg_id))
        .header("Authorization", &mod_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "mod unpin failed: {}",
        String::from_utf8_lossy(&body)
    );

    // owner_id is intentionally unused in assertions, but keeping it ensures register path created owner correctly
    let _ = owner_id;
}

#[tokio::test]
async fn concurrent_pin_and_reaction_requests_preserve_message_limits() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("message-limit-{suffix}@example.com"),
        &format!("message_limit_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (_server_id, channel_id, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &owner_auth,
        "Message Limit Race Server",
    )
    .await;

    sqlx::query(
        r#"INSERT INTO messages (id, channel_id, user_id, content, created_at)
           SELECT uuid_generate_v4(), $1, $2, 'pin limit seed', NOW()
           FROM generate_series(1, 49)"#,
    )
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO channel_pins (channel_id, message_id, pinned_by_id)
           SELECT $1, id, $2
           FROM messages
           WHERE channel_id = $1 AND content = 'pin limit seed'"#,
    )
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();

    let pin_candidate_a = Uuid::new_v4();
    let pin_candidate_b = Uuid::new_v4();
    for message_id in [pin_candidate_a, pin_candidate_b] {
        sqlx::query(
            "INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, 'pin race candidate')",
        )
        .bind(message_id)
        .bind(channel_id)
        .bind(owner_id)
        .execute(&state.db)
        .await
        .unwrap();
    }

    let pin_request = |message_id: Uuid| {
        Request::builder()
            .method("POST")
            .uri(format!("/api/messages/{channel_id}/pins"))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "message_id": message_id })).unwrap(),
            ))
            .unwrap()
    };
    let (pin_a, pin_b) = tokio::join!(
        app.clone().oneshot(pin_request(pin_candidate_a)),
        app.clone().oneshot(pin_request(pin_candidate_b))
    );
    let pin_statuses = [
        pin_a.expect("pin request A should resolve").status(),
        pin_b.expect("pin request B should resolve").status(),
    ];
    assert_eq!(
        pin_statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        pin_statuses
            .iter()
            .filter(|status| **status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    let pin_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channel_pins WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(pin_count, 50);

    let reaction_message_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, 'reaction race target')",
    )
    .bind(reaction_message_id)
    .bind(channel_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO message_reactions (message_id, user_id, emoji)
           SELECT $1, $2, 'seed-' || seed
           FROM generate_series(1, 19) AS seed"#,
    )
    .bind(reaction_message_id)
    .bind(owner_id)
    .execute(&state.db)
    .await
    .unwrap();

    let reaction_request = |emoji: &str| {
        Request::builder()
            .method("POST")
            .uri(format!(
                "/api/messages/item/{reaction_message_id}/reactions"
            ))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "emoji": emoji })).unwrap(),
            ))
            .unwrap()
    };
    let (reaction_a, reaction_b) = tokio::join!(
        app.clone().oneshot(reaction_request("new-a")),
        app.clone().oneshot(reaction_request("new-b"))
    );
    let reaction_statuses = [
        reaction_a
            .expect("reaction request A should resolve")
            .status(),
        reaction_b
            .expect("reaction request B should resolve")
            .status(),
    ];
    assert_eq!(
        reaction_statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        reaction_statuses
            .iter()
            .filter(|status| **status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
    let reaction_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT emoji) FROM message_reactions WHERE message_id = $1",
    )
    .bind(reaction_message_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(reaction_count, 20);
}

#[tokio::test]
async fn message_and_dm_retries_create_one_persistent_message() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-message-{suffix}@example.com"),
        &format!("idem_msg_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let peer_suffix = Uuid::new_v4();
    let (_, peer_id) = register_user(
        &mut app,
        &format!("idempotent-peer-{peer_suffix}@example.com"),
        &format!("idem_peer_{}", peer_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let (_, channel_id, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &auth,
        "Idempotent Message Server",
    )
    .await;

    let message_request_id = format!("message-{suffix}");
    let message_request = |content: &str| {
        Request::builder()
            .method("POST")
            .uri(format!("/api/messages/{channel_id}"))
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "content": content,
                    "client_request_id": message_request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, message_request("send once")).await;
    let (retry_status, retry_body) = oneshot(&mut app, message_request("send once")).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first_message: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retried_message: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first_message["id"], retried_message["id"]);
    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND user_id = $2 AND client_request_id = $3",
    )
    .bind(channel_id)
    .bind(user_id)
    .bind(&message_request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(message_count, 1);
    let (conflict_status, _) = oneshot(&mut app, message_request("different content")).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);

    let dm_channel_id = Uuid::new_v4();
    sqlx::query("INSERT INTO dm_channels (id) VALUES ($1)")
        .bind(dm_channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO dm_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)")
        .bind(dm_channel_id)
        .bind(user_id)
        .bind(peer_id)
        .execute(&state.db)
        .await
        .unwrap();
    let dm_request_id = format!("dm-{suffix}");
    let dm_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/dm/messages/{dm_channel_id}"))
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "content": "send DM once",
                    "client_request_id": dm_request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, dm_request()).await;
    let (retry_status, retry_body) = oneshot(&mut app, dm_request()).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first_dm: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retried_dm: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first_dm["id"], retried_dm["id"]);
    for (content, expected_status) in [
        ("ğ".repeat(4000), StatusCode::OK),
        ("ğ".repeat(4001), StatusCode::BAD_REQUEST),
    ] {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/dm/messages/{dm_channel_id}"))
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "content": content })).unwrap(),
            ))
            .unwrap();
        let (status, _) = oneshot(&mut app, req).await;
        assert_eq!(status, expected_status);
    }
    let dm_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_messages WHERE channel_id = $1 AND user_id = $2 AND client_request_id = $3",
    )
    .bind(dm_channel_id)
    .bind(user_id)
    .bind(&dm_request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(dm_count, 1);
}

#[tokio::test]
async fn pin_authors_can_be_cleared_when_their_account_goes() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (_, state) = setup_app().await;
    // ON DELETE SET NULL needs a nullable column; NOT NULL would make the delete fail instead.
    for table in ["channel_pins", "dm_channel_pins"] {
        let nullable: String = sqlx::query_scalar(
            "SELECT is_nullable FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'pinned_by_id'",
        )
        .bind(table)
        .fetch_one(&state.db)
        .await
        .unwrap();
        assert_eq!(nullable, "YES", "{table}.pinned_by_id");
    }
}

#[tokio::test]
async fn only_authors_edit_their_messages_and_dm_peers_cannot_delete_them() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (author_auth, author_id, _) = register_named_user(&mut app, "msgauthor").await;
    let (other_auth, other_id, _) = register_named_user(&mut app, "msgother").await;

    // Server channel: a regular member cannot edit or delete the owner's message.
    let (_, channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &author_auth, "Authorship").await;
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/servers/join",
        &other_auth,
        Some(json!({ "invite_code": invite_code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, message) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        &author_auth,
        Some(json!({ "content": "original" })),
    )
    .await;
    assert!(status.is_success(), "send failed: {message}");
    let message_id = message["id"].as_str().unwrap().to_string();
    let item = format!("/api/messages/item/{message_id}");
    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &item,
        &other_auth,
        Some(json!({ "content": "hijacked" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a member cannot edit someone else's message"
    );
    let (status, _) = api_json(&mut app, "DELETE", &item, &other_auth, None).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a member without Manage Messages cannot delete it"
    );
    let (status, edited) = api_json(
        &mut app,
        "PATCH",
        &item,
        &author_auth,
        Some(json!({ "content": "edited" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "the author can edit: {edited}");

    // Direct message: the other participant cannot edit or delete it either.
    befriend(&state, author_id, other_id).await;
    let (status, dm) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{other_id}"),
        &author_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "open DM failed: {dm}");
    let dm_id = dm["id"].as_str().unwrap().to_string();
    let (status, dm_message) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/messages/{dm_id}"),
        &author_auth,
        Some(json!({ "content": "private" })),
    )
    .await;
    assert!(status.is_success(), "DM send failed: {dm_message}");
    let dm_item = format!(
        "/api/dm/messages/item/{}",
        dm_message["id"].as_str().unwrap()
    );
    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &dm_item,
        &other_auth,
        Some(json!({ "content": "hijacked" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "the peer cannot edit a DM they did not write"
    );
    let (status, _) = api_json(&mut app, "DELETE", &dm_item, &other_auth, None).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "the peer cannot delete a DM they did not write"
    );
    let (status, _) = api_json(&mut app, "DELETE", &dm_item, &author_auth, None).await;
    assert!(status.is_success(), "the author can delete their DM");
}

#[tokio::test]
async fn hiding_a_channel_stops_message_delivery_without_waiting_for_the_permission_cache() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "cacheowner").await;
    let (member_auth, _, _) = register_named_user(&mut app, "cachemember").await;
    let (server_id, channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Cache").await;
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/servers/join",
        &member_auth,
        Some(json!({ "invite_code": invite_code })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let addr = spawn_ws_app(&state).await;
    let mut member_ws = connect_ws(addr, &member_auth).await;
    ws_subscribe(&mut member_ws, &[channel_id]).await;

    // The first delivery caches "may view" for this connection.
    let visible = format!("visible-{}", Uuid::new_v4());
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        &owner_auth,
        Some(json!({ "content": visible })),
    )
    .await;
    assert!(status.is_success());
    let delivered = receive_ws_event(&mut member_ws, "NewMessage").await;
    assert!(delivered.to_string().contains(&visible));

    // Hiding the channel publishes ServerChannelsUpdated, which clears the cache, so the next
    // message is withheld well before the cache would expire on its own.
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{channel_id}/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_VIEW })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "override failed: {body}");
    let hidden = format!("hidden-{}", Uuid::new_v4());
    let (status, _) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{channel_id}"),
        &owner_auth,
        Some(json!({ "content": hidden })),
    )
    .await;
    assert!(status.is_success());
    assert_no_ws_event_mentioning(
        &mut member_ws,
        "NewMessage",
        &hidden,
        std::time::Duration::from_millis(1500),
    )
    .await;
}
