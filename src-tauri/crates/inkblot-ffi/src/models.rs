//! `inkblot-models`, as the Swift shell sees it: the synonym model, rhymes, Kokoro
//! speech, whisper dictation and the Pinterest scrape channel.
//!
//! The Tauri commands in `src-tauri/src/*_commands.rs` are the other wrapper over the
//! same engines, and `TauriHost` answers the page's `invoke` for those commands by
//! calling these — so the page cannot tell which shell it is in, which is the point.
//!
//! **Everything here blocks.** Model loads take seconds and downloads take minutes;
//! Swift calls these from a detached task, never from the main actor. The async parts
//! of the engines (downloads, the scrape wait) run on a runtime this object owns,
//! because the Swift side has no tokio for them to borrow.
//!
//! Values cross as JSON for the reason `lib.rs` gives — and here also because the
//! page wants exactly the JSON the Tauri command would have returned, so `TauriHost`
//! hands the string through untouched.

use std::path::PathBuf;
use std::sync::Arc;

use inkblot_core::pinterest::ScrapeReport;
use inkblot_models::dictation::{DictationEngine, LiveDictationOptions};
use inkblot_models::kokoro_speech::KokoroEngine;
use inkblot_models::rhymes::RhymeEngine;
use inkblot_models::scrape::ScrapeChannels;
use inkblot_models::synonyms::SynonymEngine;

use crate::{CoreError, ModelEventSink};

fn failed(message: impl Into<String>) -> CoreError {
    CoreError::Failed(message.into())
}

fn json<T: serde::Serialize>(value: &T) -> Result<String, CoreError> {
    Ok(serde_json::to_string(value)?)
}

fn emit_json<T: serde::Serialize>(sink: &Arc<dyn ModelEventSink>, event: &str, value: &T) {
    if let Ok(payload) = serde_json::to_string(value) {
        sink.emit(event.to_string(), payload);
    }
}

/// The models, rooted at one AppData directory. One per app, like `InkblotCore`: the
/// engines cache loaded sessions, and two would load every model twice.
#[derive(uniffi::Object)]
pub struct InkblotModels {
    runtime: tokio::runtime::Runtime,
    synonyms: SynonymEngine,
    rhymes: RhymeEngine,
    kokoro: KokoroEngine,
    dictation: DictationEngine,
    scrapes: ScrapeChannels,
}

#[uniffi::export]
impl InkblotModels {
    /// `app_data_root` as for `InkblotCore`; `tokenizer_path` is where the app bundle
    /// put `minilm-tokenizer.json`.
    #[uniffi::constructor]
    pub fn new(app_data_root: String, tokenizer_path: String) -> Result<Arc<Self>, CoreError> {
        let root = PathBuf::from(app_data_root);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("inkblot-models")
            .enable_all()
            .build()
            .map_err(|e| failed(format!("could not start the models runtime: {e}")))?;
        Ok(Arc::new(Self {
            runtime,
            synonyms: SynonymEngine::new(root.join("models"), tokenizer_path),
            rhymes: RhymeEngine::new(root.join("models")),
            kokoro: KokoroEngine::new(root.join("models").join("kokoro")),
            dictation: DictationEngine::new(&root),
            scrapes: ScrapeChannels::default(),
        }))
    }

    /* ---------------- synonyms ---------------- */

    pub fn synonym_model_status_json(&self) -> Result<String, CoreError> {
        json(&self.synonyms.status().map_err(failed)?)
    }

    pub fn download_synonym_model_json(
        &self,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let status = self
            .runtime
            .block_on(self.synonyms.download(&|progress| {
                emit_json(&sink, "synonym://download", &progress)
            }))
            .map_err(failed)?;
        json(&status)
    }

    pub fn synonyms_json(&self, text: String, target_word: String) -> Result<String, CoreError> {
        json(&self.synonyms.synonyms(&text, &target_word).map_err(failed)?)
    }

    /* ---------------- rhymes ---------------- */

    pub fn rhyme_dictionary_status_json(&self) -> Result<String, CoreError> {
        json(&self.rhymes.status().map_err(failed)?)
    }

    pub fn download_rhyme_dictionary_json(
        &self,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let status = self
            .runtime
            .block_on(self.rhymes.download(&|progress| {
                emit_json(&sink, "rhyme://download", &progress)
            }))
            .map_err(failed)?;
        json(&status)
    }

    pub fn rhymes_json(&self, word: String) -> Result<String, CoreError> {
        json(&self.rhymes.rhymes(&word).map_err(failed)?)
    }

    /* ---------------- Kokoro ---------------- */

    pub fn kokoro_vocab_json(&self) -> Result<String, CoreError> {
        json(&self.kokoro.vocab().map_err(failed)?)
    }

    pub fn kokoro_model_status_json(&self, voice: String) -> Result<String, CoreError> {
        json(&self.kokoro.status(&voice).map_err(failed)?)
    }

    pub fn download_kokoro_model_json(
        &self,
        voice: String,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let status = self
            .runtime
            .block_on(self.kokoro.download(&voice, &|progress| {
                emit_json(&sink, "kokoro://download", &progress)
            }))
            .map_err(failed)?;
        json(&status)
    }

    pub fn generate_kokoro_speech_json(
        &self,
        tokens: Vec<i64>,
        voice: String,
        speed: Option<f32>,
    ) -> Result<String, CoreError> {
        json(&self.kokoro.generate(tokens, &voice, speed).map_err(failed)?)
    }

    pub fn prewarm_kokoro_speech(&self, voice: String) -> Result<(), CoreError> {
        self.kokoro.prewarm(&voice).map_err(failed)
    }

    /* ---------------- dictation ---------------- */

    pub fn load_dictation_model_json(&self, model_path: Option<String>) -> Result<String, CoreError> {
        json(&self.dictation.load_model(model_path).map_err(failed)?)
    }

    /// `options_json` is a `LiveDictationOptions`, or nothing for the defaults.
    pub fn start_dictation_session(
        &self,
        options_json: Option<String>,
        sink: Arc<dyn ModelEventSink>,
    ) -> Result<String, CoreError> {
        let options = options_json
            .filter(|raw| !raw.trim().is_empty() && raw.trim() != "null")
            .map(|raw| serde_json::from_str::<LiveDictationOptions>(&raw))
            .transpose()?;
        self.dictation
            .start_session(
                options,
                Arc::new(move |event, payload| {
                    sink.emit(event.to_string(), payload.to_string());
                }),
            )
            .map_err(failed)
    }

    pub fn stop_dictation_session(&self) -> Result<(), CoreError> {
        self.dictation.stop_session().map_err(failed)
    }

    pub fn cancel_dictation_session(&self) {
        self.dictation.cancel_session();
    }

    pub fn dictation_status_json(&self) -> Result<String, CoreError> {
        json(&self.dictation.status())
    }

    /* ---------------- the Pinterest scrape channel ---------------- */

    pub fn pinterest_begin_scrape(&self, request_id: String) {
        self.scrapes.begin(request_id);
    }

    /// Called with what the script inside the Pinterest page reported.
    pub fn pinterest_report_scrape(&self, report_json: String) -> Result<(), CoreError> {
        let report: ScrapeReport = serde_json::from_str(&report_json)?;
        self.scrapes.report(report);
        Ok(())
    }

    /// The report as JSON, or nothing if the scrape never reported in time.
    pub fn pinterest_await_scrape_json(
        &self,
        request_id: String,
        timeout_ms: u64,
    ) -> Result<Option<String>, CoreError> {
        let report = self
            .runtime
            .block_on(self.scrapes.await_report(&request_id, timeout_ms))
            .map_err(failed)?;
        report.map(|report| json(&report)).transpose()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Collect(Mutex<Vec<(String, String)>>);

    impl ModelEventSink for Collect {
        fn emit(&self, event: String, payload_json: String) {
            self.0.lock().unwrap().push((event, payload_json));
        }
    }

    fn models() -> (Arc<InkblotModels>, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "inkblot-ffi-models-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let models = InkblotModels::new(
            root.to_string_lossy().into_owned(),
            root.join("tokenizer.json").to_string_lossy().into_owned(),
        )
        .unwrap();
        (models, root)
    }

    #[test]
    fn an_uninstalled_model_answers_with_the_page_s_sentinel() {
        let (models, root) = models();
        let error = models.synonyms_json("a word".into(), "word".into()).unwrap_err();
        assert_eq!(error.to_string(), inkblot_models::MODEL_NOT_INSTALLED);
        let error = models.generate_kokoro_speech_json(vec![0, 1, 0], "af_heart".into(), None).unwrap_err();
        assert_eq!(error.to_string(), inkblot_models::MODEL_NOT_INSTALLED);

        let status: serde_json::Value =
            serde_json::from_str(&models.synonym_model_status_json().unwrap()).unwrap();
        assert_eq!(status["installed"], false);
        // The page reads these by their camelCase names, exactly as from Tauri.
        let status: serde_json::Value =
            serde_json::from_str(&models.kokoro_model_status_json("af_heart".into()).unwrap()).unwrap();
        assert!(status["missing"].as_array().unwrap().len() == 3);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_scrape_channel_crosses_as_json() {
        let (models, root) = models();
        models.pinterest_begin_scrape("r1".into());
        models
            .pinterest_report_scrape(
                r#"{"requestId":"r1","url":"https://pinterest.com/b","pins":[],"reason":"stable","stage":"","progress":false}"#
                    .into(),
            )
            .unwrap();
        let report = models.pinterest_await_scrape_json("r1".into(), 50).unwrap().unwrap();
        assert!(report.contains(r#""reason":"stable""#));

        models.pinterest_begin_scrape("r2".into());
        assert!(models.pinterest_await_scrape_json("r2".into(), 10).unwrap().is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn dictation_options_default_when_absent() {
        let (models, root) = models();
        // No model is loaded, so starting fails — but on the model, not on the options.
        let sink: Arc<dyn ModelEventSink> = Arc::new(Collect(Mutex::new(Vec::new())));
        let error = models.start_dictation_session(Some("null".into()), sink).unwrap_err();
        assert!(!error.to_string().contains("expected"), "{error}");
        let status: serde_json::Value =
            serde_json::from_str(&models.dictation_status_json().unwrap()).unwrap();
        assert_eq!(status["modelLoaded"], false);
        let _ = std::fs::remove_dir_all(root);
    }
}
