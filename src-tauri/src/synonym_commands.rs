//! Synonym and antonym suggestions from a local ONNX model.
//!
//! Two things here exist to keep the app genuinely offline and genuinely shippable,
//! because neither was true before:
//!
//!   * The model is ~423 MB, so it is NOT bundled. It downloads once into the app
//!     data directory and is cached there for good. It used to be fetched at BUILD
//!     time into `public/`, which meant 426 MB rode along inside the frontend bundle
//!     even though nothing in the frontend ever read it, and Rust then loaded it by
//!     the relative path `../public/synonym.onnx` — which resolves only when the
//!     working directory is `src-tauri/`, i.e. in dev. In a bundled `.app` it panicked.
//!
//!   * The tokenizer IS bundled (455 KB, `resources/minilm-tokenizer.json`).
//!     `Tokenizer::from_pretrained(...)` reached out to HuggingFace on first use, so
//!     the one feature advertised as local inference needed the network to start.
//!
//! Loading is lazy and fallible: a missing model returns `MODEL_NOT_INSTALLED` for the
//! frontend to act on, rather than aborting the process before a window exists.

use ndarray::Array;
use once_cell::sync::Lazy;
use ort::session::builder::SessionBuilder;
use ort::session::Session;
use ort::value::Tensor;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tokenizers::Tokenizer;

/// The GitHub repo the model assets are pulled from, and the ref to pull them at.
const MODEL_REPO: &str = "g3vin/inkblot-nlp-models";
const MODEL_REF: &str = "main";

/// `synonym.onnx` stores its weights as external data — ONNX Runtime fails at load
/// with an opaque "unknown exception in Initialize()" if the `.data` file is not
/// sitting next to it, so the two are always fetched as a set.
const MODEL_ASSETS: [&str; 3] = ["synonym.onnx", "synonym.onnx.data", "vocab_kaggle.json"];

const MAX_LEN: usize = 32;

static TOKENIZER: Lazy<Mutex<Option<Tokenizer>>> = Lazy::new(|| Mutex::new(None));

struct SynonymModel {
    session: Session,
    vocab: Vec<String>,
}

#[derive(Default)]
pub struct SynonymState {
    model: Mutex<Option<SynonymModel>>,
}

#[derive(Serialize)]
pub struct SynonymResponse {
    synonyms: Vec<String>,
    antonyms: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SynonymModelStatus {
    /// Every asset is present on disk.
    installed: bool,
    /// The session is built and resident in memory.
    loaded: bool,
    /// Which assets are still missing, for a precise message in the UI.
    missing: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    asset: String,
    /// 1-based, so the UI can say "2 of 3".
    index: usize,
    count: usize,
    received: u64,
    /// 0 when the server sends no content-length.
    total: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    Ok(dir)
}

fn missing_assets(app: &AppHandle) -> Result<Vec<String>, String> {
    let dir = models_dir(app)?;
    Ok(MODEL_ASSETS
        .iter()
        .filter(|asset| !dir.join(asset).is_file())
        .map(|asset| (*asset).to_string())
        .collect())
}

/// The bundled tokenizer, loaded once. Kept separate from the model so that a missing
/// model does not also cost us the tokenizer, and vice versa.
fn with_tokenizer<T>(app: &AppHandle, f: impl FnOnce(&Tokenizer) -> T) -> Result<T, String> {
    let mut guard = TOKENIZER.lock().unwrap();
    if guard.is_none() {
        let path = app
            .path()
            .resolve("resources/minilm-tokenizer.json", BaseDirectory::Resource)
            .map_err(|e| format!("tokenizer resource missing: {e}"))?;
        let tokenizer = Tokenizer::from_file(&path)
            .map_err(|e| format!("could not load tokenizer at {path:?}: {e}"))?;
        *guard = Some(tokenizer);
    }
    Ok(f(guard.as_ref().expect("tokenizer just loaded")))
}

fn find_target_position(encoding: &tokenizers::Encoding, text: &str, target: &str) -> i64 {
    let offsets = encoding.get_offsets();
    let start_char = text.find(target).unwrap_or(0);

    for (i, (s, e)) in offsets.iter().enumerate() {
        if (*s as usize) <= start_char && start_char < (*e as usize) {
            return i as i64;
        }
    }
    0
}

/* ============================================================
   COMMANDS
============================================================ */

#[tauri::command]
pub async fn synonym_model_status(
    app: AppHandle,
    state: State<'_, SynonymState>,
) -> Result<SynonymModelStatus, String> {
    let missing = missing_assets(&app)?;
    Ok(SynonymModelStatus {
        installed: missing.is_empty(),
        loaded: state.model.lock().unwrap().is_some(),
        missing,
    })
}

/// Fetches whatever is missing into the app data dir, emitting `synonym://download`
/// as it goes. Downloads to a `.part` file and renames on completion, so an interrupted
/// download is never mistaken for an installed asset.
#[tauri::command]
pub async fn download_synonym_model(app: AppHandle) -> Result<SynonymModelStatus, String> {
    let dir = models_dir(&app)?;
    let missing = missing_assets(&app)?;
    let count = missing.len();

    let client = reqwest::Client::builder()
        .user_agent("inkblot")
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    for (i, asset) in missing.iter().enumerate() {
        let meta_url =
            format!("https://api.github.com/repos/{MODEL_REPO}/contents/{asset}?ref={MODEL_REF}");
        // reqwest is built with default-features = false and no `json` feature, so the
        // body is parsed with serde_json rather than pulling one in.
        let meta_body = client
            .get(&meta_url)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("metadata for {asset}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("metadata for {asset}: {e}"))?
            .text()
            .await
            .map_err(|e| format!("metadata for {asset}: {e}"))?;
        let meta: serde_json::Value = serde_json::from_str(&meta_body)
            .map_err(|e| format!("metadata for {asset}: {e}"))?;

        let url = meta
            .get("download_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("no download_url for {asset}"))?;

        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("downloading {asset}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("downloading {asset}: {e}"))?;

        let total = response.content_length().unwrap_or(0);
        let part = dir.join(format!("{asset}.part"));
        let mut file =
            std::fs::File::create(&part).map_err(|e| format!("creating {part:?}: {e}"))?;

        let mut received: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("reading {asset}: {e}"))?
        {
            file.write_all(&chunk)
                .map_err(|e| format!("writing {asset}: {e}"))?;
            received += chunk.len() as u64;

            // Throttle to ~every 4 MB; the .data file is 422 MB and would otherwise
            // flood the bridge with tens of thousands of events.
            if received - last_emit >= 4 * 1024 * 1024 || received == total {
                last_emit = received;
                let _ = app.emit(
                    "synonym://download",
                    DownloadProgress {
                        asset: asset.clone(),
                        index: i + 1,
                        count,
                        received,
                        total,
                    },
                );
            }
        }

        file.flush().map_err(|e| format!("flushing {asset}: {e}"))?;
        drop(file);
        std::fs::rename(&part, dir.join(asset))
            .map_err(|e| format!("finalising {asset}: {e}"))?;
    }

    let missing = missing_assets(&app)?;
    Ok(SynonymModelStatus {
        installed: missing.is_empty(),
        loaded: false,
        missing,
    })
}

#[tauri::command]
pub async fn get_synonyms(
    app: AppHandle,
    state: State<'_, SynonymState>,
    text: String,
    target_word: String,
) -> Result<SynonymResponse, String> {
    let dir = models_dir(&app)?;

    let mut guard = state.model.lock().unwrap();
    if guard.is_none() {
        if !missing_assets(&app)?.is_empty() {
            // A sentinel, not prose: SynonymTile matches on it to offer the download.
            return Err("MODEL_NOT_INSTALLED".into());
        }

        let session = SessionBuilder::new()
            .map_err(|e| format!("onnx session builder: {e}"))?
            .commit_from_file(dir.join("synonym.onnx"))
            .map_err(|e| format!("loading synonym.onnx: {e}"))?;

        let vocab: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(dir.join("vocab_kaggle.json"))
                .map_err(|e| format!("reading vocab: {e}"))?,
        )
        .map_err(|e| format!("invalid vocab JSON: {e}"))?;

        *guard = Some(SynonymModel { session, vocab });
    }
    let model = guard.as_mut().expect("model just loaded");

    let (input_ids, attention_mask, target_pos) = with_tokenizer(&app, |tokenizer| {
        let encoding = tokenizer
            .encode(text.as_str(), true)
            .map_err(|e| format!("tokenizer.encode: {e}"))?;

        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let mut mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&m| m as i64)
            .collect();

        ids.resize(MAX_LEN, 0);
        mask.resize(MAX_LEN, 0);
        ids.truncate(MAX_LEN);
        mask.truncate(MAX_LEN);

        let pos = find_target_position(&encoding, &text, &target_word);
        Ok::<_, String>((ids, mask, pos))
    })??;

    let input_array = Array::from_shape_vec((1, MAX_LEN), input_ids)
        .map_err(|e| format!("input ndarray: {e}"))?;
    let mask_array =
        Array::from_shape_vec((1, MAX_LEN), attention_mask).map_err(|e| format!("mask ndarray: {e}"))?;
    let target_array = Array::from_vec(vec![target_pos]);

    let input_tensor = Tensor::from_array(input_array).map_err(|e| e.to_string())?;
    let mask_tensor = Tensor::from_array(mask_array).map_err(|e| e.to_string())?;
    let target_tensor = Tensor::from_array(target_array).map_err(|e| e.to_string())?;

    let outputs = model
        .session
        .run(vec![
            ("input_ids", &input_tensor),
            ("attention_mask", &mask_tensor),
            ("target_pos", &target_tensor),
        ])
        .map_err(|e| format!("onnx run failed: {e}"))?;

    let (_shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("extract tensor failed: {e}"))?;

    let sims: Vec<f32> = data.to_vec();
    if sims.is_empty() {
        return Err("Empty model output".into());
    }

    let indices: Vec<usize> = (0..sims.len()).collect();

    let mut high = indices.clone();
    high.sort_by(|&a, &b| sims[b].partial_cmp(&sims[a]).unwrap_or(std::cmp::Ordering::Equal));

    let mut low = indices;
    low.sort_by(|&a, &b| sims[a].partial_cmp(&sims[b]).unwrap_or(std::cmp::Ordering::Equal));

    let mut synonyms = Vec::new();
    for idx in high.iter().take(200) {
        if let Some(word) = model.vocab.get(*idx) {
            if word != &target_word {
                synonyms.push(word.clone());
            }
        }
        if synonyms.len() >= 10 {
            break;
        }
    }

    let mut antonyms = Vec::new();
    for idx in low.iter().take(200) {
        if let Some(word) = model.vocab.get(*idx) {
            if word != &target_word {
                antonyms.push(word.clone());
            }
        }
        if antonyms.len() >= 5 {
            break;
        }
    }

    Ok(SynonymResponse { synonyms, antonyms })
}
