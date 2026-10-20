use std::net::{IpAddr, Ipv4Addr};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::Url;

use crate::errors::AppError;

pub const MAX_REMOTE_IMAGE_PROXY_BYTES: usize = 3_000_000;
pub const MAX_STORED_IMAGE_DATA_URL_BYTES: usize = 1_000_000;
pub const AVATAR_PROXY_CACHE_CONTROL: &str = "public, max-age=86400, stale-while-revalidate=604800";

pub fn is_private_or_local_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_or_local_ipv4(v4),
        IpAddr::V6(v6) => {
            // IPv6 forms that carry an IPv4 address reach that IPv4 host, so apply the IPv4
            // rules to it: IPv4-mapped/-compatible (::ffff:a.b.c.d, ::a.b.c.d), NAT64
            // (64:ff9b::/96) and 6to4 (2002::/16).
            if let Some(v4) = embedded_ipv4(v6) {
                if is_private_or_local_ipv4(&v4) {
                    return true;
                }
            }
            let segments = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
                // Site-local (deprecated), documentation and Teredo ranges.
                || (segments[0] & 0xffc0) == 0xfec0
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                || (segments[0] == 0x2001 && segments[1] == 0x0000)
        }
    }
}

fn is_private_or_local_ipv4(v4: &Ipv4Addr) -> bool {
    let octets = v4.octets();
    v4.is_private()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_multicast()
        || v4.is_unspecified()
        || v4.is_documentation()
        || *v4 == Ipv4Addr::BROADCAST
        || octets[0] == 0
        || octets[0] >= 240
        || (octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
}

fn embedded_ipv4(v6: &std::net::Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = v6.segments();
    let from_segments = |high: u16, low: u16| {
        Ipv4Addr::new((high >> 8) as u8, high as u8, (low >> 8) as u8, low as u8)
    };
    if let Some(v4) = v6.to_ipv4_mapped() {
        return Some(v4);
    }
    // IPv4-compatible ::a.b.c.d (the loopback/unspecified forms are handled as IPv6).
    if segments[..6].iter().all(|segment| *segment == 0)
        && !v6.is_loopback()
        && !v6.is_unspecified()
    {
        return Some(from_segments(segments[6], segments[7]));
    }
    if segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2..6].iter().all(|s| *s == 0) {
        return Some(from_segments(segments[6], segments[7]));
    }
    if segments[0] == 0x2002 {
        return Some(from_segments(segments[1], segments[2]));
    }
    None
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

pub fn validate_external_image_url(raw: &str, label: &str) -> Result<Url, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} URL cannot be empty")));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|_| AppError::Validation(format!("{label} must be a valid HTTPS image URL")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Validation(format!(
            "{label} image URLs must use https://"
        )));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Validation(format!("{label} URL must include a host")))?;
    // IPv6 literals keep their brackets in host_str ("[::1]").
    let literal_ip = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<IpAddr>();
    if let Ok(ip) = literal_ip {
        if is_private_or_local_ip(&ip) {
            return Err(AppError::Validation(format!(
                "{label} URL cannot point to local or private network addresses"
            )));
        }
    } else if is_forbidden_avatar_host(host) {
        return Err(AppError::Validation(format!(
            "{label} URL host is not allowed"
        )));
    }

    Ok(parsed)
}

pub fn validate_external_avatar_url(raw: &str) -> Result<Url, AppError> {
    validate_external_image_url(raw, "Avatar")
}

pub fn validate_stored_image_url(raw: &str, label: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} URL cannot be empty")));
    }
    if trimmed
        .to_ascii_lowercase()
        .starts_with("data:image/svg+xml")
    {
        return Err(AppError::Validation(format!(
            "SVG images are not allowed for {label}s (security)"
        )));
    }
    if trimmed.starts_with("data:image/") {
        if trimmed.len() > MAX_STORED_IMAGE_DATA_URL_BYTES {
            return Err(AppError::Validation(format!("{label} image is too large")));
        }
        return Ok(trimmed.to_string());
    }

    validate_external_image_url(trimmed, label)?;
    Ok(trimmed.to_string())
}

pub fn validate_profile_avatar_url(raw: &str) -> Result<String, AppError> {
    validate_stored_image_url(raw, "Avatar")
}

pub fn validate_server_icon_image_url(raw: &str) -> Result<String, AppError> {
    validate_stored_image_url(raw, "Server icon")
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

const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// True when `bytes` start with the signature of `media_type`, so a stored image is only ever
/// served as the type its content actually has.
fn has_image_signature(media_type: &str, bytes: &[u8]) -> bool {
    match media_type {
        "image/png" => bytes.starts_with(PNG_SIGNATURE),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Decodes a stored `data:` image URL into its media type and bytes. Anything that is not a
/// base64 PNG, JPEG, GIF or WebP whose content matches its declared type is refused.
pub fn decode_stored_image_data_url(raw: &str) -> Option<(&'static str, Vec<u8>)> {
    let raw = raw.trim();
    if raw.len() > MAX_STORED_IMAGE_DATA_URL_BYTES {
        return None;
    }
    let (mime, encoded) = raw.strip_prefix("data:")?.split_once(";base64,")?;
    let media_type = match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => "image/png",
        "image/jpeg" | "image/jpg" => "image/jpeg",
        "image/gif" => "image/gif",
        "image/webp" => "image/webp",
        _ => return None,
    };
    let bytes = BASE64.decode(encoded.trim().as_bytes()).ok()?;
    has_image_signature(media_type, &bytes).then_some((media_type, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_only_stored_images_whose_content_matches_their_type() {
        let png = [PNG_SIGNATURE, b"rest"].concat();
        let url = format!("data:image/png;base64,{}", BASE64.encode(&png));
        assert_eq!(
            decode_stored_image_data_url(&url),
            Some(("image/png", png.clone()))
        );

        let webp = [b"RIFF".as_slice(), &[0, 0, 0, 0], b"WEBPVP8 "].concat();
        let url = format!("data:image/webp;base64,{}", BASE64.encode(&webp));
        assert_eq!(
            decode_stored_image_data_url(&url).map(|(media_type, _)| media_type),
            Some("image/webp")
        );

        // Declared type and content disagree, unsupported types and broken base64 are refused.
        let mislabeled = format!("data:image/jpeg;base64,{}", BASE64.encode(&png));
        assert_eq!(decode_stored_image_data_url(&mislabeled), None);
        let html = format!("data:text/html;base64,{}", BASE64.encode(b"<script>"));
        assert_eq!(decode_stored_image_data_url(&html), None);
        let svg = format!("data:image/svg+xml;base64,{}", BASE64.encode(b"<svg/>"));
        assert_eq!(decode_stored_image_data_url(&svg), None);
        assert_eq!(
            decode_stored_image_data_url("data:image/png;base64,***"),
            None
        );
        assert_eq!(
            decode_stored_image_data_url("https://example.com/a.png"),
            None
        );
    }

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
    fn rejects_private_ipv4_embedded_in_ipv6() {
        for blocked in [
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:192.168.1.10",
            "::127.0.0.1",
            "64:ff9b::a9fe:a9fe",
            "2002:7f00:1::1",
            "2001:db8::1",
            "fec0::1",
        ] {
            let ip: IpAddr = blocked.parse().unwrap();
            assert!(is_private_or_local_ip(&ip), "{blocked} must be blocked");
        }
        for public in [
            "::ffff:8.8.8.8",
            "2606:4700:4700::1111",
            "8.8.8.8",
            "64:ff9b::808:808",
        ] {
            let ip: IpAddr = public.parse().unwrap();
            assert!(!is_private_or_local_ip(&ip), "{public} must stay allowed");
        }
    }

    #[test]
    fn rejects_private_ipv6_literal_urls() {
        assert!(validate_external_avatar_url("https://[::1]/avatar.png").is_err());
        assert!(validate_external_avatar_url("https://[::ffff:127.0.0.1]/avatar.png").is_err());
        assert!(validate_external_avatar_url("https://[::ffff:a9fe:a9fe]/avatar.png").is_err());
        assert!(validate_external_avatar_url("https://[2606:4700:4700::1111]/avatar.png").is_ok());
    }

    #[test]
    fn validates_profile_avatar_data_urls() {
        assert!(validate_profile_avatar_url("data:image/png;base64,abc").is_ok());
        assert!(validate_profile_avatar_url("data:image/svg+xml;base64,abc").is_err());
    }

    #[test]
    fn rejects_oversized_stored_data_urls() {
        let large = format!(
            "data:image/png;base64,{}",
            "a".repeat(MAX_STORED_IMAGE_DATA_URL_BYTES)
        );
        assert!(validate_profile_avatar_url(&large).is_err());
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
