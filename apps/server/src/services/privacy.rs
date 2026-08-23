use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;

pub const CURRENT_TERMS_VERSION: &str = "2026-08-23";
pub const CURRENT_PRIVACY_NOTICE_VERSION: &str = "2026-08-23";
pub const DATA_EXPORT_MESSAGE_LIMIT: i64 = 20_000;
pub const DATA_EXPORT_REAUTH_MAX_AGE_SECS: usize = 10 * 60;
pub const DATA_EXPORT_MAX_ARCHIVE_BYTES: i64 = 256 * 1024 * 1024;

pub fn validate_registration_documents(
    terms_accepted: bool,
    terms_version: &str,
    privacy_notice_acknowledged: bool,
    privacy_notice_version: &str,
) -> Result<(), AppError> {
    if !terms_accepted || terms_version != CURRENT_TERMS_VERSION {
        return Err(AppError::Validation(
            "The current Terms of Service must be accepted before account creation".into(),
        ));
    }
    if !privacy_notice_acknowledged || privacy_notice_version != CURRENT_PRIVACY_NOTICE_VERSION {
        return Err(AppError::Validation(
            "The current Privacy Notice must be acknowledged before account creation".into(),
        ));
    }
    Ok(())
}

pub async fn record_privacy_event(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    event_type: &str,
    terms_version: Option<&str>,
    privacy_notice_version: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO privacy_audit_log
           (id, user_id, event_type, terms_version, privacy_notice_version, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())"#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(event_type)
    .bind(terms_version)
    .bind(privacy_notice_version)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
