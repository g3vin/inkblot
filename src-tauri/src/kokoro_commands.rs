//! Read Aloud's native speech, without Python.
//!
//! ## What this replaced
//!
//! A **long-lived Python child process**. The Rust side probed anaconda, homebrew and
//! system Python for an interpreter that had `pip install 'kokoro>=0.9.4' soundfile
//! misaki[en]` done to it, spawned it, and spoke JSON over its stdin and stdout. Two
//! consequences:
//!
//! - Read Aloud worked natively on the machine it was set up on, and silently fell back
//!   to the in-browser WASM build everywhere else. Nobody was told why.
//! - **Subprocesses are impossible on iOS and iPadOS**, so it blocked two of the three
//!   targets this migration exists to reach.
//!
//! ## What it is now
//!
//! The same model, through `ort`, which was already a dependency here. The work splits
//! across the seam:
//!
//! ```text
//!   webview:  text -> normalize -> phonemize -> token ids   (lib/readAloudVoice.js)
//!   native:   token ids + voice + speed -> ONNX -> f32 @ 24kHz
//! ```
//!
//! Phonemization stays in the webview because a correct English grapheme-to-phoneme
//! pass is a lexicon plus several thousand rules, there is a working one there already,
//! and — the part that matters — it is not a subprocess, so it does not block iOS.
//!
//! ## The model is downloaded, not bundled
//!
//! ~310MB for the model and ~26MB for a voice, from the same public repo the WASM
//! fallback fetches from. Same arrangement as the synonym model: it lands in
//! `<AppData>/models/kokoro/`, and until it does, `generate_kokoro_speech` returns the
//! `MODEL_NOT_INSTALLED` sentinel so the UI can offer the download rather than fail.

use std::io::Write;
use std::path::PathBuf;

use inkblot_core::kokoro;
use ndarray::Array;
use ort::session::builder::SessionBuilder;
use ort::session::Session;
use ort::value::Tensor;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// The repo the WASM fallback already fetches from, so the two paths cannot end up on
/// different weights.
const MODEL_BASE_URL: &str =
    "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";
const MODEL_FILE: &str = "onnx/model.onnx";

/// The sentinel `ReadAloudControl` matches on to offer the download. Prose here would
/// be shown to the user as an error instead.
const MODEL_NOT_INSTALLED: &str = "MODEL_NOT_INSTALLED";

#[derive(Default)]
pub struct KokoroSpeechState {
    session: Arc<Mutex<Option<Session>>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroSpeechResponse {
    /// Raw little-endian f32 samples, base64. Not WAV — the webview's decoder wants the
    /// samples themselves.
    pub audio_base64: String,
    pub sample_rate: u32,
    pub engine: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KokoroModelStatus {
    pub installed: bool,
    /// What is still missing, by file name, for the UI to say so.
    pub missing: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    asset: String,
    received: u64,
    /// 0 when the server sends no content-length.
    total: u64,
}

fn kokoro_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("models")
        .join("kokoro");
    std::fs::create_dir_all(dir.join("voices"))
        .map_err(|e| format!("could not create {dir:?}: {e}"))?;
    Ok(dir)
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(kokoro_dir(app)?.join("model.onnx"))
}

fn voice_path(app: &AppHandle, voice: &str) -> Result<PathBuf, String> {
    Ok(kokoro_dir(app)?.join("voices").join(format!("{voice}.bin")))
}

/// A voice name we are willing to turn into a path. Anything else is not a voice, it is
/// an attempt to name a file.
fn valid_voice(voice: &str) -> Result<&str, String> {
    let ok = !voice.is_empty()
        && voice.len() <= 40
        && voice.bytes().all(|b| b.is_ascii_lowercase() || b == b'_' || b.is_ascii_digit());
    if ok {
        Ok(voice)
    } else {
        Err(format!("not a voice name: {voice}"))
    }
}

fn tokenizer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(kokoro_dir(app)?.join("tokenizer.json"))
}

fn missing_assets(app: &AppHandle, voice: &str) -> Result<Vec<String>, String> {
    let mut missing = Vec::new();
    if !model_path(app)?.is_file() {
        missing.push("model.onnx".to_string());
    }
    if !tokenizer_path(app)?.is_file() {
        missing.push("tokenizer.json".to_string());
    }
    if !voice_path(app, valid_voice(voice)?)?.is_file() {
        missing.push(format!("voices/{voice}.bin"));
    }
    Ok(missing)
}

/// The model's phoneme→id map, for the webview's tokenizer.
///
/// Read back out of the downloaded `tokenizer.json` rather than written down anywhere,
/// because it is part of the weights: a vocabulary that is off by one does not fail,
/// it produces fluent, confident, wrong speech.
#[tauri::command]
pub async fn kokoro_vocab(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = tokenizer_path(&app)?;
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

#[tauri::command]
pub async fn kokoro_model_status(
    app: AppHandle,
    voice: String,
) -> Result<KokoroModelStatus, String> {
    let missing = missing_assets(&app, &voice)?;
    Ok(KokoroModelStatus { installed: missing.is_empty(), missing })
}

/// Fetch whatever is missing, emitting `kokoro://download` as it goes.
///
/// Downloads land beside their destination and are renamed into place, so an
/// interrupted download is never mistaken for an installed model — the same rule the
/// synonym model follows, and for the same reason: a half-written ONNX file fails at
/// load time with an error nobody can act on.
#[tauri::command]
pub async fn download_kokoro_model(
    app: AppHandle,
    voice: String,
) -> Result<KokoroModelStatus, String> {
    let voice = valid_voice(&voice)?.to_string();

    let client = reqwest::Client::builder()
        .user_agent("inkblot")
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    for asset in missing_assets(&app, &voice)? {
        let (url, destination) = match asset.as_str() {
            "model.onnx" => (format!("{MODEL_BASE_URL}/{MODEL_FILE}"), model_path(&app)?),
            "tokenizer.json" => {
                (format!("{MODEL_BASE_URL}/tokenizer.json"), tokenizer_path(&app)?)
            }
            _ => (format!("{MODEL_BASE_URL}/voices/{voice}.bin"), voice_path(&app, &voice)?),
        };

        let mut response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("downloading {asset}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("downloading {asset}: {e}"))?;

        let total = response.content_length().unwrap_or(0);
        let partial = destination.with_extension("partial");
        let mut file =
            std::fs::File::create(&partial).map_err(|e| format!("creating {partial:?}: {e}"))?;

        let mut received: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) =
            response.chunk().await.map_err(|e| format!("downloading {asset}: {e}"))?
        {
            file.write_all(&chunk).map_err(|e| format!("writing {partial:?}: {e}"))?;
            received += chunk.len() as u64;

            if received - last_emit >= 4 * 1024 * 1024 || received == total {
                last_emit = received;
                let _ = app.emit(
                    "kokoro://download",
                    DownloadProgress { asset: asset.clone(), received, total },
                );
            }
        }

        file.flush().map_err(|e| format!("flushing {partial:?}: {e}"))?;
        drop(file);
        std::fs::rename(&partial, &destination)
            .map_err(|e| format!("installing {destination:?}: {e}"))?;
    }

    let missing = missing_assets(&app, &voice)?;
    Ok(KokoroModelStatus { installed: missing.is_empty(), missing })
}

/// Synthesize one chunk.
///
/// `tokens` are phoneme ids from the webview, padding included — the padding is what
/// [`kokoro::style_offset`] subtracts, so it has to still be there.
#[tauri::command]
pub async fn generate_kokoro_speech(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    tokens: Vec<i64>,
    voice: String,
    speed: Option<f32>,
) -> Result<KokoroSpeechResponse, String> {
    if tokens.is_empty() {
        return Err("nothing to speak".into());
    }
    let voice = valid_voice(&voice)?.to_string();
    if !missing_assets(&app, &voice)?.is_empty() {
        return Err(MODEL_NOT_INSTALLED.into());
    }

    let session = state.session.clone();
    let model_path = model_path(&app)?;
    let voice_path = voice_path(&app, &voice)?;
    let speed = kokoro::clamp_speed(speed.unwrap_or(1.0));

    // ONNX inference is blocking and slow enough to matter; it must not hold the async
    // runtime's worker while a paragraph is synthesized.
    tauri::async_runtime::spawn_blocking(move || {
        let voice_bytes = std::fs::read(&voice_path)
            .map_err(|e| format!("reading {voice_path:?}: {e}"))?;
        let style = kokoro::voice_style(&voice_bytes, tokens.len())?;

        let mut guard = session.lock();
        if guard.is_none() {
            *guard = Some(
                SessionBuilder::new()
                    .map_err(|e| format!("onnx session builder: {e}"))?
                    .commit_from_file(&model_path)
                    .map_err(|e| format!("loading {model_path:?}: {e}"))?,
            );
        }
        let session = guard.as_mut().expect("session just loaded");

        let token_count = tokens.len();
        let input_ids = Array::from_shape_vec((1, token_count), tokens)
            .map_err(|e| format!("input ndarray: {e}"))?;
        let style_array =
            Array::from_shape_vec((1, kokoro::STYLE_DIM), style).map_err(|e| format!("style ndarray: {e}"))?;
        let speed_array = Array::from_vec(vec![speed]);

        // Erased to DynValue because the three inputs are not the same element type
        // — ids are i64, style and speed are f32 — and `run` takes one slice.
        let input_tensor = Tensor::from_array(input_ids).map_err(|e| e.to_string())?.into_dyn();
        let style_tensor = Tensor::from_array(style_array).map_err(|e| e.to_string())?.into_dyn();
        let speed_tensor = Tensor::from_array(speed_array).map_err(|e| e.to_string())?.into_dyn();

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
    .await
    .map_err(|e| format!("kokoro task failed: {e}"))?
}

/// Load the model and the voice ahead of the first sentence.
///
/// Worth doing: the first `commit_from_file` on a 310MB graph is seconds, and paying it
/// when the user presses play is the difference between Read Aloud feeling instant and
/// feeling broken.
#[tauri::command]
pub async fn prewarm_kokoro_speech(
    app: AppHandle,
    state: State<'_, KokoroSpeechState>,
    voice: String,
) -> Result<(), String> {
    let voice = valid_voice(&voice)?.to_string();
    if !missing_assets(&app, &voice)?.is_empty() {
        return Err(MODEL_NOT_INSTALLED.into());
    }

    let session = state.session.clone();
    let model_path = model_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = session.lock();
        if guard.is_none() {
            *guard = Some(
                SessionBuilder::new()
                    .map_err(|e| format!("onnx session builder: {e}"))?
                    .commit_from_file(&model_path)
                    .map_err(|e| format!("loading {model_path:?}: {e}"))?,
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("kokoro prewarm failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::valid_voice;

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
}
