//! `REGISTRATION_MODE`: who may create an account, on every sign-up path.

use super::*;

fn register_request(body: &serde_json::Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(body).unwrap()))
        .unwrap()
}

fn unique_account() -> (String, String) {
    let id = Uuid::new_v4().simple().to_string();
    (format!("{id}@example.test"), format!("reg_{}", &id[..20]))
}

async fn is_member(state: &AppState, server_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap()
}

async fn registration_mode_reported(app: &mut axum::Router) -> String {
    let request = Request::builder()
        .uri("/api/system/features")
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(app, request).await;
    assert_eq!(status, StatusCode::OK);
    let features: serde_json::Value = serde_json::from_slice(&body).unwrap();
    features["registration_mode"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn open_mode_is_the_default_and_needs_no_invite() {
    let (mut app, _state) = setup_app().await;
    assert_eq!(registration_mode_reported(&mut app).await, "open");
    let (email, username) = unique_account();
    register_user(&mut app, &email, &username, "registration-test-password").await;
}

#[tokio::test]
async fn closed_mode_refuses_every_sign_up_path_but_keeps_sign_in() {
    let (mut open_app, _) = setup_app().await;
    let (email, username) = unique_account();
    register_user(
        &mut open_app,
        &email,
        &username,
        "registration-test-password",
    )
    .await;

    let (mut app, state) = setup_app_with_registration_mode(RegistrationMode::Closed, true).await;
    assert_eq!(registration_mode_reported(&mut app).await, "closed");

    // Email registration.
    let (new_email, new_username) = unique_account();
    let (status, body) = oneshot(
        &mut app,
        register_request(&registration_body(
            &new_email,
            &new_username,
            "registration-test-password",
        )),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "{}",
        String::from_utf8_lossy(&body)
    );
    let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&new_email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(stored, 0);

    // Desktop registration never starts.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/desktop-registration?origin=voxpery%3A%2F%2Fauth&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&redirect=%2Fsocial")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // A pending Google registration cannot be completed.
    let (cookie, csrf, _hash, _verifier) = pending_google_fixture(&state, false).await;
    let response = app
        .clone()
        .oneshot(pending_google_request(&cookie, &csrf))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // An existing account still signs in.
    let login = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "identifier": email, "password": "registration-test-password" }).to_string(),
        ))
        .unwrap();
    assert_eq!(oneshot(&mut app, login).await.0, StatusCode::OK);
}

#[tokio::test]
async fn invite_mode_needs_a_real_invite_and_joins_that_server() {
    let (mut open_app, open_state) = setup_app().await;
    let (owner_email, owner_username) = unique_account();
    let (owner_token, _) = register_user(
        &mut open_app,
        &owner_email,
        &owner_username,
        "registration-test-password",
    )
    .await;
    let (server_id, _channel_id, invite_code) = create_server_with_default_text_channel(
        &mut open_app,
        &open_state,
        &format!("Bearer {owner_token}"),
        "Invite Only Friends",
    )
    .await;

    let (mut app, state) = setup_app_with_registration_mode(RegistrationMode::Invite, false).await;
    assert_eq!(registration_mode_reported(&mut app).await, "invite");

    // No code, an unknown code and the public default community code are all refused.
    for invite in [None, Some("NoSuchCode"), Some("voxpery")] {
        let (email, username) = unique_account();
        let mut body = registration_body(&email, &username, "registration-test-password");
        if let Some(code) = invite {
            body["invite_code"] = json!(code);
        }
        let (status, response) = oneshot(&mut app, register_request(&body)).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "invite {invite:?}: {}",
            String::from_utf8_lossy(&response)
        );
        let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
            .bind(&email)
            .fetch_one(&state.db)
            .await
            .unwrap();
        assert_eq!(stored, 0, "invite {invite:?} must not create an account");
    }

    // A real invite admits the sign-up and the new account is a member at once.
    let (email, username) = unique_account();
    let mut body = registration_body(&email, &username, "registration-test-password");
    body["invite_code"] = json!(invite_code);
    let (status, response) = oneshot(&mut app, register_request(&body)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&response)
    );
    let auth: serde_json::Value = serde_json::from_slice(&response).unwrap();
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();
    assert!(is_member(&state, server_id, user_id).await);
}

#[tokio::test]
async fn invite_mode_applies_to_desktop_registration() {
    let (mut open_app, open_state) = setup_app().await;
    let (owner_email, owner_username) = unique_account();
    let (owner_token, _) = register_user(
        &mut open_app,
        &owner_email,
        &owner_username,
        "registration-test-password",
    )
    .await;
    let (server_id, _channel_id, invite_code) = create_server_with_default_text_channel(
        &mut open_app,
        &open_state,
        &format!("Bearer {owner_token}"),
        "Desktop Invite Friends",
    )
    .await;

    let (app, state) = setup_app_with_registration_mode(RegistrationMode::Invite, false).await;

    // Without an invite the form comes back with the invite field and no account exists.
    let (cookie, csrf, hash, _verifier) =
        desktop_registration_fixture(&app, &state, "voxpery://auth").await;
    let email = format!("{}@example.test", Uuid::new_v4());
    let response = app
        .clone()
        .oneshot(desktop_registration_request(&cookie, &csrf, &email))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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
    assert!(
        html.contains("name=invite_code"),
        "the form asks for the invite code"
    );
    let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(stored, 0);

    // The invite link the app passed as the return path admits the same submission.
    sqlx::query(
        "UPDATE pending_desktop_registrations SET redirect_path = $2 WHERE cookie_hash = $1",
    )
    .bind(&hash)
    .bind(format!("/invite/{invite_code}"))
    .execute(&state.db)
    .await
    .unwrap();
    let response = app
        .clone()
        .oneshot(desktop_registration_request(&cookie, &csrf, &email))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert!(is_member(&state, server_id, user_id).await);
}

#[tokio::test]
async fn invite_mode_refuses_an_invite_code_that_was_reset() {
    let (mut open_app, open_state) = setup_app().await;
    let (owner_email, owner_username) = unique_account();
    let (owner_token, _) = register_user(
        &mut open_app,
        &owner_email,
        &owner_username,
        "registration-test-password",
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let (server_id, _channel_id, old_code) = create_server_with_default_text_channel(
        &mut open_app,
        &open_state,
        &owner_auth,
        "Leaked Invite Friends",
    )
    .await;
    let (status, rotated) = api_json(
        &mut open_app,
        "POST",
        &format!("/api/servers/{server_id}/invite/rotate"),
        &owner_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rotated}");
    let new_code = rotated["invite_code"].as_str().unwrap().to_string();
    assert_ne!(new_code, old_code);

    let (mut app, state) = setup_app_with_registration_mode(RegistrationMode::Invite, false).await;

    // The leaked code no longer admits a sign-up.
    let (email, username) = unique_account();
    let mut body = registration_body(&email, &username, "registration-test-password");
    body["invite_code"] = json!(old_code);
    let (status, response) = oneshot(&mut app, register_request(&body)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "{}",
        String::from_utf8_lossy(&response)
    );
    let stored: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap();
    assert_eq!(stored, 0, "the reset code must not create an account");

    // The new code does, and the account joins the server.
    let (email, username) = unique_account();
    let mut body = registration_body(&email, &username, "registration-test-password");
    body["invite_code"] = json!(new_code);
    let (status, response) = oneshot(&mut app, register_request(&body)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&response)
    );
    let auth: serde_json::Value = serde_json::from_slice(&response).unwrap();
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();
    assert!(is_member(&state, server_id, user_id).await);
}
