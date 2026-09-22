//! The Tauri shell: command registration and app setup.
//!
//! The builder lives here rather than in `main.rs` so that every target can share it.
//! `main.rs` is the desktop binary and does nothing but call `run()`; the mobile entry
//! point calls the same function, and the `staticlib`/`cdylib` outputs are what a
//! native Swift shell would link against.
//!
//! This file used to hold a second, parallel `tauri::Builder` that registered no
//! commands and was never called by anything.

use tauri::{AppHandle, Manager};
use url::Url;


mod dictation_commands;
mod kokoro_commands;
mod pinterest_commands;
mod preferences_commands;
mod synonym_commands;

use dictation_commands::{
    cancel_dictation_session, dictation_status, load_dictation_model, start_dictation_session,
    stop_dictation_session, AppDictationState,
};
use kokoro_commands::{generate_kokoro_speech, prewarm_kokoro_speech, KokoroSpeechState};
use pinterest_commands::{
    pinterest_await_scrape, pinterest_begin_scrape, pinterest_report_scrape, ScrapeChannels,
};
use preferences_commands::{
    preferences_load, preferences_remove, preferences_rename_prefix, preferences_set,
};
use synonym_commands::{
    download_synonym_model, get_synonyms, synonym_model_status, SynonymState,
};

/* ============================================================
   WEBVIEW COMMANDS
============================================================ */

#[tauri::command]
async fn navigate_webview(app_handle: AppHandle, label: String, url: String) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        let parsed_url = Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

        let webview_clone = webview.clone();

        webview
            .run_on_main_thread(move || {
                let _ = webview_clone.navigate(parsed_url);
            })
            .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

        Ok(())
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

#[tauri::command]
async fn get_webview_url(app_handle: AppHandle, label: String) -> Result<String, String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        webview
            .url()
            .map(|u| u.to_string())
            .map_err(|e| format!("Failed to get URL: {e}"))
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

#[tauri::command]
async fn eval_webview(app_handle: AppHandle, label: String, script: String) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        webview
            .eval(script)
            .map_err(|e| format!("Failed to evaluate script: {e}"))
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

/* ============================================================
   HAPTICS
============================================================ */

/// Tap the trackpad.
///
/// `NSHapticFeedbackPattern`: Generic = 0, Alignment = 1, LevelChange = 2.
/// Alignment is the light tick AppKit uses when a dragged object snaps to a
/// guide; LevelChange is the heavier one. Both are no-ops on hardware without a
/// Force Touch trackpad, and on a user who has turned feedback off in System
/// Settings — the OS decides, which is why nothing here tries to.
#[cfg(target_os = "macos")]
fn perform_haptic_pattern(pattern: isize) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let performer: *mut AnyObject = msg_send![class!(NSHapticFeedbackManager), defaultPerformer];
        if performer.is_null() {
            return;
        }

        // performanceTime: NSHapticFeedbackPerformanceTimeNow = 1.
        let _: () = msg_send![performer, performFeedbackPattern: pattern, performanceTime: 1isize];
    }
}

#[tauri::command]
fn perform_haptic(app_handle: AppHandle, pattern: String) -> Result<(), String> {
    let _ = &pattern;

    #[cfg(target_os = "macos")]
    {
        let raw: isize = match pattern.as_str() {
            "alignment" => 1,
            "level" => 2,
            _ => 0,
        };

        // AppKit's feedback manager is main-thread only; commands are not.
        app_handle
            .run_on_main_thread(move || perform_haptic_pattern(raw))
            .map_err(|e| format!("Failed to perform haptic: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app_handle;

    Ok(())
}

/* ============================================================
   CORE DELEGATES

   Thin #[tauri::command] shims over inkblot-core. The logic lives in the core
   crate so a native shell can call it without going through Tauri.
============================================================ */

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>, String> {
    inkblot_core::fonts::list_system_fonts()
}

#[tauri::command]
async fn scrape_pinterest_html(
    url: String,
    max_pins: Option<usize>,
) -> Result<inkblot_core::pinterest::ScrapeResult, String> {
    inkblot_core::pinterest::scrape_pinterest_html(url, max_pins).await
}

/* ============================================================
   MAIN
============================================================ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppDictationState::default())
        .manage(KokoroSpeechState::default())
        .manage(SynonymState::default())
        .manage(ScrapeChannels::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            navigate_webview,
            get_webview_url,
            eval_webview,
            scrape_pinterest_html,
            list_system_fonts,
            perform_haptic,
            get_synonyms,
            synonym_model_status,
            download_synonym_model,
            load_dictation_model,
            start_dictation_session,
            stop_dictation_session,
            cancel_dictation_session,
            dictation_status,
            generate_kokoro_speech,
            prewarm_kokoro_speech,
            preferences_load,
            preferences_set,
            preferences_remove,
            preferences_rename_prefix,
            pinterest_begin_scrape,
            pinterest_report_scrape,
            pinterest_await_scrape,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
