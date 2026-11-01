use super::*;

#[tokio::test]
async fn personal_notes_stay_with_their_author() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _state) = setup_app().await;
    let (alice_auth, alice_id, _) = register_named_user(&mut app, "notealice").await;
    let (bob_auth, bob_id, _) = register_named_user(&mut app, "notebob").await;
    let path = format!("/api/users/{bob_id}/note");

    let (status, empty) = api_json(&mut app, "GET", &path, &alice_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(empty["note"].is_null());

    let (status, saved) = api_json(
        &mut app,
        "PUT",
        &path,
        &alice_auth,
        Some(json!({ "note": "  met at the meetup  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["note"], "met at the meetup");

    // Another signed-in user reads their own (empty) note, never the author's.
    let (status, other) = api_json(&mut app, "GET", &path, &bob_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(other["note"].is_null());
    let (status, other) = api_json(
        &mut app,
        "GET",
        &format!("/api/users/{alice_id}/note"),
        &bob_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(other["note"].is_null());

    // Editing keeps one note; emptying it deletes it.
    let (status, edited) = api_json(
        &mut app,
        "PUT",
        &path,
        &alice_auth,
        Some(json!({ "note": "plays bass" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(edited["note"], "plays bass");
    let (_, read) = api_json(&mut app, "GET", &path, &alice_auth, None).await;
    assert_eq!(read["note"], "plays bass");
    let (status, _) = api_json(
        &mut app,
        "PUT",
        &path,
        &alice_auth,
        Some(json!({ "note": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, read) = api_json(&mut app, "GET", &path, &alice_auth, None).await;
    assert!(read["note"].is_null());
}

#[tokio::test]
async fn personal_notes_are_validated_and_need_a_session() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, _state) = setup_app().await;
    let (auth, _, _) = register_named_user(&mut app, "notevalid").await;
    let (_, target_id, _) = register_named_user(&mut app, "notetarget").await;
    let path = format!("/api/users/{target_id}/note");

    let (status, _) = api_json(
        &mut app,
        "PUT",
        &path,
        &auth,
        Some(json!({ "note": "x".repeat(1001) })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = api_json(
        &mut app,
        "PUT",
        &format!("/api/users/{}/note", Uuid::new_v4()),
        &auth,
        Some(json!({ "note": "nobody" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = api_json(&mut app, "GET", &path, "", None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn personal_notes_follow_data_export_and_account_deletion() {
    let Some(_) = test_db_url() else {
        eprintln!("SKIP: DATABASE_URL not set");
        return;
    };
    let (mut app, state) = setup_app().await;
    let (author_auth, author_id, author_password) = register_named_user(&mut app, "noteauthor").await;
    let (target_auth, target_id, target_password) = register_named_user(&mut app, "notesubject").await;
    let (status, _) = api_json(
        &mut app,
        "PUT",
        &format!("/api/users/{target_id}/note"),
        &author_auth,
        Some(json!({ "note": "exported note" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let export = |auth: String, password: &'static str| {
        Request::builder()
            .method("POST")
            .uri("/api/auth/data-export")
            .header("Authorization", auth)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({ "password": password })).unwrap(),
            ))
            .unwrap()
    };
    let manifest = |body: &[u8]| {
        let mut archive = zip::ZipArchive::new(Cursor::new(body.to_vec())).unwrap();
        let mut text = String::new();
        archive
            .by_name("voxpery-data-export.json")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        serde_json::from_str::<serde_json::Value>(&text).unwrap()
    };

    let (status, body) = oneshot(&mut app, export(author_auth.clone(), author_password)).await;
    assert_eq!(status, StatusCode::OK);
    let notes = manifest(&body)["personal_notes"].clone();
    assert_eq!(notes.as_array().unwrap().len(), 1);
    assert_eq!(notes[0]["note"], "exported note");
    assert!(notes[0].get("target_user_id").is_none());

    // Someone a note is about does not receive it in their own export.
    let (status, body) = oneshot(&mut app, export(target_auth.clone(), target_password)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(manifest(&body)["personal_notes"], json!([]));

    let (status, body) = api_json(
        &mut app,
        "DELETE",
        "/api/auth/account",
        &target_auth,
        Some(json!({ "confirm": "DELETE", "password": target_password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "delete failed: {body}");
    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notes WHERE author_id = $1 OR target_user_id = $2",
    )
    .bind(author_id)
    .bind(target_id)
    .fetch_one(&state.db)
    .await
    .unwrap();
    assert_eq!(remaining, 0, "a deleted account takes the notes about it");
}
