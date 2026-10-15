use super::*;

#[tokio::test]
async fn attachment_upload_stores_file_and_returns_signed_url() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("upload-{}@example.com", uid);
    let username = format!("upload_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let boundary = format!("----voxperyboundary{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"hello.txt\"\r\nContent-Type: text/plain\r\n\r\nhello from integration test\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "upload failed: {}",
        String::from_utf8_lossy(&body)
    );

    let payload: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let arr = payload.as_array().expect("upload response must be array");
    assert_eq!(arr.len(), 1);
    let uploaded = &arr[0];
    let attachment_id = uploaded["id"]
        .as_str()
        .expect("attachment id must be present in upload response");
    Uuid::parse_str(attachment_id).expect("attachment id must be valid uuid");
    let url = uploaded["url"].as_str().unwrap_or_default();
    assert!(
        url.contains("/api/attachments/content/"),
        "unexpected upload URL: {url}"
    );
    assert!(
        url.contains("exp=") && url.contains("sig="),
        "signed URL must include exp/sig query params: {url}"
    );
    assert_eq!(uploaded["type"], "text/plain");
    assert_eq!(uploaded["name"], "hello.txt");
    assert_eq!(uploaded["size"], 27);

    let row: (String, String, String, i64, String) = sqlx::query_as(
        r#"SELECT storage_backend, content_type, original_name, size_bytes, storage_key
           FROM uploaded_attachments
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(row.0, "local");
    assert_eq!(row.1, "text/plain");
    assert_eq!(row.2, "hello.txt");
    assert_eq!(row.3, 27);

    let signed_path = url
        .strip_prefix("http://localhost:3001")
        .expect("signed URL should use localhost API base")
        .to_string();
    let req = Request::builder()
        .method("GET")
        .uri(&signed_path)
        .header("Authorization", &auth)
        .body(Body::empty())
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "signed content URL should serve file"
    );
    assert_eq!(
        body,
        bytes::Bytes::from_static(b"hello from integration test")
    );

    let tampered_path = if let Some((prefix, sig)) = signed_path.rsplit_once("sig=") {
        let replacement = if sig.ends_with('0') { '1' } else { '0' };
        let bad_sig = format!("{}{replacement}", &sig[..sig.len().saturating_sub(1)]);
        format!("{prefix}sig={bad_sig}")
    } else {
        panic!("signed URL must include sig param");
    };
    let req = Request::builder()
        .method("GET")
        .uri(&tampered_path)
        .header("Authorization", &auth)
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "tampered signature must be rejected"
    );

    let req = Request::builder()
        .method("GET")
        .uri(format!("/uploads/{}", row.4))
        .body(Body::empty())
        .unwrap();
    let (status, _body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "legacy public /uploads route must be disabled"
    );
}

#[tokio::test]
async fn zip_attachment_download_preserves_bytes_and_filename() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let uid = Uuid::new_v4();
    let email = format!("zip-download-{uid}@example.com");
    let username = format!("zip_download_{}", uid.as_u128() % 1_000_000);
    let (token, _) = register_user(&mut app, &email, &username, test_credential("default")).await;
    let auth = format!("Bearer {token}");
    let archive = [b"PK\x05\x06".as_slice(), &[0; 18]].concat();
    let boundary = format!("----voxperyzip{uid}");
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"notes.zip\"\r\nContent-Type: application/zip\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(&archive);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let upload = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let (status, response_body) = oneshot(&mut app, upload).await;
    assert_eq!(status, StatusCode::OK);
    let uploaded: serde_json::Value = serde_json::from_slice(&response_body).unwrap();
    let url = uploaded[0]["url"].as_str().unwrap();
    let signed_path = url.strip_prefix("http://localhost:3001").unwrap();
    let download = Request::builder()
        .method("GET")
        .uri(signed_path)
        .header("Authorization", &auth)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(download).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-disposition").unwrap(),
        "attachment; filename=\"notes.zip\""
    );
    let downloaded = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(downloaded.as_ref(), archive.as_slice());
}

#[tokio::test]
async fn attachment_upload_rejects_mime_spoofed_executable() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("upload-spoof-{}@example.com", uid);
    let username = format!("upload_spoof_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    let boundary = format!("----voxperyspoof{}", Uuid::new_v4());
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"photo.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"MZfake-portable-executable");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let (status, response_body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "spoofed executable should be rejected: {}",
        String::from_utf8_lossy(&response_body)
    );

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(stored_count, 0, "rejected content must not be persisted");
}

#[tokio::test]
async fn attachment_upload_fails_when_user_storage_quota_is_exceeded() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("quota-{}@example.com", uid);
    let username = format!("quota_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);

    sqlx::query("UPDATE users SET storage_used_bytes = $1 WHERE id = $2")
        .bind(1_073_741_824_i64)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let boundary = format!("----voxperyquota{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"small.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "upload should fail when quota is full: {}",
        String::from_utf8_lossy(&body)
    );
    assert!(
        String::from_utf8_lossy(&body).contains("Storage quota exceeded"),
        "quota error message should be explicit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn attachment_upload_rolls_back_prior_files_when_later_file_exceeds_quota() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;

    let uid = Uuid::new_v4();
    let email = format!("quota-rollback-{}@example.com", uid);
    let username = format!("quota_rollback_{}", uid.as_u128() % 1_000_000);
    let password = test_credential("default");
    let (token, user_id) = register_user(&mut app, &email, &username, password).await;
    let auth = format!("Bearer {}", token);
    let initial_storage_used = 1_073_741_819_i64;

    sqlx::query("UPDATE users SET storage_used_bytes = $1 WHERE id = $2")
        .bind(initial_storage_used)
        .bind(user_id)
        .execute(&state.db)
        .await
        .unwrap();

    let boundary = format!("----voxperyquotarollback{}", Uuid::new_v4());
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"first.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"second.txt\"\r\nContent-Type: text/plain\r\n\r\nworld\r\n--{boundary}--\r\n"
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/attachments/upload")
        .header("Authorization", &auth)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body.into_bytes()))
        .unwrap();
    let (status, response_body) = oneshot(&mut app, req).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "second upload should exceed quota: {}",
        String::from_utf8_lossy(&response_body)
    );

    let storage_used: i64 =
        sqlx::query_scalar("SELECT storage_used_bytes FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(
        storage_used, initial_storage_used,
        "quota reservation must roll back"
    );

    let stored_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(stored_count, 0, "attachment metadata must roll back");

    let storage_root = state
        .attachment_service
        .local_storage_dir()
        .expect("local attachment storage root");
    assert_eq!(
        count_regular_files(&storage_root).await,
        0,
        "rollback must remove files stored earlier in the request"
    );
}

#[tokio::test]
async fn attachment_content_rate_limit_runs_before_signature_and_storage_work() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("attachment-read-limit-{suffix}@example.com"),
        &format!("attachment_read_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth_header = format!("Bearer {token}");
    let attachment_id = Uuid::new_v4();
    let content_request = |requested_attachment_id: Uuid| {
        Request::builder()
            .uri(format!(
                "/api/attachments/content/{requested_attachment_id}?exp=4102444800&sig=invalid"
            ))
            .header("Authorization", &auth_header)
            .body(Body::empty())
            .unwrap()
    };

    for attempt in 1..=30 {
        let (status, body) = oneshot(&mut app, content_request(attachment_id)).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "attachment attempt {attempt} should reach signature validation: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, content_request(attachment_id)).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the thirty-first attachment request should be limited before validation: {}",
        String::from_utf8_lossy(&body)
    );

    for attempt in 32..=240 {
        let (status, body) = oneshot(&mut app, content_request(Uuid::new_v4())).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "attachment attempt {attempt} should remain under the user-wide limit: {}",
            String::from_utf8_lossy(&body)
        );
    }
    let (status, body) = oneshot(&mut app, content_request(Uuid::new_v4())).await;
    assert_eq!(
        status,
        StatusCode::TOO_MANY_REQUESTS,
        "the 241st attachment request should hit the user-wide limit: {}",
        String::from_utf8_lossy(&body)
    );
}

#[tokio::test]
async fn repeated_attachment_upload_reuses_storage_and_quota() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let suffix = Uuid::new_v4();
    let (token, user_id) = register_user(
        &mut app,
        &format!("idempotent-upload-{suffix}@example.com"),
        &format!("idem_upload_{}", suffix.as_u128() % 1_000_000),
        test_credential("default"),
    )
    .await;
    let auth = format!("Bearer {token}");
    let upload_request = || {
        let boundary = format!("----voxpery-idempotent-{suffix}");
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"retry.txt\"\r\nContent-Type: text/plain\r\n\r\nretry-safe upload\r\n--{boundary}--\r\n"
        );
        Request::builder()
            .method("POST")
            .uri("/api/attachments/upload")
            .header("Authorization", &auth)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body.into_bytes()))
            .unwrap()
    };
    let (first_status, first_body) = oneshot(&mut app, upload_request()).await;
    let (retry_status, retry_body) = oneshot(&mut app, upload_request()).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(retry_status, StatusCode::OK);
    let first: serde_json::Value = serde_json::from_slice(&first_body).unwrap();
    let retry: serde_json::Value = serde_json::from_slice(&retry_body).unwrap();
    assert_eq!(first[0]["id"], retry[0]["id"]);
    let attachment_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM uploaded_attachments WHERE user_id = $1 AND original_name = 'retry.txt'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(attachment_count, 1);
    let storage_used: i64 =
        sqlx::query_scalar("SELECT storage_used_bytes FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await
            .unwrap();
    assert_eq!(storage_used, 17);
}

#[tokio::test]
async fn unused_uploads_are_released_and_their_quota_returned() {
    use voxpery_server::services::attachment_release::release_unused_uploads;
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (auth, user_id, _) = register_named_user(&mut app, "uploader").await;
    let (_, channel_id, _) =
        create_server_with_default_text_channel(&mut app, &state, &auth, "Uploads").await;

    // A file used by two messages stays until the second one is deleted.
    let shared = upload_text_file(&mut app, &auth, "shared.txt", b"shared release bytes").await;
    let (shared_key, _) = upload_release_state(&state, shared).await.unwrap();
    let first = send_with_attachment(&mut app, &auth, channel_id, shared).await;
    let second = send_with_attachment(&mut app, &auth, channel_id, shared).await;
    age_upload(&state, shared, false).await;
    let used_before = storage_used(&state, user_id).await;
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/messages/item/{first}"),
        &auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, check_at) = upload_release_state(&state, shared)
        .await
        .expect("still in use");
    assert!(
        check_at.is_none(),
        "a file in use waits for its next message deletion"
    );
    let (status, _) = api_json(
        &mut app,
        "DELETE",
        &format!("/api/messages/item/{second}"),
        &auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        upload_release_state(&state, shared).await.is_none(),
        "unused file must be released"
    );
    assert!(state
        .attachment_service
        .open_local_attachment_file(&shared_key)
        .await
        .is_err());
    assert_eq!(
        storage_used(&state, user_id).await,
        used_before - b"shared release bytes".len() as i64
    );

    // An unsent upload is kept through the grace period, then released.
    let draft = upload_text_file(&mut app, &auth, "draft.txt", b"draft bytes").await;
    let outcome = release_unused_uploads(&state.db, &state.attachment_service, Some(&[draft]))
        .await
        .unwrap();
    assert_eq!(outcome.released, 0);
    let (_, check_at) = upload_release_state(&state, draft).await.unwrap();
    assert!(check_at.unwrap() > chrono::Utc::now() + chrono::Duration::hours(23));
    age_upload(&state, draft, true).await;
    let outcome = release_unused_uploads(&state.db, &state.attachment_service, Some(&[draft]))
        .await
        .unwrap();
    assert_eq!(outcome.released, 1);

    // Uploading the same file again reuses the upload and restarts its grace period.
    let reused = upload_text_file(&mut app, &auth, "again.txt", b"reuse bytes").await;
    age_upload(&state, reused, true).await;
    assert_eq!(
        upload_text_file(&mut app, &auth, "again.txt", b"reuse bytes").await,
        reused
    );
    release_unused_uploads(&state.db, &state.attachment_service, Some(&[reused]))
        .await
        .unwrap();
    assert!(
        upload_release_state(&state, reused).await.is_some(),
        "a fresh re-upload is kept"
    );

    // Messages removed with their channel mark their files for the next check.
    let cascaded = upload_text_file(&mut app, &auth, "cascade.txt", b"cascade bytes").await;
    send_with_attachment(&mut app, &auth, channel_id, cascaded).await;
    age_upload(&state, cascaded, false).await;
    sqlx::query("UPDATE uploaded_attachments SET release_check_at = NULL WHERE id = $1")
        .bind(cascaded)
        .execute(&state.db)
        .await
        .unwrap();
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(&state.db)
        .await
        .unwrap();
    let (_, check_at) = upload_release_state(&state, cascaded).await.unwrap();
    assert!(
        check_at.is_some(),
        "deleting messages must queue their files"
    );
    let outcome = release_unused_uploads(&state.db, &state.attachment_service, Some(&[cascaded]))
        .await
        .unwrap();
    assert_eq!(outcome.released, 1);

    let remaining: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM uploaded_attachments WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(
        storage_used(&state, user_id).await,
        remaining,
        "quota matches the files left"
    );
}

#[tokio::test]
async fn image_proxy_serves_only_server_signed_grants() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let uid = Uuid::new_v4();
    let (token, _) = register_user(
        &mut app,
        &format!("img-{uid}@example.com"),
        &format!("img_{}", uid.as_u128() % 1_000_000),
        test_credential("image-grant"),
    )
    .await;
    let auth_header = format!("Bearer {token}");
    let get = |uri: String, auth: Option<&str>| {
        let mut builder = Request::builder().method("GET").uri(uri);
        if let Some(auth) = auth {
            builder = builder.header("Authorization", auth);
        }
        builder.body(Body::empty()).unwrap()
    };
    let proxy = |url: &str, grant: Option<&str>| {
        let mut uri = format!("/api/images/remote?url={}", urlencoding::encode(url));
        if let Some(grant) = grant {
            uri.push_str(&format!("&grant={}", urlencoding::encode(grant)));
        }
        uri
    };

    // The session snapshot and the refresh endpoint hand signed-in clients a grant.
    let (status, body) = oneshot(
        &mut app,
        get("/api/auth/session".into(), Some(&auth_header)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let user_grant = session["image_proxy"]["grant"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        session["image_proxy"]["expires_at"].as_i64().unwrap() > chrono::Utc::now().timestamp()
    );
    let (status, _) = oneshot(&mut app, get("/api/images/grant".into(), None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = oneshot(
        &mut app,
        get("/api/images/grant".into(), Some(&auth_header)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let refreshed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(refreshed["grant"]
        .as_str()
        .is_some_and(|grant| !grant.is_empty()));

    // Without a valid grant nothing is fetched, even for signed-in callers.
    let image = "https://cdn.example.com/a.png";
    for (grant, auth) in [
        (None, None),
        (None, Some(auth_header.as_str())),
        (Some("u.0.0.AAAA"), None),
    ] {
        let (status, _) = oneshot(&mut app, get(proxy(image, grant), auth)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "grant {grant:?}");
    }
    // A valid grant passes the check; this URL then fails validation without any fetch.
    let (status, _) = oneshot(
        &mut app,
        get(proxy("https://127.0.0.1/a.png", Some(&user_grant)), None),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Invite previews carry a grant for the server icon only.
    let (_, _, invite_code) =
        create_server_with_default_text_channel(&mut app, &state, &auth_header, "Icon server")
            .await;
    sqlx::query("UPDATE servers SET icon_url = $1 WHERE invite_code = $2")
        .bind(image)
        .bind(&invite_code)
        .execute(&state.db)
        .await
        .unwrap();
    let (status, body) = oneshot(
        &mut app,
        get(format!("/api/servers/invite/{invite_code}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let preview: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let icon_grant = preview["icon_grant"].as_str().unwrap();
    let now = chrono::Utc::now().timestamp();
    assert!(image_proxy_grant::verify(
        &state.jwt_secret,
        icon_grant,
        image,
        now
    ));
    assert!(!image_proxy_grant::verify(
        &state.jwt_secret,
        icon_grant,
        "https://cdn.example.com/other.png",
        now
    ));
    let (status, _) = oneshot(
        &mut app,
        get(
            proxy("https://cdn.example.com/other.png", Some(icon_grant)),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
