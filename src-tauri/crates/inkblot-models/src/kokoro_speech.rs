//! Read Aloud's native speech: the Kokoro model, through `ort`.
//!
//! The work splits across the process boundary:
//!
//! ```text
//!   webview:  text -> normalize -> phonemize -> token ids   (src/lib/readAloudVoice.ts)
//!   native:   token ids + voice + speed -> ONNX -> f32 @ 24kHz
//! ```
//!
//! Phonemization lives in the webview because a correct English grapheme-to-phoneme
//! pass is a lexicon plus several thousand rules, and `phonemizer` provides one there.
//! No step needs a subprocess, so the pipeline can run on iOS. When the native path is
//! unavailable the page falls back to kokoro-js's in-browser WASM build.
//!
//! ## The model is downloaded, not bundled
//!
//! ~310MB for the model and ~26MB for a voice, from the same public repo the WASM
//! fallback fetches from. It lands in `<AppData>/models/kokoro/`, and until it does,
//! synthesis returns [`MODEL_NOT_INSTALLED`] so the UI can offer the download.

use std::path::PathBuf;
use std::sync::Arc;

use inkblot_core::kokoro;
use ndarray::Array;
use ort::session::builder::SessionBuilder;
use ort::session::Session;
use ort::value::Tensor;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::download;
use crate::MODEL_NOT_INSTALLED;

/// The repo the WASM fallback already fetches from, so the two paths cannot end up on
/// different weights.
const MODEL_BASE_URL: &str =
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const MODEL_FILE: &str = "onnx/model.onnx";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KokoroSpeechResponse {
    /// Raw little-endian f32 samples, base64. Not WAV — the webview's decoder wants the
    /// samples themselves.
    pub audio_base64: String,
    pub sample_rate: u32,
    pub engine: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KokoroModelStatus {
    pub installed: bool,
    /// What is still missing, by file name, for the UI to say so.
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KokoroDownloadProgress {
    pub asset: String,
    pub received: u64,
    /// 0 when the server sends no content-length.
    pub total: u64,
}

/// The session, loaded on first use and kept. Cheap to clone: clones share it.
#[derive(Clone)]
pub struct KokoroEngine {
    dir: PathBuf,
    session: Arc<Mutex<Option<Session>>>,
}

/// A voice name we are willing to turn into a path. Anything else is not a voice, it is
/// an attempt to name a file.
pub fn valid_voice(voice: &str) -> Result<&str, String> {
    let ok = !voice.is_empty()
        && voice.len() <= 40
        && voice
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'_' || b.is_ascii_digit());
    if ok {
        Ok(voice)
    } else {
        Err(format!("not a voice name: {voice}"))
    }
}

impl KokoroEngine {
    /// `dir` is `<AppData>/models/kokoro`.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            session: Arc::new(Mutex::new(None)),
        }
    }

    fn dir(&self) -> Result<PathBuf, String> {
        std::fs::create_dir_all(self.dir.join("voices"))
            .map_err(|e| format!("could not create {:?}: {e}", self.dir))?;
        Ok(self.dir.clone())
    }

    fn model_path(&self) -> Result<PathBuf, String> {
        Ok(self.dir()?.join("model.onnx"))
    }

    fn tokenizer_path(&self) -> Result<PathBuf, String> {
        Ok(self.dir()?.join("tokenizer.json"))
    }

    fn voice_path(&self, voice: &str) -> Result<PathBuf, String> {
        Ok(self
            .dir()?
            .join("voices")
            .join(format!("{}.bin", valid_voice(voice)?)))
    }

    fn missing_assets(&self, voice: &str) -> Result<Vec<String>, String> {
        let mut missing = Vec::new();
        if !self.model_path()?.is_file() {
            missing.push("model.onnx".to_string());
        }
        if !self.tokenizer_path()?.is_file() {
            missing.push("tokenizer.json".to_string());
        }
        if !self.voice_path(voice)?.is_file() {
            missing.push(format!("voices/{voice}.bin"));
        }
        Ok(missing)
    }

    /// The model's phoneme→id map, for the webview's tokenizer.
    ///
    /// Read back out of the downloaded `tokenizer.json` rather than written down
    /// anywhere, because it is part of the weights: a vocabulary that is off by one does
    /// not fail, it produces fluent, confident, wrong speech.
    pub fn vocab(&self) -> Result<serde_json::Value, String> {
        let path = self.tokenizer_path()?;
        if !path.is_file() {
            return Err(MODEL_NOT_INSTALLED.into());
        }

        let raw = std::fs::read_to_string(&path).map_err(|e| format!("reading {path:?}: {e}"))?;
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("invalid tokenizer.json: {e}"))?;

        parsed
            .get("model")
            .and_then(|model| model.get("vocab"))
            .filter(|vocab| vocab.is_object())
            .cloned()
            .ok_or_else(|| "tokenizer.json has no model.vocab".to_string())
    }

    pub fn status(&self, voice: &str) -> Result<KokoroModelStatus, String> {
        let missing = self.missing_assets(voice)?;
        Ok(KokoroModelStatus {
            installed: missing.is_empty(),
            missing,
        })
    }

    /// Fetch whatever is missing for `voice`, reporting progress as it goes.
    pub async fn download(
        &self,
        voice: &str,
        progress: &(dyn Fn(KokoroDownloadProgress) + Send + Sync),
    ) -> Result<KokoroModelStatus, String> {
        let voice = valid_voice(voice)?.to_string();
        let client = download::client()?;

        for asset in self.missing_assets(&voice)? {
            let (url, destination) = match asset.as_str() {
                "model.onnx" => (format!("{MODEL_BASE_URL}/{MODEL_FILE}"), self.model_path()?),
                "tokenizer.json" => (
                    format!("{MODEL_BASE_URL}/tokenizer.json"),
                    self.tokenizer_path()?,
                ),
                _ => (
                    format!("{MODEL_BASE_URL}/voices/{voice}.bin"),
                    self.voice_path(&voice)?,
                ),
            };

            download::fetch_to(&client, &url, &destination, &asset, &|received, total| {
                progress(KokoroDownloadProgress {
                    asset: asset.clone(),
                    received,
                    total,
                })
            })
            .await?;
        }

        self.status(&voice)
    }

    fn with_session<T>(
        &self,
        f: impl FnOnce(&mut Session) -> Result<T, String>,
    ) -> Result<T, String> {
        let model_path = self.model_path()?;
        let mut guard = self.session.lock();
        if guard.is_none() {
            *guard = Some(
                SessionBuilder::new()
                    .map_err(|e| format!("onnx session builder: {e}"))?
                    .commit_from_file(&model_path)
                    .map_err(|e| format!("loading {model_path:?}: {e}"))?,
            );
        }
        f(guard.as_mut().expect("session just loaded"))
    }

    /// Synthesize one chunk. Blocking — run it off any async runtime's workers.
    ///
    /// `tokens` are phoneme ids from the webview, padding included — the padding is
    /// what [`kokoro::style_offset`] subtracts, so it has to still be there.
    pub fn generate(
        &self,
        tokens: Vec<i64>,
        voice: &str,
        speed: Option<f32>,
    ) -> Result<KokoroSpeechResponse, String> {
        if tokens.is_empty() {
            return Err("nothing to speak".into());
        }
        let voice = valid_voice(voice)?;
        if !self.missing_assets(voice)?.is_empty() {
            return Err(MODEL_NOT_INSTALLED.into());
        }

        let voice_path = self.voice_path(voice)?;
        let speed = kokoro::clamp_speed(speed.unwrap_or(1.0));
        let voice_bytes =
            std::fs::read(&voice_path).map_err(|e| format!("reading {voice_path:?}: {e}"))?;
        let style = kokoro::voice_style(&voice_bytes, tokens.len())?;

        self.with_session(|session| {
            let token_count = tokens.len();
            let input_ids = Array::from_shape_vec((1, token_count), tokens)
                .map_err(|e| format!("input ndarray: {e}"))?;
            let style_array = Array::from_shape_vec((1, kokoro::STYLE_DIM), style)
                .map_err(|e| format!("style ndarray: {e}"))?;
            let speed_array = Array::from_vec(vec![speed]);

            // Erased to DynValue because the three inputs are not the same element type
            // — ids are i64, style and speed are f32 — and `run` takes one slice.
            let input_tensor = Tensor::from_array(input_ids)
                .map_err(|e| e.to_string())?
                .into_dyn();
            let style_tensor = Tensor::from_array(style_array)
                .map_err(|e| e.to_string())?
                .into_dyn();
            let speed_tensor = Tensor::from_array(speed_array)
                .map_err(|e| e.to_string())?
                .into_dyn();

            let outputs = session
                .run(vec![
                    ("input_ids", &input_tensor),
                    ("style", &style_tensor),
                    ("speed", &speed_tensor),
                ])
                .map_err(|e| format!("onnx run failed: {e}"))?;

            let (_shape, samples) = outputs["waveform"]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("extract waveform failed: {e}"))?;

            Ok(KokoroSpeechResponse {
                audio_base64: kokoro::encode_samples_base64(samples),
                sample_rate: kokoro::SAMPLE_RATE,
                engine: "kokoro-onnx".to_string(),
            })
        })
    }

    /// Load the model ahead of the first sentence. Blocking.
    ///
    /// Worth doing: the first `commit_from_file` on a 310MB graph is seconds, and paying
    /// it when the user presses play is the difference between Read Aloud feeling
    /// instant and feeling broken.
    pub fn prewarm(&self, voice: &str) -> Result<(), String> {
        if !self.missing_assets(valid_voice(voice)?)?.is_empty() {
            return Err(MODEL_NOT_INSTALLED.into());
        }
        self.with_session(|_| Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_voice_name_cannot_be_a_path() {
        assert!(valid_voice("af_heart").is_ok());
        assert!(valid_voice("bm_fable").is_ok());
        // A voice name reaches the filesystem, so these must not.
        assert!(valid_voice("../../../etc/passwd").is_err());
        assert!(valid_voice("af_heart/../../x").is_err());
        assert!(valid_voice("").is_err());
        assert!(valid_voice("AF_HEART").is_err());
        assert!(valid_voice(&"a".repeat(41)).is_err());
    }

    #[test]
    fn nothing_installed_is_the_sentinel() {
        let dir = std::env::temp_dir().join(format!("inkblot-kokoro-{}", std::process::id()));
        let engine = KokoroEngine::new(&dir);
        assert_eq!(
            engine
                .generate(vec![0, 1, 0], "af_heart", None)
                .unwrap_err(),
            MODEL_NOT_INSTALLED
        );
        assert_eq!(engine.vocab().unwrap_err(), MODEL_NOT_INSTALLED);
        assert_eq!(engine.status("af_heart").unwrap().missing.len(), 3);
        assert!(engine.status("../x").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
