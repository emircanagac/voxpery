use super::*;

#[tokio::test]
async fn default_voxpery_server_has_moderator_role_after_register() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("mod-{}@example.com", uid);
    let username = format!("moduser_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

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
    let user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();

    let role_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'moderator'"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("role count query should succeed");

    assert!(
        role_count >= 1,
        "default Voxpery server must have Moderator role after register"
    );

    let guide: (bool, String, String, Vec<Uuid>, Vec<String>) = sqlx::query_as(
        r#"SELECT sog.enabled, sog.title, sog.body, sog.recommended_channel_ids, sog.starter_tasks
           FROM server_onboarding_guides sog
           INNER JOIN servers s ON s.id = sog.server_id
           WHERE s.invite_code = 'voxpery'"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("default Voxpery server should have a seeded onboarding guide");

    assert!(
        guide.0,
        "default Voxpery onboarding guide should be enabled"
    );
    assert_eq!(guide.1, "Welcome to the Voxpery Community");
    assert!(
        guide
            .2
            .contains("Start here, say hello, and jump into voice"),
        "default Voxpery onboarding guide should explain the first session"
    );
    assert_eq!(
        guide.3.len(),
        2,
        "default Voxpery onboarding guide should recommend text and voice channels"
    );
    assert_eq!(
        guide.4,
        vec![
            "Send your first message in #general".to_string(),
            "Join the General voice channel".to_string(),
            "Explore the open-source project on GitHub".to_string(),
        ]
    );

    let moderator_permissions = sqlx::query_scalar::<_, i64>(
        r#"SELECT sr.permissions
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'moderator'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("moderator permissions query should succeed");

    assert_eq!(
        moderator_permissions, 15216,
        "default Voxpery Moderator role should use recommended default permissions"
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT sr.id
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'everyone'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist on default Voxpery server");

    let everyone_permissions: i64 = sqlx::query_scalar(
        r#"SELECT sr.permissions
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery'
             AND LOWER(sr.name) = 'everyone'
           LIMIT 1"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("@everyone permissions query should succeed");

    assert_eq!(
        everyone_permissions, 1153,
        "@everyone role should use baseline default permissions"
    );

    let has_everyone_role: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_member_roles smr
           INNER JOIN servers s ON s.id = smr.server_id
           WHERE s.invite_code = 'voxpery'
             AND smr.user_id = $1
             AND smr.role_id = $2"#,
    )
    .bind(user_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("member-role mapping query should succeed");
    assert_eq!(
        has_everyone_role, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );
}

#[tokio::test]
async fn official_community_backfill_preserves_members_and_excludes_bans() {
    let Some(database_url) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let mut db = PgConnection::connect(&database_url).await.unwrap();
    sqlx::raw_sql(
        r#"CREATE TEMP TABLE users (id UUID PRIMARY KEY);
           CREATE TEMP TABLE servers (id UUID PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE);
           CREATE TEMP TABLE server_bans (server_id UUID, user_id UUID);
           CREATE TEMP TABLE server_members (
               server_id UUID NOT NULL, user_id UUID NOT NULL, role TEXT NOT NULL,
               joined_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (server_id, user_id)
           );"#,
    )
    .execute(&mut db)
    .await
    .unwrap();

    let official_id = Uuid::new_v4();
    let other_id = Uuid::new_v4();
    let owner_id = Uuid::new_v4();
    let old_user_id = Uuid::new_v4();
    let banned_user_id = Uuid::new_v4();
    for user_id in [owner_id, old_user_id, banned_user_id] {
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(user_id)
            .execute(&mut db)
            .await
            .unwrap();
    }
    for (server_id, invite_code) in [(official_id, "voxpery"), (other_id, "another")] {
        sqlx::query("INSERT INTO servers (id, invite_code) VALUES ($1, $2)")
            .bind(server_id)
            .bind(invite_code)
            .execute(&mut db)
            .await
            .unwrap();
    }
    sqlx::query(
        "INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', '2024-01-01'::timestamptz)",
    )
    .bind(official_id)
    .bind(owner_id)
    .execute(&mut db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO server_bans (server_id, user_id) VALUES ($1, $2)")
        .bind(official_id)
        .bind(banned_user_id)
        .execute(&mut db)
        .await
        .unwrap();

    for _ in 0..2 {
        sqlx::raw_sql(include_str!(
            "../../migrations/049_backfill_official_community_members.sql"
        ))
        .execute(&mut db)
        .await
        .unwrap();
    }

    let official_members: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM server_members WHERE server_id = $1")
            .bind(official_id)
            .fetch_one(&mut db)
            .await
            .unwrap();
    assert_eq!(official_members, 2);
    let owner: (String, bool) = sqlx::query_as(
        "SELECT role, joined_at = '2024-01-01'::timestamptz FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(official_id)
    .bind(owner_id)
    .fetch_one(&mut db)
    .await
    .unwrap();
    assert_eq!(owner, ("owner".to_string(), true));
    let restored_role: String =
        sqlx::query_scalar("SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2")
            .bind(official_id)
            .bind(old_user_id)
            .fetch_one(&mut db)
            .await
            .unwrap();
    assert_eq!(restored_role, "member");
    let other_members: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM server_members WHERE server_id = $1")
            .bind(other_id)
            .fetch_one(&mut db)
            .await
            .unwrap();
    assert_eq!(other_members, 0);
}

#[tokio::test]
async fn official_community_join_is_idempotent_and_respects_bans() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let (_, user_id) = register_user(
        &mut app,
        &format!("restore-community-{uid}@example.com"),
        &format!("restore_{}", uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let (server_id, owner_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT id, owner_id FROM servers WHERE invite_code = 'voxpery'")
            .fetch_one(&state.db)
            .await
            .unwrap();
    sqlx::query("UPDATE users SET password_hash = 'oauth', google_id = $2 WHERE id = $1")
        .bind(user_id)
        .bind(format!("restore-google-{uid}"))
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    for _ in 0..2 {
        voxpery_server::routes::auth::ensure_default_server_join(&state.db, user_id)
            .await
            .unwrap();
    }
    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(member_count, 1);

    sqlx::query("INSERT INTO server_bans (server_id, user_id, banned_by) VALUES ($1, $2, $3)")
        .bind(server_id)
        .bind(user_id)
        .bind(owner_id)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    voxpery_server::routes::auth::ensure_default_server_join(&state.db, user_id)
        .await
        .unwrap();
    let joined: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert!(!joined);
}

#[tokio::test]
async fn official_community_cannot_be_left_but_other_servers_can() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let owner_id = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("community-owner-{owner_id}@example.com"),
        &format!("community_owner_{}", owner_id.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let member_id = Uuid::new_v4();
    let (member_token, member_user_id) = register_user(
        &mut app,
        &format!("community-member-{member_id}@example.com"),
        &format!("community_member_{}", member_id.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;

    let official_server_id: Uuid =
        sqlx::query_scalar("SELECT id FROM servers WHERE invite_code = 'voxpery'")
            .fetch_one(&state.db)
            .await
            .unwrap();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{official_server_id}/leave"))
        .header("Authorization", format!("Bearer {member_token}"))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let still_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(official_server_id)
    .bind(member_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert!(still_member);

    let (other_server_id, _, invite_code) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &format!("Bearer {owner_token}"),
        &format!("Community leave test {owner_id}"),
    )
    .await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", format!("Bearer {member_token}"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{other_server_id}/leave"))
        .header("Authorization", format!("Bearer {member_token}"))
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let still_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(other_server_id)
    .bind(member_user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert!(!still_member);
}

#[tokio::test]
async fn create_server_list_servers_get_server() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("srv-{}@example.com", uid);
    let username = format!("srvuser_{}", uid.as_u128() % 1_000_000);
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
    let create_body = json!({ "name": "My Test Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = server["id"].as_str().unwrap();

    // List servers
    let req = Request::builder()
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let list: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!list.is_empty());
    assert!(list.iter().any(|s| s["id"].as_str() == Some(server_id)));

    // Get server by id
    let req = Request::builder()
        .uri(format!("/api/servers/{}", server_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let got: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(got["id"], server_id);
    assert_eq!(got["name"], "My Test Server");
}

#[tokio::test]
async fn server_name_limit_counts_characters_not_bytes() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("srvname-{}@example.com", uid),
        &format!("srvname_{}", uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {}", token);
    let request = |method: &str, uri: String, name: &str| {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", &auth_header)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "name": name })).unwrap(),
            ))
            .unwrap()
    };

    // 100 two-byte characters are 200 bytes but still within the 100-character limit.
    let long_name = "\u{e7}".repeat(100);
    let too_long = "\u{e7}".repeat(101);
    let (status, body) =
        oneshot(&mut app, request("POST", "/api/servers".into(), &long_name)).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(server["name"], long_name.as_str());
    let server_uri = format!("/api/servers/{}", server["id"].as_str().unwrap());

    let (status, _) = oneshot(&mut app, request("POST", "/api/servers".into(), &too_long)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) = oneshot(
        &mut app,
        request("PATCH", server_uri.clone(), &"\u{f6}".repeat(100)),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "rename: {}",
        String::from_utf8_lossy(&body)
    );
    let (status, _) = oneshot(&mut app, request("PATCH", server_uri, &too_long)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn lists_reference_uploaded_avatars_by_url_and_serve_them_with_a_grant() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;

    let uid = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("avatarurl-{}@example.com", uid),
        &format!("avatarurl_{}", uid.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {}", token);
    let png = [
        &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a][..],
        &[7u8; 2048][..],
    ]
    .concat();
    let data_url = format!("data:image/png;base64,{}", BASE64.encode(&png));
    let json_request = |method: &str, uri: String, body: serde_json::Value| {
        Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", &auth_header)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap()
    };

    let (status, body) = oneshot(
        &mut app,
        json_request(
            "PATCH",
            "/api/auth/profile".into(),
            json!({ "avatar_url": data_url }),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "profile: {}",
        String::from_utf8_lossy(&body)
    );
    let (status, body) = oneshot(
        &mut app,
        json_request(
            "POST",
            "/api/servers".into(),
            json!({ "name": "Avatar Guild" }),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();

    let req = Request::builder()
        .uri(format!("/api/servers/{}", server["id"].as_str().unwrap()))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !String::from_utf8_lossy(&body).contains("data:image"),
        "member list must not inline uploaded avatars"
    );
    let details: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let avatar_url = details["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["user_id"] == user_id.to_string())
        .and_then(|member| member["avatar_url"].as_str())
        .expect("member avatar url")
        .to_string();
    assert!(
        avatar_url.starts_with(&format!("/api/images/users/{user_id}/avatar?v=")),
        "unexpected avatar url {avatar_url}"
    );

    let get = |uri: String| Request::builder().uri(uri).body(Body::empty()).unwrap();
    let (status, _) = oneshot(&mut app, get(avatar_url.clone())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let req = Request::builder()
        .uri("/api/images/grant")
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let grant: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let grant = grant["grant"].as_str().unwrap();
    let response = app
        .clone()
        .oneshot(get(format!("{avatar_url}&grant={grant}")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let served = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(served.as_ref(), png.as_slice());

    let (status, _) = oneshot(
        &mut app,
        get(format!(
            "/api/images/users/{}/avatar?grant={grant}",
            Uuid::new_v4()
        )),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn server_onboarding_guide_update_and_member_read_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("onboarding-owner-{owner_uid}@example.com");
    let owner_username = format!("onboarding_owner_{}", owner_uid.as_u128() % 1_000_000);
    let (owner_token, _) = register_user(
        &mut app,
        &owner_email,
        &owner_username,
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Onboarding {}", owner_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let initial_guide = sqlx::query_as::<_, (bool, Vec<Uuid>)>(
        "SELECT enabled, recommended_channel_ids FROM server_onboarding_guides WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("new servers should have a welcome guide");
    assert!(!initial_guide.0);
    assert!(initial_guide.1.is_empty());

    let channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position ASC LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let update_body = json!({
        "enabled": true,
        "title": "Welcome to the lab",
        "body": "Start here before jumping into voice.",
        "recommended_channel_ids": [channel_id],
        "starter_tasks": ["Read the rules", "Introduce yourself"]
    });
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&update_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "update onboarding failed: {}",
        String::from_utf8_lossy(&body)
    );
    let guide: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(guide["enabled"], true);
    assert_eq!(guide["title"], "Welcome to the lab");
    assert_eq!(guide["recommended_channel_ids"][0], channel_id.to_string());
    assert_eq!(guide["starter_tasks"][1], "Introduce yourself");

    let member_uid = Uuid::new_v4();
    let member_email = format!("onboarding-member-{member_uid}@example.com");
    let member_username = format!("onboarding_member_{}", member_uid.as_u128() % 1_000_000);
    let (member_token, _) = register_user(
        &mut app,
        &member_email,
        &member_username,
        test_credential("default"),
    )
    .await;
    let member_auth = format!("Bearer {member_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let member_guide: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(member_guide["title"], "Welcome to the lab");

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "enabled": false })).unwrap(),
        ))
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let outsider_uid = Uuid::new_v4();
    let outsider_email = format!("onboarding-outsider-{outsider_uid}@example.com");
    let outsider_username = format!("onboarding_outsider_{}", outsider_uid.as_u128() % 1_000_000);
    let outsider_password = format!("onboarding-credential-{}", Uuid::new_v4().as_simple());
    let (outsider_token, _) = register_user(
        &mut app,
        &outsider_email,
        &outsider_username,
        &outsider_password,
    )
    .await;
    let outsider_auth = format!("Bearer {outsider_token}");
    let req = Request::builder()
        .uri(format!("/api/servers/{server_id}/onboarding"))
        .header("Authorization", &outsider_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn member_timeout_blocks_and_clear_restores_messages() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("timeout-owner-{owner_uid}@example.com");
    let owner_username = format!("timeout_owner_{}", owner_uid.as_u128() % 1_000_000);
    let (owner_token, _) = register_user(
        &mut app,
        &owner_email,
        &owner_username,
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Timeout {}", owner_uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let member_uid = Uuid::new_v4();
    let member_email = format!("timeout-member-{member_uid}@example.com");
    let member_username = format!("timeout_member_{}", member_uid.as_u128() % 1_000_000);
    let (member_token, member_id) = register_user(
        &mut app,
        &member_email,
        &member_username,
        test_credential("default"),
    )
    .await;
    let member_auth = format!("Bearer {member_token}");

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position ASC LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/timeout"
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "duration_minutes": 5,
                "reason": "integration test"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "timeout member failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "blocked while timed out" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "timed out member should be blocked: {}",
        String::from_utf8_lossy(&body)
    );
    assert!(
        String::from_utf8_lossy(&body).contains("timed out"),
        "timeout error should be user-facing: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/timeout"
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "clear timeout failed: {}",
        String::from_utf8_lossy(&body)
    );

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "allowed after timeout clear" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "message should work after timeout clear: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn create_server_seeds_recommended_moderator_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("srvmod-{}@example.com", uid);
    let username = format!("srvmod_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");

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
    let token = auth["token"].as_str().unwrap();
    let creator_user_id = Uuid::parse_str(auth["user"]["id"].as_str().unwrap()).unwrap();
    let auth_header = format!("Bearer {}", token);

    let create_body = json!({ "name": "Moderator Seed Server" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();

    let moderator_permissions = sqlx::query_scalar::<_, i64>(
        r#"SELECT permissions
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) = 'moderator'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("moderator role should exist for newly created server");

    assert_eq!(
        moderator_permissions, 15216,
        "new server Moderator role should use recommended default permissions"
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT id
           FROM server_roles
           WHERE server_id = $1
             AND LOWER(name) = 'everyone'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist for newly created server");

    let everyone_permissions: i64 = sqlx::query_scalar(
        r#"SELECT permissions
           FROM server_roles
           WHERE id = $1"#,
    )
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone permissions should be readable");
    assert_eq!(
        everyone_permissions, 1153,
        "new server @everyone role should use baseline default permissions"
    );

    let creator_has_everyone: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_member_roles
           WHERE server_id = $1 AND user_id = $2 AND role_id = $3"#,
    )
    .bind(server_id)
    .bind(creator_user_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("creator @everyone mapping query should succeed");
    assert_eq!(
        creator_has_everyone, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );

    let bootstrap_counts: (i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT
               (SELECT COUNT(*) FROM server_members WHERE server_id = $1 AND user_id = $2),
               (SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'text'),
               (SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'voice'),
               (SELECT COUNT(*) FROM server_channel_categories WHERE server_id = $1)"#,
    )
    .bind(server_id)
    .bind(creator_user_id)
    .fetch_one(&state.db)
    .await
    .expect("server bootstrap state should be readable");
    assert_eq!(
        bootstrap_counts,
        (1, 1, 1, 1),
        "server creation must commit its owner, channels, and category together"
    );
}

#[tokio::test]
async fn join_server_auto_assigns_everyone_role() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    // Owner account
    let owner_uid = Uuid::new_v4();
    let owner_email = format!("owner-{}@example.com", owner_uid);
    let owner_username = format!("owner_{}", owner_uid.as_u128() % 1_000_000);
    let owner_register =
        registration_body(&owner_email, &owner_username, test_credential("default"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&owner_register).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let owner_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let owner_token = owner_auth["token"].as_str().unwrap();
    let owner_auth_header = format!("Bearer {}", owner_token);

    // Create server
    let create_body = json!({ "name": "Join Everyone Test" });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&create_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "create server failed: {}",
        String::from_utf8_lossy(&body)
    );
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Member account
    let member_uid = Uuid::new_v4();
    let member_email = format!("member-{}@example.com", member_uid);
    let member_username = format!("member_{}", member_uid.as_u128() % 1_000_000);
    let member_register =
        registration_body(&member_email, &member_username, test_credential("default"));
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/register")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&member_register).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "member register failed: {}",
        String::from_utf8_lossy(&body)
    );
    let member_auth: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let member_token = member_auth["token"].as_str().unwrap();
    let member_id = Uuid::parse_str(member_auth["user"]["id"].as_str().unwrap()).unwrap();
    let member_auth_header = format!("Bearer {}", member_token);

    // Join server by invite code
    let join_body = json!({ "invite_code": invite_code });
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&join_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    let everyone_role_id: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM server_roles
           WHERE server_id = $1 AND LOWER(name) = 'everyone'
           LIMIT 1"#,
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .expect("@everyone role should exist");

    let member_has_everyone: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM server_member_roles
           WHERE server_id = $1 AND user_id = $2 AND role_id = $3"#,
    )
    .bind(server_id)
    .bind(member_id)
    .bind(everyone_role_id)
    .fetch_one(&state.db)
    .await
    .expect("member role assignment query should succeed");

    assert_eq!(
        member_has_everyone, 0,
        "@everyone is implicit and should not require explicit member-role row"
    );

    // Joined member must still get baseline permissions from implicit @everyone.
    // Verify by checking they can view channels for the joined server.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "joined member should be able to view server channels: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn roles_and_channel_overrides_flow() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("admin-{}@example.com", uid);
    let username = format!("admin_{}", uid.as_u128() % 1_000_000);

    // Register owner
    let register_body = registration_body(&email, &username, test_credential("default"));
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
    let create_body = json!({ "name": "Permissions Server" });
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
    let server_id: Uuid = server["id"].as_str().unwrap().parse().unwrap();

    // Create a role
    let role_body = json!({
        "name": "VIP",
        "permissions": 128, // SEND_MESSAGES
        "color": "#ff0000"
    });
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/servers/{}/roles", server_id))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&role_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK, "create role failed");
    let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let role_id = role["id"].as_str().unwrap();
    let everyone_position: i32 = sqlx::query_scalar(
        "SELECT position FROM server_roles WHERE server_id = $1 AND LOWER(name) = 'everyone'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert!(
        role["position"].as_i64().unwrap() < i64::from(everyone_position),
        "new custom roles must remain above Everyone in the hierarchy"
    );

    // Create a channel
    let channel_body = json!({
        "server_id": server_id,
        "name": "vip-lounge",
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
    assert_eq!(status, StatusCode::OK);
    let channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let channel_id = channel["id"].as_str().unwrap();

    // Add channel override
    let override_body = json!({
        "allow": 128, // SEND_MESSAGES
        "deny": 1 // VIEW_SERVER (meaning view channel)
    });
    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/channels/{}/overrides/{}",
            channel_id, role_id
        ))
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_vec(&override_body).unwrap()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "channel override failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Get channel overrides
    let req = Request::builder()
        .uri(format!("/api/channels/{}/overrides", channel_id))
        .header("Authorization", &auth_header)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let overrides: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(overrides.len(), 1);
    assert_eq!(overrides[0]["role_id"], role_id);
    assert_eq!(overrides[0]["allow"], 128);
    assert_eq!(overrides[0]["deny"], 1);
}

#[tokio::test]
async fn category_override_enforces_view_send_and_voice_access() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_uid = Uuid::new_v4();
    let owner_email = format!("owner-cat-{}@example.com", owner_uid);
    let owner_username = format!("owner_cat_{}", owner_uid.as_u128() % 1_000_000);
    let owner_password = Uuid::new_v4().to_string();
    let (owner_token, _owner_id) =
        register_user(&mut app, &owner_email, &owner_username, &owner_password).await;
    let owner_auth = format!("Bearer {}", owner_token);

    let member_uid = Uuid::new_v4();
    let member_email = format!("member-cat-{}@example.com", member_uid);
    let member_username = format!("member_cat_{}", member_uid.as_u128() % 1_000_000);
    let member_password = Uuid::new_v4().to_string();
    let (member_token, _member_id) =
        register_user(&mut app, &member_email, &member_username, &member_password).await;
    let member_auth = format!("Bearer {}", member_token);

    // Create server as owner.
    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Category Override Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap().to_string();

    // Join member.
    let join_req = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "join server failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Create text + voice channels under same category.
    let text_req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "secret-text",
                "channel_type": "text",
                "category": "Secret"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, text_req).await;
    assert_eq!(status, StatusCode::OK);
    let text_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let text_channel_id = text_channel["id"].as_str().unwrap().to_string();

    let voice_req = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "secret-voice",
                "channel_type": "voice",
                "category": "Secret"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, voice_req).await;
    assert_eq!(status, StatusCode::OK);
    let voice_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let voice_channel_id = voice_channel["id"].as_str().unwrap().to_string();

    // Verify member can initially see channels.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let before: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(before.iter().any(|c| c["id"] == text_channel_id));
    assert!(before.iter().any(|c| c["id"] == voice_channel_id));

    // Deny VIEW + SEND + CONNECT for @everyone in category.
    let everyone_role_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM server_roles WHERE server_id = $1 AND lower(name) = 'everyone' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    let deny_bits = 1_i64 | 128_i64 | 1024_i64; // VIEW_SERVER + SEND_MESSAGES + CONNECT_VOICE

    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/channels/server/{}/categories/{}/overrides/{}",
            server_id, "Secret", everyone_role_id
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "allow": 0, "deny": deny_bits })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "category override failed: {}",
        String::from_utf8_lossy(&body)
    );

    // Member should no longer see channels in that category.
    let req = Request::builder()
        .uri(format!("/api/servers/{}/channels", server_id))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let after: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();
    assert!(!after.iter().any(|c| c["id"] == text_channel_id));
    assert!(!after.iter().any(|c| c["id"] == voice_channel_id));

    // Member cannot send message anymore.
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{}", text_channel_id))
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "should fail" })).unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Member cannot get voice token anymore.
    let req = Request::builder()
        .uri(format!(
            "/api/webrtc/livekit-token?channel_id={}",
            voice_channel_id
        ))
        .header("Authorization", &member_auth)
        .body(Body::empty())
        .unwrap();
    let (status, _) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Owner must still be able to join voice (owner override).
    let req = Request::builder()
        .uri(format!(
            "/api/webrtc/livekit-token?channel_id={}",
            voice_channel_id
        ))
        .header("Authorization", &owner_auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner voice token should succeed: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn channel_create_race_is_serialized_at_500_channel_limit() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (app, state) = setup_app().await;
    let mut app = app;

    let uid = Uuid::new_v4();
    let email = format!("chan-race-{}@example.com", uid);
    let username = format!("chanrace_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, _) = register_user(&mut app, &email, &username, password).await;
    let auth_header = format!("Bearer {}", token);

    let req = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": format!("Race Lock {}", uid) })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();

    sqlx::query("DELETE FROM channels WHERE server_id = $1")
        .bind(server_id)
        .execute(&state.db)
        .await
        .unwrap();

    for idx in 0..499 {
        sqlx::query(
            r#"INSERT INTO channels (id, server_id, name, description, channel_type, category, position, created_at)
               VALUES ($1, $2, $3, NULL, 'text', 'General', $4, NOW())"#,
        )
        .bind(Uuid::new_v4())
        .bind(server_id)
        .bind(format!("seed-{idx}"))
        .bind(idx)
        .execute(&state.db)
        .await
        .unwrap();
    }

    let req_a = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "race-a",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let req_b = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &auth_header)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "race-b",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();

    let (resp_a, resp_b) = tokio::join!(app.clone().oneshot(req_a), app.clone().oneshot(req_b));
    let resp_a = resp_a.expect("channel create request A should resolve");
    let resp_b = resp_b.expect("channel create request B should resolve");
    let status_a = resp_a.status();
    let body_a = resp_a.into_body().collect().await.unwrap().to_bytes();
    let status_b = resp_b.status();
    let body_b = resp_b.into_body().collect().await.unwrap().to_bytes();

    let success_count = [status_a, status_b]
        .iter()
        .filter(|s| **s == StatusCode::OK)
        .count();
    let rejected_count = [status_a, status_b]
        .iter()
        .filter(|s| **s == StatusCode::BAD_REQUEST)
        .count();

    assert_eq!(
        success_count, 1,
        "exactly one concurrent create should succeed, got ({status_a}, {status_b}) with bodies: A={}, B={}",
        String::from_utf8_lossy(&body_a),
        String::from_utf8_lossy(&body_b)
    );
    assert_eq!(
        rejected_count, 1,
        "exactly one concurrent create should be rejected at 500-limit, got ({status_a}, {status_b}) with bodies: A={}, B={}",
        String::from_utf8_lossy(&body_a),
        String::from_utf8_lossy(&body_b)
    );

    let total_channels: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        total_channels, 500,
        "row lock must keep channel count capped at 500"
    );
}

#[tokio::test]
async fn concurrent_member_role_replacements_leave_one_complete_state() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let owner_suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("role-owner-{owner_suffix}@example.com"),
        &format!("role_owner_{}", owner_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let member_suffix = Uuid::new_v4();
    let (member_token, member_id) = register_user(
        &mut app,
        &format!("role-member-{member_suffix}@example.com"),
        &format!("role_member_{}", member_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");
    let member_auth = format!("Bearer {member_token}");

    let create_server_request = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Role Race Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_server_request).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let invite_code = server["invite_code"].as_str().unwrap();

    let join_request = Request::builder()
        .method("POST")
        .uri("/api/servers/join")
        .header("Authorization", &member_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "invite_code": invite_code })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, join_request).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "member join failed: {}",
        String::from_utf8_lossy(&body)
    );

    let mut role_ids = Vec::new();
    for name in ["Race Alpha", "Race Beta"] {
        let request = Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/roles"))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "name": name,
                    "permissions": 0,
                    "color": null
                }))
                .unwrap(),
            ))
            .unwrap();
        let (status, body) = oneshot(&mut app, request).await;
        assert_eq!(status, StatusCode::OK);
        let role: serde_json::Value = serde_json::from_slice(&body).unwrap();
        role_ids.push(Uuid::parse_str(role["id"].as_str().unwrap()).unwrap());
    }

    let role_request = |role_id: Uuid| {
        Request::builder()
            .method("PUT")
            .uri(format!(
                "/api/servers/{server_id}/members/{member_id}/roles"
            ))
            .header("Authorization", &owner_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "role_ids": [role_id] })).unwrap(),
            ))
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(role_request(role_ids[0])),
        app.clone().oneshot(role_request(role_ids[1]))
    );
    assert_eq!(
        response_a.expect("role request A should resolve").status(),
        StatusCode::OK
    );
    assert_eq!(
        response_b.expect("role request B should resolve").status(),
        StatusCode::OK
    );

    let assigned_role_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(member_id)
    .fetch_all(&state.db)
    .await
    .unwrap();
    assert_eq!(assigned_role_ids.len(), 1);
    assert!(role_ids.contains(&assigned_role_ids[0]));

    let invalid_role_request = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/servers/{server_id}/members/{member_id}/roles"
        ))
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "role_ids": [assigned_role_ids[0], Uuid::new_v4()]
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, _) = oneshot(&mut app, invalid_role_request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let roles_after_rejection: Vec<Uuid> = sqlx::query_scalar(
        "SELECT role_id FROM server_member_roles WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(member_id)
    .fetch_all(&state.db)
    .await
    .unwrap();
    assert_eq!(roles_after_rejection, assigned_role_ids);
}

#[tokio::test]
async fn concurrent_text_channel_deletes_preserve_one_channel() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let suffix = Uuid::new_v4();
    let (owner_token, _) = register_user(
        &mut app,
        &format!("delete-race-{suffix}@example.com"),
        &format!("delete_race_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let owner_auth = format!("Bearer {owner_token}");

    let create_server_request = Request::builder()
        .method("POST")
        .uri("/api/servers")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "name": "Delete Race Server" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_server_request).await;
    assert_eq!(status, StatusCode::OK);
    let server: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let server_id = Uuid::parse_str(server["id"].as_str().unwrap()).unwrap();
    let first_channel_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' LIMIT 1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    let create_channel_request = Request::builder()
        .method("POST")
        .uri("/api/channels")
        .header("Authorization", &owner_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({
                "server_id": server_id,
                "name": "second-text",
                "channel_type": "text"
            }))
            .unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, create_channel_request).await;
    assert_eq!(status, StatusCode::OK);
    let second_channel: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let second_channel_id = Uuid::parse_str(second_channel["id"].as_str().unwrap()).unwrap();

    let delete_request = |channel_id: Uuid| {
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/channels/{channel_id}"))
            .header("Authorization", &owner_auth)
            .body(Body::empty())
            .unwrap()
    };
    let (response_a, response_b) = tokio::join!(
        app.clone().oneshot(delete_request(first_channel_id)),
        app.clone().oneshot(delete_request(second_channel_id))
    );
    let status_a = response_a
        .expect("delete request A should resolve")
        .status();
    let status_b = response_b
        .expect("delete request B should resolve")
        .status();
    let success_count = [status_a, status_b]
        .iter()
        .filter(|status| **status == StatusCode::OK)
        .count();
    let rejected_count = [status_a, status_b]
        .iter()
        .filter(|status| **status == StatusCode::BAD_REQUEST)
        .count();
    assert_eq!(success_count, 1);
    assert_eq!(rejected_count, 1);

    let remaining_text_channels: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channels WHERE server_id = $1 AND channel_type = 'text'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(remaining_text_channels, 1);

    let delete_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE server_id = $1 AND action = 'channel_delete'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(delete_audit_count, 1);
}

#[tokio::test]
async fn concurrent_duplicate_reports_create_one_open_report() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let reporter_suffix = Uuid::new_v4();
    let (reporter_token, reporter_id) = register_user(
        &mut app,
        &format!("reporter-{reporter_suffix}@example.com"),
        &format!("reporter_{}", reporter_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let target_suffix = Uuid::new_v4();
    let (target_token, target_id) = register_user(
        &mut app,
        &format!("report-target-{target_suffix}@example.com"),
        &format!("report_target_{}", target_suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let reporter_auth = format!("Bearer {reporter_token}");
    let target_auth = format!("Bearer {target_token}");
    let (server_id, channel_id, invite_code) = create_server_with_default_text_channel(
        &mut app,
        &state,
        &reporter_auth,
        "Report Race Server",
    )
    .await;

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

    let user_report_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/reports/user"))
            .header("Authorization", &reporter_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "reported_user_id": target_id,
                    "reason": "spam"
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (user_report_a, user_report_b) = tokio::join!(
        app.clone().oneshot(user_report_request()),
        app.clone().oneshot(user_report_request())
    );
    assert_eq!(
        user_report_a
            .expect("user report A should resolve")
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        user_report_b
            .expect("user report B should resolve")
            .status(),
        StatusCode::OK
    );

    let send_request = Request::builder()
        .method("POST")
        .uri(format!("/api/messages/{channel_id}"))
        .header("Authorization", &target_auth)
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "content": "report race message" })).unwrap(),
        ))
        .unwrap();
    let (status, body) = oneshot(&mut app, send_request).await;
    assert_eq!(status, StatusCode::OK);
    let message: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let message_id = Uuid::parse_str(message["id"].as_str().unwrap()).unwrap();

    let message_report_request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/servers/{server_id}/reports/message"))
            .header("Authorization", &reporter_auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "message_id": message_id,
                    "reason": "spam"
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (message_report_a, message_report_b) = tokio::join!(
        app.clone().oneshot(message_report_request()),
        app.clone().oneshot(message_report_request())
    );
    assert_eq!(
        message_report_a
            .expect("message report A should resolve")
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        message_report_b
            .expect("message report B should resolve")
            .status(),
        StatusCode::OK
    );

    let open_report_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM server_reports
           WHERE server_id = $1
             AND reporter_user_id = $2
             AND reported_user_id = $3
             AND status = 'open'"#,
    )
    .bind(server_id)
    .bind(reporter_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        open_report_count, 2,
        "one user and one message report should remain"
    );

    let duplicate_groups: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM (
               SELECT message_id
               FROM server_reports
               WHERE server_id = $1
                 AND reporter_user_id = $2
                 AND reported_user_id = $3
                 AND status = 'open'
               GROUP BY message_id
               HAVING COUNT(*) > 1
           ) duplicates"#,
    )
    .bind(server_id)
    .bind(reporter_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(duplicate_groups, 0);
}

#[tokio::test]
async fn server_create_retry_returns_the_original_server() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-server-{suffix}@example.com"),
        &format!("idem_server_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let request_id = format!("server-{suffix}");
    let create_request = |name: &str| {
        Request::builder()
            .method("POST")
            .uri("/api/servers")
            .header("Authorization", &auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({
                    "name": name,
                    "description": "Retry-safe server",
                    "client_request_id": request_id
                }))
                .unwrap(),
            ))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, create_request("One Server")).await;
    let (retry_status, retry_body) = oneshot(&mut app, create_request("One Server")).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retry: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first["id"], retry["id"]);
    let server_id = Uuid::parse_str(first["id"].as_str().unwrap()).unwrap();
    let server_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM servers WHERE owner_id = $1 AND client_request_id = $2",
    )
    .bind(user_id)
    .bind(&request_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(server_count, 1);
    let channel_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(channel_count, 2);
    let (conflict_status, _) = oneshot(&mut app, create_request("Changed Server")).await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn sign_in_keeps_owner_edits_to_the_default_moderator_role() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    // Registering makes sure the default server and its Moderator role exist.
    register_named_user(&mut app, "seed").await;
    let (role_id, original_name, original_permissions): (Uuid, String, i64) = sqlx::query_as(
        r#"SELECT sr.id, sr.name, sr.permissions
           FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery' AND LOWER(sr.name) = 'moderator'"#,
    )
    .fetch_one(&state.db)
    .await
    .expect("default server must have a Moderator role");

    use voxpery_server::services::permissions::Permissions;
    let removed = (Permissions::KICK_MEMBERS | Permissions::BAN_MEMBERS).bits();
    let trimmed = original_permissions & !removed;
    let password = test_credential("default");
    let suffix = Uuid::new_v4();
    let email = format!("mod-edit-{suffix}@example.com");
    register_user(
        &mut app,
        &email,
        &format!("modedit_{}", suffix.as_u128() % 1_000_000),
        password,
    )
    .await;
    let login_body =
        serde_json::to_vec(&json!({ "identifier": email, "password": password })).unwrap();
    let sign_in_request = || {
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(login_body.clone()))
            .unwrap()
    };

    // 1) The owner removes kick and ban; a sign-in must not add them back.
    sqlx::query("UPDATE server_roles SET permissions = $2 WHERE id = $1")
        .bind(role_id)
        .bind(trimmed)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, body) = oneshot(&mut app, sign_in_request()).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "login failed: {}",
        String::from_utf8_lossy(&body)
    );
    let permissions_after_sign_in: i64 =
        sqlx::query_scalar("SELECT permissions FROM server_roles WHERE id = $1")
            .bind(role_id)
            .fetch_one(&state.db)
            .await
            .unwrap();

    // 2) The owner renames the role; a sign-in must not create a new Moderator role.
    sqlx::query("UPDATE server_roles SET name = 'Helpers' WHERE id = $1")
        .bind(role_id)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, body) = oneshot(&mut app, sign_in_request()).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "login failed: {}",
        String::from_utf8_lossy(&body)
    );
    let recreated: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM server_roles sr
           INNER JOIN servers s ON s.id = sr.server_id
           WHERE s.invite_code = 'voxpery' AND LOWER(sr.name) = 'moderator'"#,
    )
    .fetch_one(&state.db)
    .await
    .unwrap();

    // Restore the shared default server before asserting.
    sqlx::query(
        r#"DELETE FROM server_roles
           WHERE id <> $1
             AND LOWER(name) = 'moderator'
             AND server_id = (SELECT server_id FROM server_roles WHERE id = $1)"#,
    )
    .bind(role_id)
    .execute(&state.db)
    .await
    .unwrap();
    sqlx::query("UPDATE server_roles SET permissions = $2, name = $3 WHERE id = $1")
        .bind(role_id)
        .bind(original_permissions)
        .bind(&original_name)
        .execute(&state.db)
        .await
        .unwrap();

    assert_eq!(
        permissions_after_sign_in, trimmed,
        "sign-in restored removed permissions"
    );
    assert_eq!(
        recreated, 0,
        "sign-in recreated a Moderator role the owner renamed"
    );
}

#[tokio::test]
async fn everyone_allow_does_not_undo_a_role_deny() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    use voxpery_server::services::permissions::{get_user_channel_permissions, Permissions};
    use voxpery_server::ws::access::{can_join_voice_channel, can_subscribe_to_channel};
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Deny Guild").await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "restricted").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let restricted_id =
        grant_role_with_permissions(&state, server_id, member_id, "Restricted", 5, 0).await;
    let channel_perms = |channel_id: Uuid| {
        let db = state.db.clone();
        async move {
            get_user_channel_permissions(&db, channel_id, member_id)
                .await
                .unwrap()
        }
    };

    // Channel level: Everyone may view and send, the member's role may not view.
    put_channel_override_row(
        &state,
        text_channel_id,
        everyone_id,
        PERM_VIEW | PERM_SEND,
        0,
    )
    .await;
    put_channel_override_row(&state, text_channel_id, restricted_id, 0, PERM_VIEW).await;
    assert!(!channel_perms(text_channel_id)
        .await
        .contains(Permissions::VIEW_SERVER));
    assert!(
        !can_subscribe_to_channel(&state.db, member_id, text_channel_id)
            .await
            .unwrap()
    );
    let (status, _) = api_json(
        &mut app,
        "GET",
        &format!("/api/messages/{text_channel_id}"),
        &member_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "REST must agree with the computed permissions"
    );

    // Voice: Everyone may connect, the member's role may not.
    put_channel_override_row(
        &state,
        voice_channel_id,
        everyone_id,
        PERM_VIEW | PERM_CONNECT_VOICE,
        0,
    )
    .await;
    put_channel_override_row(
        &state,
        voice_channel_id,
        restricted_id,
        0,
        PERM_CONNECT_VOICE,
    )
    .await;
    assert!(
        !can_join_voice_channel(&state.db, member_id, voice_channel_id)
            .await
            .unwrap()
    );

    // Between the member's own roles an allow still lifts a deny (Discord behaviour).
    put_channel_override_row(&state, text_channel_id, restricted_id, 0, PERM_SEND).await;
    assert!(!channel_perms(text_channel_id)
        .await
        .contains(Permissions::SEND_MESSAGES));
    let speaker_id =
        grant_role_with_permissions(&state, server_id, member_id, "Speaker", 6, 0).await;
    put_channel_override_row(&state, text_channel_id, speaker_id, PERM_SEND, 0).await;
    let perms = channel_perms(text_channel_id).await;
    assert!(perms.contains(Permissions::VIEW_SERVER) && perms.contains(Permissions::SEND_MESSAGES));

    // Category level follows the same order.
    sqlx::query("DELETE FROM channel_role_overrides WHERE channel_id = $1")
        .bind(text_channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    let category: String = sqlx::query_scalar("SELECT category FROM channels WHERE id = $1")
        .bind(text_channel_id)
        .fetch_one(&state.db)
        .await
        .unwrap();
    for (role_id, allow, deny) in [(everyone_id, PERM_VIEW, 0), (restricted_id, 0, PERM_VIEW)] {
        sqlx::query(
            r#"INSERT INTO channel_category_role_overrides (server_id, category, role_id, allow, deny)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(server_id)
        .bind(&category)
        .bind(role_id)
        .bind(allow)
        .bind(deny)
        .execute(&state.db)
        .await
        .unwrap();
    }
    assert!(!channel_perms(text_channel_id)
        .await
        .contains(Permissions::VIEW_SERVER));
    assert!(
        !can_subscribe_to_channel(&state.db, member_id, text_channel_id)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn permission_snapshot_matches_per_user_permission_checks() {
    use voxpery_server::services::permissions::{
        get_user_category_permissions, get_user_channel_permissions, Permissions,
        ServerPermissionSnapshot,
    };
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, owner_id, _) = register_named_user(&mut app, "snapowner").await;
    let (server_id, general_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Snapshot").await;
    let mut users = vec![owner_id];
    for label in [
        "snapplain",
        "snapstaff",
        "snapmuted",
        "snapadmin",
        "snapweird",
    ] {
        let (auth, user_id, _) = register_named_user(&mut app, label).await;
        join_with_invite(&mut app, &auth, &invite_code).await;
        users.push(user_id);
    }
    let (_, outsider_id, _) = register_named_user(&mut app, "snapoutsider").await;
    users.push(outsider_id);
    let [_, _, staff_id, muted_id, admin_id, weird_id, _] = users[..] else {
        unreachable!()
    };

    let view = Permissions::VIEW_SERVER.bits();
    let send = Permissions::SEND_MESSAGES.bits();
    let pins = Permissions::MANAGE_PINS.bits();
    let add_role = |name: &'static str, bits: i64, member: Uuid| {
        let state = state.clone();
        async move {
            let role_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO server_roles (id, server_id, name, color, position, permissions) VALUES ($1, $2, $3, NULL, 5, $4)",
            )
            .bind(role_id)
            .bind(server_id)
            .bind(name)
            .bind(bits)
            .execute(&state.db)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
            )
            .bind(server_id)
            .bind(member)
            .bind(role_id)
            .execute(&state.db)
            .await
            .unwrap();
            role_id
        }
    };
    let staff_role = add_role("Snap staff", send, staff_id).await;
    let muted_role = add_role("Snap muted", 0, muted_id).await;
    add_role("Snap admin", Permissions::MANAGE_SERVER.bits(), admin_id).await;
    // Unknown bits make a role's permissions unreadable, so it grants nothing.
    add_role(
        "Snap weird",
        (1 << 40) | Permissions::MANAGE_CHANNELS.bits(),
        weird_id,
    )
    .await;
    let everyone_role: Uuid = sqlx::query_scalar(
        "SELECT id FROM server_roles WHERE server_id = $1 AND LOWER(name) = 'everyone'",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO server_channel_categories (server_id, name, position) VALUES ($1, 'Staff', 1)",
    )
    .bind(server_id)
    .execute(&state.db)
    .await
    .unwrap();
    let mut channels = vec![general_id];
    for (name, category) in [
        ("staff-chat", Some("Staff")),
        ("padded", Some("  Staff ")),
        ("news", None),
    ] {
        let channel_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO channels (id, server_id, name, channel_type, category, position, created_at) VALUES ($1, $2, $3, 'text', $4, 3, NOW())",
        )
        .bind(channel_id)
        .bind(server_id)
        .bind(name)
        .bind(category)
        .execute(&state.db)
        .await
        .unwrap();
        channels.push(channel_id);
    }
    let [_, staff_chat, _, news] = channels[..] else {
        unreachable!()
    };
    for (role_id, allow, deny) in [(everyone_role, 0, view), (staff_role, view, 0)] {
        sqlx::query(
            "INSERT INTO channel_category_role_overrides (server_id, category, role_id, allow, deny) VALUES ($1, 'Staff', $2, $3, $4)",
        )
        .bind(server_id)
        .bind(role_id)
        .bind(allow)
        .bind(deny)
        .execute(&state.db)
        .await
        .unwrap();
    }
    for (channel_id, role_id, allow, deny) in [
        (news, everyone_role, 0, send),
        (news, staff_role, send, 0),
        (news, muted_role, 0, view),
        // Allowing a server-wide power per channel has no effect.
        (
            staff_chat,
            muted_role,
            view | Permissions::MANAGE_SERVER.bits(),
            0,
        ),
        (staff_chat, staff_role, 0, pins),
    ] {
        sqlx::query(
            "INSERT INTO channel_role_overrides (channel_id, role_id, allow, deny) VALUES ($1, $2, $3, $4)",
        )
        .bind(channel_id)
        .bind(role_id)
        .bind(allow)
        .bind(deny)
        .execute(&state.db)
        .await
        .unwrap();
    }

    let everyone = ServerPermissionSnapshot::load(&state.db, server_id, None)
        .await
        .unwrap();
    for &user_id in &users {
        let single = ServerPermissionSnapshot::load(&state.db, server_id, Some(&[user_id]))
            .await
            .unwrap();
        for &channel_id in &channels {
            let expected = get_user_channel_permissions(&state.db, channel_id, user_id)
                .await
                .unwrap();
            assert_eq!(everyone.channel_permissions(channel_id, user_id), expected);
            assert_eq!(single.channel_permissions(channel_id, user_id), expected);
        }
        for category in ["Staff", " Staff ", "", "Missing"] {
            let expected = get_user_category_permissions(&state.db, server_id, category, user_id)
                .await
                .unwrap();
            assert_eq!(everyone.category_permissions(category, user_id), expected);
            assert_eq!(single.category_permissions(category, user_id), expected);
        }
    }
    // The fixture exercises distinct outcomes, not only empty or full permissions.
    assert!(!everyone
        .channel_permissions(staff_chat, users[1])
        .contains(Permissions::VIEW_SERVER));
    assert!(everyone
        .channel_permissions(staff_chat, staff_id)
        .contains(Permissions::VIEW_SERVER));
    assert!(everyone
        .channel_permissions(staff_chat, muted_id)
        .contains(Permissions::VIEW_SERVER));
    assert!(!everyone
        .channel_permissions(news, muted_id)
        .contains(Permissions::VIEW_SERVER));
    assert!(everyone
        .channel_permissions(news, staff_id)
        .contains(Permissions::SEND_MESSAGES));
    assert_eq!(
        everyone.channel_permissions(news, outsider_id),
        Permissions::empty()
    );
}

#[tokio::test]
async fn server_rules_are_for_members_or_invite_holders_only() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "rulesowner").await;
    let (stranger_auth, _, _) = register_named_user(&mut app, "rulesstranger").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Rules").await;
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/rules"),
        &owner_auth,
        Some(json!({ "rule_text": "Be kind to each other" })),
    )
    .await;
    assert!(status.is_success(), "create rule failed: {body}");
    let rules_uri = format!("/api/servers/{server_id}/rules");

    let (status, rules) = api_json(&mut app, "GET", &rules_uri, &owner_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rules[0]["rule_text"], "Be kind to each other");
    let (status, _) = api_json(&mut app, "GET", &rules_uri, &stranger_auth, None).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "a non-member must not read the rules by server id (got {status})"
    );
    let (status, _) = oneshot(
        &mut app,
        Request::builder()
            .uri(&rules_uri)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Someone holding the invite sees the rules before joining.
    let (status, invite_rules) = api_json(
        &mut app,
        "GET",
        &format!("/api/servers/invite/{invite_code}/rules"),
        &stranger_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(invite_rules[0]["rule_text"], "Be kind to each other");
    let (status, _) = api_json(
        &mut app,
        "GET",
        "/api/servers/invite/not-a-real-code/rules",
        &stranger_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn reports_and_audit_log_do_not_quote_channels_the_viewer_cannot_see() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "quoteowner").await;
    let (insider_auth, insider_id, _) = register_named_user(&mut app, "quoteinsider").await;
    let (outsider_auth, _, _) = register_named_user(&mut app, "quoteoutsider").await;
    let (moderator_auth, moderator_id, _) = register_named_user(&mut app, "quotemod").await;
    let (server_id, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Quotes").await;
    for auth in [&insider_auth, &outsider_auth, &moderator_auth] {
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
    let (status, channel) = api_json(
        &mut app,
        "POST",
        "/api/channels",
        &owner_auth,
        Some(json!({ "server_id": server_id, "name": "staff-only", "channel_type": "text" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create channel failed: {channel}");
    let private_channel_id = channel["id"].as_str().unwrap().to_string();

    // Everyone is denied the private channel; an "Insider" role may view it; the moderator role
    // has Ban Members and View Audit Log but no access to that channel.
    let insert_role = |name: &'static str, permissions: i64| {
        let state = state.clone();
        async move {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO server_roles (id, server_id, name, color, position, permissions)
                 VALUES ($1, $2, $3, NULL, 1, $4)",
            )
            .bind(id)
            .bind(server_id)
            .bind(name)
            .bind(permissions)
            .execute(&state.db)
            .await
            .unwrap();
            id
        }
    };
    let insider_role = insert_role("Insider", PERM_VIEW | PERM_SEND).await;
    let moderator_role = insert_role("Report reviewer", PERM_VIEW | PERM_BAN | (1_i64 << 6)).await;
    for (user_id, role_id) in [(insider_id, insider_role), (moderator_id, moderator_role)] {
        sqlx::query(
            "INSERT INTO server_member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
        )
        .bind(server_id)
        .bind(user_id)
        .bind(role_id)
        .execute(&state.db)
        .await
        .unwrap();
    }
    let everyone_id = everyone_role_id(&state, server_id).await;
    for (role_id, allow, deny) in [(everyone_id, 0, PERM_VIEW), (insider_role, PERM_VIEW, 0)] {
        let (status, body) = api_json(
            &mut app,
            "PUT",
            &format!("/api/channels/{private_channel_id}/overrides/{role_id}"),
            &owner_auth,
            Some(json!({ "allow": allow, "deny": deny })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "override failed: {body}");
    }

    let (status, message) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{private_channel_id}"),
        &owner_auth,
        Some(json!({ "content": "staff secret plan" })),
    )
    .await;
    assert!(status.is_success(), "send failed: {message}");
    let message_id = message["id"].as_str().unwrap().to_string();
    let report = json!({ "message_id": message_id, "reason": "other" });

    // Someone who cannot see the channel cannot report (or probe) the message.
    let report_uri = format!("/api/servers/{server_id}/reports/message");
    let (status, _) = api_json(
        &mut app,
        "POST",
        &report_uri,
        &outsider_auth,
        Some(report.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = api_json(&mut app, "POST", &report_uri, &insider_auth, Some(report)).await;
    assert!(status.is_success(), "an insider can report it: {body}");

    // The moderator handles the report without seeing the quoted text; the owner sees it.
    let reports_uri = format!("/api/servers/{server_id}/reports");
    let (status, reports) = api_json(&mut app, "GET", &reports_uri, &moderator_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        reports[0]["message_excerpt"].is_null(),
        "excerpt must be hidden: {reports}"
    );
    let (_, reports) = api_json(&mut app, "GET", &reports_uri, &owner_auth, None).await;
    assert_eq!(reports[0]["message_excerpt"], "staff secret plan");

    // Edit previews in the audit log follow the same rule.
    let (status, _) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/messages/item/{message_id}"),
        &owner_auth,
        Some(json!({ "content": "staff secret plan v2" })),
    )
    .await;
    assert!(status.is_success());
    let audit_uri = format!("/api/servers/{server_id}/audit-log?action=message_edit");
    let (status, page) = api_json(&mut app, "GET", &audit_uri, &moderator_auth, None).await;
    assert_eq!(status, StatusCode::OK, "audit log failed: {page}");
    let details = &page["entries"][0]["details"];
    assert!(
        details["before_preview"].is_null() && details["after_preview"].is_null(),
        "{details}"
    );
    assert_eq!(details["content_hidden"], true);
    let (_, page) = api_json(&mut app, "GET", &audit_uri, &owner_auth, None).await;
    assert_eq!(
        page["entries"][0]["details"]["after_preview"],
        "staff secret plan v2"
    );
}

#[tokio::test]
async fn removed_members_gain_nothing_from_everyone_channel_overrides() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Override Guild")
            .await;
    let voice_channel_id = voice_channel_of(&state, server_id).await;
    let everyone_id = everyone_role_id(&state, server_id).await;
    // Explicit Everyone allows on both channels: these must still only apply to members.
    put_channel_override_row(
        &state,
        text_channel_id,
        everyone_id,
        PERM_VIEW | PERM_SEND,
        0,
    )
    .await;
    put_channel_override_row(
        &state,
        voice_channel_id,
        everyone_id,
        PERM_VIEW | PERM_CONNECT_VOICE,
        0,
    )
    .await;

    let (leaver_auth, leaver_id, _) = register_named_user(&mut app, "leaver").await;
    let (kicked_auth, kicked_id, _) = register_named_user(&mut app, "kicked").await;
    let (banned_auth, banned_id, _) = register_named_user(&mut app, "banned").await;
    for auth in [&leaver_auth, &kicked_auth, &banned_auth] {
        join_with_invite(&mut app, auth, &invite_code).await;
    }
    for user_id in [leaver_id, kicked_id, banned_id] {
        assert!(
            voxpery_server::ws::access::can_subscribe_to_channel(
                &state.db,
                user_id,
                text_channel_id
            )
            .await
            .unwrap(),
            "members can view the channel before removal"
        );
    }

    let addr = spawn_ws_app(&state).await;
    let mut owner_ws = connect_ws(addr, &owner_auth).await;
    ws_subscribe(&mut owner_ws, &[text_channel_id]).await;
    // An existing connection subscribed while the user was still a member.
    let mut leaver_ws = connect_ws(addr, &leaver_auth).await;
    ws_subscribe(&mut leaver_ws, &[text_channel_id]).await;

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

    for (label, user_id, auth) in [
        ("left", leaver_id, &leaver_auth),
        ("kicked", kicked_id, &kicked_auth),
        ("banned", banned_id, &banned_auth),
    ] {
        let channel_perms = voxpery_server::services::permissions::get_user_channel_permissions(
            &state.db,
            text_channel_id,
            user_id,
        )
        .await
        .unwrap();
        assert!(
            channel_perms.is_empty(),
            "{label} user must not keep channel permissions: {channel_perms:?}"
        );
        assert!(
            !voxpery_server::ws::access::can_subscribe_to_channel(
                &state.db,
                user_id,
                text_channel_id
            )
            .await
            .unwrap(),
            "{label} user must not subscribe to the channel"
        );
        assert!(
            !voxpery_server::ws::access::can_join_voice_channel(
                &state.db,
                user_id,
                voice_channel_id
            )
            .await
            .unwrap(),
            "{label} user must not join voice"
        );
        let (status, _) = api_json(
            &mut app,
            "GET",
            &format!("/api/servers/{server_id}/channels/{text_channel_id}/members"),
            auth,
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{label} user must not list channel members"
        );
    }

    // A new connection from a removed user cannot subscribe either.
    let mut banned_ws = connect_ws(addr, &banned_auth).await;
    ws_subscribe(&mut banned_ws, &[text_channel_id]).await;

    let marker = format!("after removal {}", Uuid::new_v4());
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{text_channel_id}"),
        &owner_auth,
        Some(json!({ "content": marker })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "owner message failed: {body}");
    let delivered = receive_ws_event(&mut owner_ws, "NewMessage").await;
    assert!(delivered.to_string().contains(&marker));
    let quiet = std::time::Duration::from_millis(800);
    assert_no_ws_event_mentioning(&mut leaver_ws, "NewMessage", &marker, quiet).await;
    assert_no_ws_event_mentioning(&mut banned_ws, "NewMessage", &marker, quiet).await;
}

#[tokio::test]
async fn only_the_owner_manages_roles_and_permission_overrides() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Delegation Guild")
            .await;
    let (manager_auth, manager_id, _) = register_named_user(&mut app, "manager").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "member").await;
    join_with_invite(&mut app, &manager_auth, &invite_code).await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    // The manager can manage roles and channels, but not the server or messages.
    let manager_role_id = grant_role_with_permissions(
        &state,
        server_id,
        manager_id,
        "Manager",
        0,
        PERM_VIEW | PERM_SEND | PERM_MANAGE_ROLES | PERM_MANAGE_CHANNELS,
    )
    .await;

    let (status, member_message) = api_json(
        &mut app,
        "POST",
        &format!("/api/messages/{text_channel_id}"),
        &member_auth,
        Some(json!({ "content": "member message" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "member message failed: {member_message}"
    );
    let member_message_id = member_message["id"].as_str().unwrap().to_string();
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/messages/item/{member_message_id}"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager cannot delete others' messages yet"
    );

    // Role creation, ordering and assignment are owner-only.
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/roles"),
        &manager_auth,
        Some(json!({ "name": "Escalated", "permissions": PERM_MANAGE_SERVER, "color": null })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager created a role: {body}"
    );
    let role_ids: Vec<String> = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM server_roles WHERE server_id = $1 AND LOWER(name) <> 'everyone' ORDER BY position",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await
    .unwrap()
    .into_iter()
    .rev()
    .map(|id| id.to_string())
    .collect();
    let (status, body) = api_json(
        &mut app,
        "PATCH",
        &format!("/api/servers/{server_id}/roles/reorder"),
        &manager_auth,
        Some(json!({ "role_ids": role_ids })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager reordered roles: {body}"
    );
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/servers/{server_id}/members/{member_id}/roles"),
        &manager_auth,
        Some(json!({ "role_ids": [manager_role_id] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager assigned a role: {body}"
    );
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/servers/{server_id}/members/{manager_id}/roles"),
        &manager_auth,
        Some(json!({ "role_ids": [] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager changed their own roles: {body}"
    );

    // Channel and category permission overrides are owner-only, including for one's own role.
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{text_channel_id}/overrides/{manager_role_id}"),
        &manager_auth,
        Some(json!({ "allow": PERM_MANAGE_MESSAGES, "deny": 0 })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager edited a channel override: {body}"
    );
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/messages/item/{member_message_id}"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager gained message moderation"
    );
    let (status, body) = api_json(
        &mut app,
        "POST",
        &format!("/api/channels/server/{server_id}/categories"),
        &owner_auth,
        Some(json!({ "name": "Secure" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "category create failed: {body}");
    let category_path = body["name"].as_str().unwrap_or("Secure").to_string();
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/{category_path}/overrides/{manager_role_id}"),
        &manager_auth,
        Some(json!({ "allow": PERM_MANAGE_MESSAGES, "deny": 0 })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager edited a category override: {body}"
    );
    put_channel_override_row(&state, text_channel_id, manager_role_id, 0, 0).await;
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/channels/{text_channel_id}/overrides/{manager_role_id}"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "manager deleted a channel override: {body}"
    );

    // The owner keeps every management path.
    let (status, created) = api_json(
        &mut app,
        "POST",
        &format!("/api/servers/{server_id}/roles"),
        &owner_auth,
        Some(json!({ "name": "Message moderators", "permissions": PERM_VIEW | PERM_SEND | PERM_MANAGE_MESSAGES, "color": null })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner role create failed: {created}"
    );
    let moderator_role_id = created["id"].as_str().unwrap().to_string();
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/servers/{server_id}/members/{manager_id}/roles"),
        &owner_auth,
        Some(json!({ "role_ids": [manager_role_id, moderator_role_id] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner role assignment failed: {body}"
    );
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/{text_channel_id}/overrides/{manager_role_id}"),
        &owner_auth,
        Some(json!({ "allow": PERM_MANAGE_MESSAGES, "deny": 0 })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner channel override failed: {body}"
    );
    let (status, body) = api_json(
        &mut app,
        "PUT",
        &format!("/api/channels/server/{server_id}/categories/{category_path}/overrides/{manager_role_id}"),
        &owner_auth,
        Some(json!({ "allow": PERM_SEND, "deny": 0 })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "owner category override failed: {body}"
    );

    // Moderators keep the daily powers they were given.
    let (status, body) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/messages/item/{member_message_id}"),
        &manager_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "moderator delete failed: {body}");
}

#[tokio::test]
async fn channel_overrides_only_carry_channel_scoped_permissions() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (owner_auth, _, _) = register_named_user(&mut app, "owner").await;
    let (server_id, text_channel_id, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &owner_auth, "Scope Guild").await;
    let (member_auth, member_id, _) = register_named_user(&mut app, "member").await;
    join_with_invite(&mut app, &member_auth, &invite_code).await;
    let everyone_id = everyone_role_id(&state, server_id).await;

    for server_scoped in [PERM_MANAGE_SERVER, PERM_MANAGE_ROLES, PERM_KICK, PERM_BAN] {
        let (status, body) = api_json(
            &mut app,
            "PUT",
            &format!("/api/channels/{text_channel_id}/overrides/{everyone_id}"),
            &owner_auth,
            Some(json!({ "allow": PERM_VIEW | server_scoped, "deny": 0 })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "server-scoped bit {server_scoped} accepted in a channel override: {body}"
        );
    }

    // Rows written before this rule existed must not grant server-scoped permissions either.
    put_channel_override_row(
        &state,
        text_channel_id,
        everyone_id,
        PERM_VIEW | PERM_SEND | PERM_MANAGE_ROLES | PERM_KICK | PERM_BAN,
        0,
    )
    .await;
    let perms = voxpery_server::services::permissions::get_user_channel_permissions(
        &state.db,
        text_channel_id,
        member_id,
    )
    .await
    .unwrap();
    assert!(
        perms.bits() & PERM_VIEW != 0,
        "channel-scoped allow still applies"
    );
    assert_eq!(
        perms.bits() & (PERM_MANAGE_ROLES | PERM_KICK | PERM_BAN),
        0,
        "server-scoped bits from an override must be ignored: {perms:?}"
    );
}
