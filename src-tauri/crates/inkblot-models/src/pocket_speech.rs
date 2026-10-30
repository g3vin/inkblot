//! Read Aloud's speech: Kyutai's Pocket TTS, through `ort`.
//!
//! Text goes in and samples come out; there is no phonemizer, because the model reads
//! text tokens. Four graphs from an ONNX export of the English model:
//!
//! ```text
//!   tokens -> text_conditioner -> flow_lm_main (prompt)
//!   loop:     flow_lm_main (last latent) -> conditioning, EOS logit
//!             flow_lm_flow (conditioning, noise) -> next latent
//!   latents -> mimi_decoder -> f32 @ 24kHz
//! ```
//!
//! `flow_lm_main` and `mimi_decoder` are stateful: each takes its state tensors as
//! inputs and returns the next ones as outputs (`bundle.json` lists them). A voice is
//! the state `flow_lm_main` reaches after that voice's audio prompt, precomputed by
//! Kyutai, so every chunk starts from it. The text rules, stopping rule and state
//! layout are in `inkblot_core::pocket_tts`.
//!
//! ## The model is downloaded, not bundled
//!
//! ~400MB for the fp32 graphs, ~6MB a voice, all from pinned revisions. Kyutai's own
//! repository with these graphs is gated, so the graphs come from an ONNX export of
//! the same weights (CC BY 4.0), and the voices and tokenizer from Kyutai's ungated
//! repository. Until they are all in `<AppData>/models/pocket-tts/`, synthesis returns
//! [`MODEL_NOT_INSTALLED`] so the page can offer the download.

use std::path::PathBuf;
use std::sync::Arc;

use inkblot_core::pocket_tts::{
    self, read_safetensors, Bundle, EndOfSpeech, Noise, StateData, StateEntry, TextTokenizer,
};
use ort::memory::Allocator;
use ort::session::builder::SessionBuilder;
use ort::session::{Session, SessionInputValue};
use ort::value::{DynValue, Tensor};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;

use crate::download;
use crate::MODEL_NOT_INSTALLED;

/// The voices Read Aloud offers, all downloaded with the model. Their recordings are
/// CC0 or CC BY 4.0; Kyutai's voices from non-commercial datasets are left out.
/// `src/lib/readAloud.js` names them, and its test checks the two lists agree.
pub const VOICES: &[&str] = &[
    "alba",
    "azelma",
    "george",
    "mary",
    "peter_yearsley",
    "stuart_bell",
];

const GRAPHS_BASE_URL: &str = "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/58a6d00cf13d239b6748cb0769f35c580a8f606c/onnx/english_2026-04";
const KYUTAI_BASE_URL: &str = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/english_2026-04";
const TOKENIZER_URL: &str = "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/00eac05ed3d16bdc3f6b5d598874019c34a89214/languages/english_2026-04/tokenizer.json";

const GRAPHS: [&str; 4] = [
    "text_conditioner.onnx",
    "flow_lm_main.onnx",
    "flow_lm_flow.onnx",
    "mimi_decoder.onnx",
];

/// Latent frames decoded per `mimi_decoder` call.
const DECODE_FRAMES: usize = 12;

/// The loop is many small sequential matmuls; more threads than this only contend.
const INTRA_THREADS: usize = 4;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechResponse {
    /// Raw little-endian f32 samples, base64.
    pub audio_base64: String,
    pub sample_rate: u32,
    pub engine: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechModelStatus {
    pub installed: bool,
    /// What is still missing, by file name.
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDownloadProgress {
    pub asset: String,
    /// 1-based position of `asset` among the files being fetched.
    pub index: usize,
    pub count: usize,
    pub received: u64,
    /// 0 when the server sends no content-length.
    pub total: u64,
}

struct Loaded {
    bundle: Bundle,
    tokenizer: Tokenizer,
    text_conditioner: Session,
    flow_lm_main: Session,
    flow_lm_flow: Session,
    mimi_decoder: Session,
    /// The last voice used and its prompt state. One at a time: each is ~48MB.
    voice: Option<(String, Arc<Vec<DynValue>>)>,
}

/// The model, loaded on first use and kept. Cheap to clone: clones share it.
#[derive(Clone)]
pub struct PocketEngine {
    dir: PathBuf,
    loaded: Arc<Mutex<Option<Loaded>>>,
}

/// A voice we offer. Anything else is not a voice, it is an attempt to name a file.
pub fn valid_voice(voice: &str) -> Result<&str, String> {
    VOICES
        .iter()
        .find(|&&known| known == voice)
        .copied()
        .ok_or_else(|| format!("not a voice: {voice}"))
}

struct TokenizerAdapter<'a>(&'a Tokenizer);

impl TextTokenizer for TokenizerAdapter<'_> {
    fn encode(&self, text: &str) -> Result<Vec<u32>, String> {
        Ok(self
            .0
            .encode(text, true)
            .map_err(|e| format!("tokenizing: {e}"))?
            .get_ids()
            .to_vec())
    }

    fn decode(&self, tokens: &[u32]) -> Result<String, String> {
        self.0
            .decode(tokens, false)
            .map_err(|e| format!("detokenizing: {e}"))
    }
}

/// A tensor of `shape` holding `values`. `ort` will not build a tensor with a
/// zero-length dimension from data, and the graphs' empty states and sequences have
/// them, so those are allocated instead: there is nothing to copy in.
fn tensor<T>(shape: Vec<usize>, values: Vec<T>) -> Result<DynValue, String>
where
    T: ort::tensor::PrimitiveTensorElementType + Clone + std::fmt::Debug + 'static,
{
    let value = if values.is_empty() {
        Tensor::<T>::new(&Allocator::default(), shape)
    } else {
        Tensor::from_array((shape, values))
    };
    value.map(Tensor::into_dyn).map_err(|e| e.to_string())
}

fn state_value(entry: &StateEntry, data: StateData) -> Result<DynValue, String> {
    let shape = entry.shape.clone();
    match data {
        StateData::F32(values) => tensor(shape, values),
        StateData::I64(values) => tensor(shape, values),
        StateData::Bool(values) => tensor(shape, values),
    }
    .map_err(|e| format!("state {}: {e}", entry.input_name))
}

fn f32_tensor(shape: Vec<usize>, values: Vec<f32>) -> Result<DynValue, String> {
    tensor(shape, values)
}

/// Run a stateful graph: `inputs` and the current `state`, in manifest order, in; the
/// outputs named `wanted` and the next state out.
fn run_stateful(
    session: &mut Session,
    inputs: Vec<(&str, SessionInputValue<'_>)>,
    manifest: &[StateEntry],
    state: &[&DynValue],
    wanted: &[&str],
) -> Result<(Vec<DynValue>, Vec<DynValue>), String> {
    let mut all = inputs;
    for (entry, value) in manifest.iter().zip(state) {
        all.push((entry.input_name.as_str(), (*value).into()));
    }
    let mut outputs = session
        .run(all)
        .map_err(|e| format!("onnx run failed: {e}"))?;
    let take = |outputs: &mut ort::session::SessionOutputs<'_>, name: &str| {
        outputs
            .remove(name)
            .ok_or_else(|| format!("the graph has no output {name}"))
    };
    let wanted = wanted
        .iter()
        .map(|name| take(&mut outputs, name))
        .collect::<Result<Vec<_>, _>>()?;
    let next = manifest
        .iter()
        .map(|entry| take(&mut outputs, &entry.output_name))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((wanted, next))
}

fn floats(value: &DynValue) -> Result<&[f32], String> {
    value
        .try_extract_tensor::<f32>()
        .map(|(_, data)| data)
        .map_err(|e| format!("extracting output: {e}"))
}

impl Loaded {
    fn load(dir: &std::path::Path) -> Result<Self, String> {
        let raw = std::fs::read_to_string(dir.join("bundle.json"))
            .map_err(|e| format!("reading bundle.json: {e}"))?;
        let bundle: Bundle =
            serde_json::from_str(&raw).map_err(|e| format!("invalid bundle.json: {e}"))?;
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| format!("loading tokenizer.json: {e}"))?;
        let session = |file: &str| -> Result<Session, String> {
            let path = dir.join(file);
            SessionBuilder::new()
                .and_then(|b| b.with_intra_threads(INTRA_THREADS))
                .and_then(|b| b.with_inter_threads(1))
                .map_err(|e| format!("onnx session builder: {e}"))?
                .commit_from_file(&path)
                .map_err(|e| format!("loading {path:?}: {e}"))
        };
        Ok(Self {
            bundle,
            tokenizer,
            text_conditioner: session(GRAPHS[0])?,
            flow_lm_main: session(GRAPHS[1])?,
            flow_lm_flow: session(GRAPHS[2])?,
            mimi_decoder: session(GRAPHS[3])?,
            voice: None,
        })
    }

    fn voice_state(
        &mut self,
        dir: &std::path::Path,
        voice: &str,
    ) -> Result<Arc<Vec<DynValue>>, String> {
        if let Some((name, state)) = &self.voice {
            if name == voice {
                return Ok(state.clone());
            }
        }
        let path = dir.join("voices").join(format!("{voice}.safetensors"));
        let bytes = std::fs::read(&path).map_err(|e| format!("reading {path:?}: {e}"))?;
        let tensors = read_safetensors(&bytes)?;
        let state = self
            .bundle
            .flow_lm_state_manifest
            .iter()
            .map(|entry| state_value(entry, entry.from_voice(&tensors)?))
            .collect::<Result<Vec<_>, _>>()?;
        let state = Arc::new(state);
        self.voice = Some((voice.to_string(), state.clone()));
        Ok(state)
    }

    /// One prompt's latents, from the voice's state.
    fn latents(
        &mut self,
        voice: &[DynValue],
        prompt: &str,
        frames_after_eos: usize,
        noise: &mut Noise,
    ) -> Result<Vec<f32>, String> {
        let latent_dim = self.bundle.latent_dim;
        let ids: Vec<i64> = TokenizerAdapter(&self.tokenizer)
            .encode(prompt)?
            .into_iter()
            .map(i64::from)
            .collect();
        let token_count = ids.len();
        let ids = Tensor::from_array((vec![1, token_count], ids)).map_err(|e| e.to_string())?;
        let mut outputs = self
            .text_conditioner
            .run(vec![("token_ids", SessionInputValue::from(&ids))])
            .map_err(|e| format!("onnx run failed: {e}"))?;
        let text_embeddings = outputs
            .remove("embeddings")
            .ok_or("the text conditioner has no embeddings output")?;
        drop(outputs);

        let manifest = self.bundle.flow_lm_state_manifest.clone();
        let no_sequence = f32_tensor(vec![1, 0, latent_dim], Vec::new())?;
        let no_text = f32_tensor(vec![1, 0, self.bundle.conditioning_dim], Vec::new())?;

        let (_, mut state) = run_stateful(
            &mut self.flow_lm_main,
            vec![
                ("sequence", (&no_sequence).into()),
                ("text_embeddings", (&text_embeddings).into()),
            ],
            &manifest,
            &voice.iter().collect::<Vec<_>>(),
            &[],
        )?;

        // The first step has no latent before it; NaN is how the model was trained to
        // read "start of speech".
        let mut previous = vec![f32::NAN; latent_dim];
        let mut latents = Vec::new();
        let mut end = EndOfSpeech::new(frames_after_eos);
        for step in 0..pocket_tts::max_frames(token_count) {
            let sequence = f32_tensor(vec![1, 1, latent_dim], previous)?;
            let (outputs, next) = run_stateful(
                &mut self.flow_lm_main,
                vec![
                    ("sequence", (&sequence).into()),
                    ("text_embeddings", (&no_text).into()),
                ],
                &manifest,
                &state.iter().collect::<Vec<_>>(),
                &["conditioning", "eos_logit"],
            )?;
            state = next;
            let eos_logit = floats(&outputs[1])?.first().copied().unwrap_or(f32::MIN);
            if end.stop(step, eos_logit) {
                break;
            }

            // One Euler step of the flow, from noise at s = 0 to a latent at t = 1.
            let mut x = noise.sample(latent_dim);
            let start = f32_tensor(vec![1, latent_dim], x.clone())?;
            let s = f32_tensor(vec![1, 1], vec![0.0])?;
            let t = f32_tensor(vec![1, 1], vec![1.0])?;
            let flow = self
                .flow_lm_flow
                .run(vec![
                    ("c", SessionInputValue::from(&outputs[0])),
                    ("s", (&s).into()),
                    ("t", (&t).into()),
                    ("x", (&start).into()),
                ])
                .map_err(|e| format!("onnx run failed: {e}"))?;
            let direction = floats(&flow["flow_dir"])?;
            for (value, delta) in x.iter_mut().zip(direction) {
                *value += delta;
            }
            latents.extend_from_slice(&x);
            previous = x;
        }
        Ok(latents)
    }

    fn decode(&mut self, latents: &[f32]) -> Result<Vec<f32>, String> {
        let latent_dim = self.bundle.latent_dim;
        let manifest = self.bundle.mimi_state_manifest.clone();
        let mut state = manifest
            .iter()
            .map(|entry| state_value(entry, entry.initial()?))
            .collect::<Result<Vec<_>, _>>()?;
        let mut samples = Vec::new();
        for window in latents.chunks(DECODE_FRAMES * latent_dim) {
            let latent = f32_tensor(
                vec![1, window.len() / latent_dim, latent_dim],
                window.to_vec(),
            )?;
            let (outputs, next) = run_stateful(
                &mut self.mimi_decoder,
                vec![("latent", (&latent).into())],
                &manifest,
                &state.iter().collect::<Vec<_>>(),
                &["audio_frame"],
            )?;
            state = next;
            samples.extend_from_slice(floats(&outputs[0])?);
        }
        Ok(samples)
    }
}

impl PocketEngine {
    /// `dir` is `<AppData>/models/pocket-tts`.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            loaded: Arc::new(Mutex::new(None)),
        }
    }

    /// Every file the model needs, as `(name under dir, url)`.
    fn assets() -> Vec<(String, String)> {
        let mut assets = vec![(
            "bundle.json".to_string(),
            format!("{GRAPHS_BASE_URL}/bundle.json"),
        )];
        for graph in GRAPHS {
            assets.push((graph.to_string(), format!("{GRAPHS_BASE_URL}/{graph}")));
        }
        assets.push(("tokenizer.json".to_string(), TOKENIZER_URL.to_string()));
        for voice in VOICES {
            assets.push((
                format!("voices/{voice}.safetensors"),
                format!("{KYUTAI_BASE_URL}/embeddings/{voice}.safetensors"),
            ));
        }
        assets
    }

    fn missing_assets(&self) -> Vec<(String, String)> {
        Self::assets()
            .into_iter()
            .filter(|(name, _)| !self.dir.join(name).is_file())
            .collect()
    }

    pub fn status(&self) -> SpeechModelStatus {
        let missing: Vec<String> = self
            .missing_assets()
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        SpeechModelStatus {
            installed: missing.is_empty(),
            missing,
        }
    }

    /// Fetch whatever is missing, reporting progress as it goes.
    pub async fn download(
        &self,
        progress: &(dyn Fn(SpeechDownloadProgress) + Send + Sync),
    ) -> Result<SpeechModelStatus, String> {
        std::fs::create_dir_all(self.dir.join("voices"))
            .map_err(|e| format!("could not create {:?}: {e}", self.dir))?;
        let client = download::client()?;
        let missing = self.missing_assets();
        let count = missing.len();
        for (position, (asset, url)) in missing.into_iter().enumerate() {
            download::fetch_to(
                &client,
                &url,
                &self.dir.join(&asset),
                &asset,
                &|received, total| {
                    progress(SpeechDownloadProgress {
                        asset: asset.clone(),
                        index: position + 1,
                        count,
                        received,
                        total,
                    })
                },
            )
            .await?;
        }
        Ok(self.status())
    }

    fn with_loaded<T>(
        &self,
        f: impl FnOnce(&mut Loaded) -> Result<T, String>,
    ) -> Result<T, String> {
        if !self.status().installed {
            return Err(MODEL_NOT_INSTALLED.into());
        }
        let mut guard = self.loaded.lock();
        if guard.is_none() {
            *guard = Some(Loaded::load(&self.dir)?);
        }
        f(guard.as_mut().expect("model just loaded"))
    }

    /// Speak `text` in `voice`. Blocking: run it off any async runtime's workers.
    ///
    /// The text is one Read Aloud chunk; it is split again here into prompts the
    /// model can say without skipping words, and their audio is joined.
    pub fn generate(&self, text: &str, voice: &str) -> Result<SpeechResponse, String> {
        let voice = valid_voice(voice)?;
        self.with_loaded(|loaded| {
            let state = loaded.voice_state(&self.dir, voice)?;
            let prompts = pocket_tts::split_into_best_sentences(
                &TokenizerAdapter(&loaded.tokenizer),
                text,
                pocket_tts::MAX_TOKENS_PER_CHUNK,
            )?;
            if prompts.is_empty() {
                return Err("nothing to speak".into());
            }

            // Seeded by the text, so a sentence sounds the same each time it is read.
            let seed = text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| {
                (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
            });
            let mut noise = Noise::new(seed, pocket_tts::TEMPERATURE);
            let mut samples = Vec::new();
            for prompt in prompts {
                let Some((prompt, frames_after_eos)) = pocket_tts::prepare_text_prompt(&prompt)
                else {
                    continue;
                };
                let latents = loaded.latents(&state, &prompt, frames_after_eos, &mut noise)?;
                samples.extend(loaded.decode(&latents)?);
            }

            Ok(SpeechResponse {
                audio_base64: pocket_tts::encode_samples_base64(&samples),
                sample_rate: loaded.bundle.sample_rate,
                engine: "pocket-tts".to_string(),
            })
        })
    }

    /// Load the model and the voice ahead of the first sentence. Blocking.
    ///
    /// Loading four graphs is a second or two, which is the difference between Read
    /// Aloud feeling instant and feeling broken when it is paid on pressing play.
    pub fn prewarm(&self, voice: &str) -> Result<(), String> {
        let voice = valid_voice(voice)?;
        self.with_loaded(|loaded| loaded.voice_state(&self.dir, voice).map(|_| ()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_offered_voices_are_voices() {
        assert!(valid_voice("alba").is_ok());
        // A voice name reaches the filesystem, so these must not.
        assert!(valid_voice("../../../etc/passwd").is_err());
        assert!(valid_voice("alba/../../x").is_err());
        assert!(valid_voice("").is_err());
        assert!(valid_voice("ALBA").is_err());
        // Kyutai has it, but its recording is licensed for non-commercial use only.
        assert!(valid_voice("cosette").is_err());
    }

    #[test]
    fn nothing_installed_is_the_sentinel() {
        let dir = std::env::temp_dir().join(format!("inkblot-pocket-{}", std::process::id()));
        let engine = PocketEngine::new(&dir);
        assert_eq!(
            engine.generate("Hello.", "alba").unwrap_err(),
            MODEL_NOT_INSTALLED
        );
        assert_eq!(engine.prewarm("alba").unwrap_err(), MODEL_NOT_INSTALLED);
        let status = engine.status();
        assert!(!status.installed);
        assert_eq!(status.missing.len(), 6 + VOICES.len());
        assert!(engine.generate("Hello.", "../x").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Speaks a sentence with the real model, when `POCKET_TTS_DIR` points at an
    /// installed copy, and writes it to `POCKET_TTS_OUT` for a listen.
    /// `cargo test -p inkblot-models --release -- --ignored speaks`
    #[test]
    #[ignore = "needs the downloaded model"]
    fn speaks_with_the_installed_model() {
        let dir = std::env::var("POCKET_TTS_DIR").expect("POCKET_TTS_DIR");
        let engine = PocketEngine::new(dir);
        let text = std::env::var("POCKET_TTS_TEXT")
            .unwrap_or_else(|_| "The lamp on her desk had burned all night.".into());
        let started = std::time::Instant::now();
        let response = engine.generate(&text, "alba").unwrap();
        assert_eq!(response.sample_rate, 24_000);
        // Four bytes a sample, four base64 characters for every three bytes.
        let seconds = response.audio_base64.len() as f64 * 3.0 / 4.0 / 4.0 / 24_000.0;
        assert!(seconds > 1.0, "{seconds}s of audio");
        eprintln!("{seconds:.2}s of audio in {:.2?}", started.elapsed());
        if let Ok(out) = std::env::var("POCKET_TTS_OUT") {
            std::fs::write(out, response.audio_base64).unwrap();
        }
    }
}
