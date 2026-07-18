use sqlx::{Postgres, Transaction};

use crate::errors::AppError;

const MAX_CLIENT_REQUEST_ID_LEN: usize = 128;

pub fn normalize_client_request_id(value: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_CLIENT_REQUEST_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(AppError::Validation(
            "client_request_id must be 1-128 URL-safe characters".into(),
        ));
    }
    Ok(Some(value.to_owned()))
}

pub async fn acquire_transaction_lock(
    tx: &mut Transaction<'_, Postgres>,
    lock_key: &str,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(lock_key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_client_request_ids() {
        assert_eq!(
            normalize_client_request_id(Some("request_123:retry-1")).unwrap(),
            Some("request_123:retry-1".into())
        );
    }

    #[test]
    fn rejects_empty_oversized_and_unsafe_client_request_ids() {
        assert!(normalize_client_request_id(Some(" ")).is_err());
        assert!(normalize_client_request_id(Some(&"a".repeat(129))).is_err());
        assert!(normalize_client_request_id(Some("request/123")).is_err());
    }
}
