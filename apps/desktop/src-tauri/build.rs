fn main() {
    // The in-app secure-storage plugin keeps the permission name used by capabilities.
    // Listing the app's own commands turns on access control for them too: each one then needs
    // an `allow-*` permission in a capability, and capabilities are granted to the bundled app
    // only, so remote pages (a server's captcha frame, for example) can never invoke them.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "secure-storage",
                tauri_build::InlinedPlugin::new()
                    .commands(&["get_item", "set_item", "remove_item"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .app_manifest(tauri_build::AppManifest::new().commands(&[
                "desktop_set_minimize_to_tray_on_close",
                "desktop_prepare_for_update_install",
                "desktop_take_pending_deep_links",
                "desktop_update_unread_feedback",
                "desktop_open_media_permission_settings",
                "desktop_refocus_webview_keyboard",
                "desktop_update_channel",
                "desktop_custom_server",
                "desktop_probe_custom_server",
                "desktop_set_custom_server",
            ])),
    )
    .expect("failed to run tauri-build");
}
