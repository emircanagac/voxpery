//! Browser-hosted email registration for desktop builds.
//!
//! Tauri's Linux WebKit origin is not a supported Turnstile origin. This flow
//! keeps CAPTCHA in the trusted web/API origin and returns only a short-lived
//! PKCE-bound desktop code to the application.

use super::*;
use axum::extract::Form;

const COOKIE: &str = "voxpery_desktop_registration";
const PATH: &str = "/api/auth/desktop-registration";

#[derive(sqlx::FromRow)]
struct Pending {
    csrf_token: String,
    return_origin: String,
    redirect_path: String,
    code_challenge: String,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct StartQuery {
    origin: Option<String>,
    redirect: Option<String>,
    code_challenge: Option<String>,
}

#[derive(serde::Deserialize)]
pub(super) struct RegistrationForm {
    csrf_token: String,
    username: String,
    email: String,
    password: String,
    confirm_password: String,
    terms_accepted: Option<String>,
    terms_version: String,
    privacy_notice_acknowledged: Option<String>,
    privacy_notice_version: String,
    kvkk_notice_acknowledged: Option<String>,
    kvkk_notice_version: String,
    captcha_token: Option<String>,
}

fn cookie(state: &AppState, value: &str, max_age: u32) -> String {
    format!(
        "{COOKIE}={value}; HttpOnly; Path={PATH}; SameSite=Lax; Max-Age={max_age}{}",
        if state.cookie_secure { "; Secure" } else { "" }
    )
}

fn cookie_hash(headers: &HeaderMap) -> Result<String, AppError> {
    let prefix = format!("{COOKIE}=");
    let secret = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|part| part.trim().strip_prefix(&prefix))
        })
        .filter(|value| value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| {
            AppError::Validation(
                "Registration expired. Return to Voxpery and sign in again.".into(),
            )
        })?;
    Ok(BASE64URL.encode(Sha256::digest(secret.as_bytes())))
}

fn safe_redirect_path(value: Option<&str>) -> String {
    let value = value.unwrap_or("/").trim();
    if value.starts_with('/') && !value.starts_with("//") && !value.contains(['\\', '\n', '\r']) {
        value.to_string()
    } else {
        "/".into()
    }
}

fn valid_origin(origin: &str) -> bool {
    origin == DESKTOP_OAUTH_ORIGIN
}

/// Non-secret values echoed back after a failed submission. Passwords are never re-rendered.
#[derive(Default, Clone, Copy)]
struct Prefill<'a> {
    username: &'a str,
    email: &'a str,
}

/// Errors the user can fix in the same form; everything else ends the browser flow.
fn recoverable_status(error: &AppError) -> Option<StatusCode> {
    match error {
        AppError::Validation(_) => Some(StatusCode::BAD_REQUEST),
        AppError::UserAlreadyExists => Some(StatusCode::CONFLICT),
        AppError::TooManyRequests(_) => Some(StatusCode::TOO_MANY_REQUESTS),
        _ => None,
    }
}

fn page(
    state: &AppState,
    pending: &Pending,
    error: Option<&str>,
    accepted: [bool; 3],
    prefill: Prefill<'_>,
) -> Response {
    let nonce = Uuid::new_v4().simple().to_string();
    let legal_origin = state
        .frontend_url
        .as_deref()
        .or_else(|| {
            state
                .cors_origins
                .iter()
                .find(|origin| origin.starts_with("http"))
                .map(String::as_str)
        })
        .unwrap_or("http://localhost:5173");
    let labels = [
        (
            "terms_accepted",
            "terms_version",
            "terms",
            "I accept the Terms of Service",
            CURRENT_TERMS_VERSION,
        ),
        (
            "privacy_notice_acknowledged",
            "privacy_notice_version",
            "privacy",
            "I have read the Privacy Notice",
            CURRENT_PRIVACY_NOTICE_VERSION,
        ),
        (
            "kvkk_notice_acknowledged",
            "kvkk_notice_version",
            "kvkk",
            "I have read the KVKK Notice",
            CURRENT_KVKK_NOTICE_VERSION,
        ),
    ];
    let options = labels
        .iter()
        .enumerate()
        .map(|(index, (name, version_name, path, label, version))| {
            format!(
                "<label class=check><input type=checkbox name={name} value=true required {}><a href=\"{}/{}\" target=_blank rel=noreferrer>{label}</a></label><input type=hidden name={version_name} value=\"{}\">",
                if accepted[index] { "checked" } else { "" },
                escape_html_attribute(legal_origin),
                path,
                escape_html_attribute(version),
            )
        })
        .collect::<String>();
    let error = error
        .map(|message| {
            format!(
                "<p class=error role=alert>{}</p>",
                escape_html_attribute(message)
            )
        })
        .unwrap_or_default();
    let captcha = state
        .turnstile_site_key
        .as_deref()
        .map(|key| {
            format!(
                "<div class=cf-turnstile id=registration-captcha data-sitekey=\"{}\"></div><p id=registration-captcha-status role=status>Loading CAPTCHA...</p><button type=button id=registration-captcha-retry hidden>Retry CAPTCHA</button>",
                escape_html_attribute(key)
            )
        })
        .unwrap_or_default();
    let captcha_script = if state.turnstile_site_key.is_some() {
        format!("<script nonce=\"{nonce}\">{}</script>", include_str!("desktop_registration_captcha.js"))
    } else {
        String::new()
    };
    let captcha_disabled = if state.turnstile_site_key.is_some() { "disabled" } else { "" };
    let html = format!(
        r#"<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create your Voxpery account</title>
<style nonce="{nonce}">*{{box-sizing:border-box}}body{{margin:0;padding:16px;font:16px system-ui;background:#171925;color:#f1f3f8;min-height:100vh;display:grid;place-items:center}}main{{max-width:520px;width:100%;background:#202a4b;padding:16px;border-radius:8px}}h1{{margin-top:0}}p{{line-height:1.5;color:#bdc9e3}}label{{display:block;margin:16px 0 6px;font-weight:700;font-size:13px}}input[type=text],input[type=email],input[type=password]{{display:block;width:100%;min-height:44px;padding:10px;border:1px solid #44577f;border-radius:6px;background:#0e1b2d;color:#fff;font:inherit}}.check{{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:14px}}.check input{{margin-top:4px}}a{{color:#9abdfb}}button{{min-height:46px;width:100%;margin-top:18px;padding:12px;background:#376bcc;color:white;border:0;border-radius:6px;font:inherit;font-weight:700;cursor:pointer}}.error{{color:#ffb4b4}}.cf-turnstile{{margin-top:18px;min-width:0}}</style>
{captcha_script}<main><h1>Create your Voxpery account</h1><p>Voxpery will reopen when your account is ready.</p>{error}<form method="post" action="{PATH}"><input type="hidden" name="csrf_token" value="{csrf}"><label for=username>Username</label><input id=username name=username type=text minlength=3 maxlength=32 required autocomplete=username value="{username}"><label for=email>Email</label><input id=email name=email type=email maxlength=255 required autocomplete=email value="{email}"><label for=password>Password</label><input id=password name=password type=password minlength=8 required autocomplete=new-password><label for=confirm_password>Confirm password</label><input id=confirm_password name=confirm_password type=password minlength=8 required autocomplete=new-password>{captcha}<div>{options}</div><button type=submit {captcha_disabled}>Create account</button></form></main></html>"#,
        nonce = nonce,
        captcha_script = captcha_script.replace("{nonce}", &nonce),
        error = error,
        csrf = escape_html_attribute(&pending.csrf_token),
        username = escape_html_attribute(prefill.username),
        email = escape_html_attribute(prefill.email),
        options = options,
    );
    let mut response = Html(html).into_response();
    let csp = format!(
        "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com"
    );
    response.headers_mut().insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_str(&csp).unwrap(),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub(super) async fn show(
    State(state): State<Arc<AppState>>,
    Query(query): Query<StartQuery>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if state.turnstile_secret_key.is_some() && state.turnstile_site_key.is_none() {
        return Err(AppError::Validation(
            "CAPTCHA is not configured for browser registration".into(),
        ));
    }
    if query.origin.is_none() && query.code_challenge.is_none() {
        let pending = sqlx::query_as::<_, Pending>(
            "SELECT * FROM pending_desktop_registrations WHERE cookie_hash=$1 AND expires_at>NOW()",
        )
        .bind(cookie_hash(&headers)?)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| {
            AppError::Validation("Registration expired. Return to Voxpery and try again.".into())
        })?;
        if !valid_origin(&pending.return_origin) {
            return Err(AppError::Forbidden(
                "Invalid desktop registration origin".into(),
            ));
        }
        return Ok(page(&state, &pending, None, [false; 3], Prefill::default()));
    }
    let origin = query.origin.as_deref().unwrap_or("").trim();
    let challenge = query
        .code_challenge
        .as_deref()
        .map(str::trim)
        .filter(|value| is_valid_pkce_component(value))
        .ok_or_else(|| AppError::Validation("Missing or invalid desktop PKCE challenge".into()))?;
    if !valid_origin(origin) {
        return Err(AppError::Forbidden(
            "Desktop registration requires the Voxpery app".into(),
        ));
    }
    let client_ip = extract_client_ip(
        &state,
        &headers,
        connect_info.as_ref().map(|Extension(info)| info),
    );
    if let Some(ip) = client_ip {
        enforce_rate_limit(
            &state.redis,
            format!("auth:desktop_registration_start:{ip}"),
            20,
            Duration::from_secs(3600),
            "Too many registration attempts",
        )
        .await?;
    }
    let redirect_path = safe_redirect_path(query.redirect.as_deref());
    let secret = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = BASE64URL.encode(Sha256::digest(secret.as_bytes()));
    let csrf = Uuid::new_v4().simple().to_string();
    sqlx::query("DELETE FROM pending_desktop_registrations WHERE expires_at <= NOW()")
        .execute(&state.db)
        .await?;
    sqlx::query("INSERT INTO pending_desktop_registrations (cookie_hash, csrf_token, return_origin, redirect_path, code_challenge) VALUES ($1,$2,$3,$4,$5)")
        .bind(hash)
        .bind(&csrf)
        .bind(origin)
        .bind(redirect_path)
        .bind(challenge)
        .execute(&state.db)
        .await?;
    let pending = Pending {
        csrf_token: csrf,
        return_origin: origin.to_string(),
        redirect_path: safe_redirect_path(query.redirect.as_deref()),
        code_challenge: challenge.to_string(),
    };
    let mut response = page(&state, &pending, None, [false; 3], Prefill::default());
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie(&state, &secret, 600)).unwrap(),
    );
    Ok(response)
}

pub(super) async fn complete(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Form(form): Form<RegistrationForm>,
) -> Result<Response, AppError> {
    let hash = cookie_hash(&headers)?;
    enforce_rate_limit(
        &state.redis,
        format!("auth:desktop_registration:{hash}"),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many registration attempts",
    )
    .await?;
    let mut tx = state.db.begin().await?;
    let pending = sqlx::query_as::<_, Pending>("SELECT csrf_token, return_origin, redirect_path, code_challenge FROM pending_desktop_registrations WHERE cookie_hash=$1 AND expires_at>NOW() FOR UPDATE")
        .bind(&hash).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::Validation("Registration expired. Return to Voxpery and sign in again.".into()))?;
    if !valid_origin(&pending.return_origin) {
        return Err(AppError::Forbidden(
            "Invalid desktop registration origin".into(),
        ));
    }
    if !constant_time_eq(&pending.csrf_token, &form.csrf_token) {
        return Err(AppError::Forbidden("Cross-site request rejected".into()));
    }
    let accepted = [
        form.terms_accepted.as_deref() == Some("true"),
        form.privacy_notice_acknowledged.as_deref() == Some("true"),
        form.kvkk_notice_acknowledged.as_deref() == Some("true"),
    ];
    let prefill = Prefill {
        username: form.username.trim(),
        email: form.email.trim(),
    };
    if let Err(error) = validate_current_legal_documents(
        accepted[0],
        form.terms_version.trim(),
        accepted[1],
        form.privacy_notice_version.trim(),
        accepted[2],
        form.kvkk_notice_version.trim(),
    ) {
        drop(tx);
        let current_versions = form.terms_version.trim() == CURRENT_TERMS_VERSION
            && form.privacy_notice_version.trim() == CURRENT_PRIVACY_NOTICE_VERSION
            && form.kvkk_notice_version.trim() == CURRENT_KVKK_NOTICE_VERSION;
        return Ok(page(
            &state,
            &pending,
            Some(&error.to_string()),
            if current_versions {
                accepted
            } else {
                [false; 3]
            },
            prefill,
        ));
    }

    let user = match create_account(&state, &headers, connect_info.as_ref(), &form, &mut tx).await
    {
        Ok(user) => user,
        Err(error) => {
            drop(tx);
            let Some(status) = recoverable_status(&error) else {
                return Err(error);
            };
            let message = match &error {
                AppError::Validation(message) | AppError::TooManyRequests(message) => {
                    message.clone()
                }
                _ => "An account with this username or email already exists".to_string(),
            };
            let mut response = page(&state, &pending, Some(&message), accepted, prefill);
            *response.status_mut() = status;
            return Ok(response);
        }
    };
    sqlx::query("DELETE FROM pending_desktop_registrations WHERE cookie_hash=$1")
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    // Issue the single-use code only for a committed account.
    let token = generate_token(
        user.id,
        &user.username,
        user.token_version,
        &state.jwt_secret,
        state.jwt_expiration,
    )?;
    let code = issue_desktop_oauth_code(&state, &token, &pending.code_challenge).await?;
    if let Err(error) = ensure_default_server_join(&state.db, user.id).await {
        tracing::warn!("Default server join after desktop registration failed: {error}");
    }
    let redirect = format!(
        "{}{}",
        pending.return_origin,
        append_query_param(&pending.redirect_path, "code", &code)
    );
    let mut response = desktop_oauth_handoff_response(&redirect, true);
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie(&state, "", 0)).unwrap(),
    );
    Ok(response)
}

/// Validates the submission and inserts the account inside the caller's transaction.
async fn create_account(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    connect_info: Option<&Extension<ConnectInfo<SocketAddr>>>,
    form: &RegistrationForm,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<User, AppError> {
    if form.password != form.confirm_password {
        return Err(AppError::Validation("Passwords do not match".into()));
    }
    let username = form.username.trim();
    validate_username(username).map_err(|message| AppError::Validation(message.into()))?;
    let email = form.email.trim().to_lowercase();
    if email.len() > 255 || !is_valid_email(&email) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
        ));
    }
    if form.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }
    enforce_rate_limit(
        &state.redis,
        format!("auth:register:{email}"),
        state.auth_rate_limit_max,
        Duration::from_secs(state.auth_rate_limit_window_secs),
        "Too many register attempts for this email. Please wait and try again.",
    )
    .await?;
    let client_ip = extract_client_ip(state, headers, connect_info.map(|Extension(info)| info));
    if let Some(ip) = client_ip.as_deref() {
        enforce_rate_limit(
            &state.redis,
            format!("auth:register_ip:{ip}"),
            5,
            Duration::from_secs(3600),
            "Too many accounts created from this IP address. Please try again later.",
        )
        .await?;
    }
    validate_registration_captcha(state, form.captcha_token.as_deref(), client_ip.as_deref())
        .await?;
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($2)",
    )
    .bind(&email)
    .bind(username)
    .fetch_one(&mut **tx)
    .await?;
    if existing > 0 {
        return Err(AppError::UserAlreadyExists);
    }
    let password_hash = hash_password(&form.password)?;
    let user = sqlx::query_as::<_, User>("INSERT INTO users (id,username,email,password_hash,status,dm_privacy,email_verified,created_at,terms_version,terms_accepted_at,privacy_notice_version,privacy_notice_acknowledged_at,kvkk_notice_version,kvkk_notice_acknowledged_at) VALUES ($1,$2,$3,$4,'online','everyone',FALSE,NOW(),$5,NOW(),$6,NOW(),$7,NOW()) RETURNING *")
        .bind(Uuid::new_v4()).bind(username).bind(&email).bind(password_hash)
        .bind(CURRENT_TERMS_VERSION).bind(CURRENT_PRIVACY_NOTICE_VERSION).bind(CURRENT_KVKK_NOTICE_VERSION)
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| {
            // A concurrent registration can win between the existence check and insert.
            let unique_violation = error
                .as_database_error()
                .and_then(|db| db.code())
                .is_some_and(|code| code == "23505");
            if unique_violation {
                AppError::UserAlreadyExists
            } else {
                AppError::from(error)
            }
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

#[cfg(test)]
mod tests {
    use super::safe_redirect_path;

    #[test]
    fn desktop_registration_keeps_redirects_on_the_app_origin() {
        assert_eq!(safe_redirect_path(Some("/app/friends")), "/app/friends");
        assert_eq!(safe_redirect_path(Some("//evil.example")), "/");
        assert_eq!(safe_redirect_path(Some("https://evil.example")), "/");
        assert_eq!(
            safe_redirect_path(Some("/safe\r\nLocation: https://evil.example")),
            "/"
        );
    }
}
