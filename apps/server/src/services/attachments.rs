//! Attachment URL validation to prevent XSS (javascript:, data:, etc.) in message attachments.
//! Allows http/https URLs and safe base64 data: URLs (images, video, audio, pdf, text/plain).

use serde_json::Value;

use crate::errors::AppError;

const MAX_URL_LEN: usize = 2048;
/// Base64-encoded files can be large; 12 MB covers the frontend's 8 MB file limit + ~33% base64 overhead.
const MAX_DATA_URL_LEN: usize = 12 * 1024 * 1024;
const MAX_ATTACHMENTS: usize = 10;

/// Validates the attachments JSON before persisting. Rejects any attachment with a URL
/// that could lead to XSS (e.g. javascript:, dangerous data: MIME types) or that is not http(s) or safe data:.
/// Returns Ok(()) if valid; Err(AppError::Validation(...)) otherwise.
pub fn validate_attachments(attachments: Option<&Value>) -> Result<(), AppError> {
    let Some(att) = attachments else {
        return Ok(());
    };
    let arr = match att.as_array() {
        Some(a) => a,
        None => return Err(AppError::Validation("Attachments must be an array".into())),
    };
    if arr.len() > MAX_ATTACHMENTS {
        return Err(AppError::Validation(format!(
            "At most {} attachments allowed",
            MAX_ATTACHMENTS
        )));
    }
    for (i, item) in arr.iter().enumerate() {
        let obj = item.as_object().ok_or_else(|| {
            AppError::Validation(format!("Attachment {} must be an object", i + 1))
        })?;
        let url = obj
            .get("url")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Validation(format!("Attachment {} must have a 'url' string", i + 1)))?;
        validate_attachment_url(url).map_err(|e| {
            AppError::Validation(format!("Attachment {}: {}", i + 1, e))
        })?;
    }
    Ok(())
}

fn validate_attachment_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".into());
    }
    let lower = trimmed.to_lowercase();

    // data: URLs use a much larger limit to accommodate base64-encoded files.
    if let Some(rest) = lower.strip_prefix("data:") {
        if trimmed.len() > MAX_DATA_URL_LEN {
            return Err(format!(
                "Attachment file is too large (max {} MB)",
                MAX_DATA_URL_LEN / (1024 * 1024)
            ));
        }
        // Extract the MIME type (the part between "data:" and ";" or ",")
        let mime = rest.split(';').next().unwrap_or("").split(',').next().unwrap_or("").trim();

        // Block dangerous MIME types that can execute scripts
        const BLOCKED_MIMES: &[&str] = &[
            "text/html",
            "text/javascript",
            "application/javascript",
            "application/x-javascript",
            "application/xhtml+xml",
            "image/svg+xml", // SVG can contain inline scripts
            "text/xml",
            "application/xml",
        ];
        for blocked in BLOCKED_MIMES {
            if mime == *blocked {
                return Err(format!("data: URL MIME type '{}' is not allowed", mime));
            }
        }

        // Allowlist of safe MIME type prefixes
        const ALLOWED_MIMES: &[&str] = &[
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/webp",
            "image/bmp",
            "image/ico",
            "image/x-icon",
            "image/tiff",
            "image/avif",
            "video/mp4",
            "video/webm",
            "video/ogg",
            "audio/mpeg",
            "audio/mp3",
            "audio/ogg",
            "audio/wav",
            "audio/webm",
            "audio/aac",
            "application/pdf",
            "application/zip",
            "application/octet-stream",
            "text/plain",
        ];
        if !ALLOWED_MIMES.iter().any(|allowed| mime.starts_with(allowed)) {
            return Err(format!("data: URL MIME type '{}' is not permitted", mime));
        }
        return Ok(());
    }

    // For all other URLs: only allow http/https, with a reasonable length limit
    if trimmed.len() > MAX_URL_LEN {
        return Err(format!("URL must be at most {} characters", MAX_URL_LEN));
    }
    const BLOCKED_SCHEMES: &[&str] = &[
        "javascript:",
        "vbscript:",
        "file:",
        "blob:",
        "content:",
    ];
    for scheme in BLOCKED_SCHEMES {
        if lower.starts_with(scheme) {
            return Err("URL scheme not allowed for attachments".into());
        }
    }
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("Attachment URL must use https:// or http://".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_urls() {
        let v = serde_json::json!([{ "url": "https://example.com/file.png" }]);
        assert!(validate_attachments(Some(&v)).is_ok());
    }

    #[test]
    fn allows_http_urls() {
        let v = serde_json::json!([{ "url": "http://localhost/foo" }]);
        assert!(validate_attachments(Some(&v)).is_ok());
    }

    #[test]
    fn allows_image_data_url() {
        let v = serde_json::json!([{ "url": "data:image/png;base64,iVBORw0KGgo=" }]);
        assert!(validate_attachments(Some(&v)).is_ok());
    }

    #[test]
    fn allows_jpeg_data_url() {
        let v = serde_json::json!([{ "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }]);
        assert!(validate_attachments(Some(&v)).is_ok());
    }

    #[test]
    fn rejects_html_data_url() {
        let v = serde_json::json!([{ "url": "data:text/html,<script>alert(1)</script>" }]);
        assert!(validate_attachments(Some(&v)).is_err());
    }

    #[test]
    fn rejects_svg_data_url() {
        let v = serde_json::json!([{ "url": "data:image/svg+xml,<svg><script>alert(1)</script></svg>" }]);
        assert!(validate_attachments(Some(&v)).is_err());
    }

    #[test]
    fn rejects_javascript() {
        let v = serde_json::json!([{ "url": "javascript:alert(1)" }]);
        assert!(validate_attachments(Some(&v)).is_err());
    }

    #[test]
    fn rejects_empty_array_items_without_url() {
        let v = serde_json::json!([{}]);
        assert!(validate_attachments(Some(&v)).is_err());
    }

    #[test]
    fn allows_none() {
        assert!(validate_attachments(None).is_ok());
    }
}
