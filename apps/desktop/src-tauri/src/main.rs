#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Dev-only convenience: auto-allow media permissions on Windows WebView2.
    // Never enable in production builds.
    #[cfg(all(target_os = "windows", debug_assertions))]
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--use-fake-ui-for-media-stream");

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use tauri::Manager;
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        use tauri::WindowEvent;

        builder = builder
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_secure_storage::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .setup(|app| {
            let _ = app.handle().plugin(
                tauri_plugin_single_instance::init(|app, _args, _cwd| {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                        let _ = w.unminimize();
                        let _ = w.show();
                    }
                }),
            );

            // System tray: icon + menu (Show, Quit)
            let show_i = MenuItem::with_id(app, "show", "Show Voxpery", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Close button → hide to tray (minimize to tray)
            if let Some(main_win) = app.get_webview_window("main") {
                let main_win_clone = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_win_clone.hide();
                    }
                });
            }

            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Voxpery");
}
