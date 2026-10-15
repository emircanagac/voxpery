use super::*;

#[tokio::test]
async fn health_returns_200_when_db_connected() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let req = Request::builder()
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;

    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ok");
    assert!(json.get("checks").is_none());
}

#[tokio::test]
async fn privacy_safe_observability_is_feature_gated_and_accepts_only_the_fixed_schema() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app_with_features(false, false, true, false).await;

    let features = Request::builder()
        .uri("/api/system/features")
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, features).await;
    assert_eq!(status, StatusCode::OK);
    let features: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(features["observability_enabled"], true);
    // Without TURN_URLS, voice uses LiveKit's own ICE servers.
    assert_eq!(features["turn_enabled"], false);
    assert!(
        features.get("voice_url").is_some(),
        "desktop custom servers read the voice origin"
    );

    let valid = Request::builder()
        .method("POST")
        .uri("/api/system/observability/events")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "event": "voice_join_succeeded", "client": "web" }).to_string(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, valid).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_empty());

    let arbitrary = Request::builder()
        .method("POST")
        .uri("/api/system/observability/events")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "event": "voice_join_succeeded",
                "client": "web",
                "message": "must not be logged"
            })
            .to_string(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, arbitrary).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn api_security_headers_cover_normal_error_and_preflight_responses() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, _) = setup_app().await;

    let requests = [
        Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .uri("/missing-route")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("OPTIONS")
            .uri("/api/auth/login")
            .header("Origin", "http://localhost:5173")
            .header("Access-Control-Request-Method", "POST")
            .body(Body::empty())
            .unwrap(),
    ];

    for request in requests {
        let response = app.clone().oneshot(request).await.expect("request failed");
        let headers = response.headers();
        assert_eq!(headers["strict-transport-security"], "max-age=31536000");
        assert_eq!(headers["x-frame-options"], "DENY");
        assert_eq!(headers["x-content-type-options"], "nosniff");
        assert_eq!(headers["referrer-policy"], "no-referrer");
        assert!(headers["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert!(headers["permissions-policy"]
            .to_str()
            .unwrap()
            .contains("display-capture=()"));
    }
}

#[tokio::test]
async fn optional_auth_integrations_return_feature_disabled_when_unconfigured() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let disabled_reset_password = format!("disabled-reset-{}", Uuid::new_v4());
    let disabled_token = Uuid::new_v4().to_string();

    let disabled_requests = [
        Request::builder()
            .method("GET")
            .uri("/api/auth/google")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("GET")
            .uri("/api/auth/google/callback?code=test-code")
            .body(Body::empty())
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/google/desktop-exchange")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "code": "00000000000000000000000000000000",
                    "code_verifier": "test-verifier"
                }))
                .unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/forgot-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "email": "disabled@example.com" })).unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/reset-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "token": &disabled_token,
                    "new_password": disabled_reset_password
                }))
                .unwrap(),
            ))
            .unwrap(),
        Request::builder()
            .method("POST")
            .uri("/api/auth/email/confirm")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "token": &disabled_token })).unwrap(),
            ))
            .unwrap(),
    ];

    for req in disabled_requests {
        let (status, body) = oneshot(&mut app, req).await;
        assert_feature_disabled(status, &body);
    }
}

#[tokio::test]
async fn anonymous_auth_requests_cannot_store_oversized_values_in_redis() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _state) = setup_app_with_auth_features(false, true).await;
    let mut redis = redis_client()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let long_value = format!("{}@example.com", "x".repeat(48 * 1024));
    let post = |uri: &str, body: serde_json::Value| {
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    };

    let (status, _) = oneshot(
        &mut app,
        post(
            "/api/auth/login",
            json!({ "identifier": &long_value, "password": "irrelevant-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = oneshot(
        &mut app,
        post("/api/auth/forgot-password", json!({ "email": &long_value })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = oneshot(
        &mut app,
        post(
            "/api/auth/reset-password",
            json!({ "token": &long_value, "new_password": "irrelevant-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    for key in [
        format!("rate:auth:login:{long_value}"),
        format!("auth:login_fail:user:{long_value}"),
        format!("rate:auth:forgot_password:{long_value}"),
        format!("rate:auth:reset_password_attempt:{long_value}"),
    ] {
        let exists: bool = redis::cmd("EXISTS")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .unwrap();
        assert!(
            !exists,
            "oversized value was stored in Redis: {}",
            &key[..40]
        );
    }

    // Public auth endpoints only accept small request bodies.
    let (status, _) = oneshot(
        &mut app,
        post(
            "/api/auth/login",
            json!({ "identifier": "x".repeat(128 * 1024), "password": "irrelevant-password" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn out_of_range_page_limits_are_clamped_instead_of_failing() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (auth, user_id, _) = register_named_user(&mut app, "limitsa").await;
    let (_, friend_id, _) = register_named_user(&mut app, "limitsb").await;
    befriend(&state, user_id, friend_id).await;
    let (_, channel_id, _) =
        create_server_with_default_text_channel(&mut app, &state, &auth, "Limits").await;
    let (status, dm) = api_json(
        &mut app,
        "POST",
        &format!("/api/dm/channels/{friend_id}"),
        &auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "open DM failed: {dm}");
    let dm_id = dm["id"].as_str().unwrap().to_string();

    for uri in [
        format!("/api/dm/messages/{dm_id}?limit=-1"),
        format!("/api/dm/messages/{dm_id}?limit=0"),
        format!("/api/dm/messages/{dm_id}/search?q=hi&limit=-5"),
        format!("/api/messages/{channel_id}/search?q=hi&limit=-5"),
    ] {
        let (status, body) = api_json(&mut app, "GET", &uri, &auth, None).await;
        assert_eq!(status, StatusCode::OK, "{uri} failed: {body}");
    }
}
