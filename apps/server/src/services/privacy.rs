use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;

pub const CURRENT_TERMS_VERSION: &str = "2026-08-23";
pub const CURRENT_PRIVACY_NOTICE_VERSION: &str = "2026-08-23";
pub const CURRENT_KVKK_NOTICE_VERSION: &str = "2026-08-23";
pub const DATA_EXPORT_MESSAGE_LIMIT: i64 = 20_000;
pub const DATA_EXPORT_REAUTH_MAX_AGE_SECS: usize = 10 * 60;
pub const DATA_EXPORT_MAX_ARCHIVE_BYTES: i64 = 256 * 1024 * 1024;

pub fn validate_current_legal_documents(
    terms_accepted: bool,
    terms_version: &str,
    privacy_notice_acknowledged: bool,
    privacy_notice_version: &str,
    kvkk_notice_acknowledged: bool,
    kvkk_notice_version: &str,
) -> Result<(), AppError> {
    if !terms_accepted || terms_version != CURRENT_TERMS_VERSION {
        return Err(AppError::Validation(
            "The current Terms of Service must be accepted".into(),
        ));
    }
    if !privacy_notice_acknowledged || privacy_notice_version != CURRENT_PRIVACY_NOTICE_VERSION {
        return Err(AppError::Validation(
            "The current Privacy Notice must be acknowledged".into(),
        ));
    }
    if !kvkk_notice_acknowledged || kvkk_notice_version != CURRENT_KVKK_NOTICE_VERSION {
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
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .fetch_one(db)
    .await?;
    Ok(current)
}

pub async fn legal_consent_for_token_version(
    db: &PgPool,
    user_id: Uuid,
    token_version: i64,
) -> Result<Option<bool>, AppError> {
    let current = sqlx::query_scalar::<_, bool>(
        r#"SELECT COALESCE(
               terms_version = $3
               AND terms_accepted_at IS NOT NULL
               AND privacy_notice_version = $4
               AND privacy_notice_acknowledged_at IS NOT NULL
               AND kvkk_notice_version = $5
               AND kvkk_notice_acknowledged_at IS NOT NULL,
               FALSE
           )
           FROM users
           WHERE id = $1 AND token_version = $2"#,
    )
    .bind(user_id)
    .bind(token_version)
    .bind(CURRENT_TERMS_VERSION)
    .bind(CURRENT_PRIVACY_NOTICE_VERSION)
    .bind(CURRENT_KVKK_NOTICE_VERSION)
    .fetch_optional(db)
    .await?;
    Ok(current)
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
            CURRENT_TERMS_VERSION,
            true,
            CURRENT_PRIVACY_NOTICE_VERSION,
            true,
            CURRENT_KVKK_NOTICE_VERSION,
        )
        .is_ok());

        assert!(validate_current_legal_documents(
            true,
            CURRENT_TERMS_VERSION,
            true,
            CURRENT_PRIVACY_NOTICE_VERSION,
            false,
            CURRENT_KVKK_NOTICE_VERSION,
        )
        .is_err());

        assert!(validate_current_legal_documents(
            true,
            "outdated",
            true,
            CURRENT_PRIVACY_NOTICE_VERSION,
            true,
            CURRENT_KVKK_NOTICE_VERSION,
        )
        .is_err());
    }
}
