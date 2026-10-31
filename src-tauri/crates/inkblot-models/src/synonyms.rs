//! Synonym and antonym suggestions from a local ONNX model.
//!
//! Two decisions keep the feature offline and the app small:
//!
//!   * The model is ~423 MB, so it is NOT bundled. It downloads once into
//!     `<AppData>/models/` and is cached there for good. Never load it by a path
//!     relative to the working directory: that resolves only in development.
//!
//!   * The tokenizer IS bundled (455 KB, `src-tauri/resources/minilm-tokenizer.json`),
//!     and read from a file — never `Tokenizer::from_pretrained`, which would reach
//!     out to HuggingFace on first use. Each shell passes the path its bundle puts it
//!     at (the Swift app's Embed Web Bundle phase copies it in).
//!
//! Loading is lazy and fallible: a missing model returns [`MODEL_NOT_INSTALLED`] for the
//! caller to act on, rather than aborting the process before a window exists.

use std::path::PathBuf;

use ndarray::Array;
use ort::session::Session;
use ort::value::Tensor;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;

use crate::download;
use crate::MODEL_NOT_INSTALLED;

/// The GitHub repo the model assets are pulled from, and the ref to pull them at.
const MODEL_REPO: &str = "g3vin/inkblot-nlp-models";
const MODEL_REF: &str = "main";

/// `synonym.onnx` stores its weights as external data — ONNX Runtime fails at load
/// with an opaque "unknown exception in Initialize()" if the `.data` file is not
/// sitting next to it, so the two are always fetched as a set.
pub const MODEL_ASSETS: [&str; 3] = ["synonym.onnx", "synonym.onnx.data", "vocab_kaggle.json"];

const MAX_LEN: usize = 32;

struct SynonymModel {
    session: Session,
    vocab: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SynonymResponse {
    pub synonyms: Vec<String>,
    pub antonyms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SynonymModelStatus {
    /// Every asset is present on disk.
    pub installed: bool,
    /// The session is built and resident in memory.
    pub loaded: bool,
    /// Which assets are still missing, for a precise message in the UI.
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SynonymDownloadProgress {
    pub asset: String,
    /// 1-based, so the UI can say "2 of 3".
    pub index: usize,
    pub count: usize,
    pub received: u64,
    /// 0 when the server sends no content-length.
    pub total: u64,
}

/// The model, its vocabulary and the tokenizer, each loaded on first use.
pub struct SynonymEngine {
    models_dir: PathBuf,
    tokenizer_path: PathBuf,
    model: Mutex<Option<SynonymModel>>,
    tokenizer: Mutex<Option<Tokenizer>>,
}

impl SynonymEngine {
    /// `models_dir` is `<AppData>/models`; `tokenizer_path` is wherever the shell's
    /// bundle put `minilm-tokenizer.json`.
    pub fn new(models_dir: impl Into<PathBuf>, tokenizer_path: impl Into<PathBuf>) -> Self {
        Self {
            models_dir: models_dir.into(),
            tokenizer_path: tokenizer_path.into(),
            model: Mutex::new(None),
            tokenizer: Mutex::new(None),
        }
    }

    fn dir(&self) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("could not create {:?}: {e}", self.models_dir))?;
        Ok(self.models_dir.clone())
    }

    fn missing_assets(&self) -> Result<Vec<String>, String> {
        let dir = self.dir()?;
        Ok(MODEL_ASSETS
            .iter()
            .filter(|asset| !dir.join(asset).is_file())
            .map(|asset| (*asset).to_string())
            .collect())
    }

    pub fn status(&self) -> Result<SynonymModelStatus, String> {
        let missing = self.missing_assets()?;
        Ok(SynonymModelStatus {
            installed: missing.is_empty(),
            loaded: self.model.lock().is_some(),
            missing,
        })
    }

    /// Fetch whatever is missing, reporting progress as it goes.
    pub async fn download(
        &self,
        progress: &(dyn Fn(SynonymDownloadProgress) + Send + Sync),
    ) -> Result<SynonymModelStatus, String> {
        let dir = self.dir()?;
        let missing = self.missing_assets()?;
        let count = missing.len();
        let client = download::client()?;

        for (i, asset) in missing.iter().enumerate() {
            let meta_url = format!(
                "https://api.github.com/repos/{MODEL_REPO}/contents/{asset}?ref={MODEL_REF}"
            );
            // reqwest is built with default-features = false and no `json` feature, so
            // the body is parsed with serde_json rather than pulling one in.
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

            download::fetch_to(&client, url, &dir.join(asset), asset, &|received, total| {
                progress(SynonymDownloadProgress {
                    asset: asset.clone(),
                    index: i + 1,
                    count,
                    received,
                    total,
                })
            })
            .await?;
        }

        let missing = self.missing_assets()?;
        Ok(SynonymModelStatus {
            installed: missing.is_empty(),
            loaded: false,
            missing,
        })
    }

    /// Ten synonyms and five antonyms for `target_word` as it is used in `text`.
    ///
    /// Blocking: the first call loads a 423 MB graph, and every call runs inference.
    pub fn synonyms(&self, text: &str, target_word: &str) -> Result<SynonymResponse, String> {
        let dir = self.dir()?;

        let mut guard = self.model.lock();
        if guard.is_none() {
            if !self.missing_assets()?.is_empty() {
                // A sentinel, not prose: SynonymTile matches on it to offer the download.
                return Err(MODEL_NOT_INSTALLED.into());
            }

            let session = crate::onnx_session_builder()?
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

        let (input_ids, attention_mask, target_pos) = self.with_tokenizer(|tokenizer| {
            let encoding = tokenizer
                .encode(text, true)
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

            let pos = find_target_position(&encoding, text, target_word);
            Ok::<_, String>((ids, mask, pos))
        })??;

        let input_array = Array::from_shape_vec((1, MAX_LEN), input_ids)
            .map_err(|e| format!("input ndarray: {e}"))?;
        let mask_array = Array::from_shape_vec((1, MAX_LEN), attention_mask)
            .map_err(|e| format!("mask ndarray: {e}"))?;
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

        Ok(rank(&sims, &model.vocab, target_word))
    }

    /// The bundled tokenizer, loaded once. Kept separate from the model so that a
    /// missing model does not also cost us the tokenizer, and vice versa.
    fn with_tokenizer<T>(&self, f: impl FnOnce(&Tokenizer) -> T) -> Result<T, String> {
        let mut guard = self.tokenizer.lock();
        if guard.is_none() {
            let path = &self.tokenizer_path;
            let tokenizer = Tokenizer::from_file(path)
                .map_err(|e| format!("could not load tokenizer at {path:?}: {e}"))?;
            *guard = Some(tokenizer);
        }
        Ok(f(guard.as_ref().expect("tokenizer just loaded")))
    }
}

fn find_target_position(encoding: &tokenizers::Encoding, text: &str, target: &str) -> i64 {
    let offsets = encoding.get_offsets();
    let start_char = text.find(target).unwrap_or(0);

    for (i, (s, e)) in offsets.iter().enumerate() {
        if *s <= start_char && start_char < *e {
            return i as i64;
        }
    }
    0
}

/// The most similar words as synonyms and the least similar as antonyms, skipping the
/// word itself.
fn rank(sims: &[f32], vocab: &[String], target_word: &str) -> SynonymResponse {
    let indices: Vec<usize> = (0..sims.len()).collect();

    let mut high = indices.clone();
    high.sort_by(|&a, &b| {
        sims[b]
            .partial_cmp(&sims[a])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut low = indices;
    low.sort_by(|&a, &b| {
        sims[a]
            .partial_cmp(&sims[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let pick = |order: &[usize], limit: usize| {
        let mut words = Vec::new();
        for idx in order.iter().take(200) {
            if let Some(word) = vocab.get(*idx) {
                if word != target_word {
                    words.push(word.clone());
                }
            }
            if words.len() >= limit {
                break;
            }
        }
        words
    };

    SynonymResponse {
        synonyms: pick(&high, 10),
        antonyms: pick(&low, 5),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranking_skips_the_word_itself() {
        let vocab: Vec<String> = ["happy", "glad", "sad", "joyful"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let ranked = rank(&[0.99, 0.9, -0.8, 0.7], &vocab, "happy");
        assert_eq!(ranked.synonyms, vec!["glad", "joyful", "sad"]);
        assert_eq!(ranked.antonyms, vec!["sad", "joyful", "glad"]);
    }

    #[test]
    fn a_missing_model_is_the_sentinel_not_a_crash() {
        let dir = std::env::temp_dir().join(format!("inkblot-syn-{}", std::process::id()));
        let engine = SynonymEngine::new(&dir, dir.join("no-tokenizer.json"));
        assert_eq!(
            engine.synonyms("a b", "a").unwrap_err(),
            MODEL_NOT_INSTALLED
        );
        let status = engine.status().unwrap();
        assert!(!status.installed && !status.loaded);
        assert_eq!(status.missing.len(), MODEL_ASSETS.len());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The model was trained on these ids, so a `tokenizers` upgrade must still read
    /// the bundled file and encode it the same way.
    #[test]
    fn the_bundled_tokenizer_encodes_as_the_model_expects() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../resources/minilm-tokenizer.json"
        );
        let tokenizer = Tokenizer::from_file(path).unwrap();
        let text = "The cat sat quietly";
        let encoding = tokenizer.encode(text, true).unwrap();
        let (ids, padding) = encoding.get_ids().split_at(6);
        assert_eq!(ids, [101, 1996, 4937, 2938, 5168, 102]);
        assert!(padding.iter().all(|&id| id == 0));
        let mask = encoding.get_attention_mask();
        assert_eq!(mask.iter().filter(|&&m| m == 1).count(), 6);
        assert_eq!(find_target_position(&encoding, text, "sat"), 3);
    }
}
