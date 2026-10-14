fn main() {
    // The in-app secure-storage plugin keeps the permission name used by capabilities.
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "secure-storage",
            tauri_build::InlinedPlugin::new()
                .commands(&["get_item", "set_item", "remove_item"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to run tauri-build");
}
