#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

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

// ── Permission commands ──────────────────────────────────────────────────────

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
        .map_err(|e| format!("Failed to open System Settings: {e}"))?;
    Ok(())
}

// ── Screenshot commands ──────────────────────────────────────────────────────

fn encode_image_at(path: &PathBuf) -> Result<String, String> {
    let encoded = Command::new("base64")
        .arg("-i")
        .arg(path)
        .output()
        .map_err(|e| format!("base64 encoding failed: {e}"))?;
    let _ = fs::remove_file(path);
    if !encoded.status.success() {
        return Err("base64 encoding returned an error".to_string());
    }
    let body = String::from_utf8(encoded.stdout)
        .map_err(|e| format!("Invalid UTF-8 from base64: {e}"))?
        .replace('\n', "");
    Ok(format!("data:image/png;base64,{body}"))
}

/// Take a silent full-screen screenshot (used before showing the overlay)
#[tauri::command]
fn capture_screen(app: AppHandle) -> Result<String, String> {
    let path = temp_capture_path();
    let status = Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?;

    if !status.success() || !path.exists() {
        return Err("Screenshot failed.".to_string());
    }
    encode_image_at(&path)
}

/// Interactive screenshot tool (for manual capture in session view)
#[tauri::command]
fn capture_interactive_screenshot(app: AppHandle) -> Result<String, String> {
    let path = temp_capture_path();
    let status = Command::new("screencapture")
        .args(["-i", "-x"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?;

    if !status.success() || !path.exists() {
        return Err("Screenshot was cancelled.".to_string());
    }

    let data_url = encode_image_at(&path)?;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(data_url)
}

// ── Window management commands ───────────────────────────────────────────────

#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
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
        // Emit event to switch to session mode before showing
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

// ── Internal helpers ─────────────────────────────────────────────────────────

fn trigger_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let is_visible = overlay.is_visible().unwrap_or(false);
        if is_visible {
            let _ = overlay.hide();
        } else {
            let _ = overlay.show();
            let _ = overlay.set_focus();
        }
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // ── Tray menu ──────────────────────────────────────────────────
            let annotate = MenuItemBuilder::new("New Annotation")
                .id("annotate")
                .build(app)?;
            let sessions = MenuItemBuilder::new("Sessions")
                .id("sessions")
                .build(app)?;
            let settings = MenuItemBuilder::new("Settings")
                .id("settings")
                .enabled(false)
                .build(app)?;
            let quit = MenuItemBuilder::new("Quit Debugr")
                .id("quit")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&annotate)
                .item(&sessions)
                .separator()
                .item(&settings)
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Debugr — Press ⌘⌥A to annotate")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "annotate" => trigger_overlay(app),
                    "sessions" => {
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
            app.global_shortcut()
                .on_shortcut("cmd+alt+a", move |_, _, _| {
                    trigger_overlay(&handle);
                })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_screen_capture_permission,
            request_screen_capture_permission,
            open_screen_capture_settings,
            capture_screen,
            capture_interactive_screenshot,
            show_overlay,
            hide_overlay,
            show_session_window,
            hide_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running debugr.ai");
}
