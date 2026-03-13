/// Application configuration loaded from environment variables.
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_expiration: i64,
    pub server_host: String,
    pub server_port: u16,
    /// Allowed CORS origins. Use `CORS_ORIGINS` (comma-separated) or legacy `CORS_ORIGIN`. Include `null` for Tauri desktop app (release build often sends Origin: null).
    pub cors_origins: Vec<String>,
    pub auth_rate_limit_max: usize,
    pub auth_rate_limit_window_secs: u64,
    pub message_rate_limit_max: usize,
    pub message_rate_limit_window_secs: u64,
    /// Optional admin account for default setup. If all three are set, a user is created at startup (if none with that email exists) and becomes owner of the default Voxpery server.
    pub admin_email: Option<String>,
    pub admin_username: Option<String>,
    pub admin_password: Option<String>,
    /// Auth cookie: Secure flag (set true in production over HTTPS).
    pub cookie_secure: bool,
    /// Auth cookie name (httpOnly session cookie for web).
    pub cookie_name: String,
    /// TURN server URLs (comma-separated). Served via API so credentials are not in frontend bundle.
    pub turn_urls: Option<String>,
    /// Shared secret for coturn REST API credentials (use_auth_secret).
    pub turn_shared_secret: Option<String>,
    /// TURN credential lifetime in seconds.
    pub turn_credential_ttl_secs: u64,
    /// LiveKit (SFU) connection and API credentials for token minting.
    pub livekit_ws_url: Option<String>,
    pub livekit_api_key: Option<String>,
    pub livekit_api_secret: Option<String>,
    /// Google OAuth: client ID and secret. If both set, "Sign in with Google" is enabled.
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    /// Public base URL of this API (for OAuth redirect_uri). e.g. http://localhost:3001 or https://api.voxpery.com
    pub public_api_url: Option<String>,
    /// Cloudflare Turnstile Secret Key for CAPTCHA validation
    pub turnstile_secret_key: Option<String>,
    /// SMTP Host for sending emails (e.g. smtp.gmail.com)
    pub smtp_host: Option<String>,
    /// SMTP User
    pub smtp_user: Option<String>,
    /// SMTP Password (App Password)
    pub smtp_password: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let cors_origins = std::env::var("CORS_ORIGINS")
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect::<Vec<_>>()
            })
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| {
                // DEV ONLY: For production, set CORS_ORIGINS explicitly.
                // Include "null" only if Tauri desktop app (release build) needs it.
                // Example: CORS_ORIGINS=https://voxpery.com,tauri://localhost,null
                vec![
                    std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into()),
                    "http://127.0.0.1:5173".into(),
                    "tauri://localhost".into(),
                    "tauri://127.0.0.1".into(),
                    "voxpery://auth".into(),
                    // "null" removed from default - add explicitly via CORS_ORIGINS if needed for Tauri
                ]
            });

        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            jwt_expiration: std::env::var("JWT_EXPIRATION")
                .unwrap_or_else(|_| "86400".into())
                .parse()
                .expect("JWT_EXPIRATION must be a number"),
            server_host: std::env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            server_port: std::env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3001".into())
                .parse()
                .expect("SERVER_PORT must be a number"),
            cors_origins,
            auth_rate_limit_max: std::env::var("AUTH_RATE_LIMIT_MAX")
                .unwrap_or_else(|_| "10".into())
                .parse()
                .expect("AUTH_RATE_LIMIT_MAX must be a number"),
            auth_rate_limit_window_secs: std::env::var("AUTH_RATE_LIMIT_WINDOW_SECS")
                .unwrap_or_else(|_| "60".into())
                .parse()
                .expect("AUTH_RATE_LIMIT_WINDOW_SECS must be a number"),
            message_rate_limit_max: std::env::var("MESSAGE_RATE_LIMIT_MAX")
                .unwrap_or_else(|_| "30".into())
                .parse()
                .expect("MESSAGE_RATE_LIMIT_MAX must be a number"),
            message_rate_limit_window_secs: std::env::var("MESSAGE_RATE_LIMIT_WINDOW_SECS")
                .unwrap_or_else(|_| "10".into())
                .parse()
                .expect("MESSAGE_RATE_LIMIT_WINDOW_SECS must be a number"),
            admin_email: std::env::var("ADMIN_EMAIL").ok().filter(|s| !s.is_empty()),
            admin_username: std::env::var("ADMIN_USERNAME")
                .ok()
                .filter(|s| !s.is_empty()),
            admin_password: std::env::var("ADMIN_PASSWORD")
                .ok()
                .filter(|s| !s.is_empty()),
            cookie_secure: std::env::var("COOKIE_SECURE")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            cookie_name: std::env::var("AUTH_COOKIE_NAME")
                .unwrap_or_else(|_| "voxpery_token".into()),
            turn_urls: std::env::var("TURN_URLS").ok().filter(|s| !s.is_empty()),
            turn_shared_secret: std::env::var("TURN_SHARED_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            turn_credential_ttl_secs: std::env::var("TURN_CREDENTIAL_TTL_SECS")
                .unwrap_or_else(|_| "3600".into())
                .parse()
                .expect("TURN_CREDENTIAL_TTL_SECS must be a number"),
            livekit_ws_url: std::env::var("LIVEKIT_WS_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            livekit_api_key: std::env::var("LIVEKIT_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            livekit_api_secret: std::env::var("LIVEKIT_API_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            google_client_id: std::env::var("GOOGLE_CLIENT_ID")
                .ok()
                .filter(|s| !s.is_empty()),
            google_client_secret: std::env::var("GOOGLE_CLIENT_SECRET")
                .ok()
                .filter(|s| !s.is_empty()),
            public_api_url: std::env::var("PUBLIC_API_URL")
                .ok()
                .filter(|s| !s.is_empty()),
            turnstile_secret_key: std::env::var("TURNSTILE_SECRET_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            smtp_host: std::env::var("SMTP_HOST").ok().filter(|s| !s.is_empty()),
            smtp_user: std::env::var("SMTP_USER").ok().filter(|s| !s.is_empty()),
            smtp_password: std::env::var("SMTP_PASSWORD")
                .ok()
                .filter(|s| !s.is_empty()),
        }
    }
}
