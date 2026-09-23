//! Read Aloud's native speech, for the webview's `invoke`. The model is in
//! `inkblot_models::kokoro_speech`, which explains the split between phonemizing here
//! and synthesizing there; this is where Tauri tells it where things are.

use std::sync::OnceLock;

use inkblot_models::kokoro_speech::{KokoroEngine, KokoroModelStatus, KokoroSpeechResponse};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct KokoroSpeechState {
    engine: OnceLock<KokoroEngine>,
}

impl KokoroSpeechState {
    fn engine(&self, app: &AppHandle) -> Result<KokoroEngine, String> {
        if let Some(engine) = self.engine.get() {
            return Ok(engine.clone());
        }
        let dir = crate::app_data_dir(app)?
            .join("models")
            .join("kokoro");
        Ok(self.engine.get_or_init(|| KokoroEngine::new(dir)).clone())
    }
}

#[tauri::command]
pub async fn kokoro_vocab(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
) -> Result<serde_json::Value, String> {
    state.engine(&app)?.vocab()
}

#[tauri::command]
pub async fn kokoro_model_status(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    voice: String,
) -> Result<KokoroModelStatus, String> {
    state.engine(&app)?.status(&voice)
}

/// Fetch whatever is missing, emitting `kokoro://download` as it goes.
#[tauri::command]
pub async fn download_kokoro_model(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    voice: String,
) -> Result<KokoroModelStatus, String> {
    let emitter = app.clone();
    state
        .engine(&app)?
        .download(&voice, &move |progress| {
            let _ = emitter.emit("kokoro://download", progress);
        })
        .await
}

/// Synthesize one chunk.
#[tauri::command]
pub async fn generate_kokoro_speech(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    tokens: Vec<i64>,
    voice: String,
    speed: Option<f32>,
) -> Result<KokoroSpeechResponse, String> {
    let engine = state.engine(&app)?;
    // ONNX inference is blocking and slow enough to matter; it must not hold the async
    // runtime's worker while a paragraph is synthesized.
    tauri::async_runtime::spawn_blocking(move || engine.generate(tokens, &voice, speed))
        .await
        .map_err(|e| format!("kokoro task failed: {e}"))?
}

/// Load the model ahead of the first sentence.
#[tauri::command]
pub async fn prewarm_kokoro_speech(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    voice: String,
) -> Result<(), String> {
    let engine = state.engine(&app)?;
    tauri::async_runtime::spawn_blocking(move || engine.prewarm(&voice))
        .await
        .map_err(|e| format!("kokoro prewarm failed: {e}"))?
}
