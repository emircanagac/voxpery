use super::*;

#[tokio::test]
async fn google_oauth_callback_failures_return_to_the_originating_client() {
    assert!(
        test_db_url().is_some(),
        "This regression requires a test database"
    );
    let (app, _) = setup_app_with_features(false, false, false, true).await;
    let redirect = "/social/dm?room=1#latest";
    for origin in ["http://localhost:5173", "voxpery://auth"] {
        for (query, valid_cookie, expected_error) in [
            ("error=access_denied", true, "oauth_cancelled"),
            ("error=provider_unavailable", true, "oauth_failed"),
            ("", true, "oauth_failed"),
            ("code=", true, "oauth_failed"),
            ("error=access_denied", false, "oauth_failed_csrf"),
        ] {
            // Start through the real endpoint, including its state cookie and PKCE binding.
            let start_uri = format!(
                "/api/auth/google?origin={}&redirect={}&code_challenge={}",
                urlencoding::encode(origin),
                urlencoding::encode(redirect),
                "A".repeat(43),
            );
            let start = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(start_uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(start.status(), StatusCode::TEMPORARY_REDIRECT);
            let google_url =
                reqwest::Url::parse(start.headers()["location"].to_str().unwrap()).unwrap();
            let state = google_url
                .query_pairs()
                .find(|(name, _)| name == "state")
                .unwrap()
                .1
                .into_owned();
            let cookie = start.headers()["set-cookie"]
                .to_str()
                .unwrap()
                .split(';')
                .next()
                .unwrap();
            let callback_uri = format!(
                "/api/auth/google/callback?state={}&{query}",
                urlencoding::encode(&state)
            );
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(callback_uri)
                        .header(
                            "cookie",
                            if valid_cookie {
                                cookie
                            } else {
                                "oauth_state=wrong"
                            },
                        )
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let cookies: Vec<_> = response
                .headers()
                .get_all("set-cookie")
                .iter()
                .map(|v| v.to_str().unwrap())
                .collect();
            assert!(cookies
                .iter()
                .any(|v| v.starts_with("oauth_state=;") && v.contains("Max-Age=0")));
            assert!(!cookies.iter().any(|v| v.starts_with("voxpery_token=")));
            if origin == "voxpery://auth" {
                assert_eq!(response.status(), StatusCode::OK);
                assert_eq!(response.headers()["cache-control"], "no-store");
                let html = String::from_utf8(
                    response
                        .into_body()
                        .collect()
                        .await
                        .unwrap()
                        .to_bytes()
                        .to_vec(),
                )
                .unwrap();
                assert!(html.contains(&format!(
                    "href=\"voxpery://auth/social/dm?room=1&amp;error={expected_error}#latest\""
                )));
                assert!(html.contains("Sign-in could not be completed"));
                assert!(!html.contains("code="));
            } else {
                assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
                let url =
                    reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
                assert_eq!(url.origin().ascii_serialization(), origin);
                assert_eq!(url.path(), "/login");
                let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
                assert_eq!(params.get("error").unwrap(), expected_error);
                assert_eq!(params.get("redirect").unwrap(), redirect);
            }
        }
    }
}

#[tokio::test]
async fn google_oauth_start_defaults_to_servers_for_both_clients() {
    assert!(
        test_db_url().is_some(),
        "This regression requires a test database"
    );
    let (app, _) = setup_app_with_features(false, false, false, true).await;
    for origin in ["http://localhost:5173", "voxpery://auth"] {
        let uri = format!(
            "/api/auth/google?origin={}&code_challenge={}",
            urlencoding::encode(origin),
            "A".repeat(43)
        );
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        let google_url =
            reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
        let state = google_url
            .query_pairs()
            .find(|(name, _)| name == "state")
            .unwrap()
            .1
            .into_owned();
        let decoded = String::from_utf8(BASE64.decode(state).unwrap()).unwrap();
        assert_eq!(decoded.lines().nth(1), Some(origin));
        assert_eq!(decoded.lines().nth(2), Some("/servers"));
    }
}

#[tokio::test]
async fn desktop_oauth_handoff_runs_under_the_full_api_security_middleware() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, _) = setup_app_with_features(false, false, false, true).await;
    let nonce = Uuid::new_v4().to_string();
    let challenge = "A".repeat(43);
    let oauth_state = BASE64.encode(format!("{nonce}\nvoxpery://auth\n/servers\n{challenge}"));
    let uri = format!(
        "/api/auth/google/callback?code=unused&state={}",
        urlencoding::encode(&oauth_state)
    );

    // Deliberately omit the state cookie so the callback returns the desktop
    // error handoff without making a network request to Google.
    let response = app
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .expect("desktop OAuth callback request failed");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let csp = response.headers()["content-security-policy"]
        .to_str()
        .expect("desktop OAuth CSP")
        .to_string();
    assert!(csp.contains("default-src 'none'"));
    assert!(csp.contains("style-src 'nonce-"));
    assert!(csp.contains("script-src 'nonce-"));
    assert!(!csp.contains("'unsafe-inline'"));
    let csp_nonce = csp
        .split("script-src 'nonce-")
        .nth(1)
        .and_then(|suffix| suffix.split('\'').next())
        .expect("script nonce in CSP");

    let body = response
        .into_body()
        .collect()
        .await
        .expect("desktop OAuth body")
        .to_bytes();
    let html = String::from_utf8(body.to_vec()).expect("desktop OAuth HTML");
    assert!(html.contains(&format!("<style nonce=\"{csp_nonce}\">")));
    assert!(html.contains(&format!("<script nonce=\"{csp_nonce}\">")));
    assert!(html.contains("window.setTimeout(openDesktop, 50)"));
    assert!(html.contains("Return to Voxpery"));
}

#[tokio::test]
async fn email_verification_request_returns_feature_disabled_when_email_delivery_is_disabled() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("verify-disabled-{uid}@example.com");
    let username = format!("verify_disabled_{}", uid.as_u128() % 1_000_000);
    let password = format!("verify-disabled-{}", uid.as_simple());
    let (token, _) = register_user(&mut app, &email, &username, &password).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&json!({})).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;

    assert_feature_disabled(status, &body);
}

#[tokio::test]
async fn logout_revokes_the_bearer_token_and_reports_revocation_failure() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, state) = setup_app().await;
    let token = generate_token(Uuid::new_v4(), "logout-test", 0, &state.jwt_secret, 3600).unwrap();
    let request = || {
        Request::builder()
            .method("POST")
            .uri("/api/auth/logout")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };
    let response = app.clone().oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("set-cookie"));
    assert!(
        voxpery_server::services::jwt_blacklist::is_blacklisted(&state.redis, &token)
            .await
            .unwrap()
    );

    drop(app);
    let mut state = Arc::try_unwrap(state)
        .ok()
        .expect("test router must release state");
    // Use a reserved, closed local port; never stop the shared QA Redis service.
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = reservation.local_addr().unwrap().port();
    state.redis = redis::Client::open(format!("redis://127.0.0.1:{port}")).unwrap();
    drop(reservation);
    let app = build_app(Arc::new(state), vec!["http://localhost:5173".to_string()]);
    let response = app.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    // The browser session still ends so a reload cannot restore it; only revocation failed.
    let cleared = response.headers()["set-cookie"].to_str().unwrap();
    assert!(cleared.contains("Max-Age=0"));
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert!(!String::from_utf8_lossy(&body).contains(&token));
}

#[tokio::test]
async fn logout_keeps_a_token_revoked_through_the_expiry_leeway() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let username = format!("leeway_{}", uid.as_u128() % 1_000_000);
    let (_, user_id) = register_user(
        &mut app,
        &format!("leeway-{uid}@example.com"),
        &username,
        test_credential("default"),
    )
    .await;
    let token_version: i64 = sqlx::query_scalar("SELECT token_version FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    // Expired five seconds ago, so it validates only through the JWT leeway.
    let token = generate_token(user_id, &username, token_version, &state.jwt_secret, -5).unwrap();
    let request = |method: &str, uri: &str| {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };

    let (status, _) = oneshot(&mut app, request("GET", "/api/auth/me")).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the leeway accepts the token before logout"
    );
    let (status, _) = oneshot(&mut app, request("POST", "/api/auth/logout")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        voxpery_server::services::jwt_blacklist::is_blacklisted(&state.redis, &token)
            .await
            .unwrap(),
        "a token inside the leeway must still be blacklisted"
    );
    let (status, _) = oneshot(&mut app, request("GET", "/api/auth/me")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn registration_requires_current_legal_documents() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("legal-{uid}@example.com");
    let username = format!("legal_{}", uid.as_u128() % 1_000_000);

    let missing_acceptance = json!({
        "email": email,
        "username": username,
        "password": test_credential("legal-missing")
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&missing_acceptance).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let stale_documents = json!({
        "email": format!("stale-{uid}@example.com"),
        "username": format!("stale_{}", uid.as_u128() % 1_000_000),
        "password": test_credential("legal-stale"),
        "terms_accepted": true,
        "terms_version": "outdated",
        "privacy_notice_acknowledged": true,
        "privacy_notice_version": "outdated",
        "kvkk_notice_acknowledged": true,
        "kvkk_notice_version": CURRENT_KVKK_NOTICE_VERSION
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&stale_documents).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn register_login_me_flow() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("test-{}@example.com", uid);
    let username = format!("user_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

    // Register
    let register_body = registration_body(&email, &username, password);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = auth["token"].as_str().expect("token in response");
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();

    let legal_record: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        r#"SELECT terms_version, privacy_notice_version, kvkk_notice_version
           FROM users
           WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(legal_record.0.as_deref(), Some(CURRENT_TERMS_VERSION));
    assert_eq!(
        legal_record.1.as_deref(),
        Some(CURRENT_PRIVACY_NOTICE_VERSION)
    );
    assert_eq!(legal_record.2.as_deref(), Some(CURRENT_KVKK_NOTICE_VERSION));
    let registration_audit_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM privacy_audit_log
           WHERE user_id = $1 AND event_type = 'account_registered'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(registration_audit_count, 1);

    // GET /api/auth/me with Bearer
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let me: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(me["username"], username);
    assert_eq!(me["dm_privacy"], "everyone");
    assert!(me["id"].as_str().is_some());

    // Login
    let login_body = json!({
        "identifier": email,
        "password": password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn stale_legal_consent_blocks_protected_routes_until_atomic_acknowledgement() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("legal-gate-{uid}@example.com");
    let username = format!("legal_gate_{}", uid.as_u128() % 1_000_000);
    let (token, user_id) =
        register_user(&mut app, &email, &username, test_credential("legal-gate")).await;

    sqlx::query(
        r#"UPDATE users
           SET terms_version = 'outdated',
               terms_accepted_at = NULL,
               privacy_notice_version = NULL,
               privacy_notice_acknowledged_at = NULL,
               kvkk_notice_version = 'outdated',
               kvkk_notice_acknowledged_at = NULL
           WHERE id = $1"#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    .unwrap();

    let status_request = Request::builder()
        .uri("/api/auth/legal-consent")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, status_request).await;
    assert_eq!(status, StatusCode::OK);
    let status_body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status_body["required"], true);
    assert_eq!(
        status_body["current_kvkk_notice_version"],
        CURRENT_KVKK_NOTICE_VERSION
    );

    let protected_request = Request::builder()
        .uri("/api/friends")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, protected_request).await;
    assert_eq!(status, StatusCode::PRECONDITION_REQUIRED);
    let error: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(error["code"], "LEGAL_CONSENT_REQUIRED");

    let me_request = Request::builder()
        .uri("/api/auth/me")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, me_request).await;
    assert_eq!(status, StatusCode::OK);

    let invalid_acceptance = json!({
        "terms_accepted": true,
        "terms_version": CURRENT_TERMS_VERSION,
        "privacy_notice_acknowledged": true,
        "privacy_notice_version": CURRENT_PRIVACY_NOTICE_VERSION,
        "kvkk_notice_acknowledged": false,
        "kvkk_notice_version": CURRENT_KVKK_NOTICE_VERSION
    });
    let invalid_request = Request::builder()
        .method("POST")
        .uri("/api/auth/legal-consent")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&invalid_acceptance).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, invalid_request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let acceptance = json!({
        "terms_accepted": true,
        "terms_version": CURRENT_TERMS_VERSION,
        "privacy_notice_acknowledged": true,
        "privacy_notice_version": CURRENT_PRIVACY_NOTICE_VERSION,
        "kvkk_notice_acknowledged": true,
        "kvkk_notice_version": CURRENT_KVKK_NOTICE_VERSION
    });
    for _ in 0..2 {
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/legal-consent")
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&acceptance).unwrap()))
            .unwrap();
        let (status, body) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK);
        let result: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["required"], false);
    }

    let protected_request = Request::builder()
        .uri("/api/friends")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, protected_request).await;
    assert_eq!(status, StatusCode::OK);

    let legal_audit_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM privacy_audit_log
           WHERE user_id = $1 AND event_type = 'legal_documents_acknowledged'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(legal_audit_count, 1);
}

#[tokio::test]
async fn session_snapshot_supports_cookie_and_bearer_without_acknowledging_documents() {
    let Some(_) = test_db_url() else {
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("session-{uid}@example.com"),
        &format!("session_{}", uid.as_u128() % 1_000_000),
        test_credential("session"),
    )
    .await;
    for header_name in ["authorization", "cookie"] {
        let value = if header_name == "cookie" {
            format!("{}={token}", state.cookie_name)
        } else {
            format!("Bearer {token}")
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/auth/session")
                    .header(header_name, value)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["user"]["id"], user_id.to_string());
        assert_eq!(body["legal_consent"]["required"], false);
        assert_eq!(
            body["legal_consent"]["current_terms_version"],
            CURRENT_TERMS_VERSION
        );
        assert!(body["user"].get("password_hash").is_none());
        assert!(body["user"].get("google_id").is_none());
        assert!(body.get("token").is_none());
    }
    sqlx::query("UPDATE users SET privacy_notice_acknowledged_at = NULL WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    for _ in 0..2 {
        let (status, body) = oneshot(
            &mut app,
            Request::builder()
                .uri("/api/auth/session")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["legal_consent"]["required"], true);
    }
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .uri("/api/friends")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_REQUIRED);
    let writes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM privacy_audit_log WHERE user_id = $1 AND event_type = 'legal_documents_acknowledged'")
        .bind(user_id).fetch_one(&state.db).await.unwrap();
    assert_eq!(writes, 0);
}

#[tokio::test]
async fn session_snapshot_rejects_missing_and_revoked_credentials() {
    let Some(_) = test_db_url() else {
        return;
    };
    let (mut app, state) = setup_app().await;
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .uri("/api/auth/session")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let uid = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("revoked-session-{uid}@example.com"),
        &format!("rev_session_{}", uid.as_u128() % 1_000_000),
        test_credential("revoked-session"),
    )
    .await;
    sqlx::query("UPDATE users SET token_version = token_version + 1 WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    for header_name in ["authorization", "cookie"] {
        let value = if header_name == "cookie" {
            format!("{}={token}", state.cookie_name)
        } else {
            format!("Bearer {token}")
        };
        let (status, _) = oneshot(
            &mut app,
            Request::builder()
                .uri("/api/auth/session")
                .header(header_name, value)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn cookie_authenticated_writes_require_a_trusted_origin() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("csrf-{uid}@example.com");
    let username = format!("csrf_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("csrf");
    let (token, _) = register_user(&mut app, &email, &username, password).await;
    let cookie = format!("voxpery_token={token}");

    for origin in [None, Some("https://evil.example"), Some("null")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/auth/email/request-verification")
            .header("cookie", &cookie)
            .header("content-type", "application/json");
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        let (status, _) = oneshot(&mut app, request.body(Body::from("{}")).unwrap()).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "cookie write from {origin:?} should be rejected"
        );
    }

    let allowed_origin = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("cookie", &cookie)
        .header("origin", "http://localhost:5173")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, allowed_origin).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let allowed_referer = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("cookie", &cookie)
        .header("referer", "http://localhost:5173/settings/account")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, allowed_referer).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let desktop_bearer = Request::builder()
        .method("POST")
        .uri("/api/auth/email/request-verification")
        .header("authorization", format!("Bearer {token}"))
        .header("cookie", &cookie)
        .header("origin", "https://evil.example")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, _) = oneshot(&mut app, desktop_bearer).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

    let safe_cookie_read = Request::builder()
        .uri("/api/auth/me")
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, safe_cookie_read).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn me_unauthorized_without_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let req = Request::builder()
        .uri("/api/auth/me")
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn strict_username_validation_rejects_invalid_usernames() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let invalid_usernames = vec![
        "has space",
        ".start_dot",
        "end_dot.",
        "_start_underscore",
        "end_underscore_",
        "consecutive..dots",
        "consecutive__underscores",
        "special!chars",
    ];

    for username in invalid_usernames {
        let uid = Uuid::new_v4();
        let email = format!("test-{}@example.com", uid);

        let register_body = registration_body(&email, username, test_credential("default"));
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/register")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let err_msg = resp["error"].as_str().unwrap_or("");
        assert!(err_msg.contains("Username cannot") || err_msg.contains("Username may only"));
    }
}

#[tokio::test]
async fn usernames_preserve_case_but_remain_case_insensitively_unique() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let suffix = Uuid::new_v4().as_u128() % 1_000_000;
    let username = format!("VoxUser_{suffix}");
    let email = format!("case-{suffix}@example.com");
    let register_body = registration_body(&email, &username, test_credential("case-preserving"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let response: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(response["user"]["username"], username);

    let duplicate_email = format!("case-duplicate-{suffix}@example.com");
    let duplicate_username = username.to_lowercase();
    let duplicate_body = registration_body(
        &duplicate_email,
        &duplicate_username,
        test_credential("case-duplicate"),
    );
    let duplicate_req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&duplicate_body).unwrap()))
        .unwrap();
    let (duplicate_status, _) = oneshot(&mut app, duplicate_req).await;
    assert_eq!(duplicate_status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn password_change_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("pwchg-{}@example.com", uid);
    let username = format!("pwchg_{}", uid.as_u128() % 1_000_000);
    let old_password = test_credential("default");
    let new_password = test_credential("updated");

    let (old_token, _) = register_user(&mut app, &email, &username, old_password).await;
    let old_auth = format!("Bearer {}", old_token);

    let change_body = json!({
        "old_password": old_password,
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/change-password")
        .header("Authorization", &old_auth)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&change_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "change-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Old token must be rejected immediately.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New password should log in successfully.
    let login_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let login_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let new_token = login_auth["token"].as_str().unwrap();

    // New token should work.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {}", new_token))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn google_only_user_can_set_password_and_login() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let email = format!("oauth-setpw-{}@example.com", uid);
    let username = format!("oauthset_{}", uid.as_u128() % 1_000_000);
    let google_id = format!("google-{}", uid);
    let new_password = test_credential("set");

    sqlx::query(
        r#"INSERT INTO users
           (id, username, email, password_hash, status, dm_privacy, google_id, created_at,
            token_version, terms_version, terms_accepted_at, privacy_notice_version,
            privacy_notice_acknowledged_at, kvkk_notice_version, kvkk_notice_acknowledged_at)
           VALUES
           ($1, $2, $3, 'oauth', 'online', 'friends', $4, NOW(), 0, $5, NOW(), $6, NOW(), $7, NOW())"#,
    )
    .bind(user_id)
    .bind(&username)
    .bind(&email)
    .bind(&google_id)
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .execute(&state.db)
    .await
    .expect("failed to seed oauth-only test user");

    // Password login must fail before set-password.
    let login_before_body = json!({
        "identifier": email,
        "password": test_credential("unset")
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&login_before_body).expect("serialize login before body"),
        ))
        .expect("build login before request");
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let old_token = generate_token(
        user_id,
        &username,
        0,
        &state.jwt_secret,
        state.jwt_expiration,
    )
    .expect("generate old token");
    let old_auth = format!("Bearer {old_token}");

    let set_password_body = json!({
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/set-password")
        .header("Authorization", &old_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&set_password_body).expect("serialize set-password body"),
        ))
        .expect("build set-password request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "set-password failed: {}",
        String::from_utf8_lossy(&body)
    );
    let auth: serde_json::Value =
        serde_json::from_slice(&body).expect("parse set-password response");
    let new_token = auth["token"].as_str().expect("set-password token");
    assert_eq!(auth["user"]["google_connected"], true);
    assert_eq!(auth["user"]["has_password"], true);

    // Old token must be invalid after token_version bump.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .expect("build old /me request");
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New token must work.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", format!("Bearer {new_token}"))
        .body(Body::empty())
        .expect("build new /me request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let me: serde_json::Value = serde_json::from_slice(&body).expect("parse /me response");
    assert_eq!(me["has_password"], true);
    assert_eq!(me["google_connected"], true);

    // Password login now succeeds.
    let login_after_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&login_after_body).expect("serialize login after body"),
        ))
        .expect("build login after request");
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "login after set-password failed: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn google_only_user_can_recover_with_email_and_keep_google_connected() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;

    let uid = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let email = format!("oauth-recovery-{uid}@example.com");
    let username = format!("oauthrecover_{}", uid.as_u128() % 1_000_000);
    let google_id = format!("google-recovery-{uid}");
    let new_password = test_credential("oauth-recovery");

    sqlx::query(
        r#"INSERT INTO users
           (id, username, email, password_hash, status, dm_privacy, google_id, email_verified, created_at, token_version)
           VALUES ($1, $2, $3, 'oauth', 'online', 'friends', $4, TRUE, NOW(), 0)"#,
    )
    .bind(user_id)
    .bind(&username)
    .bind(&email)
    .bind(&google_id)
    .execute(&state.db)
    .await
    .expect("failed to seed OAuth-only recovery user");

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/forgot-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "email": email })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "OAuth-only forgot-password failed: {}",
        String::from_utf8_lossy(&body)
    );
    let reset_token_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        reset_token_count, 1,
        "OAuth-only account needs a recovery token"
    );

    let reset_token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(reset_token_plain.as_bytes());
    let reset_token_hash = BASE64.encode(hasher.finalize());
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    sqlx::query(
        "UPDATE password_reset_tokens SET token_hash = $1, expires_at = $2 WHERE user_id = $3",
    )
    .bind(reset_token_hash)
    .bind(expires_at)
    .bind(user_id)
    .execute(&state.db)
    .await
    .unwrap();

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/reset-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "token": reset_token_plain,
                "new_password": new_password,
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "OAuth-only reset-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    let recovered =
        sqlx::query_as::<_, voxpery_server::models::User>("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_ne!(recovered.password_hash, "oauth");
    assert_eq!(recovered.google_id.as_deref(), Some(google_id.as_str()));

    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "identifier": email,
                "password": new_password,
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "recovered OAuth account could not password-login: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn password_reset_invalidates_old_token() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;

    let uid = Uuid::new_v4();
    let email = format!("pwreset-{}@example.com", uid);
    let username = format!("pwreset_{}", uid.as_u128() % 1_000_000);
    let old_password = test_credential("default");
    let new_password = test_credential("updated");

    let (old_token, user_id) = register_user(&mut app, &email, &username, old_password).await;
    let old_auth = format!("Bearer {}", old_token);

    // Seed a known reset token in DB (same hashing logic as backend).
    let reset_token_plain = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(reset_token_plain.as_bytes());
    let reset_token_hash = BASE64.encode(hasher.finalize());
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(reset_token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .unwrap();

    let reset_body = json!({
        "token": reset_token_plain,
        "new_password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/reset-password")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&reset_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "reset-password failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Old token must be rejected immediately.
    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &old_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Old password should fail.
    let old_login_body = json!({
        "identifier": email,
        "password": old_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&old_login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // New password should work.
    let new_login_body = json!({
        "identifier": email,
        "password": new_password
    });
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&new_login_body).unwrap()))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn data_export_returns_user_profile_and_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("export-{}@example.com", uid);
    let username = format!("export_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let profile_req = Request::builder()
        .method("PATCH")
        .uri("/api/auth/profile")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "about_me": "Building a thoughtful community."
            }))
            .unwrap(),
        ))
        .unwrap();
    let (profile_status, profile_body) = oneshot(&mut app, profile_req).await;
    assert_eq!(profile_status, StatusCode::OK);
    let profile: serde_json::Value = serde_json::from_slice(&profile_body).unwrap();
    assert_eq!(profile["about_me"], "Building a thoughtful community.");
    assert!(chrono::DateTime::parse_from_rfc3339(profile["created_at"].as_str().unwrap()).is_ok());

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Export Server {}", uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": format!("export-chat-{}", uid.as_u128() % 100000),
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let text_channel_id = channel["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", text_channel_id))
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "export me" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "message send failed: {}",
        String::from_utf8_lossy(&body)
    );
    let message: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = message["id"].as_str().unwrap();

    sqlx::query(
        r#"UPDATE messages
           SET attachments = $1
           WHERE id = $2"#,
    )
    .bind(serde_json::json!([{
        "id": Uuid::new_v4().to_string(),
        "url": "https://api.example.test/api/attachments/content/internal?exp=999&sig=secret",
        "type": "image/png",
        "name": "diagram.png",
        "size": 1234,
        "sha256": "internal-sha"
    }]))
    .bind(Uuid::parse_str(message_id).unwrap())
    .execute(&state.db)
    .await
    .unwrap();

    let boundary = format!("----voxperyexport{}", Uuid::new_v4());
    let attachment_bytes = b"private export attachment";
    let upload_body = [
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"private.txt\"\r\nContent-Type: text/plain\r\n\r\n"
        )
        .into_bytes(),
        attachment_bytes.to_vec(),
        format!("\r\n--{boundary}--\r\n").into_bytes(),
    ]
    .concat();
    let upload_req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(upload_body))
        .unwrap();
    let (upload_status, upload_response) = oneshot(&mut app, upload_req).await;
    assert_eq!(
        upload_status,
        StatusCode::OK,
        "attachment upload failed: {}",
        String::from_utf8_lossy(&upload_response)
    );

    let missing_password_req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();
    let (missing_password_status, missing_password_body) =
        oneshot(&mut app, missing_password_req).await;
    assert_eq!(missing_password_status, StatusCode::FORBIDDEN);
    let missing_password_error: serde_json::Value =
        serde_json::from_slice(&missing_password_body).unwrap();
    assert_eq!(missing_password_error["code"], "REAUTH_REQUIRED");

    let wrong_password_req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "password": "definitely-wrong" })).unwrap(),
        ))
        .unwrap();
    let (wrong_password_status, _) = oneshot(&mut app, wrong_password_req).await;
    assert_eq!(wrong_password_status, StatusCode::UNAUTHORIZED);

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/data-export")
        .header("Authorization", &auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "password": password })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "data export failed: {}",
        String::from_utf8_lossy(&body)
    );

    let mut archive = zip::ZipArchive::new(Cursor::new(body.to_vec()))
        .expect("data export response must be a ZIP archive");
    let mut manifest_json = String::new();
    archive
        .by_name("voxpery-data-export.json")
        .expect("export manifest must be present")
        .read_to_string(&mut manifest_json)
        .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&manifest_json).unwrap();
    assert_eq!(payload["export"]["format"], "voxpery-user-data-v3");
    assert_eq!(
        payload["export"]["scope"],
        "self_service_convenience_export"
    );
    assert_eq!(
        payload["export"]["is_complete_data_subject_access_response"],
        false
    );
    assert_eq!(payload["account"]["email"], email);
    assert_eq!(payload["account"]["username"], username);
    assert!(payload["account"].get("id").is_none());
    assert!(payload["account"].get("avatar_url").is_none());
    assert!(payload["account"].get("password_hash").is_none());
    assert!(payload["account"].get("token_version").is_none());
    assert_eq!(payload["profile"]["has_avatar"], false);
    assert_eq!(
        payload["profile"]["about_me"],
        "Building a thoughtful community."
    );
    assert!(payload["servers"].is_array());
    assert!(payload["relationships"]["friends"].is_array());
    assert!(payload["relationships"]["friend_requests"].is_array());
    assert!(payload["messages"]["server"].is_array());
    assert!(payload["messages"]["direct"].is_array());
    if let Some(first_membership) = payload["servers"].as_array().and_then(|rows| rows.first()) {
        assert!(
            first_membership.get("server_id").is_none(),
            "server_id must not be included in export memberships",
        );
    }
    if let Some(first_server_message) = payload["messages"]["server"]
        .as_array()
        .and_then(|rows| rows.first())
    {
        assert!(
            first_server_message.get("server_id").is_none(),
            "server_id must not be included in exported server messages",
        );
        assert!(
            first_server_message.get("channel_id").is_none(),
            "channel_id must not be included in exported server messages",
        );
        assert!(
            first_server_message.get("id").is_none(),
            "message id must not be included in exported server messages",
        );
    }
    let exported_message = payload["messages"]["server"]
        .as_array()
        .and_then(|rows| rows.iter().find(|msg| msg["content"] == "export me"))
        .expect("export payload should include authored message");
    assert_eq!(
        exported_message["attachments"][0]["name"],
        serde_json::json!("diagram.png")
    );
    assert_eq!(
        exported_message["attachments"][0]["content_type"],
        serde_json::json!("image/png")
    );
    assert_eq!(
        exported_message["attachments"][0]["size_bytes"],
        serde_json::json!(1234)
    );
    assert!(exported_message["attachments"][0].get("id").is_none());
    assert!(exported_message["attachments"][0].get("url").is_none());
    assert!(exported_message["attachments"][0].get("sha256").is_none());

    let exported_file = payload["export"]["files"]
        .as_array()
        .and_then(|files| files.iter().find(|file| file["name"] == "private.txt"))
        .expect("owned attachment must be listed in the export manifest");
    let archive_path = exported_file["archive_path"].as_str().unwrap();
    assert!(archive_path.starts_with("files/attachments/"));
    let mut exported_attachment = Vec::new();
    archive
        .by_name(archive_path)
        .expect("owned attachment bytes must be included")
        .read_to_end(&mut exported_attachment)
        .unwrap();
    assert_eq!(exported_attachment, attachment_bytes);

    let export_text = serde_json::to_string(&payload).unwrap();
    for forbidden in [
        "\"password_hash\"",
        "\"access_token\"",
        "\"refresh_token\"",
        "\"session_id\"",
        "\"avatar_url\"",
        "internal-sha",
        "sig=secret",
    ] {
        assert!(
            !export_text.contains(forbidden),
            "export payload must not contain sensitive/internal field: {forbidden}"
        );
    }
    assert!(
        !export_text.contains(&user_id.to_string()),
        "export payload should not expose the account database id"
    );

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM privacy_audit_log
           WHERE user_id = $1 AND event_type = 'data_export_created'"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(audit_count, 1, "data export must create one audit event");
}

#[tokio::test]
async fn account_delete_endpoint_enforces_privacy() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    // Permanent delete flow
    let del_uid = Uuid::new_v4();
    let del_email = format!("delete-{}@example.com", del_uid);
    let del_username = format!("delete_{}", del_uid.as_u128() % 1_000_000);
    let del_password = test_credential("default");
    let (del_token, del_user_id) =
        register_user(&mut app, &del_email, &del_username, del_password).await;
    let del_auth = format!("Bearer {}", del_token);

    // Create a server so owner transfer path is exercised.
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &del_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Delete Owner {}", del_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server before delete failed: {}",
        String::from_utf8_lossy(&body)
    );
    let created_server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let created_server_id = Uuid::parse_str(created_server["id"].as_str().unwrap()).unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/auth/account")
        .header("Authorization", &del_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "confirm": "DELETE",
                "password": del_password
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "permanent delete failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri("/api/auth/me")
        .header("Authorization", &del_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let deleted_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = $1")
        .bind(del_user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(deleted_count, 0, "user row must be removed after delete");

    let owner_after: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(created_server_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_ne!(
        owner_after, del_user_id,
        "server ownership must be transferred away from deleted account"
    );
}

#[tokio::test]
async fn forgot_password_rate_limit_blocks_after_three_attempts() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app_with_auth_features(false, true).await;

    let email = format!("forgot-rate-limit-{}@example.com", Uuid::new_v4());
    for attempt in 0..3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/forgot-password")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "email": email })).unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, req).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "forgot-password attempt {} failed unexpectedly: {}",
            attempt + 1,
            String::from_utf8_lossy(&body)
        );
    }

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/forgot-password")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "email": email })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "forgot-password should be rate-limited on the 4th request: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn email_verification_confirm_works_without_existing_session() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(true, false).await;

    let uid = Uuid::new_v4();
    let email = format!("verify-{}@example.com", uid);
    let username = format!("verify_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (_token, user_id) = register_user(&mut app, &email, &username, password).await;

    sqlx::query("UPDATE users SET email_verified = FALSE WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let verification_token = Uuid::new_v4().to_string();
    let token_hash = token_hash_base64(&verification_token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);

    sqlx::query(
        "INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(&email)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/email/confirm")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "token": verification_token })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "email verification confirm should succeed without auth: {}",
        String::from_utf8_lossy(&body)
    );

    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["message"], "Your email address has been verified.");

    let verified: bool = sqlx::query_scalar("SELECT email_verified FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert!(verified, "user should be marked verified after confirm");

    let remaining_tokens: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_verification_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(remaining_tokens, 0, "verification token should be deleted");
}

#[tokio::test]
async fn pending_google_registration_requires_cookie_csrf_and_current_documents() {
    let (mut app, state) = setup_app_with_features(false, false, false, true).await;
    let (cookie, csrf, google_id, _) = pending_google_fixture(&state, false).await;
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .uri("/api/auth/legal-documents")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut request = pending_google_request(&cookie, &csrf);
    request.headers_mut().remove("cookie");
    assert_eq!(oneshot(&mut app, request).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        oneshot(&mut app, pending_google_request(&cookie, "wrong-csrf"))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let request = Request::builder()
        .uri("/api/auth/google/registration")
        .header("cookie", format!("voxpery_google_registration={cookie}"))
        .body(Body::empty())
        .unwrap();
    let (status, html) = oneshot(&mut app, request).await;
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(html.to_vec()).unwrap();
    assert!(html.contains("Complete your Voxpery account"));
    assert!(!html.contains(&google_id));
    assert!(!html.contains("checked"));

    for form in [
        format!("csrf_token={csrf}&terms_version={CURRENT_TERMS_VERSION}&privacy_notice_version={CURRENT_PRIVACY_NOTICE_VERSION}&kvkk_notice_version={CURRENT_KVKK_NOTICE_VERSION}"),
        format!("csrf_token={csrf}&terms_accepted=true&terms_version=old&privacy_notice_acknowledged=true&privacy_notice_version=old&kvkk_notice_acknowledged=true&kvkk_notice_version=old"),
    ] {
        let mut request = pending_google_request(&cookie, &csrf);
        *request.body_mut() = Body::from(form);
        let (status, html) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK);
        assert!(!String::from_utf8(html.to_vec()).unwrap().contains("checked"));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE google_id=$1")
        .bind(&google_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("UPDATE pending_google_registrations SET expires_at=NOW()-INTERVAL '1 second' WHERE google_id=$1").bind(google_id).execute(&state.db).await.unwrap();
    assert_eq!(
        oneshot(&mut app, pending_google_request(&cookie, &csrf))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn pending_google_registration_finalizes_atomically_and_rejects_concurrent_replay() {
    let (app, state) = setup_app_with_features(false, false, false, true).await;
    let (cookie, csrf, google_id, _) = pending_google_fixture(&state, false).await;
    let (first, second) = tokio::join!(
        app.clone().oneshot(pending_google_request(&cookie, &csrf)),
        app.clone().oneshot(pending_google_request(&cookie, &csrf))
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert!([first.status(), second.status()].contains(&StatusCode::SEE_OTHER));
    assert!([first.status(), second.status()].contains(&StatusCode::BAD_REQUEST));
    let success = if first.status() == StatusCode::SEE_OTHER {
        first
    } else {
        second
    };
    assert_eq!(
        success.headers()["location"],
        "http://localhost:5173/social"
    );
    assert_eq!(success.headers().get_all("set-cookie").iter().count(), 2);
    let user: voxpery_server::models::User =
        sqlx::query_as("SELECT * FROM users WHERE google_id=$1")
            .bind(&google_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert!(
        voxpery_server::services::privacy::has_current_legal_consent(&state.db, user.id)
            .await
            .unwrap()
    );
    let audit: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM privacy_audit_log WHERE user_id=$1 AND event_type='account_registered'").bind(user.id).fetch_one(&state.db).await.unwrap();
    assert_eq!(audit, 1);
    let pending: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_google_registrations WHERE google_id=$1")
            .bind(google_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn pending_google_registration_keeps_desktop_pkce_handoff_single_use() {
    let (mut app, state) = setup_app_with_features(false, false, false, true).await;
    let (cookie, csrf, _, verifier) = pending_google_fixture(&state, true).await;
    let response = app
        .clone()
        .oneshot(pending_google_request(&cookie, &csrf))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    // Desktop gets its session from the PKCE exchange only; the browser stays signed out.
    let session_cookie = format!("{}=", state.cookie_name);
    assert!(response
        .headers()
        .get_all("set-cookie")
        .iter()
        .all(|value| !value.to_str().unwrap().starts_with(&session_cookie)));
    let html = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    let offset = html.find("code=").expect("short-lived code in deep link") + 5;
    let code = &html[offset..offset + 32];
    assert!(code.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(!html.contains("token="));
    assert!(!html.contains("eyJ"));
    for expected in [StatusCode::OK, StatusCode::UNAUTHORIZED] {
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/google/desktop-exchange")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({ "code": code, "code_verifier": verifier }).to_string(),
            ))
            .unwrap();
        assert_eq!(oneshot(&mut app, request).await.0, expected);
    }
}

#[tokio::test]
async fn desktop_registration_rejects_unapproved_origins_and_missing_pkce() {
    let (mut app, _) = setup_app().await;
    for origin in [
        "voxpery-dev://auth",
        "https://evil.example",
        "voxpery://other",
    ] {
        let request = Request::builder()
            .uri(format!(
                "/api/auth/desktop-registration?origin={}&code_challenge={}",
                urlencoding::encode(origin),
                "a".repeat(43)
            ))
            .body(Body::empty())
            .unwrap();
        assert_eq!(oneshot(&mut app, request).await.0, StatusCode::FORBIDDEN);
    }
    let request = Request::builder()
        .uri("/api/auth/desktop-registration?origin=voxpery%3A%2F%2Fauth")
        .body(Body::empty())
        .unwrap();
    assert_eq!(oneshot(&mut app, request).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn desktop_registration_requires_cookie_csrf_current_legal_proof_and_live_context() {
    let (mut app, state) = setup_app().await;
    let (cookie, csrf, hash, _) =
        desktop_registration_fixture(&app, &state, "voxpery://auth").await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let mut request = desktop_registration_request(&cookie, &csrf, &email);
    request.headers_mut().remove("cookie");
    assert_eq!(oneshot(&mut app, request).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        oneshot(
            &mut app,
            desktop_registration_request(&cookie, "wrong", &email)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for body in [
        format!("csrf_token={csrf}&username=legal_test&email={email}&password=test-password&confirm_password=test-password&terms_version={CURRENT_TERMS_VERSION}&privacy_notice_version={CURRENT_PRIVACY_NOTICE_VERSION}&kvkk_notice_version={CURRENT_KVKK_NOTICE_VERSION}"),
        format!("csrf_token={csrf}&username=legal_test&email={email}&password=test-password&confirm_password=test-password&terms_accepted=true&terms_version=old&privacy_notice_acknowledged=true&privacy_notice_version=old&kvkk_notice_acknowledged=true&kvkk_notice_version=old"),
    ] {
        let mut request = desktop_registration_request(&cookie, &csrf, &email);
        *request.body_mut() = Body::from(body);
        let (status, html) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK);
        let html = String::from_utf8(html.to_vec()).unwrap();
        assert!(!html.contains("checked"));
        assert!(!html.contains("code="));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email=$1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("UPDATE pending_desktop_registrations SET expires_at=NOW()-INTERVAL '1 second' WHERE cookie_hash=$1")
        .bind(hash).execute(&state.db).await.unwrap();
    assert_eq!(
        oneshot(
            &mut app,
            desktop_registration_request(&cookie, &csrf, &email)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn desktop_registration_finalizes_once_without_google_and_exchanges_once() {
    let (mut app, state) = setup_app().await;
    let (cookie, csrf, hash, verifier) =
        desktop_registration_fixture(&app, &state, "voxpery://auth").await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let (first, second) = tokio::join!(
        app.clone()
            .oneshot(desktop_registration_request(&cookie, &csrf, &email)),
        app.clone()
            .oneshot(desktop_registration_request(&cookie, &csrf, &email)),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert!([first.status(), second.status()].contains(&StatusCode::OK));
    assert!([first.status(), second.status()].contains(&StatusCode::BAD_REQUEST));
    let success = if first.status() == StatusCode::OK {
        first
    } else {
        second
    };
    assert_eq!(success.headers().get_all("set-cookie").iter().count(), 1);
    let html = String::from_utf8(
        success
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("voxpery://auth/social?code="));
    assert!(!html.contains("eyJ"));
    let offset = html.find("code=").unwrap() + 5;
    let code = &html[offset..offset + 32];
    assert_eq!(
        oneshot(&mut app, desktop_exchange_request(code, &verifier))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        oneshot(&mut app, desktop_exchange_request(code, &verifier))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email=$1")
        .bind(email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert!(
        voxpery_server::services::privacy::has_current_legal_consent(&state.db, user_id)
            .await
            .unwrap()
    );
    let audit: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM privacy_audit_log WHERE user_id=$1 AND event_type='account_registered'")
        .bind(user_id).fetch_one(&state.db).await.unwrap();
    assert_eq!(audit, 1);
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pending_desktop_registrations WHERE cookie_hash=$1",
    )
    .bind(hash)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pending, 0);
}

#[tokio::test]
async fn desktop_registration_rerenders_fixable_errors_without_echoing_passwords() {
    let (mut app, state) = setup_app().await;
    let taken_email = format!("{}@example.test", Uuid::new_v4());
    let taken_username = format!("taken_{}", &Uuid::new_v4().simple().to_string()[..20]);
    register_user(
        &mut app,
        &taken_email,
        &taken_username,
        test_credential("taken"),
    )
    .await;
    let (cookie, csrf, hash, _) =
        desktop_registration_fixture(&app, &state, "voxpery://auth").await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let legal = format!("terms_accepted=true&terms_version={CURRENT_TERMS_VERSION}&privacy_notice_acknowledged=true&privacy_notice_version={CURRENT_PRIVACY_NOTICE_VERSION}&kvkk_notice_acknowledged=true&kvkk_notice_version={CURRENT_KVKK_NOTICE_VERSION}");
    for (body, expected_status, expected_message) in [
        (
            format!("csrf_token={csrf}&username={taken_username}&email={}&password=distinct-secret-value&confirm_password=distinct-secret-value&{legal}", urlencoding::encode(&email)),
            StatusCode::CONFLICT,
            "already exists",
        ),
        (
            format!("csrf_token={csrf}&username=fresh_name&email=not-an-email&password=distinct-secret-value&confirm_password=distinct-secret-value&{legal}"),
            StatusCode::BAD_REQUEST,
            "valid format",
        ),
        (
            format!("csrf_token={csrf}&username=fresh_name&email={}&password=distinct-secret-value&confirm_password=other-secret-value&{legal}", urlencoding::encode(&email)),
            StatusCode::BAD_REQUEST,
            "Passwords do not match",
        ),
    ] {
        let mut request = desktop_registration_request(&cookie, &csrf, &email);
        *request.body_mut() = Body::from(body);
        let (status, html) = oneshot(&mut app, request).await;
        assert_eq!(status, expected_status);
        let html = String::from_utf8(html.to_vec()).unwrap();
        assert!(html.contains(expected_message), "{expected_message}");
        assert!(html.contains("<form method=\"post\""));
        assert!(html.contains("checked"));
        assert!(!html.contains("distinct-secret-value"));
        assert!(!html.contains("code="));
    }
    // The pending context survives so the corrected form can still be submitted.
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pending_desktop_registrations WHERE cookie_hash=$1",
    )
    .bind(&hash)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(pending, 1);
    let (status, html) = oneshot(
        &mut app,
        desktop_registration_request(&cookie, &csrf, &email),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8(html.to_vec())
        .unwrap()
        .contains("voxpery://auth/social?code="));
}

#[tokio::test]
async fn desktop_registration_enforces_captcha_and_shared_registration_limits() {
    let (app, mut state) = setup_app().await;
    drop(app);
    let config = Arc::get_mut(&mut state).unwrap();
    config.turnstile_secret_key = Some(test_credential("turnstile").into());
    config.turnstile_site_key = Some("test-public-site-key".into());
    let mut app = build_app(state.clone(), state.cors_origins.clone());
    let (cookie, csrf, _, _) = desktop_registration_fixture(&app, &state, "voxpery://auth").await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let (status, html) = oneshot(
        &mut app,
        desktop_registration_request(&cookie, &csrf, &email),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let html = String::from_utf8(html.to_vec()).unwrap();
    assert!(html.contains("CAPTCHA token is required"));
    assert!(html.contains(&format!("value=\"{email}\"")));
    assert!(html.contains("<button type=submit disabled>"));
    assert!(html.contains("registration-captcha-retry"));
    assert!(html.contains("CAPTCHA loading timed out"));
    assert!(html.contains("<script nonce=\""));
    for _ in 1..state.auth_rate_limit_max {
        voxpery_server::services::rate_limit::enforce_rate_limit(
            &state.redis,
            format!("auth:register:{email}"),
            state.auth_rate_limit_max,
            std::time::Duration::from_secs(state.auth_rate_limit_window_secs),
            "Test registration limit",
        )
        .await
        .unwrap();
    }
    let (status, html) = oneshot(
        &mut app,
        desktop_registration_request(&cookie, &csrf, &email),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    // Rate limits keep the user on the same form instead of a raw JSON error.
    let html = String::from_utf8(html.to_vec()).unwrap();
    assert!(html.contains("Too many register attempts"));
    assert!(html.contains("name=\"csrf_token\""));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email=$1")
        .bind(email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn desktop_exchange_rejects_wrong_pkce_and_expired_codes() {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let (mut app, state) = setup_app().await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let username = format!("exchange_{}", &Uuid::new_v4().simple().to_string()[..20]);
    let (token, _) = register_user(&mut app, &email, &username, test_credential("exchange")).await;
    let verifier = "a".repeat(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let code = Uuid::new_v4().simple().to_string();
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    redis::cmd("SET")
        .arg(format!("auth:oauth:desktop_code:{code}"))
        .arg(json!({"token": token, "code_challenge": challenge}).to_string())
        .arg("EX")
        .arg(90)
        .query_async::<()>(&mut redis)
        .await
        .unwrap();
    assert_eq!(
        oneshot(&mut app, desktop_exchange_request(&code, &"b".repeat(64)))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        oneshot(&mut app, desktop_exchange_request(&code, &verifier))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let expired = Uuid::new_v4().simple().to_string();
    let key = format!("auth:oauth:desktop_code:{expired}");
    redis::cmd("SET")
        .arg(&key)
        .arg(json!({"token": token, "code_challenge": challenge}).to_string())
        .query_async::<()>(&mut redis)
        .await
        .unwrap();
    redis::cmd("EXPIREAT")
        .arg(&key)
        .arg(1)
        .query_async::<()>(&mut redis)
        .await
        .unwrap();
    assert_eq!(
        oneshot(&mut app, desktop_exchange_request(&expired, &verifier))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn password_reset_tokens_work_once_even_under_concurrent_use() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(false, true).await;
    let (_, user_id, _) = register_named_user(&mut app, "resetonce").await;

    let token = seed_password_reset_token(
        &state,
        user_id,
        chrono::Utc::now() + chrono::Duration::hours(1),
    )
    .await;
    let (mut first_app, mut second_app) = (app.clone(), app.clone());
    let first = reset_password_request(&token, test_credential("first"));
    let second = reset_password_request(&token, test_credential("second"));
    let ((first_status, _), (second_status, _)) = tokio::join!(
        oneshot(&mut first_app, first),
        oneshot(&mut second_app, second)
    );
    let mut statuses = [first_status, second_status];
    statuses.sort();
    assert_eq!(
        statuses,
        [StatusCode::OK, StatusCode::BAD_REQUEST],
        "exactly one concurrent reset may use the token"
    );
    let (status, _) = oneshot(
        &mut app,
        reset_password_request(&token, test_credential("third")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a used token is rejected");

    // An expired token is refused and removed.
    let expired = seed_password_reset_token(
        &state,
        user_id,
        chrono::Utc::now() - chrono::Duration::minutes(1),
    )
    .await;
    let (status, _) = oneshot(
        &mut app,
        reset_password_request(&expired, test_credential("late")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(remaining, 0, "the expired token is deleted");
}

#[tokio::test]
async fn seed_admin_is_never_created_with_the_example_password() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (_, state) = setup_app().await;
    let suffix = Uuid::new_v4().simple().to_string();
    let email = format!("seed-{suffix}@example.com");
    let username = format!("seed_{}", &suffix[..8]);

    let skipped = voxpery_server::routes::auth::ensure_seed_admin(
        &state.db,
        &email,
        &username,
        "CHANGE_ME_TO_A_STRONG_ADMIN_PASSWORD",
    )
    .await
    .unwrap();
    assert_eq!(
        skipped, None,
        "the placeholder password must not create an account"
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);

    let created = voxpery_server::routes::auth::ensure_seed_admin(
        &state.db,
        &email,
        &username,
        test_credential("seed-admin"),
    )
    .await
    .unwrap()
    .expect("a strong password creates the seed admin");
    // An existing account is still returned (it may own the default server) whatever the
    // configured password is; a weak one only produces a warning.
    let again = voxpery_server::routes::auth::ensure_seed_admin(
        &state.db,
        &email,
        &username,
        "CHANGE_ME_TO_A_STRONG_ADMIN_PASSWORD",
    )
    .await
    .unwrap();
    assert_eq!(again, Some(created));
}

#[tokio::test]
async fn changing_email_needs_the_password_and_waits_for_confirmation() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app_with_auth_features(true, true).await;
    let uid = Uuid::new_v4();
    let email = format!("mail-{uid}@example.com");
    let password = test_credential("mail");
    let (token, user_id) = register_user(
        &mut app,
        &email,
        &format!("mail_{}", uid.as_u128() % 1_000_000),
        password,
    )
    .await;
    let auth = format!("Bearer {token}");
    let next_email = format!("next-{uid}@example.com");
    let stored_email = |state: Arc<AppState>| async move {
        sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap()
    };

    // A session alone cannot move the account to another address.
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/request-verification",
        &auth,
        Some(json!({ "email": next_email })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "the current password is required"
    );
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/request-verification",
        &auth,
        Some(json!({ "email": next_email, "current_password": "not-the-password" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a wrong password is refused"
    );

    // With the password the request goes through to delivery (no SMTP in tests), but the
    // account keeps its address until the new one is confirmed.
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/request-verification",
        &auth,
        Some(json!({ "email": next_email, "current_password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        stored_email(state.clone()).await,
        email,
        "the address must not change before confirmation"
    );
    let pending: String =
        sqlx::query_scalar("SELECT email FROM email_verification_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        pending, next_email,
        "the new address waits in the verification token"
    );

    // Confirming the link applies it, unless another account took the address meanwhile.
    let confirm_with_token = |state: Arc<AppState>, pending_email: String| async move {
        let plain = Uuid::new_v4().to_string();
        sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(user_id)
        .bind(pending_email)
        .bind(token_hash_base64(&plain))
        .bind(chrono::Utc::now() + chrono::Duration::hours(1))
        .execute(&state.db)
        .await
        .unwrap();
        plain
    };
    let (_, other_id) = register_user(
        &mut app,
        &format!("taken-{uid}@example.com"),
        &format!("taken_{}", uid.as_u128() % 1_000_000),
        test_credential("taken"),
    )
    .await;
    let _ = other_id;
    let plain = confirm_with_token(state.clone(), format!("taken-{uid}@example.com")).await;
    let (status, _) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/confirm",
        "",
        Some(json!({ "token": plain })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "an address taken meanwhile is not applied"
    );

    let plain = confirm_with_token(state.clone(), next_email.clone()).await;
    let (status, body) = api_json(
        &mut app,
        "POST",
        "/api/auth/email/confirm",
        "",
        Some(json!({ "token": plain })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "confirm failed: {body}");
    assert_eq!(stored_email(state.clone()).await, next_email);
}

#[tokio::test]
async fn deleting_an_account_removes_its_files_and_hands_its_servers_on() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let password = test_credential("leaving");
    let (owner_token, owner_id) = register_user(
        &mut app,
        &format!("leaving-{uid}@example.com"),
        &format!("leaving_{}", uid.as_u128() % 1_000_000),
        password,
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (senior_auth, senior_id, _) = register_named_user(&mut app, "heirsenior").await;
    let (junior_auth, _, _) = register_named_user(&mut app, "heirjunior").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Inherited").await;
    // The junior member joins first, but the senior member holds a higher role.
    for auth in [&junior_auth, &senior_auth] {
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
    let role_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO server_roles (id, server_id, name, color, position, permissions)
         VALUES ($1, $2, 'Heir', NULL, 0, $3)",
    )
    .bind(role_id)
    .bind(server_id)
    .bind(PERM_VIEW)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
    )
    .bind(server_id)
    .bind(senior_id)
    .bind(role_id)
    .execute(&state.db)
    .await
    .unwrap();
    let (solo_server_id, _, _) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Solo").await;

    // An uploaded file that must leave the disk with the account.
    let boundary = format!("----voxperydelete{uid}");
    let upload_body = [
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"mine.txt\"\r\nContent-Type: text/plain\r\n\r\n"
        )
        .into_bytes(),
        b"my private notes".to_vec(),
        format!("\r\n--{boundary}--\r\n").into_bytes(),
    ]
    .concat();
    let (status, body) = oneshot(
        &mut app,
        Request::builder()
            .method("POST")
            .uri("/api/attachments/upload")
            .header("Authorization", &owner_auth)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(upload_body))
            .unwrap(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "upload failed: {}",
        String::from_utf8_lossy(&body)
    );
    let storage_key: String =
        sqlx::query_scalar("SELECT storage_key FROM uploaded_attachments WHERE user_id = $1")
            .bind(owner_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert!(state
        .attachment_service
        .open_local_attachment_file(&storage_key)
        .await
        .is_ok());

    let (status, body) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &owner_auth,
        Some(json!({ "confirm": "DELETE", "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "delete failed: {body}");
    assert!(
        state
            .attachment_service
            .open_local_attachment_file(&storage_key)
            .await
            .is_err(),
        "the uploaded file must be removed from disk"
    );
    let owner_of = |state: Arc<AppState>, id: Uuid| async move {
        sqlx::query_scalar::<_, Uuid>("SELECT owner_id FROM servers WHERE id = $1")
            .bind(id)
            .fetch_one(&state.db)
            .await
            .unwrap()
    };
    assert_eq!(
        owner_of(state.clone(), server_id).await,
        senior_id,
        "the highest-ranked member becomes the owner"
    );
    let solo_owner = owner_of(state.clone(), solo_server_id).await;
    assert_ne!(
        solo_owner, owner_id,
        "an empty server goes to the deleted-account placeholder"
    );
    let (status, roles) = api_json(
        &mut app,
        "GET",
        &format!("/api/servers/{server_id}/roles"),
        &senior_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the new owner manages the server: {roles}"
    );
}

#[tokio::test]
async fn google_only_account_deletion_needs_a_recent_sign_in() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (_, user_id, _) = register_named_user(&mut app, "googleleaver").await;
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
    let body = json!({ "confirm": "DELETE" });
    let (status, error) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &format!("Bearer {}", token_issued(60 * 60)),
        Some(body.clone()),
    )
    .await;
    assert_ne!(
        status,
        StatusCode::OK,
        "an hour-old Google session cannot delete the account"
    );
    assert_eq!(error["code"], "REAUTH_REQUIRED", "{error}");
    let (status, response) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &format!("Bearer {}", token_issued(30)),
        Some(body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a fresh Google sign-in can delete it: {response}"
    );
}

#[tokio::test]
async fn email_confirmation_and_desktop_exchange_are_rate_limited_per_ip() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (_, state) = setup_app_with_auth_features(true, true).await;
    // Served over TCP with connect info, so the per-IP limits see the client address.
    let app = build_app(state.clone(), vec!["http://localhost:5173".to_string()]);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await;
    });
    // Start from a clean per-IP budget for this address.
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    for key in [
        "auth:email_confirm_ip:127.0.0.1",
        "auth:desktop_exchange_ip:127.0.0.1",
    ] {
        let _: () = redis::AsyncCommands::del(&mut redis, key).await.unwrap();
    }
    let client = reqwest::Client::new();
    let post = |path: &str, body: serde_json::Value| {
        client
            .post(format!("http://{addr}{path}"))
            .header("origin", "http://localhost:5173")
            .json(&body)
            .send()
    };

    // A token that is not a UUID is refused before any lookup.
    let response = post("/api/auth/email/confirm", json!({ "token": "not-a-token" }))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let mut statuses = Vec::new();
    for _ in 0..12 {
        let response = post(
            "/api/auth/email/confirm",
            json!({ "token": Uuid::new_v4().to_string() }),
        )
        .await
        .unwrap();
        statuses.push(response.status());
    }
    assert!(
        statuses.contains(&StatusCode::TOO_MANY_REQUESTS),
        "repeated confirmation guesses from one IP must be limited: {statuses:?}"
    );

    let mut statuses = Vec::new();
    for _ in 0..22 {
        let response = post(
            "/api/auth/desktop-exchange",
            json!({
                "code": Uuid::new_v4().simple().to_string(),
                "code_verifier": "a".repeat(64),
            }),
        )
        .await
        .unwrap();
        statuses.push(response.status());
    }
    assert!(
        statuses.contains(&StatusCode::TOO_MANY_REQUESTS),
        "repeated desktop code guesses from one IP must be limited: {statuses:?}"
    );
}

#[tokio::test]
async fn google_link_keeps_passwords_only_for_verified_local_accounts() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let login = |identifier: String, password: &'static str| {
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "identifier": identifier, "password": password }))
                    .unwrap(),
            ))
            .unwrap()
    };

    // Someone registered this address first but never proved they own it.
    let (_, unverified_id, unverified_password) = register_named_user(&mut app, "unverified").await;
    let unverified_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(unverified_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET email_verified = FALSE WHERE id = $1")
        .bind(unverified_id)
        .execute(&state.db)
        .await
        .unwrap();
    voxpery_server::services::auth::link_google_identity(
        &state.db,
        unverified_id,
        &format!("google-{}", Uuid::new_v4()),
    )
    .await
    .unwrap();
    let (status, _) = oneshot(&mut app, login(unverified_email, unverified_password)).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "an unproven local password must not survive the Google link"
    );
    let (verified_flag, has_google): (bool, bool) =
        sqlx::query_as("SELECT email_verified, google_id IS NOT NULL FROM users WHERE id = $1")
            .bind(unverified_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert!(verified_flag && has_google);

    // A local account whose email was already verified keeps its password.
    let (_, verified_id, verified_password) = register_named_user(&mut app, "verified").await;
    let verified_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(verified_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET email_verified = TRUE WHERE id = $1")
        .bind(verified_id)
        .execute(&state.db)
        .await
        .unwrap();
    voxpery_server::services::auth::link_google_identity(
        &state.db,
        verified_id,
        &format!("google-{}", Uuid::new_v4()),
    )
    .await
    .unwrap();
    let (status, _) = oneshot(&mut app, login(verified_email, verified_password)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "verified owners keep password login"
    );
}

#[tokio::test]
async fn desktop_captcha_frame_is_embeddable_only_by_the_desktop_app() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, mut state) = setup_app().await;
    drop(app);
    let config = Arc::get_mut(&mut state).unwrap();
    config.turnstile_secret_key = Some(test_credential("turnstile").into());
    config.turnstile_site_key = Some("test-public-site-key".into());
    let app = build_app(state.clone(), state.cors_origins.clone());

    let frame = |parent: &str| {
        Request::builder()
            .uri(format!(
                "/api/auth/captcha-frame?parent={}",
                parent.replace(':', "%3A").replace('/', "%2F")
            ))
            .body(Body::empty())
            .unwrap()
    };
    let response = app
        .clone()
        .oneshot(frame("https://tauri.localhost"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers().clone();
    let csp = headers["content-security-policy"].to_str().unwrap();
    assert!(
        csp.contains("frame-ancestors https://tauri.localhost;"),
        "{csp}"
    );
    assert!(csp.contains("script-src 'nonce-"));
    assert!(
        headers.get("x-frame-options").is_none(),
        "the CSP allowlist governs framing"
    );
    assert_eq!(headers["cache-control"], "no-store");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let html = String::from_utf8(body.to_vec()).unwrap();
    assert!(html.contains("data-sitekey=\"test-public-site-key\""));
    assert!(html.contains("const parentOrigin = \"https://tauri.localhost\";"));

    for rejected in [
        "https://evil.example",
        "https://tauri.localhost.evil.example",
        "",
    ] {
        let response = app.clone().oneshot(frame(rejected)).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{rejected}");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
    }
}
