use std::sync::OnceLock;

use reqwest::Url;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;

/// Documents the official hosted service publishes; they must match the web app's
/// `PUBLISHED_LEGAL_VERSION`.
pub const HOSTED_TERMS_VERSION: &str = "2026-11-01";
pub const HOSTED_PRIVACY_NOTICE_VERSION: &str = "2026-11-01";
pub const HOSTED_KVKK_NOTICE_VERSION: &str = "2026-11-01";
/// What a self-hosted server that names no version of its own asks people to acknowledge. It
/// stays fixed: a new hosted document says nothing about that server's operator.
pub const SELF_HOSTED_DEFAULT_LEGAL_VERSION: &str = "2026-10-23";
pub const DATA_EXPORT_MESSAGE_LIMIT: i64 = 20_000;
pub const DATA_EXPORT_REAUTH_MAX_AGE_SECS: usize = 10 * 60;
pub const DATA_EXPORT_MAX_ARCHIVE_BYTES: i64 = 256 * 1024 * 1024;

const HOSTED_API_HOST: &str = "api.voxpery.com";
const HOSTED_WEB_HOST: &str = "voxpery.com";
const MAX_LEGAL_VERSION_LEN: usize = 32;
const MAX_LEGAL_URL_LEN: usize = 2048;

/// The documents people acknowledge on this server. The official service publishes its own; any
/// other server is run by a separate controller, who names theirs with `LEGAL_DOCUMENTS_VERSION`
/// and the `LEGAL_*_URL` variables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegalDocuments {
    pub hosted: bool,
    pub terms_version: String,
    pub privacy_notice_version: String,
    pub kvkk_notice_version: String,
    pub terms_url: Option<String>,
    pub privacy_url: Option<String>,
    pub kvkk_url: Option<String>,
}

impl LegalDocuments {
    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        let host_of = |name: &str| {
            let url = Url::parse(lookup(name)?.trim()).ok()?;
            url.host_str().map(str::to_ascii_lowercase)
        };
        let hosted = host_of("PUBLIC_API_URL").as_deref() == Some(HOSTED_API_HOST)
            || host_of("FRONTEND_URL").as_deref() == Some(HOSTED_WEB_HOST);
        if hosted {
            return Self {
                hosted,
                terms_version: HOSTED_TERMS_VERSION.to_string(),
                privacy_notice_version: HOSTED_PRIVACY_NOTICE_VERSION.to_string(),
                kvkk_notice_version: HOSTED_KVKK_NOTICE_VERSION.to_string(),
                terms_url: None,
                privacy_url: None,
                kvkk_url: None,
            };
        }

        let version = lookup("LEGAL_DOCUMENTS_VERSION")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .filter(|value| {
                let valid = is_valid_legal_version(value);
                if !valid {
                    tracing::warn!("LEGAL_DOCUMENTS_VERSION is invalid and was ignored");
                }
                valid
            })
            .unwrap_or_else(|| SELF_HOSTED_DEFAULT_LEGAL_VERSION.to_string());
        let url = |name: &str| {
            let value = lookup(name)?.trim().to_string();
            if value.is_empty() {
                return None;
            }
            if !is_valid_legal_url(&value) {
                tracing::warn!("{name} is not an http(s) URL and was ignored");
                return None;
            }
            Some(value)
        };
        Self {
            hosted,
            terms_version: version.clone(),
            privacy_notice_version: version.clone(),
            kvkk_notice_version: version,
            terms_url: url("LEGAL_TERMS_URL"),
            privacy_url: url("LEGAL_PRIVACY_URL"),
            kvkk_url: url("LEGAL_KVKK_URL"),
        }
    }
}

fn is_valid_legal_version(value: &str) -> bool {
    value.len() <= MAX_LEGAL_VERSION_LEN
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
}

fn is_valid_legal_url(value: &str) -> bool {
    value.len() <= MAX_LEGAL_URL_LEN
        && Url::parse(value)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

pub fn legal_documents() -> &'static LegalDocuments {
    static DOCUMENTS: OnceLock<LegalDocuments> = OnceLock::new();
    DOCUMENTS.get_or_init(|| LegalDocuments::from_lookup(|name| std::env::var(name).ok()))
}

pub fn current_terms_version() -> &'static str {
    &legal_documents().terms_version
}

pub fn current_privacy_notice_version() -> &'static str {
    &legal_documents().privacy_notice_version
}

pub fn current_kvkk_notice_version() -> &'static str {
    &legal_documents().kvkk_notice_version
}

pub async fn cleanup_expired_google_registrations(db: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM pending_google_registrations WHERE expires_at <= NOW()")
            .execute(db)
            .await?
            .rows_affected(),
    )
}

pub async fn cleanup_expired_desktop_registrations(db: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM pending_desktop_registrations WHERE expires_at <= NOW()")
            .execute(db)
            .await?
            .rows_affected(),
    )
}

pub fn validate_current_legal_documents(
    terms_accepted: bool,
    terms_version: &str,
    privacy_notice_acknowledged: bool,
    privacy_notice_version: &str,
    kvkk_notice_acknowledged: bool,
    kvkk_notice_version: &str,
) -> Result<(), AppError> {
    if !terms_accepted || terms_version != current_terms_version() {
        return Err(AppError::Validation(
            "The current Terms of Service must be accepted".into(),
        ));
    }
    if !privacy_notice_acknowledged || privacy_notice_version != current_privacy_notice_version() {
        return Err(AppError::Validation(
            "The current Privacy Notice must be acknowledged".into(),
        ));
    }
    if !kvkk_notice_acknowledged || kvkk_notice_version != current_kvkk_notice_version() {
        return Err(AppError::Validation(
            "The current KVKK Notice must be acknowledged".into(),
        ));
    }
    Ok(())
}

pub async fn has_current_legal_consent(db: &PgPool, user_id: Uuid) -> Result<bool, AppError> {
    let current = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM users
               WHERE id = $1
                 AND terms_version = $2
                 AND terms_accepted_at IS NOT NULL
                 AND privacy_notice_version = $3
                 AND privacy_notice_acknowledged_at IS NOT NULL
                 AND kvkk_notice_version = $4
                 AND kvkk_notice_acknowledged_at IS NOT NULL
           )"#,
    )
    .bind(user_id)
    .bind(current_terms_version())
    .bind(current_privacy_notice_version())
    .bind(current_kvkk_notice_version())
    .fetch_one(db)
    .await?;
    Ok(current)
}

/// What a session check needs from the account, read in one query.
#[derive(Debug, sqlx::FromRow)]
pub struct SessionAccount {
    pub legal_consent_current: bool,
    pub email_verified: bool,
    pub username: String,
    pub status: String,
}

/// The account behind a token; `None` when it is gone or the token's version is stale.
pub async fn session_account(
    db: &PgPool,
    user_id: Uuid,
    token_version: i64,
) -> Result<Option<SessionAccount>, sqlx::Error> {
    sqlx::query_as::<_, SessionAccount>(
        r#"SELECT COALESCE(
                   terms_version = $3
                   AND terms_accepted_at IS NOT NULL
                   AND privacy_notice_version = $4
                   AND privacy_notice_acknowledged_at IS NOT NULL
                   AND kvkk_notice_version = $5
                   AND kvkk_notice_acknowledged_at IS NOT NULL,
                   FALSE
               ) AS legal_consent_current,
               email_verified,
               username,
               status
           FROM users
           WHERE id = $1 AND token_version = $2"#,
    )
    .bind(user_id)
    .bind(token_version)
    .bind(current_terms_version())
    .bind(current_privacy_notice_version())
    .bind(current_kvkk_notice_version())
    .fetch_optional(db)
    .await
}

pub async fn record_privacy_event(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    event_type: &str,
    terms_version: Option<&str>,
    privacy_notice_version: Option<&str>,
    kvkk_notice_version: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO privacy_audit_log
           (id, user_id, event_type, terms_version, privacy_notice_version,
            kvkk_notice_version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(event_type)
    .bind(terms_version)
    .bind(privacy_notice_version)
    .bind(kvkk_notice_version)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_every_current_legal_document() {
        assert!(validate_current_legal_documents(
            true,
            current_terms_version(),
            true,
            current_privacy_notice_version(),
            true,
            current_kvkk_notice_version(),
        )
        .is_ok());

        assert!(validate_current_legal_documents(
            true,
            current_terms_version(),
            true,
            current_privacy_notice_version(),
            false,
            current_kvkk_notice_version(),
        )
        .is_err());

        assert!(validate_current_legal_documents(
            true,
            "outdated",
            true,
            current_privacy_notice_version(),
            true,
            current_kvkk_notice_version(),
        )
        .is_err());
    }
}

#[cfg(test)]
mod legal_documents_tests {
    use super::*;

    fn documents(values: &[(&str, &str)]) -> LegalDocuments {
        LegalDocuments::from_lookup(|name| {
            values
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        })
    }

    #[test]
    fn the_official_service_uses_its_own_documents_whatever_the_environment_says() {
        for (name, value) in [
            ("PUBLIC_API_URL", "https://api.voxpery.com"),
            ("FRONTEND_URL", "https://voxpery.com/"),
        ] {
            let hosted = documents(&[
                (name, value),
                ("LEGAL_DOCUMENTS_VERSION", "other"),
                ("LEGAL_PRIVACY_URL", "https://example.com/privacy"),
            ]);
            assert!(hosted.hosted);
            assert_eq!(hosted.privacy_notice_version, HOSTED_PRIVACY_NOTICE_VERSION);
            assert_eq!(hosted.privacy_url, None);
        }
    }

    #[test]
    fn a_self_hosted_server_does_not_follow_the_hosted_versions() {
        let unset = documents(&[("PUBLIC_API_URL", "https://chat.example.org")]);
        assert!(!unset.hosted);
        assert_eq!(unset.terms_version, SELF_HOSTED_DEFAULT_LEGAL_VERSION);
        assert_eq!(unset.kvkk_url, None);
    }

    #[test]
    fn a_self_hosted_server_names_its_own_documents() {
        let own = documents(&[
            ("LEGAL_DOCUMENTS_VERSION", " 2027.1 "),
            ("LEGAL_TERMS_URL", "https://chat.example.org/terms"),
            ("LEGAL_PRIVACY_URL", "https://chat.example.org/privacy"),
            ("LEGAL_KVKK_URL", ""),
        ]);
        assert_eq!(own.kvkk_notice_version, "2027.1");
        assert_eq!(
            own.terms_url.as_deref(),
            Some("https://chat.example.org/terms")
        );
        assert_eq!(
            own.privacy_url.as_deref(),
            Some("https://chat.example.org/privacy")
        );
        assert_eq!(own.kvkk_url, None);
    }

    #[test]
    fn unsafe_operator_values_are_ignored() {
        let unsafe_values = documents(&[
            ("LEGAL_DOCUMENTS_VERSION", "<script>"),
            ("LEGAL_TERMS_URL", "javascript:alert(1)"),
            ("LEGAL_PRIVACY_URL", "data:text/html,hi"),
        ]);
        assert_eq!(
            unsafe_values.terms_version,
            SELF_HOSTED_DEFAULT_LEGAL_VERSION
        );
        assert_eq!(unsafe_values.terms_url, None);
        assert_eq!(unsafe_values.privacy_url, None);
    }
}
