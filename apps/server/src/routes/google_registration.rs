//! Cookie-bound, single-use registration after a verified Google callback.
use super::registration_pages::{
    legal_acknowledgement_inputs, new_pending_secret, pending_cookie, pending_cookie_hash,
};
use super::*;
use axum::extract::Form;

const COOKIE: &str = "voxpery_google_registration";
const PATH: &str = "/api/auth/google/registration";

#[derive(sqlx::FromRow)]
struct Pending {
    csrf_token: String,
    google_id: String,
    email: String,
    username_seed: String,
    return_origin: String,
    redirect_path: String,
    code_challenge: Option<String>,
}

fn cookie(state: &AppState, value: &str, max_age: u32) -> String {
    pending_cookie(state, COOKIE, PATH, value, max_age)
}

fn cookie_hash(headers: &HeaderMap) -> Result<String, AppError> {
    pending_cookie_hash(headers, COOKIE)
}

pub(super) async fn begin(
    state: &Arc<AppState>,
    google_id: &str,
    email: &str,
    name: &str,
    origin: &str,
    redirect: &str,
    challenge: Option<&str>,
) -> Result<Response, AppError> {
    let (secret, hash) = new_pending_secret();
    let csrf = Uuid::new_v4().simple().to_string();
    crate::services::privacy::cleanup_expired_google_registrations(&state.db).await?;
    sqlx::query("INSERT INTO pending_google_registrations (cookie_hash, csrf_token, google_id, email, username_seed, return_origin, redirect_path, code_challenge) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(hash).bind(csrf).bind(google_id).bind(email).bind(normalize_oauth_username_seed(name))
        .bind(origin).bind(redirect).bind(challenge).execute(&state.db).await?;
    let mut response = Redirect::to(PATH).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie(state, &secret, 600)).unwrap(),
    );
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_oauth_state_cookie_header(state)).unwrap(),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn page(state: &AppState, pending: &Pending, error: Option<&str>, accepted: [bool; 3]) -> Response {
    let nonce = Uuid::new_v4().simple().to_string();
    let options = legal_acknowledgement_inputs(state, accepted);
    let error = error
        .map(|message| format!("<p role=alert>{}</p>", escape_html_attribute(message)))
        .unwrap_or_default();
    let html = format!(
        r#"<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Complete registration - Voxpery</title>
<style nonce="{nonce}">*{{box-sizing:border-box}}body{{margin:0;padding:24px;font:16px system-ui;background:#171925;color:#f1f3f8;min-height:100vh;display:grid;place-items:center}}main{{max-width:480px;width:100%}}h1{{font-size:28px}}p{{line-height:1.5}}label{{display:flex;gap:12px;margin:20px 0;align-items:start}}input{{flex:none}}a{{color:#9abdfb}}button{{min-height:44px;width:100%;padding:12px;background:#376bcc;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}}[role=alert]{{color:#ffb4b4}}</style>
<main><h1>Complete your Voxpery account</h1><p>Review these documents to finish signing up with Google.</p>{error}<form method="post" action="{PATH}"><input type="hidden" name="csrf_token" value="{}">{options}<button type="submit">Accept and create account</button></form><p>You can close this page to cancel registration.</p></main></html>"#,
        escape_html_attribute(&pending.csrf_token)
    );
    let mut response = Html(html).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response.headers_mut().insert(HeaderName::from_static("content-security-policy"), HeaderValue::from_str(&format!("default-src 'none'; style-src 'nonce-{nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none' ")).unwrap());
    response
}

pub(super) async fn show(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if !state.google_oauth_enabled {
        return Err(feature_disabled(
            "Google sign-in is disabled on this server",
        ));
    }
    let pending = sqlx::query_as::<_, Pending>(
        "SELECT * FROM pending_google_registrations WHERE cookie_hash=$1 AND expires_at>NOW()",
    )
    .bind(cookie_hash(&headers)?)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        AppError::Validation("Registration expired. Return to Voxpery and sign in again.".into())
    })?;
    Ok(page(&state, &pending, None, [false; 3]))
}

#[derive(serde::Deserialize)]
pub(super) struct Acceptance {
    csrf_token: String,
    terms_accepted: Option<String>,
    terms_version: String,
    privacy_notice_acknowledged: Option<String>,
    privacy_notice_version: String,
    kvkk_notice_acknowledged: Option<String>,
    kvkk_notice_version: String,
}

pub(super) async fn create_account(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    google_id: &str,
    email: &str,
    name: &str,
) -> Result<User, AppError> {
    let seed = normalize_oauth_username_seed(name);
    let base = if seed.len() >= 3 {
        seed.chars().take(24).collect::<String>()
    } else {
        "user".into()
    };
    let mut created = None;
    for attempt in 0..8 {
        let username = if attempt == 0 {
            base.clone()
        } else {
            format!("{base}{}", &Uuid::new_v4().simple().to_string()[..8])
        };
        let user = sqlx::query_as::<_, User>("INSERT INTO users (id,username,email,password_hash,status,dm_privacy,google_id,email_verified,terms_version,terms_accepted_at,privacy_notice_version,privacy_notice_acknowledged_at,kvkk_notice_version,kvkk_notice_acknowledged_at) VALUES ($1,$2,$3,'oauth','online','everyone',$4,TRUE,$5,NOW(),$6,NOW(),$7,NOW()) ON CONFLICT DO NOTHING RETURNING *")
            .bind(Uuid::new_v4()).bind(username).bind(email).bind(google_id)
            .bind(CURRENT_TERMS_VERSION).bind(CURRENT_PRIVACY_NOTICE_VERSION).bind(CURRENT_KVKK_NOTICE_VERSION)
            .fetch_optional(&mut **tx).await?;
        if user.is_some() {
            created = user;
            break;
        }
    }
    let user = created.ok_or_else(|| {
        AppError::Conflict("Account already exists. Return to Voxpery and sign in again.".into())
    })?;
    record_privacy_event(
        tx,
        user.id,
        "account_registered",
        Some(CURRENT_TERMS_VERSION),
        Some(CURRENT_PRIVACY_NOTICE_VERSION),
        Some(CURRENT_KVKK_NOTICE_VERSION),
    )
    .await?;
    Ok(user)
}

pub(super) async fn complete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Form(body): Form<Acceptance>,
) -> Result<Response, AppError> {
    if !state.google_oauth_enabled {
        return Err(feature_disabled(
            "Google sign-in is disabled on this server",
        ));
    }
    let hash = cookie_hash(&headers)?;
    enforce_rate_limit(
        &state.redis,
        format!("auth:google_registration:{hash}"),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many registration attempts",
    )
    .await?;
    let mut tx = state.db.begin().await?;
    let pending = sqlx::query_as::<_, Pending>("SELECT * FROM pending_google_registrations WHERE cookie_hash=$1 AND expires_at>NOW() FOR UPDATE")
        .bind(&hash).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Registration expired. Return to Voxpery and sign in again.".into()))?;
    if !constant_time_eq(&pending.csrf_token, &body.csrf_token) {
        return Err(AppError::Forbidden("Cross-site request rejected".into()));
    }
    let accepted = [
        body.terms_accepted.as_deref() == Some("true"),
        body.privacy_notice_acknowledged.as_deref() == Some("true"),
        body.kvkk_notice_acknowledged.as_deref() == Some("true"),
    ];
    if let Err(error) = validate_current_legal_documents(
        accepted[0],
        &body.terms_version,
        accepted[1],
        &body.privacy_notice_version,
        accepted[2],
        &body.kvkk_notice_version,
    ) {
        let current_versions = body.terms_version == CURRENT_TERMS_VERSION
            && body.privacy_notice_version == CURRENT_PRIVACY_NOTICE_VERSION
            && body.kvkk_notice_version == CURRENT_KVKK_NOTICE_VERSION;
        return Ok(page(
            &state,
            &pending,
            Some(&error.to_string()),
            if current_versions {
                accepted
            } else {
                [false; 3]
            },
        ));
    }
    let user = create_account(
        &mut tx,
        &pending.google_id,
        &pending.email,
        &pending.username_seed,
    )
    .await?;
    sqlx::query("DELETE FROM pending_google_registrations WHERE cookie_hash=$1")
        .bind(hash)
        .execute(&mut *tx)
        .await?;
    let token = generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;
    let desktop = is_desktop_oauth_origin(&pending.return_origin);
    // Issue the PKCE handoff before committing, so a failure retains the pending registration.
    let mut response = if desktop {
        let challenge = pending
            .code_challenge
            .as_deref()
            .filter(|v| is_valid_pkce_component(v))
            .ok_or(AppError::Unauthorized)?;
        let code = issue_desktop_oauth_code(&state, &token, challenge).await?;
        desktop_oauth_handoff_response(
            &format!(
                "{DESKTOP_OAUTH_ORIGIN}{}",
                append_query_param(&pending.redirect_path, "code", &code)
            ),
            true,
        )
    } else {
        let origin = normalize_oauth_origin(&state, &pending.return_origin);
        Redirect::to(&format!("{origin}{}", pending.redirect_path)).into_response()
    };
    tx.commit().await?;
    if let Err(error) = ensure_default_server_join(&state.db, user.id).await {
        tracing::warn!("Default server join after registration failed: {error}");
    }
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie(&state, "", 0)).unwrap(),
    );
    // Desktop signs in through the PKCE exchange only; the system browser stays signed out.
    if !desktop {
        for value in auth_cookie_header(&state, &token).get_all(header::SET_COOKIE) {
            response
                .headers_mut()
                .append(header::SET_COOKIE, value.clone());
        }
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
