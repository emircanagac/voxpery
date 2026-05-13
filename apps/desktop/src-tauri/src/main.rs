#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::{
    imageops::{crop_imm, overlay, resize, FilterType},
    ImageReader, RgbaImage,
};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

struct DesktopRuntimeState {
    minimize_to_tray_on_close: AtomicBool,
    allow_close_for_update: AtomicBool,
    tray_icon_variant: AtomicBool,
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            minimize_to_tray_on_close: AtomicBool::new(true),
            allow_close_for_update: AtomicBool::new(false),
            tray_icon_variant: AtomicBool::new(false),
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
        let _ = w.maximize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn apply_icon_variant(
    mut rgba: Vec<u8>,
    width: u32,
    height: u32,
    variant: bool,
) -> tauri::image::Image<'static> {
    let mut variant_applied = false;
    for idx in (0..rgba.len()).step_by(4) {
        if rgba[idx + 3] == 0 {
            rgba[idx] = if variant { 1 } else { 0 };
            variant_applied = true;
            break;
        }
    }

    if !variant_applied && width > 0 && height > 0 {
        let idx = ((height - 1) * width * 4) as usize;
        rgba[idx] = rgba[idx].saturating_sub(variant as u8);
    }

    tauri::image::Image::new_owned(rgba, width, height)
}

fn blend_pixel(rgba: &mut [u8], idx: usize, r: u8, g: u8, b: u8, a: u8) {
    let alpha = a as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    rgba[idx] = ((r as f32 * alpha) + (rgba[idx] as f32 * inv_alpha)).round() as u8;
    rgba[idx + 1] = ((g as f32 * alpha) + (rgba[idx + 1] as f32 * inv_alpha)).round() as u8;
    rgba[idx + 2] = ((b as f32 * alpha) + (rgba[idx + 2] as f32 * inv_alpha)).round() as u8;
    rgba[idx + 3] = ((255.0 * alpha) + (rgba[idx + 3] as f32 * inv_alpha)).round() as u8;
}

fn focus_tray_icon_canvas(img: RgbaImage, padding: u32) -> RgbaImage {
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return img;
    }

    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut found = false;

    for (x, y, pixel) in img.enumerate_pixels() {
        if pixel[3] <= 10 {
            continue;
        }
        found = true;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    if !found {
        return img;
    }

    let crop_width = max_x.saturating_sub(min_x) + 1;
    let crop_height = max_y.saturating_sub(min_y) + 1;
    let available_width = width.saturating_sub(padding.saturating_mul(2)).max(1);
    let available_height = height.saturating_sub(padding.saturating_mul(2)).max(1);
    let scale = f32::min(
        available_width as f32 / crop_width as f32,
        available_height as f32 / crop_height as f32,
    )
    .max(1.0);

    let target_width = ((crop_width as f32 * scale).round() as u32).clamp(1, width);
    let target_height = ((crop_height as f32 * scale).round() as u32).clamp(1, height);
    let cropped = crop_imm(&img, min_x, min_y, crop_width, crop_height).to_image();
    let resized = resize(
        &cropped,
        target_width,
        target_height,
        FilterType::CatmullRom,
    );

    let mut canvas = RgbaImage::new(width, height);
    let offset_x = ((width - target_width) / 2) as i64;
    let offset_y = ((height - target_height) / 2) as i64;
    overlay(&mut canvas, &resized, offset_x, offset_y);
    canvas
}

fn make_base_tray_icon(variant: bool) -> Option<tauri::image::Image<'static>> {
    let bytes = include_bytes!("../icons/64x64.png");
    let img = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?
        .to_rgba8();

    let focused = focus_tray_icon_canvas(img, 2);
    let (width, height) = focused.dimensions();
    Some(apply_icon_variant(
        focused.into_raw(),
        width,
        height,
        variant,
    ))
}

fn make_unread_tray_icon(variant: bool) -> Option<tauri::image::Image<'static>> {
    let base = make_base_tray_icon(variant)?;
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();

    let icon_size = width.min(height) as i32;
    let core_radius = (icon_size as f32 * 0.17).round() as i32;
    let border_radius = core_radius + 2;
    let glow_radius = core_radius + 5;
    let shadow_radius = core_radius + 7;
    let center_x = width as i32 - (core_radius + 7);
    let center_y = height as i32 - (core_radius + 7);
    let highlight_x = center_x - (core_radius / 3).max(1);
    let highlight_y = center_y - (core_radius / 2).max(1);
    let highlight_radius = (core_radius / 2).max(2);

    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let dx = x - center_x;
            let dy = y - center_y;
            let distance_sq = dx * dx + dy * dy;
            let idx = ((y as u32 * width + x as u32) * 4) as usize;
            let hx = x - highlight_x;
            let hy = y - highlight_y;
            let highlight_distance_sq = hx * hx + hy * hy;

            if distance_sq <= shadow_radius * shadow_radius {
                blend_pixel(&mut rgba, idx, 4, 8, 18, 44);
            }

            if distance_sq <= glow_radius * glow_radius {
                blend_pixel(&mut rgba, idx, 86, 201, 255, 96);
            }

            if distance_sq <= border_radius * border_radius {
                blend_pixel(&mut rgba, idx, 10, 17, 28, 242);
            }

            if distance_sq <= core_radius * core_radius {
                blend_pixel(&mut rgba, idx, 116, 220, 255, 255);
            }

            if highlight_distance_sq <= highlight_radius * highlight_radius {
                blend_pixel(&mut rgba, idx, 226, 247, 255, 160);
            }
        }
    }

    Some(tauri::image::Image::new_owned(rgba, width, height))
}

fn refresh_tray_icon(tray: &tauri::tray::TrayIcon, unread: bool, variant: bool) {
    let _ = if unread {
        tray.set_icon(make_unread_tray_icon(!variant))
    } else {
        tray.set_icon(make_base_tray_icon(!variant))
    };

    let _ = if unread {
        tray.set_icon(make_unread_tray_icon(variant))
    } else {
        tray.set_icon(make_base_tray_icon(variant))
    };
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

#[tauri::command]
fn desktop_update_unread_feedback(
    unread_count: u32,
    unread_increased: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopRuntimeState>,
) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(if unread_count > 0 { Some(1) } else { None });
        let window_focused = window.is_focused().unwrap_or(false);
        let _ = window.request_user_attention(if unread_increased && !window_focused {
            Some(tauri::UserAttentionType::Critical)
        } else {
            None
        });
    }

    if let Some(tray) = app.tray_by_id("main-tray") {
        let next_variant = !state.tray_icon_variant.fetch_xor(true, Ordering::Relaxed);
        refresh_tray_icon(&tray, unread_count > 0, next_variant);
        let _ = tray.set_tooltip(Some("Voxpery"));
    }
}

#[tauri::command]
fn desktop_open_media_permission_settings(kind: String) -> Result<(), String> {
    let target = match kind.as_str() {
        "camera" => "camera",
        _ => "microphone",
    };

    #[cfg(target_os = "windows")]
    {
        let uri = if target == "camera" {
            "ms-settings:privacy-webcam"
        } else {
            "ms-settings:privacy-microphone"
        };
        Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn()
            .map_err(|err| format!("Failed to open Windows privacy settings: {err}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let uri = if target == "camera" {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
        } else {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        };
        Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|err| format!("Failed to open macOS privacy settings: {err}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Err(format!(
            "Open your desktop privacy settings manually and verify portal/PipeWire services are running for {target} access."
        ))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("Opening media permission settings is not supported on this platform.".into())
    }
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
            desktop_prepare_for_update_install,
            desktop_update_unread_feedback,
            desktop_open_media_permission_settings
        ]);

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        use tauri::WindowEvent;
        use tauri::{Emitter, Manager};
        use tauri_plugin_window_state::StateFlags;

        let window_state_flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;

        builder = builder
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_secure_storage::init())
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_deep_link::init())
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(window_state_flags)
                    .build(),
            )
            .setup(|app| {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    Some(vec!["--autostart"]),
                ))?;

                let _ =
                    app.handle()
                        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                            let deep_link = args
                                .iter()
                                .find(|arg| arg.starts_with("voxpery://"))
                                .cloned();
                            let is_startup_instance = args.iter().any(|arg| arg == "--autostart");

                            if deep_link.is_some() || !is_startup_instance {
                                show_main_window(app);
                            }

                            if let Some(w) = app.get_webview_window("main") {
                                if let Some(arg) = deep_link {
                                    let _ = w.emit("custom-deep-link", arg);
                                }
                            }
                        }));

                // System tray: icon + menu (Show, Quit)
                let show_i = MenuItem::with_id(app, "show", "Show Voxpery", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
                let _tray = TrayIconBuilder::with_id("main-tray")
                    .icon(
                        make_base_tray_icon(false)
                            .unwrap_or_else(|| app.default_window_icon().unwrap().clone()),
                    )
                    .menu(&menu)
                    .tooltip("Voxpery")
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
                    main_win.on_window_event(move |event| match event {
                        WindowEvent::CloseRequested { api, .. } => {
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
                        _ => {}
                    });
                }

                Ok(())
            });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Voxpery");
}
