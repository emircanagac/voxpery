# Security

Authentication, authorization, CORS policies, and security best practices.

## User Trust Notes

These notes are written for users who want a short answer before reading the full technical details:

- Voxpery is open source and self-hostable; the hosted service and self-hosted deployments use the same public codebase.
- Google OAuth is used only for sign-in. Voxpery never receives or stores a Google password.
- Hosted Voxpery has no ads or analytics by default.
- Users can export account data and permanently delete their account from settings.
- Attachments are not exposed as public permanent files; access is scoped by signed URLs and viewer authorization.

## Authentication

### JWT (JSON Web Token)

- **Algorithm**: HS256 (HMAC with SHA-256)
- **Signing key**: `JWT_SECRET` from environment (never hardcode)
- **Expiration**: 30 days (configurable via `JWT_EXPIRATION`)
- **Claims**: `sub` (user ID), `username`, `exp` (expiration time), `ver` (token version)
- **Sensitive comparisons**: OAuth state and desktop PKCE checks use constant-time comparison helpers.

**Token storage**:
- **Web**: httpOnly cookie (`Secure` flag in production)
- **Desktop**: Secure keyring (OS-native credential store via Tauri)

### Desktop Capabilities

- Production desktop HTTP access is scoped to the official API origin.
- Desktop URL opening uses Tauri's default `http(s)`, `mailto`, and `tel` URL scope instead of an unscoped opener command.
- No production `fs:*` or `shell:*` capability is granted to the main window.

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
- **Broadcast delivery**: event delivery re-checks current channel/server visibility (not just initial subscribe state)
- **Voice join**: Authorization check for voice channel
- **Voice events**: require current server membership (removed members stop receiving server-scoped voice updates)
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
- **SameSite**: `Lax` (defense in depth; not the sole CSRF control)
- **State-changing requests**: Cookie-authenticated non-safe methods require an exact
  `Origin` match against `CORS_ORIGINS`, with same-origin `Referer` as a fallback.
- **Desktop exception**: Bearer-authenticated desktop requests do not require browser
  origin proof. OAuth callbacks retain their separate state-cookie validation.
- **Opaque origins**: `Origin: null` is never accepted as proof for a cookie-authenticated
  write, even if it exists in the CORS list for a legacy desktop integration.

**Production requirement**: `COOKIE_SECURE=1` when `CORS_ORIGINS` includes non-localhost domains.

## Rate Limiting

### Endpoints

- **Auth** (`/api/auth/login`, `/api/auth/register`): 10 requests per minute per user
- **Friend request** (`/api/friends/requests`): 5 requests per minute per user
- **DM create** (`/api/dm/channels/:peer_id`): 5 requests per minute per user
- **Server join raid signals**: join bursts and new-account join bursts are recorded for moderator review.
- **Server message raid protection**: message bursts and invite spikes are tracked per server/user; bursts can be rejected with `429` and write raid audit events.
- **Messages** (`/api/messages/:id`): 30 messages per 10 seconds per user
- **WebSocket connect**: 3 attempts per 10 seconds per user
- **WebSocket frames**: 120 frames per 10 seconds per user

Client-IP rate limits use the direct socket peer by default. `X-Forwarded-For`,
`X-Real-IP`, and `CF-Connecting-IP` are accepted only when the direct peer belongs
to an explicitly configured `TRUSTED_PROXY_CIDRS` range. Trust-all CIDRs are rejected
at startup, and forwarded chains are evaluated from the trusted proxy edge.

### Implementation

Rate limits are enforced with Redis sliding windows (`ZSET` based). Cleanup, count, insert, and expiry run inside one Redis Lua script so each rate-limit decision is atomic across concurrent app instances. Each hit uses a unique sorted-set member to avoid same-millisecond request collapse:

```rust
pub async fn enforce_rate_limit(
    redis: &redis::Client,
    key: String,
    max_requests: usize,
    window: Duration,
    message: &str,
) -> Result<(), AppError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let allowed: i64 = redis::Script::new(RATE_LIMIT_SCRIPT)
        .key(format!("rate:{}", key))
        .arg(cutoff)
        .arg(now_ms)
        .arg(unique_member)
        .arg(max_requests)
        .arg(ttl_secs)
        .invoke_async(&mut conn)
        .await?;
    if allowed == 0 {
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

### Remote Image Proxy

- User-supplied external avatar URLs are rendered through `GET /api/images/avatar?url=...` so viewers do not request third-party avatar hosts directly.
- User-controlled remote server icons and inline GIF/sticker previews are rendered through `GET /api/images/remote?url=...`.
- The proxy accepts only `https://` image URLs, rejects localhost/private/reserved hosts, resolves DNS before fetch, pins the outbound request to the validated public IP addresses to prevent DNS rebinding, disables redirects, and rate-limits proxy requests.
- Responses must be `image/jpeg`, `image/png`, `image/gif`, or `image/webp`, are capped at 3 MB, and are returned with cache headers plus `X-Content-Type-Options: nosniff`.
- `data:image/*` profile avatars and server icons are still accepted for uploaded profile photos/icons, but SVG data URLs are rejected and stored data URLs are capped at 1 MB.

### API Data Minimization

- Database user records are not serializable as API payloads.
- Current-account endpoints use explicit self-only DTOs, while WebSocket profile broadcasts use the smaller `UserBroadcastProfile` DTO.
- Password hashes, token versions, OAuth provider IDs, and emails are not included in cross-user WebSocket profile events.

### Path Traversal

- **Avatar URLs**: validated to allowed image URL/data-url schemes and proxied before third-party rendering.
- **Attachments**: message payload URLs are restricted to `http(s)` only; `data:` URLs are blocked for new messages.

### File Upload Security

- **Upload endpoint**: `POST /api/attachments/upload` (`multipart/form-data`, auth required)
- **Validation**:
  - per-file size limit (`ATTACHMENTS_MAX_FILE_BYTES`, default 10 MB)
  - per-request file count limit (`ATTACHMENTS_MAX_FILES_PER_REQUEST`)
  - MIME allowlist (`ATTACHMENTS_ALLOWED_MIME_PREFIXES`; ZIP includes `application/zip` and `application/x-zip-compressed`)
- **Malware scan**:
  - Optional ClamAV (`ATTACHMENTS_CLAMAV_ENABLED=1`)
  - `ATTACHMENTS_CLAMAV_FAIL_CLOSED=1` blocks uploads if scanner is unavailable
  - Docker Compose keeps ClamAV disabled by default; enable it explicitly with `--profile security`
- **Storage backends**:
  - Local filesystem (`ATTACHMENTS_LOCAL_DIR` + `ATTACHMENTS_KEY_PREFIX`)
  - Upload metadata persisted in `uploaded_attachments`
- **Delivery model**:
  - Files are not exposed under a permanent public `/uploads` route.
  - API returns short-lived signed URLs (`/api/attachments/content/:id?exp=...&sig=...`).
  - Signed attachment content is streamed after signature and viewer ACL checks, preserving no-sniff headers, private cache headers, and forced download for active content types.

### Email Verification Security

- Verification emails use short-lived, single-use tokens stored only as hashes in `email_verification_tokens`.
- The verification link can be redeemed without an existing session because possession of the mailbox is the proof step.
- After successful redemption, the token row is deleted immediately.
- Expired tokens are rejected and removed on use.

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
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; connect-src 'self' https://api.your-domain.com wss://api.your-domain.com https://livekit.your-domain.com wss://livekit.your-domain.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self';" always;
```

`'wasm-unsafe-eval'` is required for the RNNoise WebAssembly voice suppression runtime. It is narrower than broad JavaScript `'unsafe-eval'` and should stay in `script-src` for production voice releases.

The production web image passes `APP_ENV=production` and uses `apps/web/nginx.production.conf`, which does not allow browser connections to visitor loopback targets. Local Docker compose passes `APP_ENV=development` by default and uses `apps/web/nginx.development.conf` so `localhost` API and LiveKit smoke tests keep working. The web container runs with the unprivileged nginx image and listens on container port `8080`; Compose still exposes it on `127.0.0.1:${WEB_PORT:-5173}`.

## Secrets Management

### Environment Variables

- Store in `.env` file (never commit)
- Use strong random values (`openssl rand -base64 32`)
- Rotate regularly (JWT_SECRET, LIVEKIT_API_SECRET)

### Production

- Use secret manager (e.g., Vault, AWS Secrets Manager)
- Inject secrets at runtime (environment variables or mounted files)
- Never log secrets

## Log Hygiene

- Sensitive fields are not exposed in serialized user output (`password_hash` is skipped).
- `User` debug output is redacted for sensitive fields (`password_hash`, email, OAuth linkage detail).
- OAuth failure paths avoid logging raw state/cookie nonce values, PKCE challenges, full email addresses, and third-party token bodies.
- Third-party service failures log status and safe metadata instead of raw response bodies.

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

Critical role replacement and channel deletion flows lock their server-scoped database state, re-check authorization on the transaction connection, and commit the mutation with its audit record. External WebSocket and voice reconciliation side effects run after commit so delivery failures do not create ambiguous rollback responses for already-persisted changes.

AutoMod rules are server-scoped and require `MANAGE_MESSAGES` to manage. Enabled rules can block server-channel sends/edits for blocked keywords, invite links, links, or mention spam before persistence/broadcast. AutoMod matching removes common invisible Unicode format/control characters before evaluation so zero-width and bidi override characters cannot be used to split blocked keywords or links. AutoMod blocks write audit entries with rule metadata and a truncated content preview.

User and message reports require server membership, are rate limited per reporter/server, and repeated open reports for the same target are deduplicated before they reach the moderation queue. Report listing is capped to keep the safety panel responsive under abuse.

Temporary member timeouts require `MANAGE_MESSAGES`, respect role hierarchy, cannot target the server owner, and block server-channel sends/edits plus new reactions until expiration or manual clearing. Timeout create/clear actions are audit logged.

Raid protection records join bursts, new-account join bursts, message bursts, and invite spikes in `server_raid_events` and audit logs so moderators can review reports, bans, timeouts, and raid signals from the safety UI.

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

- **GDPR/KVKK**: Implemented self-service account data export (`GET /api/auth/data-export`) and permanent account delete (`DELETE /api/auth/account`). Data exports use the `voxpery-user-data-v2` format and intentionally omit internal database IDs, tokens, sessions, password hashes, raw avatar URLs, signed attachment URLs, and storage identifiers.
- **COPPA**: No age verification (assume 13+)
- **Privacy**: No biometrics, no hidden telemetry

For privacy policy, see main README or project website.

---

Last verified against code on 2026-05-12.
