//! Attachment upload, storage, malware scanning, and URL validation.

use std::{
    path::{Component, Path, PathBuf},
    time::Duration,
};

use chrono::Datelike;
use hmac::{Hmac, Mac};
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
const DEFAULT_URL_TTL_SECS: u64 = 15 * 60;

type HmacSha256 = Hmac<Sha256>;

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
    url_ttl_secs: u64,
    max_file_bytes: usize,
    max_files_per_request: usize,
    allowed_mime_prefixes: Vec<String>,
    scanner: ClamAvConfig,
}

#[derive(Debug, Clone)]
pub struct StoredAttachment {
    pub storage_backend: &'static str,
    pub storage_key: String,
    pub original_name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct AttachmentResponseItem {
    pub id: Uuid,
    pub url: String,
    #[serde(rename = "type")]
    pub content_type: String,
    pub name: String,
    pub size: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UploadedAttachmentRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub storage_key: String,
    pub original_name: String,
    pub content_type: String,
    pub size_bytes: i64,
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
        let url_ttl_secs = config.attachments_url_ttl_secs.max(60);
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
            url_ttl_secs,
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
            DEFAULT_URL_TTL_SECS,
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
        url_ttl_secs: u64,
        max_file_bytes: usize,
        max_files_per_request: usize,
        allowed_mime_prefixes: Vec<String>,
        scanner: ClamAvConfig,
        public_base_url: String,
    ) -> Result<Self, AppError> {
        fs::create_dir_all(&local_dir).await.map_err(|e| {
            AppError::Internal(format!("Failed to create attachment directory: {e}"))
        })?;
        let normalized_key_prefix = sanitize_storage_key_prefix(&key_prefix);

        Ok(Self {
            local_dir,
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            key_prefix: normalized_key_prefix,
            url_ttl_secs: url_ttl_secs.max(60),
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

    pub fn signed_content_url(&self, attachment_id: Uuid, signing_secret: &str) -> String {
        let exp = chrono::Utc::now().timestamp() + self.url_ttl_secs as i64;
        let sig = compute_signature(signing_secret, attachment_id, exp);
        format!(
            "{}/api/attachments/content/{}?exp={}&sig={}",
            self.public_base_url, attachment_id, exp, sig
        )
    }

    pub fn verify_signed_content_url(
        &self,
        attachment_id: Uuid,
        exp: i64,
        sig_hex: &str,
        signing_secret: &str,
    ) -> bool {
        if exp < chrono::Utc::now().timestamp() {
            return false;
        }
        verify_signature(signing_secret, attachment_id, exp, sig_hex)
    }

    pub async fn normalize_attachments_for_storage(
        &self,
        db: &sqlx::PgPool,
        owner_id: Uuid,
        attachments: Option<&Value>,
    ) -> Result<Option<Value>, AppError> {
        let Some(raw) = attachments else {
            return Ok(None);
        };
        let arr = raw
            .as_array()
            .ok_or_else(|| AppError::Validation("Attachments must be an array".into()))?;
        if arr.len() > DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE {
            return Err(AppError::Validation(format!(
                "At most {} attachments allowed",
                DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE
            )));
        }

        let mut normalized = Vec::with_capacity(arr.len());
        for (idx, item) in arr.iter().enumerate() {
            let obj = item.as_object().ok_or_else(|| {
                AppError::Validation(format!("Attachment {} must be an object", idx + 1))
            })?;

            let attachment_id = obj
                .get("id")
                .and_then(Value::as_str)
                .and_then(|s| Uuid::parse_str(s).ok());
            let source_url = obj.get("url").and_then(Value::as_str);

            let record = if let Some(id) = attachment_id {
                self.find_attachment_by_id_for_owner(db, id, owner_id)
                    .await?
            } else if let Some(url) = source_url {
                if let Some(id) = parse_attachment_id_from_content_url(url) {
                    self.find_attachment_by_id_for_owner(db, id, owner_id)
                        .await?
                } else if let Some(storage_key) = parse_storage_key_from_legacy_upload_url(url) {
                    self.find_attachment_by_storage_key_for_owner(db, &storage_key, owner_id)
                        .await?
                } else {
                    None
                }
            } else {
                None
            };

            let Some(record) = record else {
                return Err(AppError::Validation(format!(
                    "Attachment {} reference is invalid or unavailable",
                    idx + 1
                )));
            };

            normalized.push(serde_json::json!({
                "id": record.id,
                "name": record.original_name,
                "type": record.content_type,
                "size": record.size_bytes,
                "sha256": record.sha256,
            }));
        }

        if normalized.is_empty() {
            Ok(None)
        } else {
            Ok(Some(Value::Array(normalized)))
        }
    }

    pub async fn hydrate_attachments_for_output(
        &self,
        db: &sqlx::PgPool,
        signing_secret: &str,
        attachments: Option<Value>,
    ) -> Result<Option<Value>, AppError> {
        let Some(raw) = attachments else {
            return Ok(None);
        };
        let Some(arr) = raw.as_array() else {
            return Ok(Some(raw));
        };

        let mut hydrated = Vec::with_capacity(arr.len());
        for item in arr {
            let Some(obj) = item.as_object() else {
                hydrated.push(item.clone());
                continue;
            };

            let attachment_id = obj
                .get("id")
                .and_then(Value::as_str)
                .and_then(|s| Uuid::parse_str(s).ok());
            let source_url = obj.get("url").and_then(Value::as_str);

            let record = if let Some(id) = attachment_id {
                self.find_attachment_by_id(db, id).await?
            } else if let Some(url) = source_url {
                if let Some(id) = parse_attachment_id_from_content_url(url) {
                    self.find_attachment_by_id(db, id).await?
                } else if let Some(storage_key) = parse_storage_key_from_legacy_upload_url(url) {
                    self.find_attachment_by_storage_key(db, &storage_key)
                        .await?
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(record) = record {
                hydrated.push(serde_json::json!({
                    "id": record.id,
                    "url": self.signed_content_url(record.id, signing_secret),
                    "type": record.content_type,
                    "name": record.original_name,
                    "size": record.size_bytes,
                    "sha256": record.sha256,
                }));
            } else {
                hydrated.push(item.clone());
            }
        }

        Ok(Some(Value::Array(hydrated)))
    }

    pub async fn get_clean_attachment_by_id(
        &self,
        db: &sqlx::PgPool,
        attachment_id: Uuid,
    ) -> Result<Option<UploadedAttachmentRecord>, AppError> {
        self.find_attachment_by_id(db, attachment_id).await
    }

    pub async fn read_local_attachment_bytes(
        &self,
        storage_key: &str,
    ) -> Result<Vec<u8>, AppError> {
        let path = self.resolve_local_path(storage_key)?;
        fs::read(path)
            .await
            .map_err(|e| AppError::NotFound(format!("Attachment file missing: {e}")))
    }

    async fn find_attachment_by_id_for_owner(
        &self,
        db: &sqlx::PgPool,
        attachment_id: Uuid,
        owner_id: Uuid,
    ) -> Result<Option<UploadedAttachmentRecord>, AppError> {
        let row = sqlx::query_as::<_, UploadedAttachmentRecord>(
            r#"SELECT id, user_id, storage_key, original_name, content_type, size_bytes, sha256
               FROM uploaded_attachments
               WHERE id = $1 AND user_id = $2 AND scan_status = 'clean'
               LIMIT 1"#,
        )
        .bind(attachment_id)
        .bind(owner_id)
        .fetch_optional(db)
        .await?;
        Ok(row)
    }

    async fn find_attachment_by_storage_key_for_owner(
        &self,
        db: &sqlx::PgPool,
        storage_key: &str,
        owner_id: Uuid,
    ) -> Result<Option<UploadedAttachmentRecord>, AppError> {
        let row = sqlx::query_as::<_, UploadedAttachmentRecord>(
            r#"SELECT id, user_id, storage_key, original_name, content_type, size_bytes, sha256
               FROM uploaded_attachments
               WHERE storage_key = $1 AND user_id = $2 AND scan_status = 'clean'
               LIMIT 1"#,
        )
        .bind(storage_key)
        .bind(owner_id)
        .fetch_optional(db)
        .await?;
        Ok(row)
    }

    async fn find_attachment_by_id(
        &self,
        db: &sqlx::PgPool,
        attachment_id: Uuid,
    ) -> Result<Option<UploadedAttachmentRecord>, AppError> {
        let row = sqlx::query_as::<_, UploadedAttachmentRecord>(
            r#"SELECT id, user_id, storage_key, original_name, content_type, size_bytes, sha256
               FROM uploaded_attachments
               WHERE id = $1 AND scan_status = 'clean'
               LIMIT 1"#,
        )
        .bind(attachment_id)
        .fetch_optional(db)
        .await?;
        Ok(row)
    }

    async fn find_attachment_by_storage_key(
        &self,
        db: &sqlx::PgPool,
        storage_key: &str,
    ) -> Result<Option<UploadedAttachmentRecord>, AppError> {
        let row = sqlx::query_as::<_, UploadedAttachmentRecord>(
            r#"SELECT id, user_id, storage_key, original_name, content_type, size_bytes, sha256
               FROM uploaded_attachments
               WHERE storage_key = $1 AND scan_status = 'clean'
               LIMIT 1"#,
        )
        .bind(storage_key)
        .fetch_optional(db)
        .await?;
        Ok(row)
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
        let object_id = Uuid::new_v4();
        let key = format!(
            "{}/{:04}/{:02}/{}",
            self.key_prefix,
            now.year(),
            now.month(),
            object_id
        );

        let path = self.resolve_local_path(&key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                AppError::Internal(format!("Failed to prepare local upload directory: {e}"))
            })?;
        }
        fs::write(&path, bytes)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to write uploaded attachment: {e}")))?;
        Ok(StoredAttachment {
            storage_backend: "local",
            storage_key: key,
            original_name: original_name.to_string(),
            content_type: content_type.to_string(),
            size_bytes: bytes.len() as i64,
            sha256: hex_encode(&Sha256::digest(bytes)),
        })
    }

    fn resolve_local_path(&self, storage_key: &str) -> Result<PathBuf, AppError> {
        validate_storage_key(storage_key)?;
        let joined = self.local_dir.join(storage_key);
        if !joined.starts_with(&self.local_dir) {
            return Err(AppError::Validation(
                "Attachment storage key resolves outside storage root".into(),
            ));
        }
        Ok(joined)
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

#[cfg_attr(not(test), allow(dead_code))]
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

fn parse_attachment_id_from_content_url(url: &str) -> Option<Uuid> {
    let marker = "/api/attachments/content/";
    let start = url.find(marker)? + marker.len();
    let rest = &url[start..];
    let id_part = rest
        .split(['?', '#', '/'])
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    Uuid::parse_str(id_part).ok()
}

fn parse_storage_key_from_legacy_upload_url(url: &str) -> Option<String> {
    let marker = "/uploads/";
    let start = url.find(marker)? + marker.len();
    let rest = &url[start..];
    let key = rest
        .split(['?', '#'])
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if !is_safe_storage_key(key) {
        return None;
    }
    Some(key.to_string())
}

fn sanitize_storage_key_prefix(prefix: &str) -> String {
    let trimmed = prefix.trim_matches('/');
    if trimmed.is_empty() {
        return "attachments".to_string();
    }
    if is_safe_storage_key(trimmed) {
        trimmed.to_string()
    } else {
        "attachments".to_string()
    }
}

fn validate_storage_key(storage_key: &str) -> Result<(), AppError> {
    if !is_safe_storage_key(storage_key) {
        return Err(AppError::Validation(
            "Invalid attachment storage key".into(),
        ));
    }
    Ok(())
}

fn is_safe_storage_key(storage_key: &str) -> bool {
    if storage_key.is_empty() || storage_key.len() > 1024 {
        return false;
    }

    let path = Path::new(storage_key);
    let mut saw_component = false;
    for component in path.components() {
        match component {
            Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.is_empty()
                    || segment == "."
                    || segment == ".."
                    || !segment.chars().all(|ch| {
                        ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')
                    })
                {
                    return false;
                }
                saw_component = true;
            }
            _ => return false,
        }
    }

    saw_component
}

fn compute_signature(secret: &str, attachment_id: Uuid, exp: i64) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any size");
    mac.update(format!("{}:{}", attachment_id, exp).as_bytes());
    let sig = mac.finalize().into_bytes();
    hex_encode(&sig)
}

fn verify_signature(secret: &str, attachment_id: Uuid, exp: i64, sig_hex: &str) -> bool {
    let Ok(sig_bytes) = hex_decode(sig_hex) else {
        return false;
    };
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any size");
    mac.update(format!("{}:{}", attachment_id, exp).as_bytes());
    mac.verify_slice(&sig_bytes).is_ok()
}

fn hex_decode(input: &str) -> Result<Vec<u8>, ()> {
    let bytes = input.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(2) {
        return Err(());
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0usize;
    while i < bytes.len() {
        let hi = hex_nibble(bytes[i]).ok_or(())?;
        let lo = hex_nibble(bytes[i + 1]).ok_or(())?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + (b - b'a')),
        b'A'..=b'F' => Some(10 + (b - b'A')),
        _ => None,
    }
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
