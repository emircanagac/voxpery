//! Attachment upload, storage, malware scanning, and URL validation.

use std::{
    io::Cursor,
    path::{Path, PathBuf},
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
const MAX_SAFE_IMAGE_DIMENSION: u32 = 16_384;
const MAX_SAFE_IMAGE_ALLOC_BYTES: u64 = 128 * 1024 * 1024;
const GENERIC_BINARY_MIME: &str = "application/octet-stream";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DetectedAttachmentKind {
    Jpeg,
    Png,
    Gif,
    Webp,
    Bmp,
    Tiff,
    Icon,
    Avif,
    Heic,
    Pdf,
    Zip,
    Mp3,
    Aac,
    OggAudio,
    OggVideo,
    Wav,
    Flac,
    Mp4Video,
    Mp4Audio,
    QuickTime,
    Webm,
    Matroska,
    Avi,
    MpegVideo,
    PlainText,
}

impl DetectedAttachmentKind {
    fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Bmp => "image/bmp",
            Self::Tiff => "image/tiff",
            Self::Icon => "image/x-icon",
            Self::Avif => "image/avif",
            Self::Heic => "image/heic",
            Self::Pdf => "application/pdf",
            Self::Zip => "application/zip",
            Self::Mp3 => "audio/mpeg",
            Self::Aac => "audio/aac",
            Self::OggAudio => "audio/ogg",
            Self::OggVideo => "video/ogg",
            Self::Wav => "audio/wav",
            Self::Flac => "audio/flac",
            Self::Mp4Video => "video/mp4",
            Self::Mp4Audio => "audio/mp4",
            Self::QuickTime => "video/quicktime",
            Self::Webm => "video/webm",
            Self::Matroska => "video/x-matroska",
            Self::Avi => "video/x-msvideo",
            Self::MpegVideo => "video/mpeg",
            Self::PlainText => "text/plain",
        }
    }
}

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

#[derive(Debug, Clone)]
pub struct PreparedAttachment {
    pub original_name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    bytes: Vec<u8>,
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
                "application/x-zip-compressed".to_string(),
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
        let local_dir = fs::canonicalize(&local_dir).await.map_err(|e| {
            AppError::Internal(format!(
                "Failed to resolve attachment storage directory: {e}"
            ))
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
        // Keep a direct traversal guard at each filesystem sink in addition to
        // segment validation and the canonical storage-root boundary below.
        if storage_key.contains("..") {
            return Err(AppError::Validation(
                "Invalid attachment storage key".into(),
            ));
        }
        let path = self.resolve_existing_local_path(storage_key).await?;
        fs::read(path)
            .await
            .map_err(|e| AppError::NotFound(format!("Attachment file missing: {e}")))
    }

    pub async fn open_local_attachment_file(
        &self,
        storage_key: &str,
    ) -> Result<fs::File, AppError> {
        // Keep this check local to the sink so static analysis and reviewers can
        // see that untrusted traversal input cannot reach File::open.
        if storage_key.contains("..") {
            return Err(AppError::Validation(
                "Invalid attachment storage key".into(),
            ));
        }
        let path = self.resolve_existing_local_path(storage_key).await?;
        fs::File::open(path)
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

    async fn strip_image_metadata_if_needed(
        &self,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, AppError> {
        let Some(format) = image_format_for_metadata_strip(content_type) else {
            return Ok(bytes.to_vec());
        };
        let source = bytes.to_vec();

        let reencoded = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
            let mut reader = image::ImageReader::with_format(Cursor::new(&source), format);
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(MAX_SAFE_IMAGE_DIMENSION);
            limits.max_image_height = Some(MAX_SAFE_IMAGE_DIMENSION);
            limits.max_alloc = Some(MAX_SAFE_IMAGE_ALLOC_BYTES);
            reader.limits(limits);
            let image = reader.decode().map_err(|e| format!("decode failed: {e}"))?;
            let mut output = Cursor::new(Vec::<u8>::with_capacity(source.len()));
            image
                .write_to(&mut output, format)
                .map_err(|e| format!("encode failed: {e}"))?;
            Ok(output.into_inner())
        })
        .await
        .map_err(|e| AppError::Internal(format!("Image metadata cleanup task failed: {e}")))?;

        reencoded.map_err(|e| {
            AppError::Validation(format!(
                "Uploaded image could not be processed safely ({e}). Try a different file."
            ))
        })
    }

    pub async fn store_file(
        &self,
        original_name: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<StoredAttachment, AppError> {
        let prepared = self
            .prepare_file_for_storage(original_name, content_type, bytes)
            .await?;
        self.store_prepared_file(prepared).await
    }

    pub async fn prepare_file_for_storage(
        &self,
        original_name: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Result<PreparedAttachment, AppError> {
        self.validate_upload_file_meta(content_type, bytes.len())?;
        let detected_content_type =
            validate_upload_content(original_name, content_type, bytes)?.to_string();
        self.validate_upload_file_meta(&detected_content_type, bytes.len())?;
        let prepared_bytes = self
            .strip_image_metadata_if_needed(&detected_content_type, bytes)
            .await?;
        self.validate_upload_file_meta(&detected_content_type, prepared_bytes.len())?;
        let stored_content_type =
            validate_upload_content(original_name, &detected_content_type, &prepared_bytes)?;
        self.scan_file_bytes(&prepared_bytes).await?;

        Ok(PreparedAttachment {
            original_name: original_name.to_string(),
            content_type: stored_content_type.to_string(),
            size_bytes: prepared_bytes.len() as i64,
            sha256: hex_encode(&Sha256::digest(&prepared_bytes)),
            bytes: prepared_bytes,
        })
    }

    pub async fn store_prepared_file(
        &self,
        prepared: PreparedAttachment,
    ) -> Result<StoredAttachment, AppError> {
        let PreparedAttachment {
            original_name,
            content_type,
            size_bytes,
            sha256,
            bytes,
        } = prepared;

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
        write_file_atomically(&path, &bytes).await?;
        Ok(StoredAttachment {
            storage_backend: "local",
            storage_key: key,
            original_name,
            content_type,
            size_bytes,
            sha256,
        })
    }

    pub async fn delete_local_file_by_storage_key(
        &self,
        storage_key: &str,
    ) -> Result<(), AppError> {
        let path = self.resolve_local_path(storage_key)?;
        match fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Internal(format!(
                "Failed to delete local attachment file: {e}"
            ))),
        }
    }

    fn resolve_local_path(&self, storage_key: &str) -> Result<PathBuf, AppError> {
        let segments = parse_storage_key_segments(storage_key)?;
        let joined = segments
            .iter()
            .fold(self.local_dir.clone(), |mut path, segment| {
                path.push(segment);
                path
            });
        if !joined.starts_with(&self.local_dir) {
            return Err(AppError::Validation(
                "Attachment storage key resolves outside storage root".into(),
            ));
        }
        Ok(joined)
    }

    async fn resolve_existing_local_path(&self, storage_key: &str) -> Result<PathBuf, AppError> {
        let path = self.resolve_local_path(storage_key)?;
        let canonical = fs::canonicalize(&path)
            .await
            .map_err(|e| AppError::NotFound(format!("Attachment file missing: {e}")))?;
        if !canonical.starts_with(&self.local_dir) {
            return Err(AppError::Validation(
                "Attachment storage key resolves outside storage root".into(),
            ));
        }
        Ok(canonical)
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

async fn write_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let temporary_path = path.with_extension(format!("uploading-{}", Uuid::new_v4()));
    let mut temporary_file = match fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary_path)
        .await
    {
        Ok(file) => file,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path).await;
            return Err(AppError::Internal(format!(
                "Failed to create temporary attachment file: {error}"
            )));
        }
    };

    let write_result = async {
        temporary_file.write_all(bytes).await?;
        temporary_file.flush().await?;
        temporary_file.sync_all().await
    }
    .await;
    drop(temporary_file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path).await;
        return Err(AppError::Internal(format!(
            "Failed to write uploaded attachment: {error}"
        )));
    }

    if let Err(error) = fs::rename(&temporary_path, path).await {
        let _ = fs::remove_file(&temporary_path).await;
        return Err(AppError::Internal(format!(
            "Failed to finalize uploaded attachment: {error}"
        )));
    }

    Ok(())
}

fn validate_upload_content(
    original_name: &str,
    declared_content_type: &str,
    bytes: &[u8],
) -> Result<&'static str, AppError> {
    if has_blocked_executable_extension(original_name) {
        return Err(AppError::Validation(
            "Executable files and installers are not allowed as attachments".into(),
        ));
    }

    let declared = normalize_mime_type(declared_content_type);
    if is_active_or_executable_mime(&declared) || has_executable_signature(bytes) {
        return Err(AppError::Validation(
            "Executable or active attachment content is not allowed".into(),
        ));
    }

    if looks_like_active_markup(bytes) {
        return Err(AppError::Validation(
            "Active HTML, XML, and SVG content is not allowed as an attachment".into(),
        ));
    }

    let detected = detect_attachment_kind(bytes).ok_or_else(|| {
        AppError::Validation("Attachment content type could not be identified safely".into())
    })?;
    let detected_mime = detected.mime_type();

    if !declared_mime_matches_detected(&declared, detected_mime) {
        return Err(AppError::Validation(format!(
            "Attachment content does not match declared type '{declared_content_type}'"
        )));
    }

    Ok(detected_mime)
}

fn normalize_mime_type(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn declared_mime_matches_detected(declared: &str, detected: &str) -> bool {
    if declared == GENERIC_BINARY_MIME || declared == detected {
        return true;
    }

    matches!(
        (declared, detected),
        ("image/jpg", "image/jpeg")
            | ("image/vnd.microsoft.icon", "image/x-icon")
            | ("image/heif", "image/heic")
            | ("application/x-zip-compressed", "application/zip")
            | ("application/x-zip", "application/zip")
            | ("audio/mp3", "audio/mpeg")
            | ("audio/x-wav", "audio/wav")
            | ("audio/wave", "audio/wav")
            | ("audio/x-flac", "audio/flac")
            | ("audio/x-m4a", "audio/mp4")
            | ("video/x-m4v", "video/mp4")
            | ("video/avi", "video/x-msvideo")
            | ("application/ogg", "audio/ogg")
            | ("application/ogg", "video/ogg")
    )
}

fn has_blocked_executable_extension(original_name: &str) -> bool {
    let normalized_name = original_name.trim().trim_end_matches([' ', '.']);
    let extension = Path::new(normalized_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    matches!(
        extension.as_str(),
        "exe"
            | "dll"
            | "com"
            | "scr"
            | "msi"
            | "msp"
            | "msix"
            | "msixbundle"
            | "appx"
            | "appxbundle"
            | "cpl"
            | "sys"
            | "drv"
            | "bat"
            | "cmd"
            | "ps1"
            | "psm1"
            | "vbs"
            | "vbe"
            | "wsf"
            | "wsh"
            | "hta"
            | "reg"
            | "desktop"
            | "command"
            | "app"
            | "dmg"
            | "pkg"
            | "deb"
            | "rpm"
            | "apk"
            | "ipa"
            | "jar"
            | "class"
            | "wasm"
            | "lnk"
    )
}

fn is_active_or_executable_mime(content_type: &str) -> bool {
    content_type.ends_with("+xml")
        || matches!(
            content_type,
            "image/svg+xml"
                | "text/html"
                | "application/xhtml+xml"
                | "text/xml"
                | "application/xml"
                | "text/javascript"
                | "application/javascript"
                | "application/x-javascript"
                | "application/x-httpd-php"
                | "application/x-msdownload"
                | "application/x-dosexec"
                | "application/vnd.microsoft.portable-executable"
                | "application/x-executable"
                | "application/x-sharedlib"
                | "application/wasm"
                | "application/java-archive"
                | "application/java-vm"
                | "application/vnd.android.package-archive"
                | "application/x-apple-diskimage"
        )
}

fn has_executable_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"MZ")
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xce])
        || bytes.starts_with(&[0xce, 0xfa, 0xed, 0xfe])
        || bytes.starts_with(&[0xfe, 0xed, 0xfa, 0xcf])
        || bytes.starts_with(&[0xcf, 0xfa, 0xed, 0xfe])
        || bytes.starts_with(&[0xca, 0xfe, 0xba, 0xbe])
        || bytes.starts_with(&[0xca, 0xfe, 0xba, 0xbf])
        || bytes.starts_with(&[0xbf, 0xba, 0xfe, 0xca])
        || bytes.starts_with(b"dex\n")
        || bytes.starts_with(b"\0asm")
        || strip_utf8_bom_and_ascii_whitespace(bytes).starts_with(b"#!")
}

fn looks_like_active_markup(bytes: &[u8]) -> bool {
    let prefix = strip_utf8_bom_and_ascii_whitespace(bytes);
    let prefix = &prefix[..prefix.len().min(512)];
    let lower = String::from_utf8_lossy(prefix).to_ascii_lowercase();
    lower.starts_with("<svg")
        || lower.starts_with("<?xml")
        || lower.starts_with("<!doctype html")
        || lower.starts_with("<html")
}

fn detect_attachment_kind(bytes: &[u8]) -> Option<DetectedAttachmentKind> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(DetectedAttachmentKind::Jpeg);
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(DetectedAttachmentKind::Png);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(DetectedAttachmentKind::Gif);
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") {
        return match &bytes[8..12] {
            b"WEBP" => Some(DetectedAttachmentKind::Webp),
            b"WAVE" => Some(DetectedAttachmentKind::Wav),
            b"AVI " => Some(DetectedAttachmentKind::Avi),
            _ => None,
        };
    }
    if bytes.starts_with(b"BM") {
        return Some(DetectedAttachmentKind::Bmp);
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        return Some(DetectedAttachmentKind::Tiff);
    }
    if bytes.starts_with(&[0, 0, 1, 0]) {
        return Some(DetectedAttachmentKind::Icon);
    }
    if let Some(kind) = detect_iso_base_media_kind(bytes) {
        return Some(kind);
    }

    let trimmed = strip_utf8_bom_and_ascii_whitespace(bytes);
    if trimmed.starts_with(b"%PDF-") {
        return Some(DetectedAttachmentKind::Pdf);
    }
    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
    {
        return Some(DetectedAttachmentKind::Zip);
    }
    if bytes.starts_with(b"ID3")
        || matches!(bytes, [0xff, second, ..] if second & 0xe0 == 0xe0 && second & 0x06 != 0)
    {
        return Some(DetectedAttachmentKind::Mp3);
    }
    if matches!(bytes, [0xff, second, ..] if second & 0xf6 == 0xf0) {
        return Some(DetectedAttachmentKind::Aac);
    }
    if bytes.starts_with(b"fLaC") {
        return Some(DetectedAttachmentKind::Flac);
    }
    if bytes.starts_with(b"OggS") {
        let header = &bytes[..bytes.len().min(128)];
        if contains_bytes(header, b"theora") {
            return Some(DetectedAttachmentKind::OggVideo);
        }
        return Some(DetectedAttachmentKind::OggAudio);
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        let header = &bytes[..bytes.len().min(4096)];
        if contains_bytes(header, b"webm") {
            return Some(DetectedAttachmentKind::Webm);
        }
        return Some(DetectedAttachmentKind::Matroska);
    }
    if bytes.starts_with(&[0, 0, 1, 0xba]) || bytes.starts_with(&[0, 0, 1, 0xb3]) {
        return Some(DetectedAttachmentKind::MpegVideo);
    }
    if looks_like_plain_text(bytes) {
        return Some(DetectedAttachmentKind::PlainText);
    }

    None
}

fn detect_iso_base_media_kind(bytes: &[u8]) -> Option<DetectedAttachmentKind> {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return None;
    }

    let brands = &bytes[8..bytes.len().min(64)];
    if contains_aligned_brand(brands, &[b"avif", b"avis"]) {
        return Some(DetectedAttachmentKind::Avif);
    }
    if contains_aligned_brand(
        brands,
        &[b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"],
    ) {
        return Some(DetectedAttachmentKind::Heic);
    }
    if contains_aligned_brand(brands, &[b"M4A ", b"M4B ", b"M4P "]) {
        return Some(DetectedAttachmentKind::Mp4Audio);
    }
    if contains_aligned_brand(brands, &[b"qt  "]) {
        return Some(DetectedAttachmentKind::QuickTime);
    }

    Some(DetectedAttachmentKind::Mp4Video)
}

fn contains_aligned_brand(haystack: &[u8], needles: &[&[u8; 4]]) -> bool {
    haystack
        .chunks_exact(4)
        .any(|brand| needles.iter().any(|needle| brand == needle.as_slice()))
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

fn strip_utf8_bom_and_ascii_whitespace(mut bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        bytes = &bytes[3..];
    }
    while matches!(bytes.first(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        bytes = &bytes[1..];
    }
    bytes
}

fn looks_like_plain_text(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    text.chars()
        .all(|ch| !ch.is_control() || matches!(ch, '\n' | '\r' | '\t'))
}

fn image_format_for_metadata_strip(content_type: &str) -> Option<image::ImageFormat> {
    let normalized = content_type.trim().to_ascii_lowercase();
    if normalized.starts_with("image/jpeg") || normalized.starts_with("image/jpg") {
        Some(image::ImageFormat::Jpeg)
    } else if normalized.starts_with("image/png") {
        Some(image::ImageFormat::Png)
    } else {
        None
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

fn is_safe_storage_key(storage_key: &str) -> bool {
    parse_storage_key_segments(storage_key).is_ok()
}

fn parse_storage_key_segments(storage_key: &str) -> Result<Vec<String>, AppError> {
    if storage_key.is_empty()
        || storage_key.len() > 1024
        || storage_key.starts_with('/')
        || storage_key.contains('\\')
        || storage_key.contains(':')
    {
        return Err(AppError::Validation(
            "Invalid attachment storage key".into(),
        ));
    }

    let mut segments = Vec::new();
    for segment in storage_key.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || !segment
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        {
            return Err(AppError::Validation(
                "Invalid attachment storage key".into(),
            ));
        }
        segments.push(segment.to_string());
    }

    if segments.is_empty() {
        return Err(AppError::Validation(
            "Invalid attachment storage key".into(),
        ));
    }

    Ok(segments)
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
    use tokio::fs;

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

    #[test]
    fn storage_key_validation_rejects_path_escape_inputs() {
        for key in [
            "",
            "/attachments/2026/05/file",
            "attachments/../secret",
            "attachments//file",
            "attachments\\file",
            "C:/attachments/file",
            "attachments/%2e%2e/file",
        ] {
            assert!(
                parse_storage_key_segments(key).is_err(),
                "{key} should fail"
            );
        }

        assert!(parse_storage_key_segments("attachments/2026/05/file-01_abc.png").is_ok());
    }

    #[tokio::test]
    async fn local_read_and_open_reject_traversal_keys() {
        let test_root = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        let service = AttachmentService::new_local_for_tests(test_root.clone())
            .await
            .expect("service");

        for key in ["../secret", "attachments/2026/05/../../secret"] {
            assert!(matches!(
                service.read_local_attachment_bytes(key).await,
                Err(AppError::Validation(_))
            ));
            assert!(matches!(
                service.open_local_attachment_file(key).await,
                Err(AppError::Validation(_))
            ));
        }

        fs::remove_dir_all(test_root).await.expect("cleanup");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_read_and_open_reject_symlink_escape() {
        use std::os::unix::fs::symlink;

        let test_base = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        let test_root = test_base.join("storage");
        let outside_file = test_base.join("outside.txt");
        let service = AttachmentService::new_local_for_tests(test_root)
            .await
            .expect("service");
        fs::write(&outside_file, b"outside")
            .await
            .expect("outside file");

        let storage_key = format!("attachments/2026/08/{}", Uuid::new_v4());
        let linked_path = service
            .resolve_local_path(&storage_key)
            .expect("validated path");
        fs::create_dir_all(linked_path.parent().expect("storage parent"))
            .await
            .expect("storage parent");
        symlink(&outside_file, &linked_path).expect("outside symlink");

        assert!(matches!(
            service.read_local_attachment_bytes(&storage_key).await,
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            service.open_local_attachment_file(&storage_key).await,
            Err(AppError::Validation(_))
        ));

        fs::remove_dir_all(test_base).await.expect("cleanup");
    }

    #[tokio::test]
    async fn upload_meta_allows_windows_zip_mime_but_rejects_executables() {
        let test_root = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        let service = AttachmentService::new_local_for_tests(test_root.clone())
            .await
            .expect("service");

        assert!(service
            .validate_upload_file_meta("application/x-zip-compressed", 1024)
            .is_ok());
        assert!(service
            .validate_upload_file_meta("application/x-msdownload", 1024)
            .is_err());

        fs::remove_dir_all(test_root).await.expect("cleanup");
    }

    #[test]
    fn upload_content_uses_magic_bytes_and_canonical_mime() {
        let png = b"\x89PNG\r\n\x1a\nrest";
        assert_eq!(
            validate_upload_content("image.png", GENERIC_BINARY_MIME, png).unwrap(),
            "image/png"
        );

        let zip = b"PK\x03\x04archive";
        assert_eq!(
            validate_upload_content("archive.zip", "application/x-zip-compressed", zip).unwrap(),
            "application/zip"
        );

        assert_eq!(
            validate_upload_content("notes.txt", "text/plain; charset=utf-8", b"safe notes")
                .unwrap(),
            "text/plain"
        );
    }

    #[test]
    fn upload_content_rejects_mime_spoofing_and_unknown_binary() {
        let png = b"\x89PNG\r\n\x1a\nrest";
        assert!(validate_upload_content("fake.jpg", "image/jpeg", png).is_err());
        assert!(
            validate_upload_content("unknown.bin", GENERIC_BINARY_MIME, &[0, 159, 146, 150])
                .is_err()
        );
    }

    #[test]
    fn upload_content_rejects_executables_and_active_markup() {
        assert!(validate_upload_content(
            "payload.bin",
            GENERIC_BINARY_MIME,
            b"MZfake-portable-executable"
        )
        .is_err());
        assert!(validate_upload_content(
            "renamed.txt",
            "text/plain",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
        )
        .is_err());
        assert!(validate_upload_content(
            "renamed.zip.ExE. ",
            GENERIC_BINARY_MIME,
            b"PK\x03\x04archive"
        )
        .is_err());
        assert!(validate_upload_content(
            "startup.ps1",
            "text/plain",
            b"Write-Host 'payload'"
        )
        .is_err());
    }

    #[test]
    fn upload_content_detects_common_audio_and_video_containers() {
        let wav = b"RIFF\x10\0\0\0WAVEfmt ";
        assert_eq!(
            validate_upload_content("clip.wav", "audio/x-wav", wav).unwrap(),
            "audio/wav"
        );

        let mp4 = b"\0\0\0\x18ftypisom\0\0\0\0isom";
        assert_eq!(
            validate_upload_content("clip.mp4", "video/mp4", mp4).unwrap(),
            "video/mp4"
        );
    }

    #[tokio::test]
    async fn prepare_png_decodes_reencodes_and_keeps_canonical_mime() {
        let test_root = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        let service = AttachmentService::new_local_for_tests(test_root.clone())
            .await
            .expect("service");
        let image = image::DynamicImage::new_rgba8(1, 1);
        let mut source = Cursor::new(Vec::new());
        image
            .write_to(&mut source, image::ImageFormat::Png)
            .expect("encode source png");

        let prepared = service
            .prepare_file_for_storage("pixel.png", GENERIC_BINARY_MIME, &source.into_inner())
            .await
            .expect("prepare png");

        assert_eq!(prepared.content_type, "image/png");
        assert!(prepared.size_bytes > 0);
        fs::remove_dir_all(test_root).await.expect("cleanup");
    }

    #[tokio::test]
    async fn store_file_uses_uuid_storage_key_not_original_filename() {
        let test_root = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        let service = AttachmentService::new_local_for_tests(test_root.clone())
            .await
            .expect("service");

        let stored = service
            .store_file(
                "../../very-unsafe-name.png",
                "application/octet-stream",
                b"hello",
            )
            .await
            .expect("store_file");

        assert!(stored.storage_key.starts_with("attachments/"));
        assert!(!stored.storage_key.contains("unsafe-name"));
        let object_id = stored
            .storage_key
            .split('/')
            .next_back()
            .expect("last storage key segment");
        assert!(Uuid::parse_str(object_id).is_ok());
        let stored_path = service
            .resolve_local_path(&stored.storage_key)
            .expect("stored path");
        assert_eq!(fs::read(&stored_path).await.expect("stored bytes"), b"hello");
        let mut sibling_entries = fs::read_dir(stored_path.parent().expect("storage parent"))
            .await
            .expect("storage directory");
        while let Some(entry) = sibling_entries.next_entry().await.expect("storage entry") {
            assert!(
                !entry.file_name().to_string_lossy().contains(".uploading-"),
                "successful writes must not leave temporary files"
            );
        }

        fs::remove_dir_all(test_root).await.expect("cleanup");
    }

    #[tokio::test]
    async fn atomic_write_removes_temporary_file_when_finalize_fails() {
        let test_root = std::env::temp_dir().join(format!("voxpery-att-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&test_root).await.expect("test root");
        let target_path = test_root.join("existing-directory");
        fs::create_dir(&target_path).await.expect("conflicting target");

        let error = write_file_atomically(&target_path, b"temporary payload")
            .await
            .expect_err("renaming a file over a directory must fail");
        assert!(error.to_string().contains("Failed to finalize"));

        let mut entries = fs::read_dir(&test_root).await.expect("test root entries");
        while let Some(entry) = entries.next_entry().await.expect("test root entry") {
            assert!(
                !entry.file_name().to_string_lossy().contains(".uploading-"),
                "failed finalization must remove temporary files"
            );
        }

        fs::remove_dir_all(test_root).await.expect("cleanup");
    }
}
