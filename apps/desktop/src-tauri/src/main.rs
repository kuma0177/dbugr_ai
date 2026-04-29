#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ── macOS: force-activate the app so overlay windows actually appear ──────────
// LSUIElement=true (accessory/menu-bar mode) means macOS never makes us the
// active app, so any window.show() call is silently ignored.  We must call
// -[NSApplication activateIgnoringOtherApps:YES] first.

#[cfg(target_os = "macos")]
fn macos_activate() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    }
}

#[cfg(not(target_os = "macos"))]
fn macos_activate() {}

// ── CoreGraphics for screen-capture permissions ───────────────────────────────

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

fn temp_capture_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("debugr-capture-{stamp}.png"))
}

// ── Permission commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_screen_capture_permission() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[tauri::command]
fn request_screen_capture_permission() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

#[tauri::command]
fn open_screen_capture_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .status()
        .map_err(|e| format!("Failed: {e}"))?;
    Ok(())
}

// ── Screenshot helpers ────────────────────────────────────────────────────────

fn encode_image_at(path: &PathBuf) -> Result<String, String> {
    let out = Command::new("base64")
        .arg("-i").arg(path)
        .output()
        .map_err(|e| format!("base64 failed: {e}"))?;
    let _ = fs::remove_file(path);
    let body = String::from_utf8(out.stdout)
        .map_err(|e| format!("UTF-8 error: {e}"))?
        .replace('\n', "");
    Ok(format!("data:image/png;base64,{body}"))
}

/// Silent full-screen screenshot — used internally before showing overlay.
fn take_silent_screenshot() -> Result<String, String> {
    let path = temp_capture_path();
    let ok = Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?
        .success();
    if !ok || !path.exists() {
        return Err("Screenshot failed".into());
    }
    encode_image_at(&path)
}

/// Interactive screenshot (used from session window).
#[tauri::command]
fn capture_interactive_screenshot(app: AppHandle) -> Result<String, String> {
    let path = temp_capture_path();
    let ok = Command::new("screencapture")
        .args(["-i", "-x"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?
        .success();
    if !ok || !path.exists() {
        return Err("Screenshot cancelled".into());
    }
    let url = encode_image_at(&path)?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(url)
}

// ── Window management commands ────────────────────────────────────────────────

/// Called from frontend (tray Sessions menu or "New Annotation" button).
#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    macos_activate();
    trigger_overlay(&app);
    Ok(())
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_session_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("enter-session-mode", ());
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn tray_template_icon() -> Image<'static> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/trayTemplate.png");
    let file = std::fs::File::open(&path)
        .unwrap_or_else(|_| panic!("No tray template icon found — add {}", path.display()));

    let mut decoder = png::Decoder::new(file);
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().expect("Failed to read tray template PNG");
    let mut data = vec![0; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut data)
        .expect("Failed to decode tray template PNG");

    let rgba = match info.color_type {
        png::ColorType::Rgba => data[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => data[..info.buffer_size()]
            .chunks_exact(3)
            .flat_map(|rgb| [rgb[0], rgb[1], rgb[2], 255])
            .collect(),
        png::ColorType::Grayscale => data[..info.buffer_size()]
            .iter()
            .flat_map(|&g| [g, g, g, 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => data[..info.buffer_size()]
            .chunks_exact(2)
            .flat_map(|ga| [ga[0], ga[0], ga[0], ga[1]])
            .collect(),
        png::ColorType::Indexed => unreachable!("normalize_to_color8 should expand indexed PNGs"),
    };

    Image::new_owned(rgba, info.width, info.height)
}

// ── Core: trigger annotation overlay ─────────────────────────────────────────

fn trigger_overlay(app: &AppHandle) {
    // If already visible, hide it (toggle)
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible().unwrap_or(false) {
            let _ = overlay.hide();
            return;
        }
    } else {
        eprintln!("Debugr overlay window not found");
    }

    // Show the native overlay immediately so the toolbar/inspector are visible
    // even if capture permission is slow or unavailable.
    //
    // IMPORTANT: LSUIElement=true means we're an accessory app — macOS will
    // never make us the active application on its own, so window.show() +
    // set_focus() have no visual effect unless we activate first.
    macos_activate();

    if let Some(overlay) = app.get_webview_window("overlay") {
        eprintln!("Debugr overlay window found");

        // Resize the overlay to cover the monitor the user is currently working on.
        // Prefer current_monitor (the screen where the cursor/window is) so that
        // multi-monitor setups work correctly; fall back to primary monitor.
        // We convert physical → logical pixels using the scale factor so that
        // CSS `position:fixed; bottom:24px` always lands on screen.
        let monitor = overlay.current_monitor()
            .ok()
            .flatten()
            .or_else(|| overlay.primary_monitor().ok().flatten());

        if let Some(mon) = monitor {
            let phys  = mon.size();
            let pos   = mon.position();
            let scale = mon.scale_factor();
            let lw = (phys.width  as f64 / scale).round() as u32;
            let lh = (phys.height as f64 / scale).round() as u32;
            let lx = (pos.x as f64 / scale).round();
            let ly = (pos.y as f64 / scale).round();
            eprintln!("Overlay → logical {lw}×{lh} at ({lx},{ly}) scale={scale}");
            let _ = overlay.set_size(tauri::LogicalSize::new(lw, lh));
            let _ = overlay.set_position(tauri::LogicalPosition::new(lx, ly));
        }

        // Tell the frontend to reset state BEFORE we make the window visible
        let _ = overlay.emit("overlay-will-show", ());
        if let Err(e) = overlay.show() {
            eprintln!("Failed to show overlay: {e}");
        }
        if let Err(e) = overlay.set_focus() {
            eprintln!("Failed to focus overlay: {e}");
        }
    }

    // Capture the screen in a background thread so we don't block the shortcut handler.
    let app = app.clone();
    std::thread::spawn(move || {
        // Small delay so the Debugr window has time to hide if needed
        std::thread::sleep(std::time::Duration::from_millis(80));

        let screenshot = take_silent_screenshot();

        if let Some(overlay) = app.get_webview_window("overlay") {
            // Send screenshot (or empty string on failure) to overlay frontend
            match screenshot {
                Ok(data_url) => { let _ = overlay.emit("set-screenshot", data_url); }
                Err(e) => {
                    eprintln!("Screenshot failed: {e}");
                    let _ = overlay.emit("set-screenshot", String::new());
                }
            }
        }
    });
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // ── Tray menu ──────────────────────────────────────────────────
            let annotate = MenuItemBuilder::new("New Annotation  ⌘⌥A")
                .id("annotate").build(app)?;
            let sessions = MenuItemBuilder::new("Sessions")
                .id("sessions").build(app)?;
            let quit = MenuItemBuilder::new("Quit Debugr")
                .id("quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&annotate)
                .item(&sessions)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(tray_template_icon())
                .icon_as_template(true)   // renders correctly in both light & dark menu bar
                .menu(&menu)
                .tooltip("Debugr — ⌘⌥A to annotate")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "annotate"  => trigger_overlay(app),
                    "sessions"  => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.emit("enter-session-mode", ());
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // ── Global shortcut ⌘⌥A ───────────────────────────────────────
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "Cmd+Alt+A",
                move |_app, _shortcut, event| {
                    // Only fire on key-down, not key-up
                    if event.state == ShortcutState::Pressed {
                        trigger_overlay(&handle);
                    }
                },
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_screen_capture_permission,
            request_screen_capture_permission,
            open_screen_capture_settings,
            capture_interactive_screenshot,
            show_overlay,
            hide_overlay,
            show_session_window,
            hide_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running debugr.ai");
}
