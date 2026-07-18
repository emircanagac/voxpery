use axum::{
    http::{HeaderName, HeaderValue},
    response::Response,
};

const CONTENT_SECURITY_POLICY: &str =
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const PERMISSIONS_POLICY: &str =
    "camera=(), microphone=(), display-capture=(), geolocation=(), payment=()";

pub async fn apply(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        HeaderName::from_static("strict-transport-security"),
        HeaderValue::from_static("max-age=31536000"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(PERMISSIONS_POLICY),
    );
    response
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::StatusCode, response::Response};

    use super::*;

    #[tokio::test]
    async fn applies_the_api_security_header_contract() {
        let response = apply(
            Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        let headers = response.headers();

        assert_eq!(headers["x-frame-options"], "DENY");
        assert_eq!(headers["x-content-type-options"], "nosniff");
        assert_eq!(headers["referrer-policy"], "no-referrer");
        assert!(headers["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        assert!(headers["permissions-policy"]
            .to_str()
            .unwrap()
            .contains("microphone=()"));
    }
}
