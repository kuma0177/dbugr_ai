fn main() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running debugr.ai desktop app");
}
