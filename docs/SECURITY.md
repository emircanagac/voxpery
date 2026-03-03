# Security

Authentication, authorization, CORS policies, and security best practices.

## Authentication

### JWT (JSON Web Token)

- **Algorithm**: HS256 (HMAC with SHA-256)
- **Signing key**: `JWT_SECRET` from environment (never hardcode)
- **Expiration**: 24 hours (configurable via `JWT_EXPIRATION`)
- **Claims**: `sub` (user ID), `username`, `exp` (expiration time)

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

Every operation checks permissions:

- **Server membership**: `can_subscribe_to_channel`, `can_join_voice_channel`
- **Message ownership**: Author can edit/delete own messages
- **Server ownership**: Owner can delete server, kick members
- **Moderator**: Can kick members, delete messages, change roles

**Example**:
```rust
pub async fn can_subscribe_to_channel(db: &PgPool, user_id: Uuid, channel_id: Uuid) -> Result<bool, sqlx::Error> {
    // Check if user is member of channel's server
    let count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM channels c
           INNER JOIN server_members sm ON c.server_id = sm.server_id
           WHERE c.id = $1 AND sm.user_id = $2"#
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;
    Ok(count > 0)
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
CORS_ORIGINS=https://voxpery.com,https://www.voxpery.com,tauri://localhost
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

**Backend panics on startup** if config is insecure.

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

In-memory counters (DashMap):

```rust
pub fn enforce_rate_limit(
    limits: &DashMap<String, Vec<Instant>>,
    key: String,
    max: usize,
    window: Duration,
    error_msg: &str,
) -> Result<(), AppError> {
    let now = Instant::now();
    let mut entry = limits.entry(key).or_default();
    entry.retain(|t| now.duration_since(*t) < window);
    if entry.len() >= max {
        return Err(AppError::RateLimit(error_msg.to_string()));
    }
    entry.push(now);
    Ok(())
}
```

**Future**: Migrate to Redis for multi-pod deployments (horizontal scaling).

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

- **Avatar URLs**: Validated to be absolute URLs (no `../../etc/passwd`)
- **Attachment paths**: Not implemented (no file uploads yet)

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

**Not yet implemented** (PRs welcome):

- Track sensitive actions (password change, role change, kick)
- Store in `audit_log` table
- Include actor, target, timestamp, IP address

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

**Automated**: Dependabot (GitHub) scans for vulnerabilities weekly.

## Compliance

- **GDPR**: User can request data deletion (not yet implemented)
- **COPPA**: No age verification (assume 13+)
- **Privacy**: No biometrics, no hidden telemetry

For privacy policy, see main README or project website.
