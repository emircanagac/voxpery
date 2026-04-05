#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

struct DesktopRuntimeState {
    minimize_to_tray_on_close: AtomicBool,
    allow_close_for_update: AtomicBool,
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            minimize_to_tray_on_close: AtomicBool::new(true),
            allow_close_for_update: AtomicBool::new(false),
        }
    }
}

fn is_autostart_launch() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_skip_taskbar(false);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn desktop_set_minimize_to_tray_on_close(
    enabled: bool,
    state: tauri::State<'_, DesktopRuntimeState>,
) {
    state
        .minimize_to_tray_on_close
        .store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn desktop_prepare_for_update_install(state: tauri::State<'_, DesktopRuntimeState>) {
    state.allow_close_for_update.store(true, Ordering::Relaxed);
}

fn main() {
    // Dev-only convenience: auto-allow media permissions on Windows WebView2.
    // Never enable in production builds.
    #[cfg(all(target_os = "windows", debug_assertions))]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream",
    );

    let mut builder = tauri::Builder::default()
        .manage(DesktopRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_set_minimize_to_tray_on_close,
            desktop_prepare_for_update_install
        ]);

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        use tauri::WindowEvent;
        use tauri::{Emitter, Manager};

        builder = builder
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_secure_storage::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_deep_link::init())
            .setup(|app| {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec!["--autostart"]),
                ))?;

                let _ =
                    app.handle()
                        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                            show_main_window(app);
                            if let Some(w) = app.get_webview_window("main") {
                                for arg in args {
                                    if arg.starts_with("voxpery://") {
                                        let _ = w.emit("custom-deep-link", arg);
                                        break;
                                    }
                                }
                            }
                        }));

                // System tray: icon + menu (Show, Quit)
                let show_i = MenuItem::with_id(app, "show", "Show Voxpery", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "show" => {
                            show_main_window(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            show_main_window(app);
                        }
                    })
                    .build(app)?;

                // Close behavior is user-controlled. Default matches typical chat apps and keeps
                // the app in the tray until the user disables it from settings.
                if let Some(main_win) = app.get_webview_window("main") {
                    if is_autostart_launch() {
                        let _ = main_win.set_skip_taskbar(true);
                        let _ = main_win.hide();
                    }

                    let main_win_clone = main_win.clone();
                    let app_handle = app.handle().clone();
                    main_win.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            let state = app_handle.state::<DesktopRuntimeState>();
                            let allow_close = state.allow_close_for_update.load(Ordering::Relaxed);
                            let minimize_to_tray =
                                state.minimize_to_tray_on_close.load(Ordering::Relaxed);

                            if allow_close || !minimize_to_tray {
                                return;
                            }

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
