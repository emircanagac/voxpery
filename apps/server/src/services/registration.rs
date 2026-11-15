//! Account creation. Every sign-up path (email, desktop, Google) goes through this module, so
//! the server's registration mode and the account rules cannot differ between them.

use std::time::Duration;

use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    errors::AppError,
    models::User,
    services::{
        auth::{ensure_password_within_limit, hash_password_async},
        privacy::{
            current_kvkk_notice_version, current_privacy_notice_version, current_terms_version,
            record_privacy_event,
        },
        rate_limit::enforce_rate_limit,
        server_membership,
    },
    AppState,
};

/// Invite code of the default community server. It is public knowledge, so it never counts as
/// an invitation to an invite-only server.
pub const DEFAULT_SERVER_INVITE_CODE: &str = "voxpery";

pub const MAX_EMAIL_LEN: usize = 255;
/// The domain of placeholder accounts; no person can register an address in it.
pub const RESERVED_SYSTEM_EMAIL_DOMAIN: &str = "system.local";

pub const REGISTRATION_CLOSED_MESSAGE: &str = "This server is not accepting new accounts";
pub const REGISTRATION_INVITE_REQUIRED_MESSAGE: &str =
    "A valid invite link is required to create an account on this server";

/// Who may create an account (`REGISTRATION_MODE`). Existing accounts sign in under every mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistrationMode {
    /// Anyone may sign up.
    Open,
    /// Sign-up needs the invite code of a server; the new account joins that server.
    Invite,
    /// Nobody may sign up.
    Closed,
}

impl RegistrationMode {
    /// Parses the environment value; unset or empty means [`RegistrationMode::Open`].
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.map(str::trim).unwrap_or("") {
            "" | "open" => Ok(Self::Open),
            "invite" => Ok(Self::Invite),
            "closed" => Ok(Self::Closed),
            other => Err(format!(
                "Invalid REGISTRATION_MODE '{other}': use open, invite or closed"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Invite => "invite",
            Self::Closed => "closed",
        }
    }
}

/// The outcome of the registration gate for one sign-up.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Admission {
    /// Server the new account joins because its invite admitted the sign-up.
    pub invited_server_id: Option<Uuid>,
}

/// The invite code in an in-app redirect such as `/invite/AbC123`, which is how the web and
/// desktop apps carry an invite through sign-up.
pub fn invite_code_from_redirect(redirect_path: &str) -> Option<&str> {
    let path = redirect_path
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    let code = path.strip_prefix("/invite/")?;
    let valid = !code.is_empty()
        && code.len() <= 32
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    valid.then_some(code)
}

/// Applies the registration mode. `invite_code` is whatever the client supplied, if anything.
pub async fn admit(
    db: &PgPool,
    mode: RegistrationMode,
    invite_code: Option<&str>,
) -> Result<Admission, AppError> {
    match mode {
        RegistrationMode::Open => Ok(Admission::default()),
        RegistrationMode::Closed => Err(AppError::Forbidden(REGISTRATION_CLOSED_MESSAGE.into())),
        RegistrationMode::Invite => {
            let code = invite_code.map(str::trim).unwrap_or("");
            let code_is_usable =
                !code.is_empty() && code.len() <= 32 && code != DEFAULT_SERVER_INVITE_CODE;
            let server_id = if code_is_usable {
                sqlx::query_scalar::<_, Uuid>("SELECT id FROM servers WHERE invite_code = $1")
                    .bind(code)
                    .fetch_optional(db)
                    .await?
            } else {
                None
            };
            match server_id {
                Some(server_id) => Ok(Admission {
                    invited_server_id: Some(server_id),
                }),
                // A fixable input error: the person can come back with an invite.
                None => Err(AppError::Validation(
                    REGISTRATION_INVITE_REQUIRED_MESSAGE.into(),
                )),
            }
        }
    }
}

pub fn is_valid_email(email: &str) -> bool {
    email.len() <= MAX_EMAIL_LEN
        && email.contains('@')
        && email.find('@').map(|i| i > 0 && i < email.len() - 1) == Some(true)
        && !email.rsplit_once('@').is_some_and(|(_, domain)| {
            domain
                .trim()
                .eq_ignore_ascii_case(RESERVED_SYSTEM_EMAIL_DOMAIN)
        })
}

pub fn validate_username(username: &str) -> Result<(), &'static str> {
    if username.len() < 3 || username.len() > 32 {
        return Err("Username must be 3-32 characters");
    }
    if username.starts_with('_')
        || username.starts_with('.')
        || username.ends_with('_')
        || username.ends_with('.')
    {
        return Err("Username cannot start or end with an underscore or period");
    }
    if username.contains("__")
        || username.contains("..")
        || username.contains("_.")
        || username.contains("._")
    {
        return Err("Username cannot contain consecutive underscores or periods");
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphabetic() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        return Err("Username may only contain letters, numbers, underscores, and periods");
    }
    Ok(())
}

pub async fn validate_registration_captcha(
    state: &AppState,
    token: Option<&str>,
    client_ip: Option<&str>,
) -> Result<(), AppError> {
    if let Some(secret_key) = &state.turnstile_secret_key {
        let token = token.unwrap_or("");
        if token.is_empty() {
            return Err(AppError::Validation("CAPTCHA token is required".into()));
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| AppError::Internal("Could not initialize CAPTCHA verification".into()))?;
        let mut verify_form = vec![
            ("secret", secret_key.to_string()),
            ("response", token.to_string()),
        ];
        if let Some(ip) = client_ip {
            verify_form.push(("remoteip", ip.to_string()));
        }
        let res = client
            .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
            .form(&verify_form)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("Turnstile verify request failed: {}", e);
                AppError::Validation(
                    "CAPTCHA verification service is temporarily unavailable. Please try again."
                        .into(),
                )
            })?;

        #[derive(serde::Deserialize)]
        struct TurnstileResponse {
            success: bool,
            #[serde(default)]
            error_codes: Vec<String>,
        }

        let status = res.status();
        let raw = res.text().await.map_err(|e| {
            tracing::warn!("Turnstile verify response read failed: {}", e);
            AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            )
        })?;

        if !status.is_success() {
            tracing::warn!("Turnstile verify non-success status: {}", status);
            return Err(AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            ));
        }

        let verify_result = serde_json::from_str::<TurnstileResponse>(&raw).map_err(|e| {
            tracing::warn!("Turnstile verify JSON parse failed: {}", e);
            AppError::Validation(
                "CAPTCHA verification service is temporarily unavailable. Please try again.".into(),
            )
        })?;

        if !verify_result.success {
            tracing::warn!(
                "Turnstile verification failed for register request: {:?}",
                verify_result.error_codes
            );
            return Err(AppError::Validation(
                "CAPTCHA verification failed. Please retry the challenge.".into(),
            ));
        }
    }
    Ok(())
}

/// A stored account and the server it joined through its invite, if any.
pub struct NewAccount {
    pub user: User,
    pub joined_server_id: Option<Uuid>,
}

/// What a person submits to create an account with a password.
pub struct PasswordSignup<'a> {
    pub username: &'a str,
    pub email: &'a str,
    pub password: &'a str,
    pub captcha_token: Option<&'a str>,
    pub client_ip: Option<&'a str>,
    pub invite_code: Option<&'a str>,
}

/// A password sign-up that passed every check and is ready to be stored.
pub struct PreparedPasswordSignup {
    username: String,
    email: String,
    password_hash: String,
    admission: Admission,
}

/// Checks a password sign-up: registration mode, rate limits, CAPTCHA, field rules and that
/// the name and address are free. Runs outside a transaction because it calls the CAPTCHA
/// service and hashes the password. Store the result with [`insert_password_account`].
pub async fn prepare_password_signup(
    state: &AppState,
    signup: PasswordSignup<'_>,
) -> Result<PreparedPasswordSignup, AppError> {
    // A closed server answers before it spends a rate-limit slot or a CAPTCHA check.
    if state.registration_mode == RegistrationMode::Closed {
        return Err(AppError::Forbidden(REGISTRATION_CLOSED_MESSAGE.into()));
    }

    let email = signup.email.trim().to_lowercase();
    if !is_valid_email(&email) {
        return Err(AppError::Validation(
            "Email must be a valid format (e.g. user@domain)".into(),
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
    // At most 5 accounts per address per hour, as basic flood protection.
    if let Some(ip) = signup.client_ip {
        enforce_rate_limit(
            &state.redis,
            format!("auth:register_ip:{ip}"),
            5,
            Duration::from_secs(3600),
            "Too many accounts created from this IP address. Please try again later.",
        )
        .await?;
    }

    validate_registration_captcha(state, signup.captcha_token, signup.client_ip).await?;

    let username = signup.username.trim();
    validate_username(username).map_err(|message| AppError::Validation(message.into()))?;
    if signup.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }
    ensure_password_within_limit(signup.password)?;

    // After the limits above, so invite codes cannot be guessed faster than accounts are made.
    let admission = admit(&state.db, state.registration_mode, signup.invite_code).await?;

    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($2)",
    )
    .bind(&email)
    .bind(username)
    .fetch_one(&state.db)
    .await?;
    if existing > 0 {
        return Err(AppError::UserAlreadyExists);
    }

    Ok(PreparedPasswordSignup {
        username: username.to_string(),
        email,
        password_hash: hash_password_async(signup.password).await?,
        admission,
    })
}

/// Stores a prepared password sign-up with its legal acknowledgement proof, and joins the
/// inviting server, inside the caller's transaction.
pub async fn insert_password_account(
    tx: &mut Transaction<'_, Postgres>,
    signup: PreparedPasswordSignup,
) -> Result<NewAccount, AppError> {
    let user = sqlx::query_as::<_, User>(
        r#"INSERT INTO users
           (id, username, email, password_hash, status, dm_privacy, email_verified, created_at,
            terms_version, terms_accepted_at, privacy_notice_version,
            privacy_notice_acknowledged_at, kvkk_notice_version,
            kvkk_notice_acknowledged_at)
           VALUES ($1, $2, $3, $4, 'online', 'everyone', FALSE, NOW(),
                   $5, NOW(), $6, NOW(), $7, NOW())
           RETURNING *"#,
    )
    .bind(Uuid::new_v4())
    .bind(&signup.username)
    .bind(&signup.email)
    .bind(&signup.password_hash)
    .bind(current_terms_version())
    .bind(current_privacy_notice_version())
    .bind(current_kvkk_notice_version())
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| match error {
        // A concurrent registration took the email or username after the check in `prepare`.
        sqlx::Error::Database(database) if database.is_unique_violation() => {
            AppError::UserAlreadyExists
        }
        error => AppError::Database(error),
    })?;
    finish_new_account(tx, user, signup.admission).await
}

/// Stores an account for a verified Google identity inside the caller's transaction. The
/// username is `username_seed` (already reduced to username characters), with a random suffix
/// when it is taken.
pub async fn insert_google_account(
    tx: &mut Transaction<'_, Postgres>,
    google_id: &str,
    email: &str,
    username_seed: &str,
    admission: Admission,
) -> Result<NewAccount, AppError> {
    let base = if username_seed.len() >= 3 {
        username_seed.chars().take(24).collect::<String>()
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
        let user = sqlx::query_as::<_, User>(
            r#"INSERT INTO users
               (id, username, email, password_hash, status, dm_privacy, google_id, email_verified,
                terms_version, terms_accepted_at, privacy_notice_version,
                privacy_notice_acknowledged_at, kvkk_notice_version,
                kvkk_notice_acknowledged_at)
               VALUES ($1, $2, $3, 'oauth', 'online', 'everyone', $4, TRUE,
                       $5, NOW(), $6, NOW(), $7, NOW())
               ON CONFLICT DO NOTHING
               RETURNING *"#,
        )
        .bind(Uuid::new_v4())
        .bind(username)
        .bind(email)
        .bind(google_id)
        .bind(current_terms_version())
        .bind(current_privacy_notice_version())
        .bind(current_kvkk_notice_version())
        .fetch_optional(&mut **tx)
        .await?;
        if user.is_some() {
            created = user;
            break;
        }
    }
    let user = created.ok_or_else(|| {
        AppError::Conflict("Account already exists. Return to Voxpery and sign in again.".into())
    })?;
    finish_new_account(tx, user, admission).await
}

/// What every new account gets in the transaction that creates it.
async fn finish_new_account(
    tx: &mut Transaction<'_, Postgres>,
    user: User,
    admission: Admission,
) -> Result<NewAccount, AppError> {
    record_privacy_event(
        tx,
        user.id,
        "account_registered",
        Some(current_terms_version()),
        Some(current_privacy_notice_version()),
        Some(current_kvkk_notice_version()),
    )
    .await?;
    if let Some(server_id) = admission.invited_server_id {
        server_membership::lock_membership(tx, server_id, user.id).await?;
        server_membership::add_member(tx, server_id, user.id).await?;
    }
    Ok(NewAccount {
        user,
        joined_server_id: admission.invited_server_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_registration_modes_and_rejects_unknown_values() {
        assert_eq!(RegistrationMode::parse(None), Ok(RegistrationMode::Open));
        assert_eq!(
            RegistrationMode::parse(Some("  ")),
            Ok(RegistrationMode::Open)
        );
        assert_eq!(
            RegistrationMode::parse(Some("open")),
            Ok(RegistrationMode::Open)
        );
        assert_eq!(
            RegistrationMode::parse(Some(" invite ")),
            Ok(RegistrationMode::Invite)
        );
        assert_eq!(
            RegistrationMode::parse(Some("closed")),
            Ok(RegistrationMode::Closed)
        );
        for value in ["Closed", "invite-only", "off", "true"] {
            assert!(RegistrationMode::parse(Some(value)).is_err(), "{value}");
        }
        for mode in [
            RegistrationMode::Open,
            RegistrationMode::Invite,
            RegistrationMode::Closed,
        ] {
            assert_eq!(RegistrationMode::parse(Some(mode.as_str())), Ok(mode));
        }
    }

    #[test]
    fn reads_the_invite_code_from_an_in_app_redirect() {
        assert_eq!(invite_code_from_redirect("/invite/AbC123"), Some("AbC123"));
        assert_eq!(invite_code_from_redirect("/invite/AbC123/"), Some("AbC123"));
        assert_eq!(
            invite_code_from_redirect("/invite/AbC_1-2?x=1#top"),
            Some("AbC_1-2")
        );
        for path in [
            "/",
            "/servers",
            "/invite",
            "/invite/",
            "/invite/a/b",
            "/invite/has space",
            "/app/invite/AbC123",
            "invite/AbC123",
        ] {
            assert_eq!(invite_code_from_redirect(path), None, "{path}");
        }
        assert_eq!(
            invite_code_from_redirect(&format!("/invite/{}", "a".repeat(33))),
            None
        );
    }
}
