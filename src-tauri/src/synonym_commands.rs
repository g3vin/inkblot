//! The synonym model, for the webview's `invoke`. The model is in
//! `inkblot_models::synonyms`; this is where Tauri tells it where things are.

use std::sync::OnceLock;

use inkblot_models::synonyms::{SynonymEngine, SynonymModelStatus, SynonymResponse};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct SynonymState {
    engine: OnceLock<SynonymEngine>,
}

impl SynonymState {
    fn engine(&self, app: &AppHandle) -> Result<&SynonymEngine, String> {
        if let Some(engine) = self.engine.get() {
            return Ok(engine);
        }
        let models = crate::app_data_dir(app)?
            .join("models");
        let tokenizer = app
            .path()
            .resolve("resources/minilm-tokenizer.json", BaseDirectory::Resource)
            .map_err(|e| format!("tokenizer resource missing: {e}"))?;
        Ok(self.engine.get_or_init(|| SynonymEngine::new(models, tokenizer)))
    }
}

#[tauri::command]
pub async fn synonym_model_status(
    app: AppHandle,
    state: State<'_, SynonymState>,
) -> Result<SynonymModelStatus, String> {
    state.engine(&app)?.status()
}

/// Fetches whatever is missing into the app data dir, emitting `synonym://download`
/// as it goes.
#[tauri::command]
pub async fn download_synonym_model(
    app: AppHandle,
    state: State<'_, SynonymState>,
) -> Result<SynonymModelStatus, String> {
    let emitter = app.clone();
    state
        .engine(&app)?
        .download(&move |progress| {
            let _ = emitter.emit("synonym://download", progress);
        })
        .await
}

#[tauri::command]
pub async fn get_synonyms(
    app: AppHandle,
    state: State<'_, SynonymState>,
    text: String,
    target_word: String,
) -> Result<SynonymResponse, String> {
    state.engine(&app)?.synonyms(&text, &target_word)
}
