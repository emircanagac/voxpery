//! Moderation-critical audit log: who did what and when.

use sqlx::PgPool;
use uuid::Uuid;

/// Insert an audit log entry. Caller must provide valid server_id where applicable.
pub async fn log(
    db: &PgPool,
    actor_id: Uuid,
    server_id: Option<Uuid>,
    action: &str,
    resource_type: &str,
    resource_id: Option<Uuid>,
    details: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO audit_log (actor_id, server_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(actor_id)
    .bind(server_id)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(details)
    .execute(db)
    .await?;
    Ok(())
}
