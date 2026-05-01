#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}, io::Write as _};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};
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

fn log_backend(event: &str, details: impl AsRef<str>) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    eprintln!("[debugr-core][{ts}] {event} {}", details.as_ref());
}

// ── Permission commands ───────────────────────────────────────────────────────

#[tauri::command]
fn get_screen_capture_permission() -> bool {
    let preflight = unsafe { CGPreflightScreenCaptureAccess() };
    let probe = can_capture_screen_now();
    let granted = preflight || probe;
    log_backend(
        "permission.preflight",
        format!("preflight={preflight} probe={probe} granted={granted}"),
    );
    granted
}

#[derive(serde::Serialize)]
struct ScreenCaptureDiagnostics {
    preflight: bool,
    probe: bool,
    granted: bool,
    bundle_identifier: String,
    executable_path: String,
}

#[tauri::command]
fn get_screen_capture_diagnostics(app: AppHandle) -> ScreenCaptureDiagnostics {
    let preflight = unsafe { CGPreflightScreenCaptureAccess() };
    let probe = can_capture_screen_now();
    let bundle_identifier = app.config().identifier.clone();
    let executable_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.into_os_string().into_string().ok())
        .unwrap_or_else(|| "unknown".to_string());
    log_backend(
        "permission.diagnostics",
        format!(
            "preflight={preflight} probe={probe} granted={} bundle_id={} executable={}",
            preflight || probe,
            bundle_identifier,
            executable_path
        ),
    );
    ScreenCaptureDiagnostics {
        preflight,
        probe,
        granted: preflight || probe,
        bundle_identifier,
        executable_path,
    }
}

#[tauri::command]
fn request_screen_capture_permission() -> bool {
    log_backend("permission.request.start", "triggering_cg_request=true");
    let requested = unsafe { CGRequestScreenCaptureAccess() };
    let granted = get_screen_capture_permission();
    log_backend(
        "permission.request.result",
        format!("cg_request_returned={requested} effective_granted={granted}"),
    );
    granted
}

#[tauri::command]
fn open_screen_capture_settings() -> Result<(), String> {
    log_backend(
        "permission.settings.open",
        "url=x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .status()
        .map_err(|e| format!("Failed: {e}"))?;
    Ok(())
}

fn escape_applescript_text(value: &str) -> String {
    value.replace('\\', r"\\").replace('"', r#"\""#)
}

/// Open any URL in the user's default browser.
/// Uses `sh -c "open URL"` so the process inherits the user's full
/// environment and is not affected by any Tauri process sandboxing.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Escape single quotes in the URL before embedding in shell string.
    let safe = url.replace('\'', r"'\''");
    Command::new("sh")
        .arg("-c")
        .arg(format!("open '{safe}'"))
        .status()
        .map_err(|e| format!("Failed to open URL: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_auth_popup(app: AppHandle, url: String, title: String, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| format!("Failed to show auth popup: {e}"))?;
        window.set_focus().map_err(|e| format!("Failed to focus auth popup: {e}"))?;
        return Ok(());
    }

    let parsed = Url::parse(&url).map_err(|e| format!("Invalid auth popup URL: {e}"))?;
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title(&title)
        .inner_size(960.0, 760.0)
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to open auth popup: {e}"))?;

    Ok(())
}

/// Persist provider connection config (codex API key, claude connected flag)
/// to ~/Library/Application Support/debugr/provider-config.json.
#[tauri::command]
fn save_provider_config(payload: serde_json::Value) -> Result<(), String> {
    let dir = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
        .join("debugr");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;
    let path = dir.join("provider-config.json");
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Serialization failed: {e}"))?;
    let mut file = fs::File::create(&path)
        .map_err(|e| format!("Failed to create provider config: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write provider config: {e}"))?;
    log_backend(
        "workspace.provider_config.saved",
        format!("path={} bytes={}", path.display(), json.len()),
    );
    Ok(())
}

// ── Provider verification commands ───────────────────────────────────────────

/// Check that the claude CLI is installed and that an auth credentials file
/// exists (created by `claude /login`).  Returns the CLI version string on
/// success, or an error message the frontend can display.
#[tauri::command]
fn verify_claude_auth() -> Result<String, String> {
    // 1. Is the CLI on PATH?
    let which = Command::new("which")
        .arg("claude")
        .output()
        .map_err(|_| "Could not search PATH".to_string())?;
    if !which.status.success() {
        return Err(
            "claude CLI not found. Visit claude.ai/download to install it first.".to_string(),
        );
    }

    // 2. Does it run?
    let ver = Command::new("claude")
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run claude: {e}"))?;
    if !ver.status.success() {
        return Err(
            "claude CLI found but returned an error. Try reinstalling.".to_string(),
        );
    }
    let version = String::from_utf8_lossy(&ver.stdout).trim().to_string();

    // 3. Check credentials file written by `claude /login`
    let home = std::env::var("HOME").unwrap_or_default();
    let creds = PathBuf::from(&home).join(".claude").join("credentials.json");
    if !creds.exists() {
        return Err(
            "Not signed in yet. Click 'Connect Claude' and complete the Claude CLI login flow.".to_string(),
        );
    }

    Ok(version)
}

/// Validate an Anthropic API key by checking the models endpoint.
#[tauri::command]
fn verify_claude_api_key(api_key: String) -> Result<String, String> {
    if !api_key.starts_with("sk-ant-") || api_key.len() < 20 {
        return Err("Key must start with 'sk-ant-' and be at least 20 characters.".to_string());
    }

    let output = Command::new("curl")
        .args([
            "-s", "-o", "/dev/null",
            "-w", "%{http_code}",
            "--max-time", "8",
            "https://api.anthropic.com/v1/models",
            "-H", &format!("x-api-key: {api_key}"),
            "-H", "anthropic-version: 2023-06-01",
        ])
        .output()
        .map_err(|e| format!("Network check failed: {e}"))?;

    let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
    match code.as_str() {
        "200" => Ok("✓ API key verified".to_string()),
        "401" => Err("Invalid key — check you copied the full Anthropic API key.".to_string()),
        "403" => Err("Key is valid but does not have access to this workspace.".to_string()),
        "429" => Ok("✓ Key valid (rate-limited, that's fine)".to_string()),
        other => Err(format!("Unexpected response ({other}). Check your internet connection.")),
    }
}

/// Validate an OpenAI API key by making a lightweight authenticated request
/// to /v1/models.  Uses curl (always present on macOS) to avoid adding an
/// HTTP library dependency.
#[tauri::command]
fn verify_codex_key(api_key: String) -> Result<String, String> {
    if !api_key.starts_with("sk-") || api_key.len() < 20 {
        return Err("Key must start with 'sk-' and be at least 20 characters.".to_string());
    }

    let output = Command::new("curl")
        .args([
            "-s", "-o", "/dev/null",
            "-w", "%{http_code}",
            "--max-time", "8",
            "https://api.openai.com/v1/models",
            "-H", &format!("Authorization: Bearer {api_key}"),
        ])
        .output()
        .map_err(|e| format!("Network check failed: {e}"))?;

    let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
    match code.as_str() {
        "200" => Ok("✓ API key verified".to_string()),
        "429" => Ok("✓ Key valid (rate-limited, that's fine)".to_string()),
        "401" => Err("Invalid key — check you copied the full key from OpenAI.".to_string()),
        "403" => Err("Key is valid but has insufficient permissions.".to_string()),
        other => Err(format!("Unexpected response ({other}). Check your internet connection.")),
    }
}

/// Returns true if Cursor.app is installed in the standard macOS locations.
#[tauri::command]
fn check_cursor_installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from("/Applications/Cursor.app").exists()
        || PathBuf::from(&home).join("Applications/Cursor.app").exists()
}

/// Read provider connection config from disk.
#[tauri::command]
fn get_provider_config() -> serde_json::Value {
    let path = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
        .join("debugr")
        .join("provider-config.json");
    let parsed = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    log_backend(
        "workspace.provider_config.loaded",
        format!("path={} has_data={}", path.display(), parsed != serde_json::json!({})),
    );
    parsed
}

#[tauri::command]
fn open_command_in_terminal(cwd: String, command: String, title: Option<String>) -> Result<(), String> {
    let shell_command = format!("cd '{}' && {}", cwd.replace('\'', r"'\''"), command);
    let applescript = match title {
        Some(title) => format!(
            r#"tell application "Terminal"
activate
do script "{}"
set custom title of front window to "{}"
end tell"#,
            escape_applescript_text(&shell_command),
            escape_applescript_text(&title),
        ),
        None => format!(
            r#"tell application "Terminal"
activate
do script "{}"
end tell"#,
            escape_applescript_text(&shell_command),
        ),
    };

    let status = Command::new("osascript")
        .arg("-e")
        .arg(applescript)
        .status()
        .map_err(|e| format!("Failed to open Terminal: {e}"))?;

    if !status.success() {
        return Err("Terminal command failed".into());
    }

    Ok(())
}

/// Shows a native macOS folder-picker via AppleScript.
/// Returns the POSIX path of the chosen folder, or null if cancelled.
#[tauri::command]
fn pick_folder() -> Option<String> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(r#"POSIX path of (choose folder with prompt "Select your project folder:")"#)
        .output()
        .ok()?;
    if out.status.success() {
        let path = String::from_utf8(out.stdout).ok()?.trim().to_string();
        let picked = if path.is_empty() { None } else { Some(path) };
        log_backend(
            "workspace.folder_picker.result",
            format!("picked={}", picked.as_deref().unwrap_or("null")),
        );
        picked
    } else {
        log_backend("workspace.folder_picker.cancelled", "status=non_zero");
        None
    }
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

/// Runtime probe: verifies that the current executable can really capture.
/// This avoids false negatives from CGPreflight when macOS TCC state is stale.
fn can_capture_screen_now() -> bool {
    let path = temp_capture_path();
    let cmd_ok = Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let exists = path.exists();
    let ok = cmd_ok && exists;
    log_backend(
        "screenshot.probe",
        format!("path={} command_ok={cmd_ok} exists={exists} granted={ok}", path.display()),
    );
    let _ = fs::remove_file(&path);
    ok
}

/// Silent full-screen screenshot — used internally before showing overlay.
fn take_silent_screenshot() -> Result<String, String> {
    let path = temp_capture_path();
    log_backend("screenshot.silent.start", format!("path={}", path.display()));
    let ok = Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?
        .success();
    if !ok || !path.exists() {
        log_backend(
            "screenshot.silent.failed",
            format!("path={} command_ok={ok} exists={}", path.display(), path.exists()),
        );
        return Err("Screenshot failed".into());
    }
    log_backend("screenshot.silent.success", format!("path={}", path.display()));
    encode_image_at(&path)
}

/// Interactive fallback capture when silent capture fails.
fn take_interactive_fallback_screenshot() -> Result<String, String> {
    let path = temp_capture_path();
    log_backend(
        "screenshot.interactive_fallback.start",
        format!("path={}", path.display()),
    );
    let ok = Command::new("screencapture")
        .args(["-i", "-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|e| format!("interactive screencapture failed: {e}"))?
        .success();
    if !ok || !path.exists() {
        log_backend(
            "screenshot.interactive_fallback.failed",
            format!("path={} command_ok={ok} exists={}", path.display(), path.exists()),
        );
        return Err("Interactive screenshot cancelled or failed".into());
    }
    log_backend(
        "screenshot.interactive_fallback.success",
        format!("path={}", path.display()),
    );
    encode_image_at(&path)
}

/// Interactive screenshot (used from session window).
#[tauri::command]
fn capture_interactive_screenshot(app: AppHandle) -> Result<String, String> {
    let path = temp_capture_path();
    log_backend("screenshot.interactive.start", format!("path={}", path.display()));
    let ok = Command::new("screencapture")
        .args(["-i", "-x"])
        .arg(&path)
        .status()
        .map_err(|e| format!("screencapture failed: {e}"))?
        .success();
    if !ok || !path.exists() {
        log_backend(
            "screenshot.interactive.cancelled_or_failed",
            format!("path={} command_ok={ok} exists={}", path.display(), path.exists()),
        );
        return Err("Screenshot cancelled".into());
    }
    let url = encode_image_at(&path)?;
    log_backend(
        "screenshot.interactive.success",
        format!("path={} data_url_len={}", path.display(), url.len()),
    );
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(url)
}

// ── Window management commands ────────────────────────────────────────────────

/// Relay annotation data from the overlay window to the main window via the
/// Rust backend (avoids frontend emit_to permission restrictions in Tauri v2).
#[tauri::command]
fn finish_annotations(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    log_backend(
        "workspace.annotations.finish",
        format!("payload_keys={}", payload.as_object().map(|o| o.len()).unwrap_or(0)),
    );
    // Emit event to main window
    if let Some(main) = app.get_webview_window("main") {
        main.emit("annotations-saved", &payload)
            .map_err(|e| format!("Failed to emit annotations-saved: {e}"))?;
    } else {
        return Err("Main window not found".into());
    }

    // Hide overlay
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    // Show and focus main window
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| format!("Failed to show main window: {e}"))?;
        main.set_focus().map_err(|e| format!("Failed to focus main window: {e}"))?;
    }

    Ok(())
}

/// Called from frontend (tray Sessions menu or "New Annotation" button).
#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    log_backend("overlay.show.requested", "source=frontend");
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

/// Decode a base64 PNG data URL and save it as a file on disk.
/// Returns the absolute path of the saved PNG so the prompt builder can
/// reference it and the Claude / Codex CLI can view the image.
///
/// Saves to: ~/Library/Application Support/debugr/screenshots/<capture_id>.png
#[tauri::command]
fn save_screenshot(capture_id: String, data_url: String) -> Result<String, String> {
    use base64::Engine as _;

    // Strip the data URL prefix — accept png or jpeg
    let base64_data = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .ok_or_else(|| "Invalid data URL — expected data:image/png;base64,...".to_string())?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode screenshot: {e}"))?;
    log_backend(
        "workspace.screenshot.decode",
        format!("capture_id={} decoded_bytes={}", capture_id, bytes.len()),
    );

    let dir = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
        .join("debugr")
        .join("screenshots");

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create screenshots dir: {e}"))?;

    let path = dir.join(format!("{capture_id}.png"));
    fs::write(&path, bytes).map_err(|e| format!("Failed to write screenshot: {e}"))?;
    log_backend(
        "workspace.screenshot.saved",
        format!("capture_id={} path={}", capture_id, path.display()),
    );

    Ok(path.to_string_lossy().to_string())
}

/// Persist desktop sessions to disk so the local MCP server can read them.
///
/// Writes to:
///   macOS  → ~/Library/Application Support/debugr/sessions.json
///   Linux  → ~/.config/debugr/sessions.json
///   Windows→ %APPDATA%\debugr\sessions.json
#[tauri::command]
fn save_sessions_to_disk(payload: serde_json::Value) -> Result<(), String> {
    let dir = {
        #[cfg(target_os = "macos")]
        {
            dirs_next::data_dir()
                .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
                .join("debugr")
        }
        #[cfg(target_os = "linux")]
        {
            dirs_next::config_dir()
                .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config"))
                .join("debugr")
        }
        #[cfg(target_os = "windows")]
        {
            dirs_next::data_dir()
                .unwrap_or_else(|| PathBuf::from("C:\\"))
                .join("debugr")
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".debugr")
        }
    };

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let file_path = dir.join("sessions.json");
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Serialization failed: {e}"))?;

    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create sessions file: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write sessions: {e}"))?;
    log_backend(
        "workspace.sessions.saved",
        format!(
            "path={} bytes={} sessions={}",
            file_path.display(),
            json.len(),
            payload
                .get("sessions")
                .and_then(|s| s.as_array())
                .map(|arr| arr.len())
                .unwrap_or(0)
        ),
    );

    Ok(())
}

/// Copy text to the macOS clipboard via pbcopy.
#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    use std::io::Write;
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy failed: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    }
    child.wait().map_err(|e| format!("pbcopy wait failed: {e}"))?;
    Ok(())
}

/// Open Cursor at an optional project folder (macOS). Falls back to opening the app with no path.
#[tauri::command]
fn open_in_cursor(project_folder: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg("-a").arg("Cursor");
        if let Some(folder) = project_folder {
            let trimmed = folder.trim();
            if !trimmed.is_empty() {
                cmd.arg(trimmed);
            }
        }
        let status = cmd.status().map_err(|e| format!("Failed to launch Cursor: {e}"))?;
        if !status.success() {
            return Err("Cursor did not open successfully.".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = project_folder;
        Err("Open in Cursor is only available on macOS.".into())
    }
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
    log_backend("overlay.trigger.start", "source=shortcut_or_ui");
    // If already visible, hide it (toggle)
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible().unwrap_or(false) {
            log_backend("overlay.trigger.toggle_hide", "overlay_visible=true");
            let _ = overlay.hide();
            return;
        }
    } else {
        log_backend("overlay.window.missing", "label=overlay");
    }

    if !get_screen_capture_permission() {
        log_backend("overlay.permission.missing", "requesting=true");
        let _ = request_screen_capture_permission();
        if !get_screen_capture_permission() {
            log_backend("overlay.permission.still_missing", "emit_main_warning=true");
            if let Some(main) = app.get_webview_window("main") {
                macos_activate();
                let _ = main.emit("screen-capture-permission-needed", ());
            }
        }
    }

    // Show the native overlay immediately so the toolbar/inspector are visible
    // even if capture permission is slow or unavailable.
    //
    // IMPORTANT: LSUIElement=true means we're an accessory app — macOS will
    // never make us the active application on its own, so window.show() +
    // set_focus() have no visual effect unless we activate first.
    macos_activate();

    if let Some(overlay) = app.get_webview_window("overlay") {
        log_backend("overlay.window.found", "label=overlay");

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
            log_backend(
                "overlay.window.bounds",
                format!("logical_w={lw} logical_h={lh} x={lx} y={ly} scale={scale}"),
            );
            let _ = overlay.set_size(tauri::LogicalSize::new(lw, lh));
            let _ = overlay.set_position(tauri::LogicalPosition::new(lx, ly));
        }

        // Tell the frontend to reset state BEFORE we make the window visible
        let _ = overlay.emit("overlay-will-show", ());
        if let Err(e) = overlay.show() {
            log_backend("overlay.window.show_failed", e.to_string());
        }
        if let Err(e) = overlay.set_focus() {
            log_backend("overlay.window.focus_failed", e.to_string());
        }
    }

    // Capture the screen in a background thread so we don't block the shortcut handler.
    let app = app.clone();
    std::thread::spawn(move || {
        // Small delay so the Debugr window has time to hide if needed
        std::thread::sleep(std::time::Duration::from_millis(80));

        log_backend("overlay.capture.thread_start", "delay_ms=80");
        let screenshot = take_silent_screenshot().or_else(|e| {
            log_backend("overlay.capture.silent_failed", e);
            take_interactive_fallback_screenshot()
        });

        if let Some(overlay) = app.get_webview_window("overlay") {
            // Send screenshot (or empty string on failure) to overlay frontend
            match screenshot {
                Ok(data_url) => {
                    log_backend(
                        "overlay.capture.success",
                        format!("data_url_len={}", data_url.len()),
                    );
                    let _ = overlay.emit("set-screenshot", data_url);
                }
                Err(e) => {
                    log_backend("overlay.capture.failed", e.clone());
                    let _ = overlay.emit("set-screenshot", String::new());
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("screen-capture-failed", e.clone());
                    }
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
            let home = MenuItemBuilder::new("Open Debugr")
                .id("home").build(app)?;
            let annotate = MenuItemBuilder::new("New Annotation  ⌃⌘Z")
                .id("annotate").build(app)?;
            let sessions = MenuItemBuilder::new("Sessions")
                .id("sessions").build(app)?;
            let quit = MenuItemBuilder::new("Quit Debugr")
                .id("quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&home)
                .separator()
                .item(&annotate)
                .item(&sessions)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(tray_template_icon())
                .icon_as_template(true)   // renders correctly in both light & dark menu bar
                .menu(&menu)
                .tooltip("Debugr — ⌃⌘Z to annotate")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "home" => {
                        if let Some(win) = app.get_webview_window("main") {
                            macos_activate();
                            let _ = win.emit("go-home", ());
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "annotate"  => trigger_overlay(app),
                    "sessions"  => {
                        if let Some(win) = app.get_webview_window("main") {
                            macos_activate();
                            let _ = win.emit("enter-session-mode", ());
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on the tray icon → open home screen
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            macos_activate();
                            let _ = win.emit("go-home", ());
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Global shortcut ⌃⌘Z (Control + Command + Z) ───────────────
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                "Ctrl+Cmd+Z",
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
            get_screen_capture_diagnostics,
            request_screen_capture_permission,
            open_screen_capture_settings,
            capture_interactive_screenshot,
            open_command_in_terminal,
            open_auth_popup,
            finish_annotations,
            show_overlay,
            hide_overlay,
            show_session_window,
            hide_main_window,
            pick_folder,
            open_in_cursor,
            copy_to_clipboard,
            save_sessions_to_disk,
            save_screenshot,
            open_url,
            save_provider_config,
            get_provider_config,
            verify_claude_auth,
            verify_claude_api_key,
            verify_codex_key,
            check_cursor_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running debugr.ai");
}
