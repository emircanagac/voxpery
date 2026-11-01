//! A small S3 client for attachment files, for any service that speaks the S3 API (MinIO, Hetzner
//! Object Storage, Cloudflare R2, Amazon S3). Requests use AWS Signature Version 4.
//!
//! Buckets stay private: files are only ever read by the server, which keeps enforcing signed
//! links and viewer permissions.

use std::time::Duration;

use hmac::{Hmac, Mac};
use reqwest::{Method, Response, StatusCode, Url};
use sha2::{Digest, Sha256};

use crate::errors::AppError;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Covers a stalled download; a slow client must not cut a healthy one off.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_TIMEOUT: Duration = Duration::from_secs(120);
const SERVICE: &str = "s3";

type HmacSha256 = Hmac<Sha256>;

pub struct ObjectStoreConfig {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    /// `https://bucket.host/key` instead of `https://host/bucket/key`.
    pub virtual_host: bool,
}

#[derive(Clone)]
pub struct ObjectStore {
    http: reqwest::Client,
    base_url: String,
    host: String,
    path_prefix: String,
    region: String,
    access_key: String,
    secret_key: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hmac(key: &[u8], message: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(message.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn is_valid_bucket(bucket: &str) -> bool {
    (3..=63).contains(&bucket.len())
        && bucket
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
}

/// Keys are server-generated (`prefix/2026/11/<uuid>`), so they need no percent-encoding.
fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/-_.".contains(&byte))
        && !key
            .split('/')
            .any(|segment| segment == ".." || segment.is_empty())
}

struct Credentials<'a> {
    access_key: &'a str,
    secret_key: &'a str,
    region: &'a str,
}

/// The `Authorization` header value. `headers` are lowercase names sorted by name.
fn authorization(
    credentials: &Credentials<'_>,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    payload_hash: &str,
    amz_date: &str,
) -> String {
    let Credentials {
        access_key,
        secret_key,
        region,
    } = credentials;
    let date = &amz_date[..8];
    let canonical_headers: String = headers
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect();
    let signed_headers = headers
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request =
        format!("{method}\n{path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}");
    let scope = format!("{date}/{region}/{SERVICE}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let date_key = hmac(format!("AWS4{secret_key}").as_bytes(), date);
    let region_key = hmac(&date_key, region);
    let service_key = hmac(&region_key, SERVICE);
    let signing_key = hmac(&service_key, "aws4_request");
    let signature = hex(&hmac(&signing_key, &string_to_sign));
    format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{scope},SignedHeaders={signed_headers},Signature={signature}"
    )
}

impl ObjectStore {
    pub fn new(config: ObjectStoreConfig) -> Result<Self, AppError> {
        let endpoint = Url::parse(config.endpoint.trim())
            .map_err(|_| AppError::Validation("ATTACHMENTS_S3_ENDPOINT is not a URL".into()))?;
        let host = endpoint
            .host_str()
            .ok_or_else(|| AppError::Validation("ATTACHMENTS_S3_ENDPOINT has no host".into()))?;
        if !matches!(endpoint.scheme(), "http" | "https") {
            return Err(AppError::Validation(
                "ATTACHMENTS_S3_ENDPOINT must be http or https".into(),
            ));
        }
        if !is_valid_bucket(&config.bucket) {
            return Err(AppError::Validation(
                "ATTACHMENTS_S3_BUCKET is not a valid bucket name".into(),
            ));
        }
        if config.access_key.is_empty() || config.secret_key.is_empty() {
            return Err(AppError::Validation(
                "ATTACHMENTS_S3_ACCESS_KEY and ATTACHMENTS_S3_SECRET_KEY are required".into(),
            ));
        }

        let port = endpoint
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default();
        let (authority, path_prefix) = if config.virtual_host {
            (format!("{}.{host}{port}", config.bucket), String::new())
        } else {
            (format!("{host}{port}"), format!("/{}", config.bucket))
        };
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| AppError::Internal(format!("Failed to create S3 client: {e}")))?;

        Ok(Self {
            http,
            base_url: format!("{}://{authority}", endpoint.scheme()),
            host: authority,
            path_prefix,
            region: config.region,
            access_key: config.access_key,
            secret_key: config.secret_key,
        })
    }

    async fn send(
        &self,
        method: Method,
        path: String,
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<Response, AppError> {
        let is_read = method == Method::GET;
        let payload_hash = sha256_hex(body.as_deref().unwrap_or_default());
        let amz_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let headers = [
            ("host", self.host.as_str()),
            ("x-amz-content-sha256", payload_hash.as_str()),
            ("x-amz-date", amz_date.as_str()),
        ];
        let authorization = authorization(
            &Credentials {
                access_key: &self.access_key,
                secret_key: &self.secret_key,
                region: &self.region,
            },
            method.as_str(),
            &path,
            &headers,
            &payload_hash,
            &amz_date,
        );
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.base_url))
            .header("x-amz-content-sha256", &payload_hash)
            .header("x-amz-date", &amz_date)
            .header("authorization", authorization);
        if !is_read {
            request = request.timeout(WRITE_TIMEOUT);
        }
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        request
            .send()
            .await
            .map_err(|_| AppError::Internal("Object storage is unavailable".into()))
    }

    fn object_path(&self, key: &str) -> Result<String, AppError> {
        if !is_valid_key(key) {
            return Err(AppError::Validation("Invalid storage key".into()));
        }
        Ok(format!("{}/{key}", self.path_prefix))
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), AppError> {
        let path = self.object_path(key)?;
        let response = self
            .send(Method::PUT, path, Some(bytes), Some(content_type))
            .await?;
        if !response.status().is_success() {
            return Err(AppError::Internal(format!(
                "Object storage refused an upload ({})",
                response.status().as_u16()
            )));
        }
        Ok(())
    }

    /// The object's response, whose body can be streamed to a client.
    pub async fn get(&self, key: &str) -> Result<Response, AppError> {
        let path = self.object_path(key)?;
        let response = self.send(Method::GET, path, None, None).await?;
        match response.status() {
            status if status.is_success() => Ok(response),
            StatusCode::NOT_FOUND => Err(AppError::NotFound("Attachment file missing".into())),
            status => Err(AppError::Internal(format!(
                "Object storage refused a read ({})",
                status.as_u16()
            ))),
        }
    }

    /// Removing an object that does not exist succeeds.
    pub async fn delete(&self, key: &str) -> Result<(), AppError> {
        let path = self.object_path(key)?;
        let response = self.send(Method::DELETE, path, None, None).await?;
        let status = response.status();
        if status.is_success() || status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(AppError::Internal(format!(
            "Object storage refused a delete ({})",
            status.as_u16()
        )))
    }

    /// Creates the bucket for tests against a fresh local server.
    pub async fn create_bucket(&self) -> Result<(), AppError> {
        let response = self
            .send(Method::PUT, self.path_prefix.clone(), None, None)
            .await?;
        let status = response.status();
        if status.is_success() || status == StatusCode::CONFLICT {
            return Ok(());
        }
        Err(AppError::Internal(format!(
            "Object storage refused a bucket ({})",
            status.as_u16()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_the_published_aws_example() {
        // From the AWS "Signature Calculations" documentation, GET Object example.
        let empty_hash = sha256_hex(b"");
        let signature = authorization(
            &Credentials {
                access_key: "AKIAIOSFODNN7EXAMPLE",
                secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                region: "us-east-1",
            },
            "GET",
            "/test.txt",
            &[
                ("host", "examplebucket.s3.amazonaws.com"),
                ("range", "bytes=0-9"),
                ("x-amz-content-sha256", &empty_hash),
                ("x-amz-date", "20130524T000000Z"),
            ],
            &empty_hash,
            "20130524T000000Z",
        );
        assert!(signature.ends_with(
            "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        ));
        assert!(signature.contains("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"));
    }

    #[test]
    fn rejects_unsafe_configuration_and_keys() {
        let config = |endpoint: &str, bucket: &str, secret: &str| ObjectStoreConfig {
            endpoint: endpoint.into(),
            bucket: bucket.into(),
            region: "auto".into(),
            access_key: "key".into(),
            secret_key: secret.into(),
            virtual_host: false,
        };
        assert!(ObjectStore::new(config("ftp://host", "bucket", "secret")).is_err());
        assert!(ObjectStore::new(config("https://host", "No_Bucket", "secret")).is_err());
        assert!(ObjectStore::new(config("https://host", "bucket", "")).is_err());
        assert!(ObjectStore::new(config("https://host:9000", "bucket", "secret")).is_ok());

        assert!(is_valid_key("attachments/2026/11/9f1c-id"));
        assert!(!is_valid_key("attachments/../secret"));
        assert!(!is_valid_key("/attachments"));
        assert!(!is_valid_key("attachments/a?b"));
    }

    #[test]
    fn builds_path_and_virtual_host_addresses() {
        let config = |virtual_host| ObjectStoreConfig {
            endpoint: "https://storage.example.org".into(),
            bucket: "voxpery".into(),
            region: "auto".into(),
            access_key: "key".into(),
            secret_key: "secret".into(),
            virtual_host,
        };
        let path_style = ObjectStore::new(config(false)).unwrap();
        assert_eq!(path_style.base_url, "https://storage.example.org");
        assert_eq!(path_style.object_path("a/b").unwrap(), "/voxpery/a/b");
        let hosted = ObjectStore::new(config(true)).unwrap();
        assert_eq!(hosted.base_url, "https://voxpery.storage.example.org");
        assert_eq!(hosted.object_path("a/b").unwrap(), "/a/b");
    }
}
