use gtk::prelude::*;
use std::{cell::Cell, rc::Rc};
use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequestExt, WebViewExt};

fn is_trusted_media_origin(uri: &str) -> bool {
    let Ok(url) = tauri::Url::parse(uri) else {
        return false;
    };

    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(5173))
}

pub fn configure(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform_webview| {
        let webview = platform_webview.inner();

        if let Some(settings) = WebViewExt::settings(&webview) {
            settings.set_enable_webrtc(true);
            settings.set_enable_media_stream(true);
        }

        let microphone_approved = Rc::new(Cell::new(false));
        webview.connect_permission_request(move |webview, request| {
            let Some(media_request) =
                request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
            else {
                return false;
            };
            if !media_request.is_for_audio_device() {
                return false;
            }
            if !webview
                .uri()
                .as_deref()
                .is_some_and(is_trusted_media_origin)
            {
                request.deny();
                return true;
            }
            if microphone_approved.get() && !media_request.is_for_video_device() {
                request.allow();
                return true;
            }

            let parent = webview
                .toplevel()
                .and_then(|widget| widget.downcast::<gtk::Window>().ok());
            let message = if media_request.is_for_video_device() {
                "Allow Voxpery to use your microphone and camera?"
            } else {
                "Allow Voxpery to use your microphone?"
            };
            let dialog = gtk::MessageDialog::new(
                parent.as_ref(),
                gtk::DialogFlags::MODAL,
                gtk::MessageType::Question,
                gtk::ButtonsType::YesNo,
                message,
            );
            dialog.set_title("Voxpery media access");

            let request = request.clone();
            let microphone_approved = microphone_approved.clone();
            dialog.connect_response(move |dialog, response| {
                if response == gtk::ResponseType::Yes {
                    microphone_approved.set(true);
                    request.allow();
                } else {
                    request.deny();
                }
                // SAFETY: GTK invalidates the dialog on destroy; this handler never reads it again.
                unsafe { dialog.destroy() };
            });
            dialog.show_all();
            true
        });
    })
}

#[cfg(test)]
mod tests {
    use super::is_trusted_media_origin;

    #[test]
    fn only_app_origin_can_request_microphone_access() {
        assert!(is_trusted_media_origin("tauri://localhost/servers"));
        assert!(is_trusted_media_origin("https://tauri.localhost/servers"));
        assert!(!is_trusted_media_origin("https://example.com/"));
        assert!(!is_trusted_media_origin("tauri://localhost.evil.test/"));
        assert!(!is_trusted_media_origin("invalid"));
    }
}
