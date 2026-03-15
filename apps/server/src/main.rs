//! Voxpery server binary. Uses the library for app setup and serving.

use std::sync::Arc;

use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use voxpery_server::{build_app, config, routes, validate_security_config, ws, AppState};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "voxpery_server=info,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = config::Config::from_env();

    if let Err(msg) = validate_security_config(&config.cors_origins, config.cookie_secure) {
        tracing::error!("Invalid security configuration: {}", msg);
        return;
    }

    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    let redis =
        redis::Client::open(config.redis_url.clone()).expect("Failed to initialize Redis client");
    {
        let mut conn = redis
            .get_multiplexed_async_connection()
            .await
            .expect("Failed to connect to Redis");
        let _: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .expect("Failed to ping Redis");
    }

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("Failed to run migrations");

    tracing::info!("Database connected and migrations applied");

    let (tx, _rx) = broadcast::channel::<ws::WsEvent>(4096);
    let attachment_service =
        match voxpery_server::services::attachments::AttachmentService::from_config(&config).await {
            Ok(service) => Arc::new(service),
            Err(e) => {
                tracing::error!("Attachment service initialization failed: {}", e);
                return;
            }
        };
    let attachment_local_dir = attachment_service
        .local_storage_dir()
        .map(|p| p.to_string_lossy().to_string());

    let state = Arc::new(AppState {
        db,
        redis,
        jwt_secret: config.jwt_secret.clone(),
        jwt_expiration: config.jwt_expiration,
        tx,
        sessions: dashmap::DashMap::new(),
        voice_sessions: dashmap::DashMap::new(),
        voice_controls: dashmap::DashMap::new(),
        auth_rate_limit_max: config.auth_rate_limit_max,
        auth_rate_limit_window_secs: config.auth_rate_limit_window_secs,
        login_failure_max_attempts: config.login_failure_max_attempts,
        login_failure_ip_max_attempts: config.login_failure_ip_max_attempts,
        login_failure_window_secs: config.login_failure_window_secs,
        message_rate_limit_max: config.message_rate_limit_max,
        message_rate_limit_window_secs: config.message_rate_limit_window_secs,
        cookie_secure: config.cookie_secure,
        cookie_name: config.cookie_name.clone(),
        cors_origins: config.cors_origins.clone(),
        turn_urls: config.turn_urls.clone(),
        turn_shared_secret: config.turn_shared_secret.clone(),
        turn_credential_ttl_secs: config.turn_credential_ttl_secs,
        livekit_ws_url: config.livekit_ws_url.clone(),
        livekit_api_key: config.livekit_api_key.clone(),
        livekit_api_secret: config.livekit_api_secret.clone(),
        google_client_id: config.google_client_id.clone(),
        google_client_secret: config.google_client_secret.clone(),
        public_api_url: config.public_api_url.clone(),
        turnstile_secret_key: config.turnstile_secret_key.clone(),
        smtp_host: config.smtp_host.clone(),
        smtp_user: config.smtp_user.clone(),
        smtp_password: config.smtp_password.clone(),
        attachment_service,
        attachment_local_dir,
    });

    if let (Some(ref email), Some(ref username), Some(ref password)) = (
        &config.admin_email,
        &config.admin_username,
        &config.admin_password,
    ) {
        match routes::auth::ensure_seed_admin(&state.db, email, username, password).await {
            Ok(Some(admin_id)) => {
                if let Err(e) = routes::auth::ensure_default_server_join(&state.db, admin_id).await
                {
                    tracing::warn!(
                        "Failed to create default Voxpery server with admin owner: {}",
                        e
                    );
                }
            }
            Ok(None) => {}
            Err(e) => tracing::warn!("Seed admin skipped or failed: {}", e),
        }
    }

    let app = build_app(state, config.cors_origins);

    let host = if config.server_host == "0.0.0.0" {
        "[::]"
    } else {
        &config.server_host
    };
    let addr = format!("{}:{}", host, config.server_port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(e) => {
            tracing::error!("Failed to bind server listener on {}: {}", addr, e);
            return;
        }
    };
    tracing::info!("🚀 Voxpery server running on {}", addr);

    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!("HTTP server terminated with error: {}", e);
    }
}
