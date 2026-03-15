//! Attachment upload, storage, malware scanning, and URL validation.

use std::{path::PathBuf, time::Duration};

use chrono::Datelike;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use uuid::Uuid;

use crate::{config::Config, errors::AppError};

const MAX_URL_LEN: usize = 2048;
const DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE: usize = 10;

#[derive(Clone)]
struct ClamAvConfig {
    enabled: bool,
    host: String,
    port: u16,
    timeout_ms: u64,
    fail_closed: bool,
}

#[derive(Clone)]
pub struct AttachmentService {
    local_dir: PathBuf,
    public_base_url: String,
    key_prefix: String,
    max_file_bytes: usize,
    max_files_per_request: usize,
    allowed_mime_prefixes: Vec<String>,
    scanner: ClamAvConfig,
}

#[derive(Debug, Clone)]
pub struct StoredAttachment {
    pub storage_backend: &'static str,
    pub storage_key: String,
    pub url: String,
    pub original_name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct AttachmentResponseItem {
    pub url: String,
    #[serde(rename = "type")]
    pub content_type: String,
    pub name: String,
    pub size: i64,
    pub sha256: String,
}

impl AttachmentService {
    pub async fn from_config(config: &Config) -> Result<Self, AppError> {
        let key_prefix = config.attachments_key_prefix.trim_matches('/').to_string();
        let key_prefix = if key_prefix.is_empty() {
            "attachments".to_string()
        } else {
            key_prefix
        };
        let max_file_bytes = config.attachments_max_file_bytes;
        let max_files_per_request = config.attachments_max_files_per_request;
        let allowed_mime_prefixes = config
            .attachments_allowed_mime_prefixes
            .iter()
            .map(|v| v.to_ascii_lowercase())
            .collect::<Vec<_>>();

        let scanner = ClamAvConfig {
            enabled: config.attachments_clamav_enabled,
            host: config.attachments_clamav_host.clone(),
            port: config.attachments_clamav_port,
            timeout_ms: config.attachments_clamav_timeout_ms,
            fail_closed: config.attachments_clamav_fail_closed,
        };

        let public_base_url = config
            .attachments_public_base_url
            .clone()
            .or_else(|| config.public_api_url.clone())
            .unwrap_or_else(|| "http://localhost:3001".to_string());
        Self::new_local(
            PathBuf::from(config.attachments_local_dir.clone()),
            key_prefix,
            max_file_bytes,
            max_files_per_request,
            allowed_mime_prefixes,
            scanner,
            public_base_url,
        )
        .await
    }

    pub async fn new_local_for_tests(base_dir: PathBuf) -> Result<Self, AppError> {
        Self::new_local(
            base_dir,
            "attachments".to_string(),
            5 * 1024 * 1024,
            4,
            vec![
                "image/".to_string(),
                "video/".to_string(),
                "audio/".to_string(),
                "application/pdf".to_string(),
                "text/plain".to_string(),
                "application/zip".to_string(),
                "application/octet-stream".to_string(),
            ],
            ClamAvConfig {
                enabled: false,
                host: "clamav".to_string(),
                port: 3310,
                timeout_ms: 5000,
                fail_closed: true,
            },
            "http://localhost:3001".to_string(),
        )
        .await
    }

    async fn new_local(
        local_dir: PathBuf,
        key_prefix: String,
        max_file_bytes: usize,
        max_files_per_request: usize,
        allowed_mime_prefixes: Vec<String>,
        scanner: ClamAvConfig,
        public_base_url: String,
    ) -> Result<Self, AppError> {
        fs::create_dir_all(&local_dir).await.map_err(|e| {
            AppError::Internal(format!("Failed to create attachment directory: {e}"))
        })?;
        let normalized_key_prefix = if key_prefix.trim_matches('/').is_empty() {
            "attachments".to_string()
        } else {
            key_prefix.trim_matches('/').to_string()
        };

        Ok(Self {
            local_dir,
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            key_prefix: normalized_key_prefix,
            max_file_bytes,
            max_files_per_request,
            allowed_mime_prefixes,
            scanner,
        })
    }

    pub fn local_storage_dir(&self) -> Option<PathBuf> {
        Some(self.local_dir.clone())
    }

    pub fn max_files_per_request(&self) -> usize {
        self.max_files_per_request
    }

    pub fn validate_upload_file_meta(
        &self,
        content_type: &str,
        size_bytes: usize,
    ) -> Result<(), AppError> {
        if size_bytes == 0 {
            return Err(AppError::Validation("Attachment cannot be empty".into()));
        }
        if size_bytes > self.max_file_bytes {
            let max_mb = self.max_file_bytes / (1024 * 1024);
            return Err(AppError::Validation(format!(
                "Attachment file is too large (max {max_mb} MB)"
            )));
        }

        let normalized = content_type.trim().to_ascii_lowercase();
        if !self
            .allowed_mime_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
        {
            return Err(AppError::Validation(format!(
                "Attachment type '{content_type}' is not allowed"
            )));
        }

        Ok(())
    }

    pub async fn scan_file_bytes(&self, bytes: &[u8]) -> Result<(), AppError> {
        if !self.scanner.enabled {
            return Ok(());
        }

        match self.scan_with_clamav(bytes).await {
            Ok(ScanResult::Clean) => Ok(()),
            Ok(ScanResult::Infected(signature)) => Err(AppError::Validation(format!(
                "Attachment blocked by malware scanner ({signature})"
            ))),
            Err(err) => {
                tracing::warn!("Attachment malware scan unavailable: {}", err);
                if self.scanner.fail_closed {
                    Err(AppError::Internal(
                        "Attachment scan service unavailable; try again later".into(),
                    ))
                } else {
                    Ok(())
                }
            }
        }
    }

    pub async fn store_file(
        &self,
        original_name: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<StoredAttachment, AppError> {
        self.validate_upload_file_meta(content_type, bytes.len())?;
        self.scan_file_bytes(bytes).await?;

        let now = chrono::Utc::now();
        let safe_name = sanitize_file_name(original_name);
        let object_id = Uuid::new_v4();
        let key = format!(
            "{}/{:04}/{:02}/{}-{}",
            self.key_prefix,
            now.year(),
            now.month(),
            object_id,
            safe_name
        );

        let path = self.local_dir.join(&key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                AppError::Internal(format!("Failed to prepare local upload directory: {e}"))
            })?;
        }
        fs::write(&path, bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write uploaded attachment: {e}")))?;
        let url = format!("{}/uploads/{}", self.public_base_url, key);

        Ok(StoredAttachment {
            storage_backend: "local",
            storage_key: key,
            url,
            original_name: original_name.to_string(),
            content_type: content_type.to_string(),
            size_bytes: bytes.len() as i64,
            sha256: hex_encode(&Sha256::digest(bytes)),
        })
    }

    async fn scan_with_clamav(&self, bytes: &[u8]) -> Result<ScanResult, String> {
        let addr = format!("{}:{}", self.scanner.host, self.scanner.port);
        let mut stream = timeout(
            Duration::from_millis(self.scanner.timeout_ms),
            TcpStream::connect(&addr),
        )
        .await
        .map_err(|_| "ClamAV connect timeout".to_string())?
        .map_err(|e| format!("ClamAV connect failed: {e}"))?;

        timeout(
            Duration::from_millis(self.scanner.timeout_ms),
            stream.write_all(b"zINSTREAM\0"),
        )
        .await
        .map_err(|_| "ClamAV command timeout".to_string())?
        .map_err(|e| format!("ClamAV command write failed: {e}"))?;

        for chunk in bytes.chunks(8192) {
            let len = (chunk.len() as u32).to_be_bytes();
            timeout(
                Duration::from_millis(self.scanner.timeout_ms),
                stream.write_all(&len),
            )
            .await
            .map_err(|_| "ClamAV chunk header timeout".to_string())?
            .map_err(|e| format!("ClamAV chunk header write failed: {e}"))?;
            timeout(
                Duration::from_millis(self.scanner.timeout_ms),
                stream.write_all(chunk),
            )
            .await
            .map_err(|_| "ClamAV chunk write timeout".to_string())?
            .map_err(|e| format!("ClamAV chunk write failed: {e}"))?;
        }

        timeout(
            Duration::from_millis(self.scanner.timeout_ms),
            stream.write_all(&0u32.to_be_bytes()),
        )
        .await
        .map_err(|_| "ClamAV final chunk timeout".to_string())?
        .map_err(|e| format!("ClamAV final chunk write failed: {e}"))?;
        stream
            .flush()
            .await
            .map_err(|e| format!("ClamAV flush failed: {e}"))?;

        let mut response = Vec::with_capacity(128);
        timeout(
            Duration::from_millis(self.scanner.timeout_ms),
            stream.read_to_end(&mut response),
        )
        .await
        .map_err(|_| "ClamAV response timeout".to_string())?
        .map_err(|e| format!("ClamAV response read failed: {e}"))?;

        let text = String::from_utf8_lossy(&response).replace('\0', "");
        let normalized = text.to_ascii_uppercase();
        if normalized.contains("FOUND") {
            let signature = text.trim().to_string();
            return Ok(ScanResult::Infected(signature));
        }
        if normalized.contains("OK") {
            return Ok(ScanResult::Clean);
        }

        Err(format!("Unexpected ClamAV response: {}", text.trim()))
    }
}

enum ScanResult {
    Clean,
    Infected(String),
}

fn sanitize_file_name(input: &str) -> String {
    let fallback = "file.bin".to_string();
    let candidate = input.trim();
    if candidate.is_empty() {
        return fallback;
    }

    let sanitized = candidate
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        fallback
    } else {
        sanitized
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{:02x}", b);
    }
    out
}

/// Validates the attachments JSON before persisting.
/// Rejects unsafe URLs and blocks `data:` URLs to force server-side scanned uploads.
pub fn validate_attachments(attachments: Option<&Value>) -> Result<(), AppError> {
    let Some(att) = attachments else {
        return Ok(());
    };
    let arr = match att.as_array() {
        Some(a) => a,
        None => return Err(AppError::Validation("Attachments must be an array".into())),
    };
    if arr.len() > DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE {
        return Err(AppError::Validation(format!(
            "At most {} attachments allowed",
            DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE
        )));
    }
    for (i, item) in arr.iter().enumerate() {
        let obj = item.as_object().ok_or_else(|| {
            AppError::Validation(format!("Attachment {} must be an object", i + 1))
        })?;
        let url = obj.get("url").and_then(Value::as_str).ok_or_else(|| {
            AppError::Validation(format!("Attachment {} must have a 'url' string", i + 1))
        })?;
        validate_attachment_url(url)
            .map_err(|e| AppError::Validation(format!("Attachment {}: {}", i + 1, e)))?;
    }
    Ok(())
}

fn validate_attachment_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".into());
    }
    let lower = trimmed.to_lowercase();

    if lower.starts_with("data:") {
        return Err("data: URLs are not allowed. Upload files via /api/attachments/upload".into());
    }

    if trimmed.len() > MAX_URL_LEN {
        return Err(format!("URL must be at most {} characters", MAX_URL_LEN));
    }
    const BLOCKED_SCHEMES: &[&str] = &["javascript:", "vbscript:", "file:", "blob:", "content:"];
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
    fn rejects_data_urls() {
        let v = serde_json::json!([{ "url": "data:image/png;base64,iVBORw0KGgo=" }]);
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

    #[test]
    fn sanitizes_filename() {
        assert_eq!(sanitize_file_name("my image?.png"), "my_image_.png");
        assert_eq!(sanitize_file_name(""), "file.bin");
    }
}
