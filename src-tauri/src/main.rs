// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{AppHandle, Manager};
use url::Url;

#[tauri::command]
async fn navigate_webview(app_handle: AppHandle, label: String, url: String) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
        let webview_clone = webview.clone(); // ✅ clone handle before moving into closure

        webview
            .run_on_main_thread(move || {
                if let Err(e) = webview_clone.navigate(parsed_url) {
                    eprintln!("Failed to navigate webview: {}", e);
                }
            })
            .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

        Ok(())
    } else {
        Err(format!("Webview with label '{}' not found", label))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // Add this!
        .invoke_handler(tauri::generate_handler![navigate_webview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}