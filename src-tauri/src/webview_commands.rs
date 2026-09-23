//! Driving the app's other webviews by label: the Pinterest window and its hidden
//! scrape webview. `eval_webview` discards the script's result, which is why the
//! scrape reports back through `pinterest_commands` instead.

use tauri::{AppHandle, Manager};
use url::Url;

#[tauri::command]
pub async fn navigate_webview(app_handle: AppHandle, label: String, url: String) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;
    let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;

    let target = webview.clone();
    webview
        .run_on_main_thread(move || {
            let _ = target.navigate(parsed_url);
        })
        .map_err(|e| format!("run_on_main_thread failed: {e}"))
}

#[tauri::command]
pub async fn get_webview_url(app_handle: AppHandle, label: String) -> Result<String, String> {
    let webview = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;
    webview
        .url()
        .map(|u| u.to_string())
        .map_err(|e| format!("Failed to get URL: {e}"))
}

#[tauri::command]
pub async fn eval_webview(app_handle: AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;
    webview
        .eval(script)
        .map_err(|e| format!("Failed to evaluate script: {e}"))
}
