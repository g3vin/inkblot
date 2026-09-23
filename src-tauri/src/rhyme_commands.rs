//! Rhymes, for the webview's `invoke`. The dictionary and the index are in
//! `inkblot_models::rhymes`, which says why this is a lookup and not a model.

use std::sync::OnceLock;

use inkblot_models::rhymes::{RhymeDictionaryStatus, RhymeEngine, RhymeResponse};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct RhymeState {
    engine: OnceLock<RhymeEngine>,
}

impl RhymeState {
    fn engine(&self, app: &AppHandle) -> Result<&RhymeEngine, String> {
        if let Some(engine) = self.engine.get() {
            return Ok(engine);
        }
        let models = crate::app_data_dir(app)?.join("models");
        Ok(self.engine.get_or_init(|| RhymeEngine::new(models)))
    }
}

#[tauri::command]
pub async fn rhyme_dictionary_status(
    app: AppHandle,
    state: State<'_, RhymeState>,
) -> Result<RhymeDictionaryStatus, String> {
    state.engine(&app)?.status()
}

/// Fetch the dictionary, emitting `rhyme://download` as it goes.
#[tauri::command]
pub async fn download_rhyme_dictionary(
    app: AppHandle,
    state: State<'_, RhymeState>,
) -> Result<RhymeDictionaryStatus, String> {
    let emitter = app.clone();
    state
        .engine(&app)?
        .download(&move |progress| {
            let _ = emitter.emit("rhyme://download", progress);
        })
        .await
}

#[tauri::command]
pub async fn get_rhymes(
    app: AppHandle,
    state: State<'_, RhymeState>,
    word: String,
) -> Result<RhymeResponse, String> {
    state.engine(&app)?.rhymes(&word)
}
