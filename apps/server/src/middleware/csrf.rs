use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, Method, Uri},
    middleware::Next,
    response::Response,
};

use crate::errors::AppError;

#[derive(Clone, Debug)]
pub struct CookieCsrfConfig {
    cookie_name: String,
    allowed_origins: Vec<String>,
}

impl CookieCsrfConfig {
    pub fn new(cookie_name: String, allowed_origins: Vec<String>) -> Self {
        Self {
            cookie_name,
            allowed_origins: allowed_origins
                .into_iter()
                .map(|origin| origin.trim().trim_end_matches('/').to_string())
                .filter(|origin| !origin.is_empty())
                .collect(),
        }
    }

    fn allows_origin(&self, origin: &str) -> bool {
        // Opaque origins can be created by sandboxed documents and local files,
        // so they are never sufficient proof for cookie-authenticated writes.
        origin != "null" && self.allowed_origins.iter().any(|allowed| allowed == origin)
    }
}

fn is_safe_method(method: &Method) -> bool {
    matches!(
        *method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    )
}

fn has_bearer_token(headers: &HeaderMap) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|token| !token.trim().is_empty())
}

fn has_named_cookie(headers: &HeaderMap, cookie_name: &str) -> bool {
    let Some(cookie_header) = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let prefix = format!("{cookie_name}=");
    cookie_header.split(';').map(str::trim).any(|part| {
        part.strip_prefix(&prefix)
            .is_some_and(|value| !value.trim().is_empty())
    })
}

fn referer_origin(headers: &HeaderMap) -> Option<String> {
    let referer = headers.get(header::REFERER)?.to_str().ok()?;
    let uri = referer.parse::<Uri>().ok()?;
    let scheme = uri.scheme_str()?;
    let authority = uri.authority()?.as_str();
    Some(format!("{scheme}://{authority}"))
}

fn has_trusted_request_origin(headers: &HeaderMap, config: &CookieCsrfConfig) -> bool {
    if let Some(origin) = headers.get(header::ORIGIN) {
        return origin
            .to_str()
            .ok()
            .is_some_and(|origin| config.allows_origin(origin));
    }

    referer_origin(headers)
        .as_deref()
        .is_some_and(|origin| config.allows_origin(origin))
}

fn validate_request(
    method: &Method,
    headers: &HeaderMap,
    config: &CookieCsrfConfig,
) -> Result<(), AppError> {
    if is_safe_method(method)
        || has_bearer_token(headers)
        || !has_named_cookie(headers, &config.cookie_name)
    {
        return Ok(());
    }

    if has_trusted_request_origin(headers, config) {
        return Ok(());
    }

    Err(AppError::Forbidden("Cross-site request rejected".into()))
}

/// Reject state-changing requests that rely on the web auth cookie unless the
/// browser proves they came from an explicitly allowed origin.
pub async fn protect_cookie_authenticated_writes(
    State(config): State<CookieCsrfConfig>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    validate_request(req.method(), req.headers(), &config)?;
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn config() -> CookieCsrfConfig {
        CookieCsrfConfig::new(
            "voxpery_token".into(),
            vec![
                "https://voxpery.com".into(),
                "http://localhost:5173".into(),
                "null".into(),
            ],
        )
    }

    fn cookie_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("voxpery_token=session-token"),
        );
        headers
    }

    #[test]
    fn rejects_cookie_write_without_origin_proof() {
        assert!(validate_request(&Method::POST, &cookie_headers(), &config()).is_err());
    }

    #[test]
    fn rejects_cookie_write_from_untrusted_or_opaque_origin() {
        for origin in [
            "https://evil.example",
            "https://voxpery.com.evil.example",
            "null",
        ] {
            let mut headers = cookie_headers();
            headers.insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
            assert!(validate_request(&Method::DELETE, &headers, &config()).is_err());
        }
    }

    #[test]
    fn allows_cookie_write_from_allowed_origin_or_referer() {
        let mut origin_headers = cookie_headers();
        origin_headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://voxpery.com"),
        );
        assert!(validate_request(&Method::PATCH, &origin_headers, &config()).is_ok());

        let mut referer_headers = cookie_headers();
        referer_headers.insert(
            header::REFERER,
            HeaderValue::from_static("https://voxpery.com/channels/123"),
        );
        assert!(validate_request(&Method::PUT, &referer_headers, &config()).is_ok());
    }

    #[test]
    fn bearer_auth_and_safe_methods_do_not_require_origin() {
        let mut bearer_headers = cookie_headers();
        bearer_headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer desktop-token"),
        );
        assert!(validate_request(&Method::POST, &bearer_headers, &config()).is_ok());
        assert!(validate_request(&Method::GET, &cookie_headers(), &config()).is_ok());
    }

    #[test]
    fn unauthenticated_public_writes_do_not_require_origin() {
        assert!(validate_request(&Method::POST, &HeaderMap::new(), &config()).is_ok());
    }
}
