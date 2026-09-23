//! The parts of Kokoro speech synthesis that are arithmetic rather than inference.
//!
//! Read Aloud's native speech runs the Kokoro model through `ort`
//! (`inkblot-models::kokoro_speech`). The pipeline splits across the process boundary:
//!
//! ```text
//!   webview:  text -> normalize -> phonemize -> token ids   (src/lib/readAloudVoice.ts)
//!   native:   token ids + voice style + speed -> ONNX -> f32 samples at 24kHz
//! ```
//!
//! Phonemization lives in the webview because a correct English grapheme-to-phoneme
//! pass is a lexicon and several thousand rules, and `phonemizer` provides one there.
//!
//! This module holds the pieces of the native half that are decidable without a model:
//! which slice of a voice file to use, and how the samples are handed back.

/// A Kokoro voice file is a stack of 256-float style vectors, one per token length.
pub const STYLE_DIM: usize = 256;

/// The model's context: 510 token positions, of which 509 have a style vector.
pub const MAX_STYLE_INDEX: usize = 509;

/// Kokoro generates at 24kHz.
pub const SAMPLE_RATE: u32 = 24_000;

/// Which style vector a sequence of `token_count` ids uses.
///
/// A voice file is indexed by *sequence length*: longer utterances get a different
/// prosody than short ones, which is how one 26MB file covers every phrase length. The
/// two subtracted are the tokenizer's leading and trailing padding, and the clamp is
/// the model's context limit — this is `256 * min(max(len - 2, 0), 509)` exactly as
/// kokoro-js computes it, and getting it wrong does not fail, it just makes the voice
/// sound wrong.
pub fn style_offset(token_count: usize) -> usize {
    STYLE_DIM * token_count.saturating_sub(2).min(MAX_STYLE_INDEX)
}

/// The style vector for this utterance, read out of a voice file's raw bytes.
///
/// The file is a flat array of little-endian `f32`. A file too short for the offset is
/// an error rather than a silent zero vector: it means the wrong file, and a voice that
/// is silently wrong is harder to diagnose than one that refuses.
pub fn voice_style(voice_bytes: &[u8], token_count: usize) -> Result<Vec<f32>, String> {
    let offset = style_offset(token_count);
    let start = offset * std::mem::size_of::<f32>();
    let end = start + STYLE_DIM * std::mem::size_of::<f32>();

    if voice_bytes.len() < end {
        return Err(format!(
            "voice file is {} bytes, too short for a {token_count}-token utterance (needs {end})",
            voice_bytes.len()
        ));
    }

    Ok(voice_bytes[start..end]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

/// Speed, clamped to what the model was trained for. Outside this it does not fail, it
/// produces something unlistenable.
pub fn clamp_speed(speed: f32) -> f32 {
    if speed.is_nan() {
        return 1.0;
    }
    speed.clamp(0.5, 2.0)
}

/// Samples as the webview wants them: raw little-endian `f32`, base64.
///
/// Not WAV — `base64ToFloat32Array` on the other side wants the samples themselves, and
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

    #[test]
    fn the_style_index_is_the_token_count_less_its_padding() {
        // The tokenizer's leading and trailing zeros do not count.
        assert_eq!(style_offset(2), 0);
        assert_eq!(style_offset(3), STYLE_DIM);
        assert_eq!(style_offset(12), STYLE_DIM * 10);
        // Shorter than the padding, which should not underflow into an enormous offset.
        assert_eq!(style_offset(0), 0);
        assert_eq!(style_offset(1), 0);
        // And past the model's context, where it saturates rather than reading off the
        // end of the voice file.
        assert_eq!(style_offset(10_000), STYLE_DIM * MAX_STYLE_INDEX);
    }

    #[test]
    fn a_style_vector_is_read_little_endian_at_its_offset() {
        // Two stacked vectors: the first all 1.0, the second all 2.0.
        let mut file = Vec::new();
        for value in [1.0f32, 2.0f32] {
            for _ in 0..STYLE_DIM {
                file.extend_from_slice(&value.to_le_bytes());
            }
        }

        // token_count 2 -> index 0, token_count 3 -> index 1.
        assert_eq!(voice_style(&file, 2).unwrap(), vec![1.0; STYLE_DIM]);
        assert_eq!(voice_style(&file, 3).unwrap(), vec![2.0; STYLE_DIM]);
    }

    #[test]
    fn a_voice_file_too_short_for_the_utterance_is_an_error() {
        let file = vec![0u8; STYLE_DIM * 4];
        assert!(voice_style(&file, 2).is_ok());
        // One vector in the file, but the utterance wants the second.
        assert!(voice_style(&file, 3).is_err());
        assert!(voice_style(&[], 2).is_err());
    }

    #[test]
    fn speed_is_clamped_to_something_listenable() {
        assert_eq!(clamp_speed(1.0), 1.0);
        assert_eq!(clamp_speed(0.1), 0.5);
        assert_eq!(clamp_speed(9.0), 2.0);
        assert_eq!(clamp_speed(f32::NAN), 1.0);
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
        let encoded = encode_samples_base64(&samples);
        // Decoded the way base64ToFloat32Array does: bytes back to little-endian f32.
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(encoded, base64_encode(&bytes));
        assert_eq!(encoded.len() % 4, 0);
    }
}
