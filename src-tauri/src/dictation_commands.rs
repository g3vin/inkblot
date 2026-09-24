//! Whisper dictation, for the webview's `invoke`. The pipeline and the level meter are
//! in `inkblot_models::dictation`; this forwards its events to `AppHandle::emit`.

use std::sync::{Arc, OnceLock};

use inkblot_models::dictation::{
    DictationEngine, DictationSink, DictationStatus, LiveDictationOptions, ModelInfo,
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct AppDictationState {
    engine: OnceLock<DictationEngine>,
}

impl AppDictationState {
    fn engine(&self, app: &AppHandle) -> Result<&DictationEngine, String> {
        if let Some(engine) = self.engine.get() {
            return Ok(engine);
        }
        let data = crate::app_data_dir(app)?;
        Ok(self.engine.get_or_init(|| DictationEngine::new(data)))
    }
}

fn tauri_sink(app: AppHandle) -> DictationSink {
    Arc::new(move |event, payload| {
        let _ = app.emit(event, payload);
    })
}

#[tauri::command]
pub async fn load_dictation_model(
    app: AppHandle,
    state: State<'_, AppDictationState>,
    model_path: Option<String>,
) -> Result<ModelInfo, String> {
    state.engine(&app)?.load_model(model_path)
}

#[tauri::command]
pub async fn start_dictation_session(
    app: AppHandle,
    state: State<'_, AppDictationState>,
    options: Option<LiveDictationOptions>,
) -> Result<String, String> {
    state
        .engine(&app)?
        .start_session(options, tauri_sink(app.clone()))
}

#[tauri::command]
pub async fn stop_dictation_session(
    app: AppHandle,
    state: State<'_, AppDictationState>,
) -> Result<(), String> {
    state.engine(&app)?.stop_session()
}

#[tauri::command]
pub async fn cancel_dictation_session(
    app: AppHandle,
    state: State<'_, AppDictationState>,
) -> Result<(), String> {
    state.engine(&app)?.cancel_session();
    Ok(())
}

#[tauri::command]
pub async fn dictation_status(
    app: AppHandle,
    state: State<'_, AppDictationState>,
) -> Result<DictationStatus, String> {
    Ok(state.engine(&app)?.status())
}
