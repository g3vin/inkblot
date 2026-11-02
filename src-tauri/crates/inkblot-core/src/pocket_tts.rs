//! The parts of Pocket TTS speech synthesis that are text and arithmetic rather than
//! inference.
//!
//! Read Aloud runs Kyutai's Pocket TTS through `ort` (`inkblot-models::pocket_speech`):
//!
//! ```text
//!   text -> prepare + split (here) -> token ids -> text_conditioner
//!        -> flow_lm_main + flow_lm_flow, one 80ms latent frame per step, until EOS
//!        -> mimi_decoder -> f32 samples at 24kHz
//! ```
//!
//! This module holds what is decidable without a model: how a prompt is prepared and
//! split, how many frames a chunk may take, when generation stops, the noise the flow
//! head starts from, and how a voice file becomes the graph's state inputs. The text
//! rules and the stopping rule are ported from Kyutai's own Rust port
//! (`pocket-tts/rust/src/text.rs` and `model.rs`, MIT); the voice and model were trained
//! with them, so a "simpler" rule here does not fail, it skips or repeats words.

use std::collections::{BTreeMap, HashSet};

use serde::Deserialize;

/// Pocket TTS generates at 24kHz.
pub const SAMPLE_RATE: u32 = 24_000;

/// One latent frame is 80ms of audio.
pub const FRAME_RATE: f64 = 12.5;

/// The model is trained on single sentences; past this many tokens it skips words.
pub const MAX_TOKENS_PER_CHUNK: usize = 50;

/// Kyutai's human evals preferred 0.3 for the English model.
pub const TEMPERATURE: f32 = 0.3;

/// Speech has ended once the EOS logit crosses this.
pub const EOS_THRESHOLD: f32 = -4.0;

/// Before speech starts, the EOS logit of some voices can cross the threshold, and a
/// short text would end before its word is spoken.
const MIN_FRAMES_BEFORE_EOS: usize = 6;

const TOKENS_PER_SECOND_ESTIMATE: f64 = 3.0;
const GEN_SECONDS_PADDING: f64 = 2.0;

/* ---------------- text ---------------- */

/// What the tokenizer does, for the splitter. A trait so the tests can use a fake one.
pub trait TextTokenizer {
    fn encode(&self, text: &str) -> Result<Vec<u32>, String>;
    fn decode(&self, tokens: &[u32]) -> Result<String, String>;
}

/// The English model's training data has no curly single quotes.
fn replace_characters(text: &str) -> String {
    text.replace(['\u{2019}', '\u{2018}'], "'")
}

/// Python's `" ".join(text.split())`.
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `re.sub(r"([.!?…])\s*[,;:]", r"\1", text)`: '"Hi?", she said' reads as a sentence
/// end followed by a stray comma; keep the sentence mark only.
fn drop_punctuation_after_sentence_end(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        out.push(c);
        i += 1;
        if matches!(c, '.' | '!' | '?' | '\u{2026}') {
            let mut j = i;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && matches!(chars[j], ',' | ';' | ':') {
                i = j + 1;
            }
        }
    }
    out
}

const TERMINAL_PUNCTUATION: &str = ".!?\u{2026}";
const WEAK_PUNCTUATION: &str = ",;:-\u{2013}\u{2014}";
const CLOSERS: &str = "\"'\u{201d}\u{2019})]\u{bb}";

/// Without sentence-final punctuation the last word is often mispronounced or
/// repeated. A trailing comma, colon or dash becomes a period; anything else gets one
/// after its closing quotes or brackets.
fn ensure_terminal_punctuation(text: &str) -> String {
    let core = text.trim_end_matches(|c| CLOSERS.contains(c) || c == ' ');
    let closers = text[core.len()..].trim();
    match core.chars().last() {
        None => text.to_string(),
        Some(last) if TERMINAL_PUNCTUATION.contains(last) => text.to_string(),
        Some(last) if WEAK_PUNCTUATION.contains(last) => {
            let core = core.trim_end_matches(|c| WEAK_PUNCTUATION.contains(c) || c == ' ');
            format!("{core}.{closers}")
        }
        Some(_) => format!("{text}."),
    }
}

/// The prompt the model is given for `text`, and how many frames to keep generating
/// after it signals the end of speech. `None` for text with nothing in it.
pub fn prepare_text_prompt(text: &str) -> Option<(String, usize)> {
    let mut text =
        drop_punctuation_after_sentence_end(&collapse_whitespace(&replace_characters(text.trim())));
    if text.is_empty() {
        return None;
    }
    let number_of_words = text.split_whitespace().count();
    let frames_after_eos = if number_of_words <= 4 { 3 } else { 1 } + 2;

    let mut chars = text.chars();
    let first = chars.next()?;
    if !first.is_uppercase() {
        text = first.to_uppercase().chain(chars).collect();
    }
    Some((ensure_terminal_punctuation(&text), frames_after_eos))
}

/// Whether the segment starting at `start` begins right after a decimal point, as in
/// "3.5", which is not a sentence end.
fn is_decimal_period_boundary(
    tokens: &[u32],
    start: usize,
    tokenizer: &dyn TextTokenizer,
) -> Result<bool, String> {
    let prefix: Vec<char> = tokenizer.decode(&tokens[..start])?.chars().collect();
    let suffix = tokenizer.decode(&tokens[start..])?;
    Ok(prefix.len() >= 2
        && prefix[prefix.len() - 1] == '.'
        && prefix[prefix.len() - 2].is_numeric()
        && suffix.chars().next().is_some_and(char::is_numeric))
}

/// Token indices to split at: each consecutive pair delimits a segment, from 0 to
/// `tokens.len()`. A split falls after a run of boundary tokens.
fn find_boundary_indices(
    tokens: &[u32],
    boundary_tokens: &[u32],
    decimal_tokenizer: Option<&dyn TextTokenizer>,
) -> Result<Vec<usize>, String> {
    let boundary_set: HashSet<u32> = boundary_tokens.iter().copied().collect();
    let mut indices = vec![0];
    let mut previous_was_boundary = false;
    for (index, token) in tokens.iter().enumerate() {
        if boundary_set.contains(token) {
            previous_was_boundary = true;
            continue;
        }
        if previous_was_boundary {
            let is_decimal = match decimal_tokenizer {
                Some(tokenizer) => is_decimal_period_boundary(tokens, index, tokenizer)?,
                None => false,
            };
            if !is_decimal {
                indices.push(index);
            }
        }
        previous_was_boundary = false;
    }
    indices.push(tokens.len());
    Ok(indices)
}

fn segments_from_boundaries(
    tokens: &[u32],
    boundaries: &[usize],
    tokenizer: &dyn TextTokenizer,
) -> Result<Vec<(usize, String)>, String> {
    boundaries
        .windows(2)
        .map(|w| Ok((w[1] - w[0], tokenizer.decode(&tokens[w[0]..w[1]])?)))
        .collect()
}

/// The tokens of `text` without the first, which carries the leading space marker.
fn marker_tokens(tokenizer: &dyn TextTokenizer, text: &str) -> Result<Vec<u32>, String> {
    Ok(tokenizer.encode(text)?.into_iter().skip(1).collect())
}

/// Split `text` into prompts of at most `max_tokens` each: on sentence ends, then on
/// commas, semicolons and colons inside a sentence that is still too long, regrouping
/// neighbours while they fit. A sentence with no break in it stays whole.
pub fn split_into_best_sentences(
    tokenizer: &dyn TextTokenizer,
    text: &str,
    max_tokens: usize,
) -> Result<Vec<String>, String> {
    let Some((text, _)) = prepare_text_prompt(text) else {
        return Ok(Vec::new());
    };
    let tokens = tokenizer.encode(text.trim())?;

    let sentence_ends = marker_tokens(tokenizer, ".!...?")?;
    let boundaries = find_boundary_indices(&tokens, &sentence_ends, Some(tokenizer))?;
    let sentences = segments_from_boundaries(&tokens, &boundaries, tokenizer)?;

    let clause_ends = marker_tokens(tokenizer, ",;:")?;
    let mut segments = Vec::new();
    for (count, sentence) in sentences {
        if count <= max_tokens {
            segments.push((count, sentence));
            continue;
        }
        let sub_tokens = tokenizer.encode(sentence.trim())?;
        let sub_boundaries = find_boundary_indices(&sub_tokens, &clause_ends, None)?;
        let sub_segments = segments_from_boundaries(&sub_tokens, &sub_boundaries, tokenizer)?;
        if sub_segments.len() > 1 {
            segments.extend(sub_segments);
        } else {
            segments.push((count, sentence));
        }
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_count = 0;
    for (count, segment) in segments {
        if current.is_empty() {
            current = segment;
            current_count = count;
        } else if current_count + count > max_tokens {
            chunks.push(current.trim().to_string());
            current = segment;
            current_count = count;
        } else {
            current.push(' ');
            current.push_str(&segment);
            current_count += count;
        }
    }
    if !current.is_empty() {
        chunks.push(current.trim().to_string());
    }
    Ok(chunks)
}

/* ---------------- generation ---------------- */

/// The most frames a prompt of `token_count` tokens may take: about three tokens a
/// second, plus two seconds. A voice that never signals EOS stops here instead of
/// babbling on.
pub fn max_frames(token_count: usize) -> usize {
    let seconds = token_count as f64 / TOKENS_PER_SECOND_ESTIMATE + GEN_SECONDS_PADDING;
    (seconds * FRAME_RATE).ceil() as usize
}

/// When to stop generating: a few frames after the model first signals the end of
/// speech, so the last word is not clipped.
#[derive(Debug, Clone)]
pub struct EndOfSpeech {
    frames_after_eos: usize,
    eos_step: Option<usize>,
}

impl EndOfSpeech {
    pub fn new(frames_after_eos: usize) -> Self {
        Self {
            frames_after_eos,
            eos_step: None,
        }
    }

    /// Whether to stop before generating frame `step`, given its EOS logit.
    pub fn stop(&mut self, step: usize, eos_logit: f32) -> bool {
        if self.eos_step.is_none() && step >= MIN_FRAMES_BEFORE_EOS && eos_logit > EOS_THRESHOLD {
            self.eos_step = Some(step);
        }
        self.eos_step
            .is_some_and(|eos_step| step >= eos_step + self.frames_after_eos)
    }
}

/// The Gaussian noise each frame's flow starts from, with standard deviation
/// `sqrt(temperature)`.
///
/// Seeded, so the same text in the same voice always sounds the same. SplitMix64 and
/// Box–Muller rather than a dependency: this needs a few hundred draws a second, not a
/// statistician's generator.
pub struct Noise {
    state: u64,
    std_dev: f32,
    spare: Option<f32>,
}

impl Noise {
    pub fn new(seed: u64, temperature: f32) -> Self {
        Self {
            state: seed,
            std_dev: temperature.max(0.0).sqrt(),
            spare: None,
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in (0, 1]: never 0, whose logarithm Box–Muller would take.
    fn next_unit(&mut self) -> f64 {
        ((self.next_u64() >> 11) + 1) as f64 / (1u64 << 53) as f64
    }

    fn standard_normal(&mut self) -> f32 {
        if let Some(spare) = self.spare.take() {
            return spare;
        }
        let radius = (-2.0 * self.next_unit().ln()).sqrt();
        let angle = std::f64::consts::TAU * self.next_unit();
        self.spare = Some((radius * angle.sin()) as f32);
        (radius * angle.cos()) as f32
    }

    pub fn sample(&mut self, len: usize) -> Vec<f32> {
        if self.std_dev == 0.0 {
            return vec![0.0; len];
        }
        (0..len)
            .map(|_| self.standard_normal() * self.std_dev)
            .collect()
    }
}

/* ---------------- the ONNX bundle's state ---------------- */

/// What `bundle.json` says about the graphs. Only the fields Inkblot reads.
#[derive(Debug, Clone, Deserialize)]
pub struct Bundle {
    pub sample_rate: u32,
    pub latent_dim: usize,
    pub conditioning_dim: usize,
    pub flow_lm_state_manifest: Vec<StateEntry>,
    pub mimi_state_manifest: Vec<StateEntry>,
}

/// One state tensor a stateful graph takes as `input_name` and hands back as
/// `output_name`, to be fed into the next call.
#[derive(Debug, Clone, Deserialize)]
pub struct StateEntry {
    pub input_name: String,
    pub output_name: String,
    pub module: String,
    pub key: String,
    pub dtype: String,
    pub fill: String,
    pub shape: Vec<usize>,
}

/// A state tensor's starting contents.
#[derive(Debug, Clone, PartialEq)]
pub enum StateData {
    F32(Vec<f32>),
    I64(Vec<i64>),
    Bool(Vec<bool>),
}

impl StateEntry {
    fn len(&self) -> usize {
        self.shape.iter().product()
    }

    /// The tensor before any call: what the manifest's `fill` says.
    pub fn initial(&self) -> Result<StateData, String> {
        let len = self.len();
        Ok(match (self.dtype.as_str(), self.fill.as_str()) {
            ("float32", "nan") => StateData::F32(vec![f32::NAN; len]),
            ("float32", "ones") => StateData::F32(vec![1.0; len]),
            ("float32", _) => StateData::F32(vec![0.0; len]),
            ("int64", "ones") => StateData::I64(vec![1; len]),
            ("int64", _) => StateData::I64(vec![0; len]),
            ("bool", "ones") => StateData::Bool(vec![true; len]),
            ("bool", _) => StateData::Bool(vec![false; len]),
            (dtype, _) => return Err(format!("unknown state dtype {dtype}")),
        })
    }

    /// The tensor after a voice's prompt, from the voice file.
    ///
    /// A voice file holds, per attention layer, the key/value `cache` of its prompt,
    /// `[2, 1, positions, heads, dim]`, and the `offset` it reached. The graph's cache
    /// has room for more positions than the prompt fills: the prompt goes first, along
    /// the positions axis, and the rest keeps the manifest's fill. The graph's `step`
    /// is the file's `offset`.
    pub fn from_voice(&self, voice: &[SafeTensor<'_>]) -> Result<StateData, String> {
        let find = |key: &str| {
            let name = format!("{}/{key}", self.module);
            voice
                .iter()
                .find(|tensor| tensor.name == name)
                .ok_or_else(|| format!("the voice file has no {name}"))
        };
        match self.key.as_str() {
            "cache" => {
                let source = find("cache")?;
                let values = source.f32s()?;
                let [two, batch, positions, heads, dim] = source.shape[..] else {
                    return Err(format!("{} is not a 5-d cache", source.name));
                };
                let [_, _, capacity, ..] = self.shape[..] else {
                    return Err(format!("{} is not a 5-d cache", self.input_name));
                };
                if self.shape != [two, batch, capacity, heads, dim] || positions > capacity {
                    return Err(format!(
                        "{} is {:?}, which does not fit {:?}",
                        source.name, source.shape, self.shape
                    ));
                }
                let StateData::F32(mut out) = self.initial()? else {
                    return Err(format!("{} is not float32", self.input_name));
                };
                let row = heads * dim;
                for outer in 0..two * batch {
                    let from = outer * positions * row;
                    let to = outer * capacity * row;
                    out[to..to + positions * row]
                        .copy_from_slice(&values[from..from + positions * row]);
                }
                Ok(StateData::F32(out))
            }
            "step" => Ok(StateData::I64(find("offset")?.i64s()?)),
            _ => self.initial(),
        }
    }
}

/* ---------------- safetensors ---------------- */

/// One tensor in a `.safetensors` file, borrowing its bytes.
#[derive(Debug)]
pub struct SafeTensor<'a> {
    pub name: String,
    pub dtype: String,
    pub shape: Vec<usize>,
    pub data: &'a [u8],
}

impl SafeTensor<'_> {
    fn expect(&self, dtype: &str, width: usize) -> Result<(), String> {
        let len: usize = self.shape.iter().product();
        if self.dtype != dtype || self.data.len() != len * width {
            return Err(format!("{} is not a {dtype} tensor of {len}", self.name));
        }
        Ok(())
    }

    pub fn f32s(&self) -> Result<Vec<f32>, String> {
        self.expect("F32", 4)?;
        Ok(self
            .data
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect())
    }

    pub fn i64s(&self) -> Result<Vec<i64>, String> {
        self.expect("I64", 8)?;
        Ok(self
            .data
            .chunks_exact(8)
            .map(|b| i64::from_le_bytes(b.try_into().expect("chunks of 8")))
            .collect())
    }
}

#[derive(Deserialize)]
struct HeaderEntry {
    dtype: String,
    shape: Vec<usize>,
    data_offsets: [usize; 2],
}

/// The tensors of a `.safetensors` file: an 8-byte little-endian header length, a JSON
/// header naming each tensor's dtype, shape and byte range, then the bytes.
pub fn read_safetensors(bytes: &[u8]) -> Result<Vec<SafeTensor<'_>>, String> {
    let header_len = bytes
        .get(..8)
        .map(|b| u64::from_le_bytes(b.try_into().expect("8 bytes")) as usize)
        .ok_or("not a safetensors file")?;
    let data_start = 8usize
        .checked_add(header_len)
        .filter(|&end| end <= bytes.len())
        .ok_or("safetensors header runs past the file")?;
    let header: BTreeMap<String, serde_json::Value> = serde_json::from_slice(&bytes[8..data_start])
        .map_err(|e| format!("invalid safetensors header: {e}"))?;
    let data = &bytes[data_start..];

    header
        .into_iter()
        .filter(|(name, _)| name != "__metadata__")
        .map(|(name, entry)| {
            let entry: HeaderEntry = serde_json::from_value(entry)
                .map_err(|e| format!("invalid safetensors entry {name}: {e}"))?;
            let [start, end] = entry.data_offsets;
            let data = data
                .get(start..end)
                .filter(|_| start <= end)
                .ok_or_else(|| format!("{name} runs past the file"))?;
            Ok(SafeTensor {
                name,
                dtype: entry.dtype,
                shape: entry.shape,
                data,
            })
        })
        .collect()
}

/* ---------------- samples ---------------- */

/// Samples as the webview wants them: raw little-endian `f32`, base64.
///
/// Not WAV: `base64ToFloat32Array` on the other side wants the samples themselves, and
/// wrapping them in a container the caller immediately unwraps would only be a way to
/// get the header wrong.
pub fn encode_samples_base64(samples: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    base64_encode(&bytes)
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding. Hand-rolled rather than adding a dependency for
/// twenty lines, and covered by tests against known vectors.
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let triple = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);

        out.push(BASE64_ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(BASE64_ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[triple as usize & 63] as char
        } else {
            '='
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One token per character, with a leading space marker like SentencePiece.
    struct CharTokenizer;

    impl TextTokenizer for CharTokenizer {
        fn encode(&self, text: &str) -> Result<Vec<u32>, String> {
            Ok(std::iter::once(0)
                .chain(text.chars().map(|c| c as u32))
                .collect())
        }

        fn decode(&self, tokens: &[u32]) -> Result<String, String> {
            Ok(tokens
                .iter()
                .filter(|&&t| t != 0)
                .map(|&t| char::from_u32(t).unwrap())
                .collect())
        }
    }

    fn prompt(text: &str) -> String {
        prepare_text_prompt(text).unwrap().0
    }

    #[test]
    fn prompts_are_prepared_as_kyutai_prepares_them() {
        assert_eq!(
            prepare_text_prompt("hello world"),
            Some(("Hello world.".into(), 5))
        );
        assert_eq!(
            prepare_text_prompt("  one two three four five  "),
            Some(("One two three four five.".into(), 3))
        );
        assert_eq!(prompt("Wait,"), "Wait.");
        assert_eq!(prompt("He said \"hi\""), "He said \"hi\".");
        assert_eq!(prompt("Is it \"so?\""), "Is it \"so?\"");
        assert_eq!(prompt("über"), "Über.");
        assert_eq!(prompt("a\nb   c"), "A b c.");
        assert_eq!(prompt("it\u{2019}s"), "It's.");
        assert_eq!(prompt("Hi?, she said"), "Hi? she said.");
        assert_eq!(prepare_text_prompt("   "), None);
    }

    // The expected values are what Kyutai's implementation returns with the same
    // tokenizer, whose decoded segments keep their leading space (hence the doubles).
    #[test]
    fn sentences_are_grouped_up_to_max_tokens() {
        let text = "First one. Second one! Third one?";
        let chunks = split_into_best_sentences(&CharTokenizer, text, 25).unwrap();
        assert_eq!(chunks, ["First one.  Second one!", "Third one?"]);
        let chunks = split_into_best_sentences(&CharTokenizer, text, 1000).unwrap();
        assert_eq!(chunks, ["First one.  Second one!  Third one?"]);
        assert!(split_into_best_sentences(&CharTokenizer, " ", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn decimal_points_do_not_split() {
        let chunks = split_into_best_sentences(&CharTokenizer, "It costs 3.5 euros. Yes.", 5);
        assert_eq!(chunks.unwrap(), ["It costs 3.5 euros.", "Yes."]);
    }

    #[test]
    fn long_sentences_split_on_commas() {
        let chunks = split_into_best_sentences(&CharTokenizer, "aaaa, bbbb, cccc.", 8);
        assert_eq!(chunks.unwrap(), ["Aaaa,", "bbbb,", "cccc."]);
    }

    #[test]
    fn the_frame_budget_is_three_tokens_a_second_plus_two() {
        assert_eq!(max_frames(0), 25);
        assert_eq!(max_frames(30), 150);
        assert_eq!(max_frames(50), 234);
    }

    #[test]
    fn generation_stops_a_few_frames_after_the_end_of_speech() {
        let mut end = EndOfSpeech::new(2);
        // Too early to believe.
        assert!(!end.stop(0, 10.0));
        assert!(!end.stop(5, 10.0));
        assert!(!end.stop(6, -5.0));
        // Speech ends at 7; frames 7 and 8 are still generated, whatever the logit.
        assert!(!end.stop(7, -3.0));
        assert!(!end.stop(8, -9.0));
        assert!(end.stop(9, -9.0));
    }

    #[test]
    fn noise_has_the_temperature_as_its_variance_and_repeats_from_its_seed() {
        let n = 40_000;
        let samples = Noise::new(7, 0.25).sample(n);
        let mean = samples.iter().sum::<f32>() / n as f32;
        let variance = samples.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / n as f32;
        assert!(mean.abs() < 0.01, "{mean}");
        assert!((variance - 0.25).abs() < 0.01, "{variance}");
        assert!(samples.iter().all(|v| v.is_finite()));

        assert_eq!(Noise::new(7, 0.3).sample(8), Noise::new(7, 0.3).sample(8));
        assert_ne!(Noise::new(7, 0.3).sample(8), Noise::new(8, 0.3).sample(8));
        assert_eq!(Noise::new(7, 0.0).sample(3), vec![0.0; 3]);
    }

    /// A safetensors file of `(name, dtype, shape, bytes)`.
    fn safetensors(tensors: &[(&str, &str, Vec<usize>, Vec<u8>)]) -> Vec<u8> {
        let mut header = serde_json::Map::new();
        let mut data = Vec::new();
        for (name, dtype, shape, bytes) in tensors {
            header.insert(
                (*name).into(),
                serde_json::json!({
                    "dtype": dtype,
                    "shape": shape,
                    "data_offsets": [data.len(), data.len() + bytes.len()],
                }),
            );
            data.extend_from_slice(bytes);
        }
        header.insert("__metadata__".into(), serde_json::json!({"format": "pt"}));
        let header = serde_json::to_vec(&header).unwrap();
        let mut file = (header.len() as u64).to_le_bytes().to_vec();
        file.extend(header);
        file.extend(data);
        file
    }

    fn f32_bytes(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }

    fn entry(key: &str, dtype: &str, fill: &str, shape: Vec<usize>) -> StateEntry {
        StateEntry {
            input_name: format!("state_{key}"),
            output_name: format!("out_state_{key}"),
            module: "transformer.layers.0.self_attn".into(),
            key: key.into(),
            dtype: dtype.into(),
            fill: fill.into(),
            shape,
        }
    }

    #[test]
    fn safetensors_are_read_by_their_header() {
        let file = safetensors(&[
            ("a", "F32", vec![2], f32_bytes(&[1.5, -2.0])),
            ("b", "I64", vec![1], 9i64.to_le_bytes().to_vec()),
        ]);
        let tensors = read_safetensors(&file).unwrap();
        assert_eq!(tensors.len(), 2);
        assert_eq!(tensors[0].name, "a");
        assert_eq!(tensors[0].f32s().unwrap(), [1.5, -2.0]);
        assert_eq!(tensors[1].i64s().unwrap(), [9]);
        // The wrong type is refused rather than reinterpreted.
        assert!(tensors[0].i64s().is_err());

        assert!(read_safetensors(&[]).is_err());
        assert!(read_safetensors(&u64::MAX.to_le_bytes()).is_err());
        let mut truncated = file.clone();
        truncated.truncate(file.len() - 4);
        assert!(read_safetensors(&truncated).is_err());
    }

    #[test]
    fn a_voice_prompt_fills_the_front_of_the_cache() {
        // Two positions of prompt, in a cache with room for three: [2, 1, 3, 1, 2].
        let prompt: Vec<f32> = (1..=8).map(|v| v as f32).collect();
        let file = safetensors(&[
            (
                "transformer.layers.0.self_attn/cache",
                "F32",
                vec![2, 1, 2, 1, 2],
                f32_bytes(&prompt),
            ),
            (
                "transformer.layers.0.self_attn/offset",
                "I64",
                vec![1],
                2i64.to_le_bytes().to_vec(),
            ),
        ]);
        let voice = read_safetensors(&file).unwrap();

        let cache = entry("cache", "float32", "nan", vec![2, 1, 3, 1, 2]);
        let StateData::F32(values) = cache.from_voice(&voice).unwrap() else {
            panic!("cache is f32")
        };
        assert_eq!(&values[0..4], &[1.0, 2.0, 3.0, 4.0]);
        assert!(values[4].is_nan() && values[5].is_nan());
        assert_eq!(&values[6..10], &[5.0, 6.0, 7.0, 8.0]);
        assert!(values[10].is_nan() && values[11].is_nan());

        let step = entry("step", "int64", "zeros", vec![1]);
        assert_eq!(step.from_voice(&voice).unwrap(), StateData::I64(vec![2]));

        let end = entry("current_end", "float32", "empty", vec![0]);
        assert_eq!(end.from_voice(&voice).unwrap(), StateData::F32(vec![]));

        // A prompt longer than the cache is refused, not truncated into nonsense.
        let small = entry("cache", "float32", "nan", vec![2, 1, 1, 1, 2]);
        assert!(small.from_voice(&voice).is_err());
    }

    #[test]
    fn a_state_starts_as_its_fill() {
        assert_eq!(
            entry("first", "bool", "ones", vec![1]).initial().unwrap(),
            StateData::Bool(vec![true])
        );
        assert_eq!(
            entry("x", "float32", "zeros", vec![2, 2])
                .initial()
                .unwrap(),
            StateData::F32(vec![0.0; 4])
        );
        assert!(entry("x", "float16", "zeros", vec![1]).initial().is_err());
    }

    #[test]
    fn base64_matches_the_known_vectors() {
        // RFC 4648 section 10, which is what the decoder on the other side implements.
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn samples_round_trip_through_the_encoding() {
        let samples = [0.0f32, 1.0, -1.0, 0.5];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(encode_samples_base64(&samples), base64_encode(&bytes));
    }
}
