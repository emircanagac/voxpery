use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Application-level error types.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Authentication required")]
    Unauthorized,

    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("User already exists")]
    UserAlreadyExists,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Too many requests: {0}")]
    TooManyRequests(String),

    #[error("Feature disabled: {0}")]
    FeatureDisabled(String),

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message, code) = match &self {
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string(), None),
            AppError::InvalidCredentials => (StatusCode::UNAUTHORIZED, self.to_string(), None),
            AppError::UserAlreadyExists => (StatusCode::CONFLICT, self.to_string(), None),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone(), None),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone(), None),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone(), None),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone(), None),
            AppError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, msg.clone(), None),
            AppError::FeatureDisabled(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                msg.clone(),
                Some("FEATURE_DISABLED"),
            ),
            AppError::Database(e) => {
                tracing::error!("Database error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                    None,
                )
            }
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                    None,
                )
            }
        };

        let body = if let Some(code) = code {
            Json(json!({
                "error": message,
                "code": code,
            }))
        } else {
            Json(json!({
                "error": message,
            }))
        };

        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_status_codes() {
        let test_cases = [
            (AppError::Unauthorized, StatusCode::UNAUTHORIZED),
            (AppError::InvalidCredentials, StatusCode::UNAUTHORIZED),
            (AppError::UserAlreadyExists, StatusCode::CONFLICT),
            (AppError::NotFound("x".into()), StatusCode::NOT_FOUND),
            (AppError::Forbidden("x".into()), StatusCode::FORBIDDEN),
            (AppError::Validation("x".into()), StatusCode::BAD_REQUEST),
            (AppError::Conflict("x".into()), StatusCode::CONFLICT),
            (
                AppError::TooManyRequests("x".into()),
                StatusCode::TOO_MANY_REQUESTS,
            ),
            (
                AppError::FeatureDisabled("x".into()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
        ];
        for (err, expected) in test_cases {
            let res = err.into_response();
            assert_eq!(res.status(), expected, "AppError variant status");
        }
    }
}
