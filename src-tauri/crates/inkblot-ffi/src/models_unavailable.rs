//! `InkblotModels` where the models are not built: the iOS slices.
//!
//! Every function `models.rs` exports, with the same names and types, so one set of
//! Swift bindings serves every slice. Each refuses with a message the page shows as
//! it would any other failure; none of them claims a model is merely not downloaded,
//! which would offer a download that could never work.
//!
//! To build the real models for iOS instead: an onnxruntime built for iOS for `ort` to link
//! (it downloads no iOS binaries), whisper.cpp's cmake run for the iOS SDKs, and the
//! `models` feature turned on for those targets in `scripts/build-xcframework.sh`.

use std::sync::Arc;

use crate::{CoreError, ModelEventSink};

fn unavailable<T>() -> Result<T, CoreError> {
    Err(CoreError::Failed("not available on this device yet".into()))
}

#[derive(uniffi::Object)]
pub struct InkblotModels;

// The doc comments on the exported functions are copied from models.rs word for word,
// because UniFFI folds some of them into the checksums (`build-xcframework.sh` compares).
#[uniffi::export]
impl InkblotModels {
    /// `app_data_root` as for `InkblotCore`; `tokenizer_path` is where the app bundle
    /// put `minilm-tokenizer.json`.
    #[uniffi::constructor]
    pub fn new(app_data_root: String, tokenizer_path: String) -> Result<Arc<Self>, CoreError> {
        let _ = (app_data_root, tokenizer_path);
        Ok(Arc::new(Self))
    }

    pub fn synonym_model_status_json(&self) -> Result<String, CoreError> { unavailable() }

    pub fn download_synonym_model_json(&self, sink: Arc<dyn ModelEventSink>) -> Result<String, CoreError> {
        let _ = sink;
        unavailable()
    }

    pub fn synonyms_json(&self, text: String, target_word: String) -> Result<String, CoreError> {
        let _ = (text, target_word);
        unavailable()
    }

    pub fn rhyme_dictionary_status_json(&self) -> Result<String, CoreError> { unavailable() }

    pub fn download_rhyme_dictionary_json(&self, sink: Arc<dyn ModelEventSink>) -> Result<String, CoreError> {
        let _ = sink;
        unavailable()
    }

    pub fn rhymes_json(&self, word: String) -> Result<String, CoreError> {
        let _ = word;
        unavailable()
    }

    pub fn kokoro_vocab_json(&self) -> Result<String, CoreError> { unavailable() }

    pub fn kokoro_model_status_json(&self, voice: String) -> Result<String, CoreError> {
        let _ = voice;
        unavailable()
    }

    pub fn download_kokoro_model_json(
        &self,
        voice: String,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let _ = (voice, sink);
        unavailable()
    }

    pub fn generate_kokoro_speech_json(
        &self,
        tokens: Vec<i64>,
        voice: String,
        speed: Option<f32>,
    ) -> Result<String, CoreError> {
        let _ = (tokens, voice, speed);
        unavailable()
    }

    pub fn prewarm_kokoro_speech(&self, voice: String) -> Result<(), CoreError> {
        let _ = voice;
        unavailable()
    }

    pub fn load_dictation_model_json(&self, model_path: Option<String>) -> Result<String, CoreError> {
        let _ = model_path;
        unavailable()
    }

    /// `options_json` is a `LiveDictationOptions`, or nothing for the defaults.
    pub fn start_dictation_session(
        &self,
        options_json: Option<String>,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let _ = (options_json, sink);
        unavailable()
    }

    pub fn stop_dictation_session(&self) -> Result<(), CoreError> { unavailable() }

    pub fn cancel_dictation_session(&self) {}

    pub fn dictation_status_json(&self) -> Result<String, CoreError> {
        Ok(r#"{"modelLoaded":false,"sessionRunning":false}"#.into())
    }

    pub fn pinterest_begin_scrape(&self, request_id: String) {
        let _ = request_id;
    }

    /// Called with what the script inside the Pinterest page reported.
    pub fn pinterest_report_scrape(&self, report_json: String) -> Result<(), CoreError> {
        let _ = report_json;
        Ok(())
    }

    /// The report as JSON, or nothing if the scrape never reported in time.
    pub fn pinterest_await_scrape_json(
        &self,
        request_id: String,
        timeout_ms: u64,
    ) -> Result<Option<String>, CoreError> {
        let _ = (request_id, timeout_ms);
        Ok(None)
    }
}
