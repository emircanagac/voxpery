use std::{collections::HashSet, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    extract::{ConnectInfo, Query, State},
    http::{header, HeaderMap, HeaderValue},
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Extension, Json, Router,
};
use futures::StreamExt;
use reqwest::redirect::Policy;
use serde::Deserialize;
use tokio::net::lookup_host;

use crate::{
    errors::AppError,
    middleware::auth::{require_auth, Claims},
    services::{
        avatar_images::{
            is_allowed_avatar_content_type, is_private_or_local_ip, validate_external_image_url,
            AVATAR_PROXY_CACHE_CONTROL, MAX_REMOTE_IMAGE_PROXY_BYTES,
        },
        image_proxy_grant,
        rate_limit::enforce_rate_limit,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
struct ImageProxyQuery {
    url: String,
    /// Server-signed grant; the proxy does not serve requests without one.
    grant: Option<String>,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/grant",
            get(get_image_proxy_grant).route_layer(middleware::from_fn_with_state(
                state.clone(),
                require_auth,
            )),
        )
        .route("/avatar", get(proxy_avatar))
        .route("/remote", get(proxy_remote_image))
        .with_state(state)
}

/// GET /api/images/grant — a fresh grant for long-running clients; the session snapshot
/// carries the first one.
async fn get_image_proxy_grant(
    State(state): State<Arc<AppState>>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(image_proxy_grant::current_user_grant(
            &state.jwt_secret,
            claims.sub,
        )),
    )
}

fn has_valid_grant(state: &AppState, query: &ImageProxyQuery) -> bool {
    query.grant.as_deref().is_some_and(|grant| {
        image_proxy_grant::verify(
            &state.jwt_secret,
            grant,
            &query.url,
            chrono::Utc::now().timestamp(),
        )
    })
}

/// Rate-limit identity: behind a trusted reverse proxy this is the forwarded client address,
/// so users do not share one bucket keyed by the proxy's own address.
fn client_ip(
    trusted_proxies: &crate::services::client_ip::TrustedProxySet,
    headers: &HeaderMap,
    connect_info: Option<&Extension<ConnectInfo<SocketAddr>>>,
) -> String {
    crate::services::client_ip::resolve_client_ip(
        headers,
        connect_info.map(|Extension(ConnectInfo(addr))| addr.ip()),
        trusted_proxies,
    )
    .unwrap_or_else(|| "unknown".to_string())
}

fn validate_public_resolved_addrs(
    addrs: impl IntoIterator<Item = SocketAddr>,
) -> Result<Vec<SocketAddr>, AppError> {
    let mut seen = HashSet::new();
    let resolved: Vec<SocketAddr> = addrs
        .into_iter()
        .filter(|addr| seen.insert(*addr))
        .collect();
    if resolved.is_empty() {
        return Err(AppError::Validation(
            "Image URL host could not be resolved".into(),
        ));
    }

    if resolved
        .iter()
        .map(SocketAddr::ip)
        .any(|ip| is_private_or_local_ip(&ip))
    {
        return Err(AppError::Validation(
            "Image URL cannot resolve to local or private network addresses".into(),
        ));
    }

    Ok(resolved)
}

async fn resolve_public_host_addrs(host: &str, port: u16) -> Result<Vec<SocketAddr>, AppError> {
    let addrs = lookup_host((host, port))
        .await
        .map_err(|_| AppError::Validation("Image URL host could not be resolved".into()))?;

    validate_public_resolved_addrs(addrs)
}

fn build_pinned_image_proxy_client(
    host: &str,
    resolved_addrs: &[SocketAddr],
) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(6))
        .no_proxy()
        .resolve_to_addrs(host, resolved_addrs)
        .build()
        .map_err(|e| AppError::Internal(format!("Image proxy client build failed: {e}")))
}

async fn proxy_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    Query(query): Query<ImageProxyQuery>,
) -> Result<Response, AppError> {
    proxy_remote_image_with_label(state, headers, connect_info, query, "Avatar").await
}

async fn proxy_remote_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    Query(query): Query<ImageProxyQuery>,
) -> Result<Response, AppError> {
    proxy_remote_image_with_label(state, headers, connect_info, query, "Image").await
}

async fn proxy_remote_image_with_label(
    state: Arc<AppState>,
    headers: HeaderMap,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    query: ImageProxyQuery,
    label: &'static str,
) -> Result<Response, AppError> {
    // Only addresses this server signed are fetched, so the proxy is not an open image fetcher.
    if !has_valid_grant(&state, &query) {
        return Err(AppError::Unauthorized);
    }
    enforce_rate_limit(
        &state.redis,
        format!(
            "image_proxy:{}:{}",
            label.to_ascii_lowercase(),
            client_ip(&state.trusted_proxies, &headers, connect_info.as_ref())
        ),
        120,
        Duration::from_secs(60),
        "Too many image proxy requests. Please wait and try again.",
    )
    .await?;

    let url = validate_external_image_url(&query.url, label)?;
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Validation(format!("{label} URL must include a host")))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let resolved_addrs = resolve_public_host_addrs(host, port).await?;

    let client = build_pinned_image_proxy_client(host, &resolved_addrs)?;

    let upstream = client
        .get(url)
        .header(header::USER_AGENT, "VoxperyImageProxy/1.0")
        .send()
        .await
        .map_err(|_| AppError::NotFound("Image unavailable".into()))?;

    if !upstream.status().is_success() {
        return Err(AppError::NotFound("Image unavailable".into()));
    }

    if upstream
        .content_length()
        .is_some_and(|len| len > MAX_REMOTE_IMAGE_PROXY_BYTES as u64)
    {
        return Err(AppError::Validation("Image is too large".into()));
    }

    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !is_allowed_avatar_content_type(&content_type) {
        return Err(AppError::Validation(
            "URL must return a supported image type".into(),
        ));
    }

    let mut body = Vec::new();
    let mut stream = upstream.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::NotFound("Image unavailable".into()))?;
        if body.len().saturating_add(chunk.len()) > MAX_REMOTE_IMAGE_PROXY_BYTES {
            return Err(AppError::Validation("Image is too large".into()));
        }
        body.extend_from_slice(&chunk);
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(AVATAR_PROXY_CACHE_CONTROL),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    Ok((headers, body).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limits_each_client_behind_a_trusted_proxy_separately() {
        use crate::services::client_ip::TrustedProxySet;
        let trusted = TrustedProxySet::parse(Some("10.0.0.0/8")).unwrap();
        let proxy = Extension(ConnectInfo("10.0.0.2:443".parse::<SocketAddr>().unwrap()));
        let forwarded = |ip: &str| {
            let mut headers = HeaderMap::new();
            headers.insert("x-forwarded-for", HeaderValue::from_str(ip).unwrap());
            headers
        };
        assert_eq!(client_ip(&trusted, &forwarded("203.0.113.5"), Some(&proxy)), "203.0.113.5");
        assert_eq!(client_ip(&trusted, &forwarded("198.51.100.7"), Some(&proxy)), "198.51.100.7");
        // Without a trusted proxy the forwarded header is ignored.
        let direct = Extension(ConnectInfo("192.0.2.9:443".parse::<SocketAddr>().unwrap()));
        assert_eq!(client_ip(&trusted, &forwarded("203.0.113.5"), Some(&direct)), "192.0.2.9");
    }

    #[tokio::test]
    async fn rejects_private_dns_resolution() {
        let err = resolve_public_host_addrs("localhost", 443)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn rejects_mixed_private_and_public_resolved_addrs() {
        let addrs = [
            SocketAddr::from(([93, 184, 216, 34], 443)),
            SocketAddr::from(([127, 0, 0, 1], 443)),
        ];

        let err = validate_public_resolved_addrs(addrs).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn keeps_unique_public_resolved_addrs() {
        let addr = SocketAddr::from(([93, 184, 216, 34], 443));
        let resolved = validate_public_resolved_addrs([addr, addr]).unwrap();
        assert_eq!(resolved, vec![addr]);
    }

    #[test]
    fn builds_proxy_client_with_pinned_public_addrs() {
        let addrs = [SocketAddr::from(([93, 184, 216, 34], 443))];
        let client = build_pinned_image_proxy_client("example.com", &addrs);
        assert!(client.is_ok());
    }
}
