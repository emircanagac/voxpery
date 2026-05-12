use std::net::{IpAddr, Ipv4Addr};

use reqwest::Url;

use crate::errors::AppError;

pub const MAX_AVATAR_IMAGE_BYTES: usize = 3_000_000;
pub const AVATAR_PROXY_CACHE_CONTROL: &str = "public, max-age=86400, stale-while-revalidate=604800";

pub fn is_private_or_local_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || *v4 == Ipv4Addr::BROADCAST
                || octets[0] == 0
                || (octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
        }
    }
}

pub fn is_forbidden_avatar_host(host: &str) -> bool {
    let normalized = host.trim().trim_end_matches('.').to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "localhost"
            | "localhost.localdomain"
            | "metadata"
            | "metadata.google.internal"
            | "instance-data"
    ) || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized.ends_with(".internal")
}

pub fn validate_external_avatar_url(raw: &str) -> Result<Url, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Avatar URL cannot be empty".into()));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|_| AppError::Validation("Avatar must be a valid HTTPS image URL".into()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Validation(
            "Avatar image URLs must use https://".into(),
        ));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Validation("Avatar URL must include a host".into()))?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_local_ip(&ip) {
            return Err(AppError::Validation(
                "Avatar URL cannot point to local or private network addresses".into(),
            ));
        }
    } else if is_forbidden_avatar_host(host) {
        return Err(AppError::Validation(
            "Avatar URL host is not allowed".into(),
        ));
    }

    Ok(parsed)
}

pub fn validate_profile_avatar_url(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Avatar URL cannot be empty".into()));
    }
    if trimmed.len() > MAX_AVATAR_IMAGE_BYTES {
        return Err(AppError::Validation("Avatar image is too large".into()));
    }
    if trimmed
        .to_ascii_lowercase()
        .starts_with("data:image/svg+xml")
    {
        return Err(AppError::Validation(
            "SVG images are not allowed for avatars (security)".into(),
        ));
    }
    if trimmed.starts_with("data:image/") {
        return Ok(trimmed.to_string());
    }

    validate_external_avatar_url(trimmed)?;
    Ok(trimmed.to_string())
}

pub fn is_allowed_avatar_content_type(content_type: &str) -> bool {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    matches!(
        media_type.as_str(),
        "image/jpeg" | "image/png" | "image/gif" | "image/webp"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_external_https_avatar_urls() {
        assert!(validate_external_avatar_url("https://example.com/avatar.png").is_ok());
        assert!(validate_external_avatar_url("http://example.com/avatar.png").is_err());
        assert!(validate_external_avatar_url("https://localhost/avatar.png").is_err());
        assert!(validate_external_avatar_url("https://127.0.0.1/avatar.png").is_err());
        assert!(
            validate_external_avatar_url("https://metadata.google.internal/avatar.png").is_err()
        );
    }

    #[test]
    fn validates_profile_avatar_data_urls() {
        assert!(validate_profile_avatar_url("data:image/png;base64,abc").is_ok());
        assert!(validate_profile_avatar_url("data:image/svg+xml;base64,abc").is_err());
    }

    #[test]
    fn validates_proxy_content_types() {
        assert!(is_allowed_avatar_content_type("image/png"));
        assert!(is_allowed_avatar_content_type("image/jpeg; charset=binary"));
        assert!(is_allowed_avatar_content_type("image/webp"));
        assert!(!is_allowed_avatar_content_type("image/svg+xml"));
        assert!(!is_allowed_avatar_content_type("text/html"));
    }
}
