use axum::http::StatusCode;
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientObservabilityEvent {
    FrontendSessionStarted,
    FrontendCrash,
    DesktopOauthReturnReceived,
    DesktopOauthReturnSucceeded,
    DesktopOauthReturnFailed,
    DesktopOauthSetupFailed,
    WebsocketReconnectStarted,
    WebsocketReconnectSucceeded,
    WebsocketReconnectExhausted,
    VoiceJoinStarted,
    VoiceJoinSucceeded,
    VoiceJoinFailed,
    LivekitReconnectStarted,
    LivekitReconnectSucceeded,
    LivekitDisconnected,
    MediaMicrophoneStarted,
    MediaMicrophoneFailed,
    MediaCameraStarted,
    MediaCameraFailed,
    MediaScreenShareStarted,
    MediaScreenShareFailed,
}

impl ClientObservabilityEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FrontendSessionStarted => "frontend_session_started",
            Self::FrontendCrash => "frontend_crash",
            Self::DesktopOauthReturnReceived => "desktop_oauth_return_received",
            Self::DesktopOauthReturnSucceeded => "desktop_oauth_return_succeeded",
            Self::DesktopOauthReturnFailed => "desktop_oauth_return_failed",
            Self::DesktopOauthSetupFailed => "desktop_oauth_setup_failed",
            Self::WebsocketReconnectStarted => "websocket_reconnect_started",
            Self::WebsocketReconnectSucceeded => "websocket_reconnect_succeeded",
            Self::WebsocketReconnectExhausted => "websocket_reconnect_exhausted",
            Self::VoiceJoinStarted => "voice_join_started",
            Self::VoiceJoinSucceeded => "voice_join_succeeded",
            Self::VoiceJoinFailed => "voice_join_failed",
            Self::LivekitReconnectStarted => "livekit_reconnect_started",
            Self::LivekitReconnectSucceeded => "livekit_reconnect_succeeded",
            Self::LivekitDisconnected => "livekit_disconnected",
            Self::MediaMicrophoneStarted => "media_microphone_started",
            Self::MediaMicrophoneFailed => "media_microphone_failed",
            Self::MediaCameraStarted => "media_camera_started",
            Self::MediaCameraFailed => "media_camera_failed",
            Self::MediaScreenShareStarted => "media_screen_share_started",
            Self::MediaScreenShareFailed => "media_screen_share_failed",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservabilityClient {
    Web,
    Desktop,
}

impl ObservabilityClient {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Desktop => "desktop",
        }
    }
}

pub fn rate_limit_fingerprint(secret: &str, client_ip: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b":observability:");
    hasher.update(client_ip.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn log_client_event(event: ClientObservabilityEvent, client: ObservabilityClient) {
    tracing::info!(
        target: "voxpery_observability",
        event_code = event.as_str(),
        client = client.as_str(),
        "privacy_safe_event"
    );
}

pub fn should_observe_backend_response(enabled: bool, status: StatusCode) -> bool {
    enabled && status.is_server_error()
}

pub fn log_backend_5xx(status: StatusCode) {
    tracing::error!(
        target: "voxpery_observability",
        event_code = "backend_http_5xx",
        status = status.as_u16(),
        "privacy_safe_event"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_fingerprint_does_not_expose_the_ip() {
        let fingerprint = rate_limit_fingerprint("secret", "203.0.113.10");
        assert_eq!(fingerprint.len(), 64);
        assert!(!fingerprint.contains("203.0.113.10"));
        assert_ne!(
            fingerprint,
            rate_limit_fingerprint("other-secret", "203.0.113.10")
        );
    }

    #[test]
    fn only_enabled_server_errors_are_observed() {
        assert!(should_observe_backend_response(
            true,
            StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!should_observe_backend_response(
            true,
            StatusCode::BAD_REQUEST
        ));
        assert!(!should_observe_backend_response(
            false,
            StatusCode::INTERNAL_SERVER_ERROR
        ));
    }
}
