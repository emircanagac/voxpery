use super::*;

#[tokio::test]
async fn websocket_rejects_query_token_but_accepts_protocol_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("ws-{}@example.com", uid);
    let username = format!("wsuser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, _) = register_user(&mut app, &email, &username, password).await;

    // Start a real HTTP server for websocket handshake tests.
    let ws_app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, ws_app).await;
    });

    // Legacy query-token flow must fail.
    let mut legacy_req = format!("ws://{}/ws?token={}", addr, token)
        .into_client_request()
        .unwrap();
    legacy_req
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let legacy_err = connect_async(legacy_req)
        .await
        .expect_err("legacy query token must be rejected");
    match legacy_err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED)
        }
        other => panic!("expected HTTP 401 handshake error, got {other:?}"),
    }

    // Protocol token flow must succeed.
    let mut protocol_req = format!("ws://{}/ws", addr).into_client_request().unwrap();
    protocol_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{}", token)).unwrap(),
    );
    let (_ws_stream, response) = connect_async(protocol_req)
        .await
        .expect("protocol token websocket must connect");
    assert_eq!(response.status(), StatusCode::SWITCHING_PROTOCOLS);

    server_handle.abort();
}

#[tokio::test]
async fn voice_moderation_is_audited_and_queryable_with_permission_and_pagination() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let permission_updates = Arc::new(tokio::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let captured_updates = permission_updates.clone();
    let livekit_app = axum::Router::new().route(
        "/twirp/livekit.RoomService/UpdateParticipant",
        axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
            let captured_updates = captured_updates.clone();
            async move {
                captured_updates.lock().await.push(body.clone());
                axum::Json(json!({ "sid": "PA_moderated", "identity": body["identity"] }))
            }
        }),
    );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    let livekit_handle = tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;

    let owner_suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("voice-audit-owner-{owner_suffix}@example.com"),
        &format!("voice_audit_owner_{}", owner_suffix.as_u128() % 1_000_000),
        test_credential("owner"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (server_id, _, invite_code) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &owner_auth,
        "Voice Audit Server",
    )
    .await;

    let target_suffix = Uuid::new_v4();
    let (target_token, target_user_id) = register_user(
        &mut app,
        &format!("voice-audit-target-{target_suffix}@example.com"),
        &format!("voice_audit_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("target"),
    )
    .await;
    let target_auth = format!("Bearer {target_token}");
    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &target_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "target join failed: {}",
        String::from_utf8_lossy(&body)
    );

    let observer_suffix = Uuid::new_v4();
    let (observer_token, _) = register_user(
        &mut app,
        &format!("voice-audit-observer-{observer_suffix}@example.com"),
        &format!(
            "voice_audit_observer_{}",
            observer_suffix.as_u128() % 1_000_000
        ),
        test_credential("observer"),
    )
    .await;
    let observer_auth = format!("Bearer {observer_token}");
    let observer_join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &observer_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, observer_join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "observer join failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Voice moderation follows explicit permission bits, not target role position.
    // Give the target a higher full-admin role so this reproduces admin-to-admin actions.
    let target_admin_role_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Protected admin', '#D65F5F', 0, 16383)"#,
    )
    .bind(target_admin_role_id)
    .bind(server_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO server_member_roles (server_id, user_id, role_id)
           VALUES ($1, $2, $3)"#,
    )
    .bind(server_id)
    .bind(target_user_id)
    .bind(target_admin_role_id)
    .execute(&state.db)
    .await
    .unwrap();

    let voice_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    let ws_app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, ws_app).await;
    });

    let mut ws_request = format!("ws://{addr}/ws").into_client_request().unwrap();
    ws_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{owner_token}")).unwrap(),
    );
    ws_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut ws_stream, _) = connect_async(ws_request)
        .await
        .expect("owner websocket must connect");
    let mut target_request = format!("ws://{addr}/ws").into_client_request().unwrap();
    target_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{target_token}")).unwrap(),
    );
    target_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut target_ws, _) = connect_async(target_request)
        .await
        .expect("target websocket must connect");
    target_ws
        .send(WsMessage::Text(
            json!({ "type": "JoinVoice", "data": { "channel_id": voice_channel_id } })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let initial_control = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(initial_control["data"]["server_muted"], false);
    ws_stream
        .send(WsMessage::Text(
            json!({
                "type": "SetVoiceControl",
                "data": {
                    "target_user_id": target_user_id,
                    "muted": true,
                    "deafened": true,
                    "screen_sharing": false,
                    "camera_on": false,
                    "reason": "Repeated voice disruption"
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let mut audit_count = 0_i64;
    for _ in 0..40 {
        audit_count = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_log WHERE server_id = $1 AND resource_id = $2 AND action LIKE 'voice_member_%'",
        )
        .bind(server_id)
        .bind(target_user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
        if audit_count == 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert_eq!(audit_count, 2, "mute and deafen must both be audited");

    let unauthorized_request = Request::builder()
        .uri(format!("/api/servers/{server_id}/audit-log"))
        .header("Authorization", &observer_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, unauthorized_request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let filtered_request = Request::builder()
        .uri(format!(
            "/api/servers/{server_id}/audit-log?action=voice_member_mute&target_id={target_user_id}&channel_id={voice_channel_id}&limit=1"
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, filtered_request).await;
    assert_eq!(status, StatusCode::OK);
    let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["entries"][0]["action"], "voice_member_mute");
    assert_eq!(
        page["entries"][0]["resource_id"],
        target_user_id.to_string()
    );
    assert_eq!(
        page["entries"][0]["channel_id"],
        voice_channel_id.to_string()
    );
    assert_eq!(page["entries"][0]["reason"], "Repeated voice disruption");

    let paged_request = Request::builder()
        .uri(format!(
            "/api/servers/{server_id}/audit-log?target_id={target_user_id}&limit=1"
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, paged_request).await;
    assert_eq!(status, StatusCode::OK);
    let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert!(page["next_before"].as_str().is_some());

    let enforced = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(enforced["data"]["server_muted"], true);
    assert_eq!(enforced["data"]["server_deafened"], true);
    let flags: (bool, bool) = sqlx::query_as(
        "SELECT voice_server_muted, voice_server_deafened FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(flags, (true, true));
    for _ in 0..40 {
        if permission_updates.lock().await.len() >= 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let updates = permission_updates.lock().await;
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0]["permission"]["canPublish"], false);
    assert_eq!(updates[0]["permission"]["canSubscribe"], false);
    drop(updates);

    let joined_webhook = json!({
        "event": "participant_joined",
        "room": { "name": voice_channel_id.to_string() },
        "participant": { "identity": target_user_id.to_string(), "sid": "PA_rejoined" },
    })
    .to_string();
    let webhook_token = signed_livekit_webhook(&state, joined_webhook.as_bytes());
    let webhook_request = Request::builder()
        .method("POST")
        .uri("/api/webrtc/livekit-webhook")
        .header("Authorization", format!("Bearer {webhook_token}"))
        .header("content-type", "application/json")
        .body(Body::from(joined_webhook))
        .unwrap();
    let (status, _) = oneshot(&mut app, webhook_request).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let updates = permission_updates.lock().await;
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[1]["permission"]["canPublish"], false);
    drop(updates);

    target_ws
        .send(WsMessage::Text(
            json!({ "type": "LeaveVoice", "data": null })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let left_state = receive_ws_event(&mut target_ws, "VoiceStateUpdate").await;
    assert!(left_state["data"]["channel_id"].is_null());
    let left = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(left["data"]["server_muted"], false);
    let (response, grant) = voice_token_grant(&mut app, &target_auth, voice_channel_id).await;
    assert_eq!(response["server_muted"], true);
    assert_eq!(response["server_deafened"], true);
    assert_eq!(grant["video"]["canPublish"], false);
    assert_eq!(grant["video"]["canSubscribe"], false);

    target_ws
        .send(WsMessage::Text(
            json!({ "type": "JoinVoice", "data": { "channel_id": voice_channel_id } })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let rejoined = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(rejoined["data"]["server_muted"], true);
    assert_eq!(rejoined["data"]["server_deafened"], true);
    target_ws
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "muted": false, "deafened": false, "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let self_updated = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(self_updated["data"]["server_muted"], true);
    assert_eq!(self_updated["data"]["server_deafened"], true);

    let next_channel_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
         VALUES ($1, $2, 'Second Voice', 'voice', 'General', 2, NOW())",
    )
    .bind(next_channel_id)
    .bind(server_id)
    .execute(&state.db)
    .await
    .unwrap();
    target_ws
        .send(WsMessage::Text(
            json!({ "type": "JoinVoice", "data": { "channel_id": next_channel_id } })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let moved = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(moved["data"]["server_muted"], true);
    assert_eq!(moved["data"]["server_deafened"], true);

    target_ws.close(None).await.unwrap();
    for _ in 0..40 {
        if !state.voice_sessions.contains_key(&target_user_id) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    assert!(!state.voice_sessions.contains_key(&target_user_id));
    let mut reconnect_request = format!("ws://{addr}/ws").into_client_request().unwrap();
    reconnect_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{target_token}")).unwrap(),
    );
    reconnect_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut target_ws, _) = connect_async(reconnect_request).await.unwrap();
    target_ws
        .send(WsMessage::Text(
            json!({ "type": "JoinVoice", "data": { "channel_id": next_channel_id } })
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let reconnected = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(reconnected["data"]["server_muted"], true);
    assert_eq!(reconnected["data"]["server_deafened"], true);

    target_ws
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "target_user_id": target_user_id, "muted": false, "deafened": true,
                "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let self_unmuted = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(self_unmuted["data"]["server_muted"], false);
    assert_eq!(self_unmuted["data"]["server_deafened"], true);

    target_ws
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "target_user_id": target_user_id, "muted": true, "deafened": true,
                "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM server_member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3",
    )
    .bind(server_id)
    .bind(target_user_id)
    .bind(target_admin_role_id)
    .execute(&state.db)
    .await
    .unwrap();
    target_ws
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "target_user_id": target_user_id, "muted": false, "deafened": false,
                "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    let self_denied_flags: (bool, bool) = sqlx::query_as(
        "SELECT voice_server_muted, voice_server_deafened FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(self_denied_flags, (false, true));

    let mut observer_request = format!("ws://{addr}/ws").into_client_request().unwrap();
    observer_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{observer_token}")).unwrap(),
    );
    observer_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut observer_ws, _) = connect_async(observer_request).await.unwrap();
    observer_ws
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "target_user_id": target_user_id, "muted": false, "deafened": false,
                "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(75)).await;
    let unauthorized_flags: (bool, bool) = sqlx::query_as(
        "SELECT voice_server_muted, voice_server_deafened FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(unauthorized_flags, (false, true));

    ws_stream
        .send(WsMessage::Text(
            json!({ "type": "SetVoiceControl", "data": {
                "target_user_id": target_user_id, "muted": false, "deafened": false,
                "screen_sharing": false, "camera_on": false
            }})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let released = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(released["data"]["server_muted"], false);
    assert_eq!(released["data"]["server_deafened"], false);
    let (response, grant) = voice_token_grant(&mut app, &target_auth, next_channel_id).await;
    assert_eq!(response["server_muted"], false);
    assert_eq!(response["server_deafened"], false);
    assert_eq!(grant["video"]["canPublish"], true);
    assert_eq!(grant["video"]["canSubscribe"], true);
    let final_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE server_id = $1 AND resource_id = $2 AND action LIKE 'voice_member_%'",
    )
    .bind(server_id)
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(final_audit_count, 4);
    for _ in 0..40 {
        if permission_updates.lock().await.len() >= 4 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    let updates = permission_updates.lock().await;
    assert_eq!(updates.len(), 4);
    assert_eq!(updates[3]["permission"]["canPublish"], true);
    assert_eq!(updates[3]["permission"]["canSubscribe"], true);
    drop(updates);

    server_handle.abort();
    livekit_handle.abort();
}

#[tokio::test]
async fn voice_move_is_audited_only_after_livekit_destination_is_verified() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };

    let participant_lookup_attempts = Arc::new(AtomicUsize::new(0));
    let livekit_lookup_attempts = participant_lookup_attempts.clone();
    let livekit_app = axum::Router::new()
        .route(
            "/twirp/livekit.RoomService/GetParticipant",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let livekit_lookup_attempts = livekit_lookup_attempts.clone();
                async move {
                    let attempt = livekit_lookup_attempts.fetch_add(1, Ordering::SeqCst);
                    let status = if attempt < 2 {
                        StatusCode::NOT_FOUND
                    } else {
                        StatusCode::OK
                    };
                    (
                        status,
                        axum::Json(json!({
                            "sid": "PA_moved",
                            "identity": body["identity"],
                        })),
                    )
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/RemoveParticipant",
            axum::routing::post(|| async { axum::Json(json!({})) }),
        );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    let livekit_handle = tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });

    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://client-livekit.example.test".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;
    let owner_suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("voice-move-owner-{owner_suffix}@example.com"),
        &format!("voice_move_owner_{}", owner_suffix.as_u128() % 1_000_000),
        test_credential("owner"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Voice Move Server")
            .await;

    let moderator_suffix = Uuid::new_v4();
    let (moderator_token, moderator_user_id) = register_user(
        &mut app,
        &format!("voice-move-moderator-{moderator_suffix}@example.com"),
        &format!(
            "voice_move_moderator_{}",
            moderator_suffix.as_u128() % 1_000_000
        ),
        test_credential("moderator"),
    )
    .await;
    let moderator_auth = format!("Bearer {moderator_token}");
    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &moderator_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "moderator join failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Reproduce roles created by older versions below Everyone (position 9999).
    // Everyone must not flatten a custom moderator role to the same hierarchy level
    // as an ordinary member.
    let moderator_role_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO server_roles (id, server_id, name, color, position, permissions)
           VALUES ($1, $2, 'Full admin', '#5865F2', 10000, 16383)"#,
    )
    .bind(moderator_role_id)
    .bind(server_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO server_member_roles (server_id, user_id, role_id)
           VALUES ($1, $2, $3)"#,
    )
    .bind(server_id)
    .bind(moderator_user_id)
    .bind(moderator_role_id)
    .execute(&state.db)
    .await
    .unwrap();

    let target_suffix = Uuid::new_v4();
    let (target_token, target_user_id) = register_user(
        &mut app,
        &format!("voice-move-target-{target_suffix}@example.com"),
        &format!("voice_move_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("target"),
    )
    .await;
    let target_auth = format!("Bearer {target_token}");
    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &target_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "target join failed: {}",
        String::from_utf8_lossy(&body)
    );

    let source_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    let destination_channel_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at)
           VALUES ($1, $2, 'Support', 'voice', 'General', 2, NOW())"#,
    )
    .bind(destination_channel_id)
    .bind(server_id)
    .execute(&state.db)
    .await
    .unwrap();

    let ws_app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let ws_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_addr = ws_listener.local_addr().unwrap();
    let ws_handle = tokio::spawn(async move {
        let _ = axum::serve(ws_listener, ws_app).await;
    });

    let mut moderator_request = format!("ws://{ws_addr}/ws").into_client_request().unwrap();
    moderator_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{moderator_token}")).unwrap(),
    );
    moderator_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut moderator_ws, _) = connect_async(moderator_request)
        .await
        .expect("moderator websocket must connect");

    let mut target_request = format!("ws://{ws_addr}/ws").into_client_request().unwrap();
    target_request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{target_token}")).unwrap(),
    );
    target_request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    let (mut target_ws, _) = connect_async(target_request)
        .await
        .expect("target websocket must connect");

    state
        .voice_sessions
        .insert(target_user_id, source_channel_id);
    state
        .voice_participant_sids
        .insert(target_user_id, "PA_source".to_string());

    moderator_ws
        .send(WsMessage::Text(
            json!({
                "type": "SetVoiceControl",
                "data": {
                    "target_user_id": target_user_id,
                    "muted": true,
                    "deafened": false,
                    "screen_sharing": false,
                    "camera_on": false
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let muted_event = receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    assert_eq!(muted_event["data"]["server_muted"], true);
    assert_eq!(
        state
            .voice_controls
            .get(&target_user_id)
            .map(|controls| controls.2),
        Some(true),
        "a full-admin custom role must be able to server-mute a higher-role admin"
    );

    let request_id = Uuid::new_v4();
    moderator_ws
        .send(WsMessage::Text(
            json!({
                "type": "MoveVoiceMember",
                "data": {
                    "request_id": request_id,
                    "target_user_id": target_user_id,
                    "channel_id": destination_channel_id,
                    "reason": "Move to support"
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let requested = receive_ws_event(&mut target_ws, "VoiceMemberMoveRequested").await;
    assert_eq!(requested["data"]["request_id"], request_id.to_string());
    assert_eq!(
        requested["data"]["source_channel_id"],
        source_channel_id.to_string()
    );
    assert_eq!(
        requested["data"]["channel_id"],
        destination_channel_id.to_string()
    );
    let audit_before_ack: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'voice_member_move' AND resource_id = $1",
    )
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(audit_before_ack, 0, "pending moves must not be audited");

    target_ws
        .send(WsMessage::Text(
            json!({
                "type": "JoinVoice",
                "data": {
                    "channel_id": destination_channel_id,
                    "participant_sid": "PA_client_stale"
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    target_ws
        .send(WsMessage::Text(
            json!({
                "type": "AcknowledgeVoiceMemberMove",
                "data": {
                    "request_id": request_id,
                    "success": true
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let result = receive_ws_event(&mut moderator_ws, "VoiceMemberMoveResult").await;
    assert_eq!(result["data"]["request_id"], request_id.to_string());
    assert_eq!(result["data"]["success"], true);
    assert!(
        participant_lookup_attempts.load(Ordering::SeqCst) >= 3,
        "voice move verification must tolerate delayed LiveKit participant visibility"
    );
    assert_eq!(
        state
            .voice_sessions
            .get(&target_user_id)
            .map(|entry| *entry),
        Some(destination_channel_id)
    );
    assert_eq!(
        state
            .voice_participant_sids
            .get(&target_user_id)
            .map(|entry| entry.clone()),
        Some("PA_moved".to_string()),
        "the authoritative LiveKit SID must replace a stale client-reported SID"
    );
    let audit: serde_json::Value = sqlx::query_scalar(
        "SELECT details FROM audit_log WHERE action = 'voice_member_move' AND resource_id = $1 ORDER BY at DESC LIMIT 1",
    )
    .bind(target_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(audit["request_id"], request_id.to_string());
    assert_eq!(audit["participant_sid"], "PA_moved");

    let unauthorized_request_id = Uuid::new_v4();
    target_ws
        .send(WsMessage::Text(
            json!({
                "type": "MoveVoiceMember",
                "data": {
                    "request_id": unauthorized_request_id,
                    "target_user_id": target_user_id,
                    "channel_id": source_channel_id
                }
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let denied = receive_ws_event(&mut target_ws, "VoiceMemberMoveResult").await;
    assert_eq!(
        denied["data"]["request_id"],
        unauthorized_request_id.to_string()
    );
    assert_eq!(denied["data"]["success"], false);

    ws_handle.abort();
    livekit_handle.abort();
}

#[tokio::test]
async fn voice_credential_endpoints_rate_limit_token_minting() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("voice-token-limit-{suffix}@example.com"),
        &format!("voice_limit_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {token}");
    let (server_id, _, _) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &auth_header,
        "Voice Token Limit Server",
    )
    .await;
    let voice_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let turn_request = || {
        Request::builder()
            .uri("/api/webrtc/turn-credentials")
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, turn_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "TURN credential attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, turn_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first TURN request should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );

    let livekit_request = || {
        Request::builder()
            .uri(format!(
                "/api/webrtc/livekit-token?channel_id={voice_channel_id}"
            ))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=20 {
        let (status, body) = oneshot(&mut app, livekit_request()).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "LiveKit token attempt {attempt} failed unexpectedly: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, livekit_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the twenty-first LiveKit token request should be rate limited: {}",
        String::from_utf8_lossy(&body)
    );

    let second_suffix = Uuid::new_v4();
    let (second_token, _) = register_user(
        &mut app,
        &format!("voice-global-limit-{second_suffix}@example.com"),
        &format!("voice_global_{}", second_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let second_auth_header = format!("Bearer {second_token}");
    let unauthorized_livekit_request = || {
        Request::builder()
            .uri(format!(
                "/api/webrtc/livekit-token?channel_id={}",
                Uuid::new_v4()
            ))
            .header("Authorization", &second_auth_header)
            .body(Body::empty())
            .unwrap()
    };
    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, unauthorized_livekit_request()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "unauthorized LiveKit attempt {attempt} should reach access validation: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, unauthorized_livekit_request()).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first cross-channel LiveKit request should hit the user-wide limit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn removed_and_leaving_members_receive_their_own_member_left_event() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Removal Guild")
            .await;
    let (leaver_auth, leaver_id, _) = register_named_user(&mut app, "leaver").await;
    let (kicked_auth, kicked_id, _) = register_named_user(&mut app, "kicked").await;
    let (banned_auth, banned_id, _) = register_named_user(&mut app, "banned").await;
    for auth in [&leaver_auth, &kicked_auth, &banned_auth] {
        join_with_invite(&mut app, auth, &invite_code).await;
    }
    let addr = spawn_ws_app(&state).await;
    let mut leaver_ws = connect_ws(addr, &leaver_auth).await;
    let mut kicked_ws = connect_ws(addr, &kicked_auth).await;
    let mut banned_ws = connect_ws(addr, &banned_auth).await;

    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/leave"),
        &leaver_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "leave failed: {body}");
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/servers/{server_id}/members/{kicked_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "kick failed: {body}");
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/members/{banned_id}/ban"),
        &owner_auth,
        Some(json!({ "reason": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "ban failed: {body}");

    // Removed accounts no longer pass the member check for broadcasts, so each one must be
    // told directly that it left the server (other members' MemberLeft events may come first).
    for (label, user_id, ws) in [
        ("left", leaver_id, &mut leaver_ws),
        ("kicked", kicked_id, &mut kicked_ws),
        ("banned", banned_id, &mut banned_ws),
    ] {
        loop {
            let event = receive_ws_event(ws, "MemberLeft").await;
            if event["data"]["user_id"] == json!(user_id) {
                assert_eq!(event["data"]["server_id"], json!(server_id), "{label}");
                break;
            }
        }
    }
}

#[tokio::test]
async fn leaving_deleting_and_failed_livekit_calls_still_end_voice() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    // LiveKit stand-in: records removals and closed rooms; the first removal fails once.
    let removed = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let deleted_rooms = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let fail_next_removal = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let record_removed = removed.clone();
    let record_deleted = deleted_rooms.clone();
    let fail_removal = fail_next_removal.clone();
    let livekit_app = axum::Router::new()
        .route(
            "/twirp/livekit.RoomService/RemoveParticipant",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let record_removed = record_removed.clone();
                let fail_removal = fail_removal.clone();
                async move {
                    if fail_removal.swap(false, std::sync::atomic::Ordering::SeqCst) {
                        return (StatusCode::SERVICE_UNAVAILABLE, axum::Json(json!({})));
                    }
                    record_removed
                        .lock()
                        .await
                        .push(body["identity"].as_str().unwrap_or_default().to_string());
                    (StatusCode::OK, axum::Json(json!({})))
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/DeleteRoom",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let record_deleted = record_deleted.clone();
                async move {
                    record_deleted
                        .lock()
                        .await
                        .push(body["room"].as_str().unwrap_or_default().to_string());
                    axum::Json(json!({}))
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/ListParticipants",
            axum::routing::post(|| async { axum::Json(json!({ "participants": [] })) }),
        );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Voice End Guild")
            .await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let removed_identity = |user_id: Uuid| {
        let removed = removed.clone();
        async move {
            for _ in 0..40 {
                if removed.lock().await.contains(&user_id.to_string()) {
                    return true;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            false
        }
    };

    // Leaving the server cuts the LiveKit connection, even when the first attempt fails.
    let (leaver_auth, leaver_id, _) = register_named_user(&mut app, "leaver").await;
    join_with_invite(&mut app, &leaver_auth, &invite_code).await;
    state.voice_sessions.insert(leaver_id, voice_channel_id);
    fail_next_removal.store(true, std::sync::atomic::Ordering::SeqCst);
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/leave"),
        &leaver_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "leave failed: {body}");
    assert!(state.voice_sessions.get(&leaver_id).is_none());
    assert!(
        removed_identity(leaver_id).await,
        "leave did not remove the LiveKit participant"
    );

    // Deleting the account cuts it too.
    let (deleted_auth, deleted_id, deleted_password) =
        register_named_user(&mut app, "deleted").await;
    join_with_invite(&mut app, &deleted_auth, &invite_code).await;
    state.voice_sessions.insert(deleted_id, voice_channel_id);
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &deleted_auth,
        Some(json!({ "confirm": "DELETE", "password": deleted_password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "account deletion failed: {body}");
    assert!(state.voice_sessions.get(&deleted_id).is_none());
    assert!(
        removed_identity(deleted_id).await,
        "account deletion did not remove the LiveKit participant"
    );

    // Deleting the server closes its voice rooms.
    let (member_auth, member_id, _) = register_named_user(&mut app, "member").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    state.voice_sessions.insert(member_id, voice_channel_id);
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/servers/{server_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "server deletion failed: {body}");
    assert!(state.voice_sessions.get(&member_id).is_none());
    assert!(deleted_rooms
        .lock()
        .await
        .contains(&voice_channel_id.to_string()));
}

#[tokio::test]
async fn websocket_subscribe_and_connections_are_bounded_per_user() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, owner_id, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, _) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Bounded Guild")
            .await;
    let _ = server_id;
    let addr = spawn_ws_app(&state).await;
    let mut redis = redis_client()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let connect_limit_key = format!("rate:ws:{owner_id}");

    // Thousands of unknown ids next to a real channel: the real one is still subscribed.
    let mut owner_ws = connect_ws(addr, &owner_auth).await;
    let mut channel_ids: Vec<Uuid> = (0..5_000).map(|_| Uuid::new_v4()).collect();
    channel_ids.insert(0, text_channel_id);
    let started = std::time::Instant::now();
    ws_subscribe(&mut owner_ws, &channel_ids).await;
    assert!(
        started.elapsed() < std::time::Duration::from_secs(5),
        "Subscribe with unknown ids took {:?}",
        started.elapsed()
    );
    let marker = format!("bounded subscribe {}", Uuid::new_v4());
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{text_channel_id}"),
        &owner_auth,
        Some(json!({ "content": marker })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "message failed: {body}");
    let delivered = receive_ws_event(&mut owner_ws, "NewMessage").await;
    assert!(delivered.to_string().contains(&marker));

    // At most 10 open connections per account.
    let mut open = vec![owner_ws];
    while open.len() < 10 {
        let _: () = redis::cmd("DEL")
            .arg(&connect_limit_key)
            .query_async(&mut redis)
            .await
            .unwrap();
        let mut ws = connect_ws(addr, &owner_auth).await;
        ws_barrier(&mut ws).await;
        open.push(ws);
    }
    let _: () = redis::cmd("DEL")
        .arg(&connect_limit_key)
        .query_async(&mut redis)
        .await
        .unwrap();
    let token = owner_auth.trim_start_matches("Bearer ");
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("voxpery.auth,{token}")).unwrap(),
    );
    request
        .headers_mut()
        .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
    match connect_async(request).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
            assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        }
        other => panic!(
            "11th connection must be refused, got {:?}",
            other.map(|_| ())
        ),
    }
}

#[tokio::test]
async fn failed_livekit_revocations_are_retried_until_the_participant_is_gone() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    // LiveKit stand-in whose next listing and removal requests fail once each.
    let room_participants = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let removed = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let failing_lists = Arc::new(AtomicUsize::new(0));
    let failing_removals = Arc::new(AtomicUsize::new(0));
    let (list_participants, list_failures) = (room_participants.clone(), failing_lists.clone());
    let (record_removed, removal_failures) = (removed.clone(), failing_removals.clone());
    let unavailable = || (StatusCode::SERVICE_UNAVAILABLE, axum::Json(json!({})));
    let livekit_app = axum::Router::new()
        .route(
            "/twirp/livekit.RoomService/ListParticipants",
            axum::routing::post(move || {
                let list_participants = list_participants.clone();
                let list_failures = list_failures.clone();
                async move {
                    if list_failures.load(Ordering::SeqCst) > 0 {
                        list_failures.fetch_sub(1, Ordering::SeqCst);
                        return unavailable();
                    }
                    let identities = list_participants.lock().await.clone();
                    let participants: Vec<_> = identities
                        .iter()
                        .map(|identity| json!({ "identity": identity, "sid": format!("PA_{identity}") }))
                        .collect();
                    (StatusCode::OK, axum::Json(json!({ "participants": participants })))
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/RemoveParticipant",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let record_removed = record_removed.clone();
                let removal_failures = removal_failures.clone();
                async move {
                    if removal_failures.load(Ordering::SeqCst) > 0 {
                        removal_failures.fetch_sub(1, Ordering::SeqCst);
                        return unavailable();
                    }
                    let identity = body["identity"].as_str().unwrap_or_default().to_string();
                    record_removed.lock().await.push(identity);
                    (StatusCode::OK, axum::Json(json!({})))
                }
            }),
        );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Retry Guild").await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "member").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let (_, outsider_id, _) = register_named_user(&mut app, "outsider").await;
    let removed_identity = |user_id: Uuid| {
        let removed = removed.clone();
        async move {
            for _ in 0..40 {
                if removed.lock().await.contains(&user_id.to_string()) {
                    return true;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            false
        }
    };

    // A non-member joins the room with a token; the first removal request fails.
    failing_removals.store(1, Ordering::SeqCst);
    let joined = json!({
        "event": "participant_joined",
        "room": { "name": voice_channel_id.to_string() },
        "participant": { "identity": outsider_id.to_string(), "sid": "PA_outsider" },
    })
    .to_string();
    let request = Request::builder()
        .method("POST")
        .uri("/api/webrtc/livekit-webhook")
        .header(
            "Authorization",
            signed_livekit_webhook(&state, joined.as_bytes()),
        )
        .header("content-type", "application/webhook+json")
        .body(Body::from(joined))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&body)
    );
    assert!(
        removed_identity(outsider_id).await,
        "a failed webhook removal must be retried"
    );

    // A member connected straight to LiveKit loses voice access while listing the room fails.
    room_participants.lock().await.push(member_id.to_string());
    failing_lists.store(1, Ordering::SeqCst);
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{voice_channel_id}/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_CONNECT_VOICE })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "override failed: {body}");
    assert!(
        removed_identity(member_id).await,
        "a room whose participant list failed must be rechecked later"
    );
}

#[tokio::test]
async fn oversized_websocket_messages_close_the_connection() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (auth, _, _) = register_named_user(&mut app, "wsbig").await;
    let addr = spawn_ws_app(&state).await;
    let mut ws = connect_ws(addr, &auth).await;

    // Over the 256 KB limit: the server stops reading instead of buffering it.
    let oversized = format!(
        "{{\"type\":\"Ping\",\"data\":{{\"pad\":\"{}\"}}}}",
        "x".repeat(300 * 1024)
    );
    let _ = ws.send(WsMessage::Text(oversized.into())).await;
    let closed = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match ws.next().await {
                None | Some(Err(_)) | Some(Ok(WsMessage::Close(_))) => return true,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await
    .unwrap_or(false);
    assert!(closed, "an oversized message must end the connection");
}

#[tokio::test]
async fn voice_moderation_honours_voice_channel_overrides() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let livekit_app = axum::Router::new().route(
        "/twirp/livekit.RoomService/UpdateParticipant",
        axum::routing::post(
            |axum::Json(body): axum::Json<serde_json::Value>| async move {
                axum::Json(json!({ "sid": "PA_moderated", "identity": body["identity"] }))
            },
        ),
    );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;
    let (owner_auth, _, _) = register_named_user(&mut app, "vcowner").await;
    let (mod_auth, mod_id, _) = register_named_user(&mut app, "vcmod").await;
    let (target_auth, target_id, _) = register_named_user(&mut app, "vctarget").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Voice Overrides")
            .await;
    for auth in [&mod_auth, &target_auth] {
        let (status, _) = api_json(
            &mut app,
            "POST",
            "/api/servers/join",
            auth,
            Some(json!({ "invite_code": invite_code })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    // A voice moderator role: view, connect and mute members.
    let mod_role_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO server_roles (id, server_id, name, color, position, permissions)
         VALUES ($1, $2, 'Voice mod', NULL, 1, $3)",
    )
    .bind(mod_role_id)
    .bind(server_id)
    .bind(PERM_VIEW | PERM_CONNECT_VOICE | (1_i64 << 11))
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
    )
    .bind(server_id)
    .bind(mod_id)
    .bind(mod_role_id)
    .execute(&state.db)
    .await
    .unwrap();
    let voice_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'voice' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let addr = spawn_ws_app(&state).await;
    let mut mod_ws = connect_ws(addr, &mod_auth).await;
    let mut target_ws = connect_ws(addr, &target_auth).await;
    ws_send(
        &mut target_ws,
        json!({ "type": "JoinVoice", "data": { "channel_id": voice_channel_id } }),
    )
    .await;
    receive_ws_event(&mut target_ws, "VoiceControlUpdate").await;
    let mute_target = json!({ "type": "SetVoiceControl", "data": {
        "target_user_id": target_id, "muted": true, "deafened": false,
        "screen_sharing": false, "camera_on": false, "reason": "Testing overrides"
    }});
    let server_muted = |state: Arc<AppState>| async move {
        sqlx::query_scalar::<_, bool>(
            "SELECT voice_server_muted FROM server_members WHERE server_id = $1 AND user_id = $2",
        )
        .bind(server_id)
        .bind(target_id)
        .fetch_one(&state.db)
        .await
        .unwrap()
    };

    // Mute Members denied on this voice channel: the request changes nothing.
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{voice_channel_id}/overrides/{mod_role_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": 1_i64 << 11 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "override failed: {body}");
    ws_send(&mut mod_ws, mute_target.clone()).await;
    ws_barrier(&mut mod_ws).await;
    assert!(
        !server_muted(state.clone()).await,
        "a channel deny must block voice moderation"
    );

    // Without the override the same request mutes the member.
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/{voice_channel_id}/overrides/{mod_role_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert!(status.is_success());
    ws_send(&mut mod_ws, mute_target).await;
    ws_barrier(&mut mod_ws).await;
    assert!(
        server_muted(state.clone()).await,
        "server-level Mute Members applies again"
    );
}

#[tokio::test]
async fn livekit_rejoin_and_permission_changes_remove_unauthorized_participants() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    // LiveKit stand-in: reports `room_participants` and records removals.
    let room_participants = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let removed = Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let list_participants = room_participants.clone();
    let record_removed = removed.clone();
    let livekit_app = axum::Router::new()
        .route(
            "/twirp/livekit.RoomService/ListParticipants",
            axum::routing::post(move || {
                let list_participants = list_participants.clone();
                async move {
                    let identities = list_participants.lock().await.clone();
                    axum::Json(json!({
                        "participants": identities
                            .iter()
                            .map(|identity| json!({ "identity": identity, "sid": format!("PA_{identity}") }))
                            .collect::<Vec<_>>()
                    }))
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/RemoveParticipant",
            axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
                let record_removed = record_removed.clone();
                async move {
                    record_removed
                        .lock()
                        .await
                        .push(body["identity"].as_str().unwrap_or_default().to_string());
                    axum::Json(json!({}))
                }
            }),
        )
        .route(
            "/twirp/livekit.RoomService/UpdateParticipant",
            axum::routing::post(|axum::Json(body): axum::Json<serde_json::Value>| async move {
                axum::Json(json!({ "sid": "PA_updated", "identity": body["identity"] }))
            }),
        );
    let livekit_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let livekit_addr = livekit_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(livekit_listener, livekit_app).await;
    });
    let (mut app, state) = setup_app_with_features_and_livekit(
        false,
        false,
        false,
        false,
        "wss://livekit.test.local".to_string(),
        Some(format!("http://{livekit_addr}")),
    )
    .await;

    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Voice Guild").await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let (kicked_auth, kicked_id, _) = register_named_user(&mut app, "kicked").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "member").await;
    join_with_invite(&mut app, &kicked_auth, &invite_code).await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;

    // A token minted while still a member, used after removal (no JoinVoice on the WebSocket).
    voice_token_grant(&mut app, &kicked_auth, voice_channel_id).await;
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/servers/{server_id}/members/{kicked_id}"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "kick failed: {body}");
    removed.lock().await.clear();
    let joined = json!({
        "event": "participant_joined",
        "room": { "name": voice_channel_id.to_string() },
        "participant": { "identity": kicked_id.to_string(), "sid": "PA_stale" },
    })
    .to_string();
    let signature = signed_livekit_webhook(&state, joined.as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri("/api/webrtc/livekit-webhook")
        .header("Authorization", signature)
        .header("content-type", "application/webhook+json")
        .body(Body::from(joined))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&body)
    );
    assert_eq!(
        removed.lock().await.as_slice(),
        [kicked_id.to_string()],
        "a removed member joining with an old token must be disconnected"
    );

    // A member connected directly to LiveKit loses voice access through a permission change.
    room_participants.lock().await.push(member_id.to_string());
    removed.lock().await.clear();
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{voice_channel_id}/overrides/{everyone_id}"),
        &owner_auth,
        Some(json!({ "allow": 0, "deny": PERM_CONNECT_VOICE })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "override failed: {body}");
    assert!(
        removed.lock().await.contains(&member_id.to_string()),
        "participants in the LiveKit room must be rechecked, not only reported sessions"
    );
}

#[tokio::test]
async fn hidden_voice_channel_activity_is_not_broadcast_to_members_who_cannot_view_it() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Hidden Voice")
            .await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let (outsider_auth, _, _) = register_named_user(&mut app, "outsider").await;
    let (insider_auth, insider_id, _) = register_named_user(&mut app, "insider").await;
    join_with_invite(&mut app, &outsider_auth, &invite_code).await;
    join_with_invite(&mut app, &insider_auth, &invite_code).await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    put_channel_override_row(&state, voice_channel_id, everyone_id, 0, PERM_VIEW).await;
    let insider_role_id = grant_role_with_permissions(
        &state,
        server_id,
        insider_id,
        "Voice insiders",
        0,
        PERM_VIEW | PERM_SEND | PERM_CONNECT_VOICE,
    )
    .await;
    put_channel_override_row(&state, voice_channel_id, insider_role_id, PERM_VIEW, 0).await;

    let addr = spawn_ws_app(&state).await;
    let mut owner_ws = connect_ws(addr, &owner_auth).await;
    ws_subscribe(&mut owner_ws, &[text_channel_id, voice_channel_id]).await;
    let mut outsider_ws = connect_ws(addr, &outsider_auth).await;
    // Subscribing to the hidden channel is refused; the text channel is visible.
    ws_subscribe(&mut outsider_ws, &[text_channel_id, voice_channel_id]).await;
    let mut insider_ws = connect_ws(addr, &insider_auth).await;
    ws_subscribe(&mut insider_ws, &[text_channel_id, voice_channel_id]).await;

    ws_send(
        &mut insider_ws,
        json!({ "type": "JoinVoice", "data": { "channel_id": voice_channel_id } }),
    )
    .await;
    let joined = receive_ws_event(&mut owner_ws, "VoiceStateUpdate").await;
    assert_eq!(joined["data"]["user_id"], insider_id.to_string());
    let marker = insider_id.to_string();
    let quiet = std::time::Duration::from_millis(800);
    assert_no_ws_event_mentioning(&mut outsider_ws, "VoiceStateUpdate", &marker, quiet).await;
    assert_no_ws_event_mentioning(&mut outsider_ws, "VoiceControlUpdate", &marker, quiet).await;

    ws_send(&mut insider_ws, json!({ "type": "LeaveVoice" })).await;
    let left = receive_ws_event(&mut owner_ws, "VoiceStateUpdate").await;
    assert!(left["data"]["channel_id"].is_null());
    assert_no_ws_event_mentioning(&mut outsider_ws, "VoiceStateUpdate", &marker, quiet).await;
}
