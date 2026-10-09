//! The Tauri app: command registration and setup.
//!
//! Every command the page `invoke`s is registered here. The logic behind each lives
//! in `inkblot-core` (domain, persistence) or `inkblot-models` (on-device models);
//! the `*_commands.rs` modules only adapt it to Tauri — resolving AppData, holding
//! engines as managed state, and turning progress callbacks into `emit`s.
//!
//! ## Adding a command
//!
//! 1. Put the logic in `inkblot-core` or `inkblot-models`, not here, where it can be
//!    tested without Tauri.
//! 2. Add a `#[tauri::command]` wrapper to the fitting `*_commands.rs` (or a new one),
//!    and register it in `generate_handler!` below. Stateful engines go in a
//!    `*State` struct registered with `.manage`.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

mod core_commands;
mod dictation_commands;
mod haptics_commands;
mod kokoro_commands;
mod pinterest_commands;
mod preferences_commands;
mod print_commands;
mod reference_commands;
mod rhyme_commands;
mod stats_commands;
mod synonym_commands;
mod webview_commands;

use core_commands::{list_system_fonts, scrape_pinterest_html};
use dictation_commands::{
    cancel_dictation_session, dictation_status, load_dictation_model, start_dictation_session,
    stop_dictation_session, AppDictationState,
};
use haptics_commands::perform_haptic;
use inkblot_models::scrape::ScrapeChannels;
use kokoro_commands::{
    download_kokoro_model, generate_kokoro_speech, kokoro_model_status, kokoro_vocab,
    prewarm_kokoro_speech, KokoroSpeechState,
};
use pinterest_commands::{pinterest_await_scrape, pinterest_begin_scrape, pinterest_report_scrape};
use preferences_commands::{
    preferences_load, preferences_remove, preferences_rename_prefix, preferences_set,
};
use rhyme_commands::{download_rhyme_dictionary, get_rhymes, rhyme_dictionary_status, RhymeState};
use stats_commands::{
    project_word_counts, stats_config, stats_daily, stats_move_entry, stats_record_session,
    stats_record_timer_run, stats_rename_entry, stats_rename_project, stats_reset, stats_sessions,
    stats_set_config, stats_timer_runs, stats_totals,
};
use synonym_commands::{download_synonym_model, get_synonyms, synonym_model_status, SynonymState};
use webview_commands::{eval_webview, get_webview_url, navigate_webview};

/// `~/Library/Application Support/com.inkblot.app` on macOS: the preferences, the
/// models, the stats and every project not kept elsewhere.
pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppDictationState::default())
        .manage(KokoroSpeechState::default())
        .manage(SynonymState::default())
        .manage(RhymeState::default())
        .manage(ScrapeChannels::default())
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
            get_rhymes,
            rhyme_dictionary_status,
            download_rhyme_dictionary,
            load_dictation_model,
            start_dictation_session,
            stop_dictation_session,
            cancel_dictation_session,
            dictation_status,
            generate_kokoro_speech,
            prewarm_kokoro_speech,
            kokoro_model_status,
            download_kokoro_model,
            kokoro_vocab,
            preferences_load,
            preferences_set,
            preferences_remove,
            preferences_rename_prefix,
            pinterest_begin_scrape,
            pinterest_report_scrape,
            pinterest_await_scrape,
            print_commands::print_webview,
            reference_commands::fetch_text,
            stats_record_session,
            stats_sessions,
            stats_daily,
            stats_totals,
            stats_rename_entry,
            stats_move_entry,
            stats_rename_project,
            stats_reset,
            stats_record_timer_run,
            stats_timer_runs,
            stats_config,
            stats_set_config,
            project_word_counts,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
