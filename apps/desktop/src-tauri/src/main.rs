use std::{
  fs,
  path::PathBuf,
  process::Command,
  time::{SystemTime, UNIX_EPOCH},
};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
  fn CGPreflightScreenCaptureAccess() -> bool;
  fn CGRequestScreenCaptureAccess() -> bool;
}

fn temp_capture_path() -> PathBuf {
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .unwrap_or(0);
  std::env::temp_dir().join(format!("debugr-native-capture-{stamp}.png"))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let status = Command::new("open")
    .arg(&url)
    .status()
    .map_err(|error| format!("Failed to open URL: {error}"))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("macOS could not open the URL. Exit status: {status}"))
  }
}

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
  let status = Command::new("open")
    .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    .status()
    .map_err(|error| format!("Failed to open System Settings: {error}"))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("macOS could not open Screen Recording settings. Exit status: {status}"))
  }
}

#[tauri::command]
fn capture_interactive_screenshot() -> Result<String, String> {
  let path = temp_capture_path();

  let status = Command::new("screencapture")
    .args(["-i", "-x"])
    .arg(&path)
    .status()
    .map_err(|error| format!("Failed to start macOS screencapture: {error}"))?;

  if !status.success() {
    return Err("Screen capture was cancelled or macOS blocked it.".to_string());
  }

  if !path.exists() {
    return Err("No screenshot file was created.".to_string());
  }

  let encoded = Command::new("base64")
    .arg("-i")
    .arg(&path)
    .output()
    .map_err(|error| format!("Failed to encode screenshot: {error}"))?;

  let _ = fs::remove_file(&path);

  if !encoded.status.success() {
    return Err("macOS captured the screenshot, but encoding failed.".to_string());
  }

  let body = String::from_utf8(encoded.stdout)
    .map_err(|error| format!("Screenshot encoding was not valid UTF-8: {error}"))?
    .replace('\n', "");

  Ok(format!("data:image/png;base64,{body}"))
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      open_external_url,
      get_screen_capture_permission,
      request_screen_capture_permission,
      open_screen_capture_settings,
      capture_interactive_screenshot
    ])
    .run(tauri::generate_context!())
    .expect("error while running debugr.ai desktop app");
}
