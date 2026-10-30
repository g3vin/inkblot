//! Read Aloud's speech, for the webview's `invoke`. The model is in
//! `inkblot_models::pocket_speech`; this is where Tauri tells it where things are.

use std::sync::OnceLock;

use inkblot_models::pocket_speech::{PocketEngine, SpeechModelStatus, SpeechResponse};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct SpeechState {
    engine: OnceLock<PocketEngine>,
}

impl SpeechState {
    fn engine(&self, app: &AppHandle) -> Result<PocketEngine, String> {
        if let Some(engine) = self.engine.get() {
            return Ok(engine.clone());
        }
        let models = crate::app_data_dir(app)?.join("models");
        // Nothing reads `models/kokoro`, and it can hold 336MB.
        let _ = std::fs::remove_dir_all(models.join("kokoro"));
        let dir = models.join("pocket-tts");
        Ok(self.engine.get_or_init(|| PocketEngine::new(dir)).clone())
    }
}

#[tauri::command]
pub async fn speech_model_status(
    app: AppHandle,
    state: State<'_, SpeechState>,
) -> Result<SpeechModelStatus, String> {
    Ok(state.engine(&app)?.status())
}

/// Fetch whatever is missing, emitting `speech://download` as it goes.
#[tauri::command]
pub async fn download_speech_model(
    app: AppHandle,
    state: State<'_, SpeechState>,
) -> Result<SpeechModelStatus, String> {
    let emitter = app.clone();
    state
        .engine(&app)?
        .download(&move |progress| {
            let _ = emitter.emit("speech://download", progress);
        })
        .await
}

/// Speak one Read Aloud chunk.
#[tauri::command]
pub async fn generate_speech(
    app: AppHandle,
    state: State<'_, SpeechState>,
    text: String,
    voice: String,
) -> Result<SpeechResponse, String> {
    let engine = state.engine(&app)?;
    // Inference is blocking and takes a second or so a sentence; it must not hold the
    // async runtime's worker meanwhile.
    tauri::async_runtime::spawn_blocking(move || engine.generate(&text, &voice))
        .await
        .map_err(|e| format!("speech task failed: {e}"))?
}

/// Load the model and voice ahead of the first sentence.
#[tauri::command]
pub async fn prewarm_speech(
    app: AppHandle,
    state: State<'_, SpeechState>,
    voice: String,
) -> Result<(), String> {
    let engine = state.engine(&app)?;
    tauri::async_runtime::spawn_blocking(move || engine.prewarm(&voice))
        .await
        .map_err(|e| format!("speech prewarm failed: {e}"))?
}
