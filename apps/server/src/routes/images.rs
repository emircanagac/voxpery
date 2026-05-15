use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::{ConnectInfo, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    routing::get,
    Extension, Router,
};
use futures::StreamExt;
use reqwest::redirect::Policy;
use serde::Deserialize;
use tokio::net::lookup_host;

use crate::{
    errors::AppError,
    services::{
        avatar_images::{
            is_allowed_avatar_content_type, is_private_or_local_ip, validate_external_image_url,
            AVATAR_PROXY_CACHE_CONTROL, MAX_REMOTE_IMAGE_PROXY_BYTES,
        },
        rate_limit::enforce_rate_limit,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
struct ImageProxyQuery {
    url: String,
}

pub fn router(state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/avatar", get(proxy_avatar))
        .route("/remote", get(proxy_remote_image))
        .with_state(state)
}

fn client_ip(connect_info: Option<&Extension<ConnectInfo<SocketAddr>>>) -> String {
    connect_info
        .map(|Extension(ConnectInfo(addr))| addr.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

async fn ensure_resolved_host_is_public(host: &str, port: u16) -> Result<(), AppError> {
    let addrs = lookup_host((host, port))
        .await
        .map_err(|_| AppError::Validation("Image URL host could not be resolved".into()))?;

    let resolved: Vec<IpAddr> = addrs.map(|addr| addr.ip()).collect();
    if resolved.is_empty() {
        return Err(AppError::Validation(
            "Image URL host could not be resolved".into(),
        ));
    }

    if resolved.iter().any(is_private_or_local_ip) {
        return Err(AppError::Validation(
            "Image URL cannot resolve to local or private network addresses".into(),
        ));
    }

    Ok(())
}

async fn proxy_avatar(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    Query(query): Query<ImageProxyQuery>,
) -> Result<Response, AppError> {
    proxy_remote_image_with_label(state, connect_info, query, "Avatar").await
}

async fn proxy_remote_image(
    State(state): State<Arc<AppState>>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    Query(query): Query<ImageProxyQuery>,
) -> Result<Response, AppError> {
    proxy_remote_image_with_label(state, connect_info, query, "Image").await
}

async fn proxy_remote_image_with_label(
    state: Arc<AppState>,
    connect_info: Option<Extension<ConnectInfo<SocketAddr>>>,
    query: ImageProxyQuery,
    label: &'static str,
) -> Result<Response, AppError> {
    enforce_rate_limit(
        &state.redis,
        format!(
            "image_proxy:{}:{}",
            label.to_ascii_lowercase(),
            client_ip(connect_info.as_ref())
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
    ensure_resolved_host_is_public(host, port).await?;

    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| AppError::Internal(format!("Avatar proxy client build failed: {e}")))?;

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

    #[tokio::test]
    async fn rejects_private_dns_resolution() {
        let err = ensure_resolved_host_is_public("localhost", 443)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
