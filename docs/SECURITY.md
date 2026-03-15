# Security

Authentication, authorization, CORS policies, and security best practices.

## Authentication

### JWT (JSON Web Token)

- **Algorithm**: HS256 (HMAC with SHA-256)
- **Signing key**: `JWT_SECRET` from environment (never hardcode)
- **Expiration**: 24 hours (configurable via `JWT_EXPIRATION`)
- **Claims**: `sub` (user ID), `username`, `exp` (expiration time), `ver` (token version)

**Token storage**:
- **Web**: httpOnly cookie (`Secure` flag in production)
- **Desktop**: Secure keyring (OS-native credential store via Tauri)

### Password Hashing

- **Algorithm**: Argon2id (memory-hard, GPU-resistant)
- **Library**: `argon2` crate with default params
- **Salt**: Generated per-password (automatic)

**Never**:
- Log passwords
- Store plaintext passwords
- Transmit passwords over unencrypted connections

## Authorization

### Access Control

Every protected operation checks effective permissions:

- **Server-level bitmask**: computed from `@everyone` + assigned roles
- **Category/channel overrides**: DENY first, then ALLOW
- **Owner override**: server owner has full access
- **Message ownership**: author can edit/delete own messages (non-author moderation requires permission)

**Example**:
```rust
pub async fn ensure_channel_permission(
    db: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
    required: Permissions,
) -> Result<(), AppError> {
    let perms = get_user_channel_permissions(db, channel_id, user_id).await?;
    if perms.contains(required) {
        Ok(())
    } else {
        Err(AppError::Forbidden("Missing required permission".into()))
    }
}
```

### WebSocket Authorization

- **Connection**: JWT validated on upgrade
- **Subscribe**: Authorization check per channel
- **Voice join**: Authorization check for voice channel
- **Signal**: Only allowed between users in same voice channel

## CORS (Cross-Origin Resource Sharing)

### Configuration

```bash
CORS_ORIGINS=https://voxpery.com,https://www.voxpery.com,tauri://localhost,voxpery://auth
```

- **Comma-separated** list of allowed origins
- **Wildcard (`*`) rejected** at startup (security guardrail)
- **Credentials**: Always enabled (`Access-Control-Allow-Credentials: true`)

### Validation

```rust
pub fn validate_security_config(cors_origins: &[String], cookie_secure: bool) -> Result<(), String> {
    // Reject wildcard
    if cors_origins.iter().any(|o| o == "*") {
        return Err("CORS_ORIGINS cannot contain '*'".into());
    }
    // Enforce Secure cookie for non-local origins
    let has_non_local = cors_origins.iter().any(|o| !is_local_origin(o));
    if has_non_local && !cookie_secure {
        return Err("COOKIE_SECURE must be true for non-local origins".into());
    }
    Ok(())
}
```

**Backend fails fast on startup** if config is insecure.

### Cookie Security

- **httpOnly**: Prevents JavaScript access (XSS mitigation)
- **Secure**: Only sent over HTTPS (enforced for non-local origins)
- **SameSite**: `Lax` (default, prevents CSRF)

**Production requirement**: `COOKIE_SECURE=1` when `CORS_ORIGINS` includes non-localhost domains.

## Rate Limiting

### Endpoints

- **Auth** (`/api/auth/login`, `/api/auth/register`): 10 requests per minute per user
- **Messages** (`/api/messages/:id`): 30 messages per 10 seconds per user
- **WebSocket connect**: 3 attempts per 10 seconds per user

### Implementation

Rate limits are enforced with Redis sliding windows (`ZSET` based):

```rust
pub async fn enforce_rate_limit(
    redis: &redis::Client,
    key: String,
    max_requests: usize,
    window: Duration,
    message: &str,
) -> Result<(), AppError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    // trim window -> count -> insert -> expire
    let current: isize = conn.zcard(format!("rate:{}", key)).await?;
    if current >= max_requests as isize {
        return Err(AppError::TooManyRequests(message.to_string()));
    }
    Ok(())
}
```

This keeps enforcement consistent across instances and avoids per-process counters.

## JWT Blacklist

Invalidated tokens (logout, password change) stored in Redis:

```rust
pub async fn blacklist_token(redis: &redis::Client, token: &str, ttl_secs: i64) -> Result<(), AppError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    redis::cmd("SETEX")
        .arg(format!("jwt:blacklist:{}", token))
        .arg(ttl_secs)
        .arg("1")
        .query_async(&mut conn)
        .await?;
    Ok(())
}
```

**Checked on**:
- REST API auth middleware
- WebSocket upgrade

Password changes/resets also increment `users.token_version`, so previously issued tokens for that user are rejected even if they were not individually blacklisted.

## Input Validation

### SQL Injection

- **Use parameterized queries** (SQLx)
- **Never** concatenate user input into SQL strings

**Safe**:
```rust
sqlx::query("SELECT * FROM users WHERE username = $1")
    .bind(username)
    .fetch_one(&db)
    .await?;
```

**Unsafe** (never do this):
```rust
let query = format!("SELECT * FROM users WHERE username = '{}'", username); // SQL injection!
```

### XSS (Cross-Site Scripting)

- **React**: Auto-escapes by default (`dangerouslySetInnerHTML` avoided)
- **Backend**: No HTML rendering (JSON API only)
- **Message content**: Stored as plain text, rendered as text (no `<script>` execution)

### Path Traversal

- **Avatar URLs**: validated to allowed image URL/data-url schemes.
- **Attachments**: message payload URLs are restricted to `http(s)` only; `data:` URLs are blocked for new messages.

### File Upload Security

- **Upload endpoint**: `POST /api/attachments/upload` (`multipart/form-data`, auth required)
- **Validation**:
  - per-file size limit (`ATTACHMENTS_MAX_FILE_BYTES`)
  - per-request file count limit (`ATTACHMENTS_MAX_FILES_PER_REQUEST`)
  - MIME allowlist (`ATTACHMENTS_ALLOWED_MIME_PREFIXES`)
- **Malware scan**:
  - Optional ClamAV (`ATTACHMENTS_CLAMAV_ENABLED=1`)
  - `ATTACHMENTS_CLAMAV_FAIL_CLOSED=1` blocks uploads if scanner is unavailable
- **Storage backends**:
  - Local filesystem (`ATTACHMENTS_LOCAL_DIR` + `ATTACHMENTS_KEY_PREFIX`)
  - Upload metadata persisted in `uploaded_attachments`
- **Delivery model**:
  - Files are not exposed under a permanent public `/uploads` route.
  - API returns short-lived signed URLs (`/api/attachments/content/:id?exp=...&sig=...`).

## TLS/SSL

- **Development**: HTTP (localhost only)
- **Production**: HTTPS required
  - Terminate TLS at nginx reverse proxy
  - Backend listens on localhost only (`SERVER_HOST=127.0.0.1`)
  - Enforce Secure cookie flag

## Security Headers

**Recommended nginx config**:
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' wss://api.your-domain.com; img-src 'self' https:; style-src 'self' 'unsafe-inline';" always;
```

## Secrets Management

### Environment Variables

- Store in `.env` file (never commit)
- Use strong random values (`openssl rand -base64 32`)
- Rotate regularly (JWT_SECRET, LIVEKIT_API_SECRET)

### Production

- Use secret manager (e.g., Vault, AWS Secrets Manager)
- Inject secrets at runtime (environment variables or mounted files)
- Never log secrets

## Vulnerability Disclosure

**If you find a security vulnerability**:

1. **Do not** open a public issue
2. Use GitHub Security Advisories (private report)
3. Email: voxpery@gmail.com
4. Allow time for patch before public disclosure

## Security Checklist

### Code Review

- [ ] No hardcoded secrets (JWT_SECRET, database password)
- [ ] All SQL queries parameterized
- [ ] No `dangerouslySetInnerHTML` in React
- [ ] Authorization checks on all protected endpoints
- [ ] Rate limits on auth and message endpoints
- [ ] CORS origins validated (no `*`)
- [ ] Secure cookie flag for non-local origins
- [ ] JWT expiration set (not infinite)

### Deployment

- [ ] TLS/SSL enabled (HTTPS)
- [ ] Firewall configured (only 80/443 open)
- [ ] If using LiveKit, allow only required RTC ports (`7881/tcp`, `7882/udp`, `50000-50200/udp`)
- [ ] Database not exposed to internet
- [ ] Backend binds to localhost (if behind reverse proxy)
- [ ] Secrets rotated after initial setup
- [ ] Logs sanitized (no passwords/tokens)

### Monitoring

- [ ] Failed login attempt alerts
- [ ] Rate limit breach alerts
- [ ] Abnormal traffic patterns (DDoS)
- [ ] Dependency vulnerability scanning (Dependabot, cargo-audit)

## Audit Logging

Audit logging is implemented for core moderation/server actions (for example role updates, kick, ban, and server settings updates) and exposed via server audit endpoints.

## Dependency Security

**Rust**:
```bash
cargo install cargo-audit
cargo audit
```

**Node.js**:
```bash
npm audit
npm audit fix
```

**Automated**: Dependabot + CI dependency audit workflow.

## Compliance

- **GDPR/KVKK**: Implemented self-service account data export (`GET /api/auth/data-export`) and permanent account delete (`DELETE /api/auth/account`).
- **COPPA**: No age verification (assume 13+)
- **Privacy**: No biometrics, no hidden telemetry

For privacy policy, see main README or project website.

---

Last verified against code on 2026-03-16.
