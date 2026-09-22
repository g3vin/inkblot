//! Splitting readable text into the chunks Read Aloud speaks.
//!
//! One chunk is one call to the speech engine, so the split decides two things the
//! listener notices: where the voice pauses, and how long it takes before the first
//! sound. The rules, in order of precedence:
//!
//!   1. never speak across a paragraph break
//!   2. prefer to end a chunk at a sentence
//!   3. when a single sentence is too long, break it at the last clause boundary that
//!      fits — a comma or a semicolon, not a random word
//!   4. and only if there is no boundary at all, break mid-clause
//!
//! Each chunk keeps the words it was built from, because the highlight scheduler needs
//! to map audio time back to document positions.
//!
//! Mirrors `splitReadAloudText` and `buildReadAloudChunks` in `src/lib/readAloud.js`
//! (`:426-627`); `npm run parity` asserts the two agree. Everything else in that file
//! — model loading, the WASM fallback, the highlight scheduler — stays in the webview.
//!
//! **Offsets are UTF-16 code units**, as everywhere that touches a ProseMirror
//! position. See [`crate::js_string`].

use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_string::{js_trim, utf16_len, utf16_slice, JS_WHITESPACE_CLASS};
use crate::types::{ReadAloudChunk, ReadAloudPayload, ReadAloudWord};

pub const MAX_READ_ALOUD_CHUNK_LENGTH: usize = 220;

/// A word that ends a sentence: terminal punctuation, then any closing quotes or
/// brackets that trail it.
static SENTENCE_END: Lazy<Regex> =
    Lazy::new(|| Regex::new("[.!?]+[\"')\\]}»”’]*$").unwrap());

/// A word that ends a clause.
static CLAUSE_END: Lazy<Regex> = Lazy::new(|| Regex::new("[,;:][\"')\\]}»”’]*$").unwrap());

/// Horizontal whitespace — JS's `[^\S\n]`, which is `\s` minus the newline.
static HORIZONTAL_SPACE: Lazy<Regex> = Lazy::new(|| {
    let without_newline = JS_WHITESPACE_CLASS.replace('\n', "");
    Regex::new(&format!("[{without_newline}]+")).unwrap()
});

static NEWLINE_RUN: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[{JS_WHITESPACE_CLASS}]*\n+[{JS_WHITESPACE_CLASS}]*")).unwrap());

static SPACE_BEFORE_PUNCTUATION: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[{JS_WHITESPACE_CLASS}]+([,.;:!?])")).unwrap());

static NON_SPACE_RUN: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[^{JS_WHITESPACE_CLASS}]+")).unwrap());

/// Chunk text, as it is handed to the speech engine.
///
/// Line breaks become spaces — a voice cannot pronounce one, and leaving it in makes
/// the engine pause in the middle of a sentence that only *looked* broken. Space before
/// punctuation is closed up for the same reason.
fn normalize_speech_chunk_text(text: &str) -> String {
    let text = HORIZONTAL_SPACE.replace_all(text, " ");
    let text = NEWLINE_RUN.replace_all(&text, " ");
    let text = SPACE_BEFORE_PUNCTUATION.replace_all(&text, "$1");
    js_trim(&text).to_string()
}

/// Plain text → the chunks it speaks as. The simple entry point, for text with no
/// document positions attached.
pub fn split_read_aloud_text(text: &str, max_length: usize) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n");
    let normalized = HORIZONTAL_SPACE.replace_all(&normalized, " ");
    let normalized = js_trim(&normalized).to_string();
    if normalized.is_empty() {
        return Vec::new();
    }

    let words: Vec<ReadAloudWord> = NON_SPACE_RUN
        .find_iter(&normalized)
        .map(|found| {
            let start = crate::js_string::byte_to_utf16(&normalized, found.start());
            ReadAloudWord {
                text: found.as_str().to_string(),
                start_offset: Some(start as u32),
                end_offset: Some((start + utf16_len(found.as_str())) as u32),
                from: None,
                to: None,
            }
        })
        .collect();

    let payload = ReadAloudPayload { text: normalized, words };
    build_read_aloud_chunks(&payload, max_length).into_iter().map(|chunk| chunk.text).collect()
}

/// The full entry point: text plus the words the editor resolved, each carrying the
/// document positions the highlight scheduler will need.
pub fn build_read_aloud_chunks(payload: &ReadAloudPayload, max_length: usize) -> Vec<ReadAloudChunk> {
    if payload.text.is_empty() || payload.words.is_empty() {
        return Vec::new();
    }

    let text = payload.text.replace("\r\n", "\n");
    let words = words_with_text_offsets(&text, &payload.words);

    let mut chunks = Vec::new();
    for paragraph in group_words_by_paragraph_breaks(&text, &words) {
        chunks.extend(build_paragraph_chunks(&text, &paragraph, max_length));
    }
    chunks
}

/// Fill in any word that arrived without offsets, by finding it in the text.
///
/// The cursor only ever moves forward, so a repeated word matches its own occurrence
/// rather than the first one. A word that cannot be found at all is dropped.
fn words_with_text_offsets(text: &str, words: &[ReadAloudWord]) -> Vec<ReadAloudWord> {
    let mut cursor = 0usize;
    let mut resolved = Vec::with_capacity(words.len());

    for word in words {
        if word.start_offset.is_some() && word.end_offset.is_some() {
            resolved.push(word.clone());
            continue;
        }

        let haystack = utf16_slice(text, cursor, utf16_len(text));
        let Some(byte_offset) = haystack.find(&word.text) else { continue };
        let start_offset = cursor + crate::js_string::byte_to_utf16(haystack, byte_offset);
        let end_offset = start_offset + utf16_len(&word.text);
        cursor = end_offset;

        let mut filled = word.clone();
        filled.start_offset = Some(start_offset as u32);
        filled.end_offset = Some(end_offset as u32);
        resolved.push(filled);
    }

    resolved
}

fn offsets(word: &ReadAloudWord) -> (usize, usize) {
    (word.start_offset.unwrap_or(0) as usize, word.end_offset.unwrap_or(0) as usize)
}

/// Never speak across a paragraph break: any gap between two words containing a
/// newline starts a new group.
fn group_words_by_paragraph_breaks(text: &str, words: &[ReadAloudWord]) -> Vec<Vec<ReadAloudWord>> {
    let mut paragraphs = Vec::new();
    let mut paragraph: Vec<ReadAloudWord> = Vec::new();

    for word in words {
        if let Some(previous) = paragraph.last() {
            let gap = utf16_slice(text, offsets(previous).1, offsets(word).0);
            if gap.contains('\n') {
                paragraphs.push(std::mem::take(&mut paragraph));
            }
        }
        paragraph.push(word.clone());
    }

    if !paragraph.is_empty() {
        paragraphs.push(paragraph);
    }
    paragraphs
}

fn build_paragraph_chunks(
    text: &str,
    words: &[ReadAloudWord],
    max_length: usize,
) -> Vec<ReadAloudChunk> {
    let mut chunks = Vec::new();
    let mut current: Vec<ReadAloudWord> = Vec::new();

    for sentence in split_words_into_sentences(words) {
        if sentence.is_empty() {
            continue;
        }

        if words_text_length(text, &sentence) > max_length {
            push_chunk(text, std::mem::take(&mut current), &mut chunks);
            chunks.extend(split_long_sentence(text, &sentence, max_length));
            continue;
        }

        let mut next = current.clone();
        next.extend(sentence.iter().cloned());
        if !current.is_empty() && words_text_length(text, &next) > max_length {
            push_chunk(text, std::mem::take(&mut current), &mut chunks);
            current = sentence;
            continue;
        }

        current = next;
    }

    push_chunk(text, current, &mut chunks);
    chunks
}

fn split_words_into_sentences(words: &[ReadAloudWord]) -> Vec<Vec<ReadAloudWord>> {
    let mut sentences = Vec::new();
    let mut sentence: Vec<ReadAloudWord> = Vec::new();

    for word in words {
        sentence.push(word.clone());
        if SENTENCE_END.is_match(&word.text) {
            sentences.push(std::mem::take(&mut sentence));
        }
    }

    if !sentence.is_empty() {
        sentences.push(sentence);
    }
    sentences
}

/// A sentence longer than a chunk, broken at clause boundaries where it can be.
fn split_long_sentence(
    text: &str,
    words: &[ReadAloudWord],
    max_length: usize,
) -> Vec<ReadAloudChunk> {
    let mut chunks = Vec::new();
    let mut current: Vec<ReadAloudWord> = Vec::new();

    for word in words {
        current.push(word.clone());

        if words_text_length(text, &current) <= max_length {
            continue;
        }

        if let Some(split_index) = last_clause_boundary(text, &current, max_length) {
            let rest = current.split_off(split_index);
            push_chunk(text, std::mem::take(&mut current), &mut chunks);
            current = rest;
            continue;
        }

        // No boundary to use: keep everything that fit and carry the word that did not.
        if current.len() > 1 {
            let overflow = current.pop().expect("length checked");
            push_chunk(text, std::mem::take(&mut current), &mut chunks);
            current = vec![overflow];
        }
    }

    push_chunk(text, current, &mut chunks);
    chunks
}

/// The index to cut at: one past the last clause-ending word whose prefix still fits.
/// Never the first or last word — a cut there is not a clause break, it is a hyphen.
fn last_clause_boundary(
    text: &str,
    words: &[ReadAloudWord],
    max_length: usize,
) -> Option<usize> {
    if words.len() < 3 {
        return None;
    }
    for index in (1..=words.len() - 2).rev() {
        if CLAUSE_END.is_match(&words[index].text)
            && words_text_length(text, &words[..=index]) <= max_length
        {
            return Some(index + 1);
        }
    }
    None
}

fn words_text_length(text: &str, words: &[ReadAloudWord]) -> usize {
    let Some(first) = words.first() else { return 0 };
    let last = words.last().expect("non-empty");
    utf16_len(&normalize_speech_chunk_text(utf16_slice(
        text,
        offsets(first).0,
        offsets(last).1,
    )))
}

fn push_chunk(text: &str, words: Vec<ReadAloudWord>, chunks: &mut Vec<ReadAloudChunk>) {
    if words.is_empty() {
        return;
    }
    let first = offsets(&words[0]).0;
    let last = offsets(words.last().expect("non-empty")).1;
    let chunk_text = normalize_speech_chunk_text(utf16_slice(text, first, last));
    if !chunk_text.is_empty() {
        chunks.push(ReadAloudChunk { text: chunk_text, words });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(text: &str, max_length: usize) -> Vec<String> {
        split_read_aloud_text(text, max_length)
    }

    #[test]
    fn a_paragraph_break_always_ends_a_chunk() {
        let chunks = split("First para.\n\nSecond para.", 220);
        assert_eq!(chunks, ["First para.", "Second para."]);
    }

    #[test]
    fn sentences_pack_together_until_they_would_not_fit() {
        let chunks = split("One. Two. Three.", 220);
        assert_eq!(chunks, ["One. Two. Three."]);
        let chunks = split("One. Two. Three.", 8);
        assert_eq!(chunks, ["One.", "Two.", "Three."]);
    }

    #[test]
    fn a_long_sentence_breaks_at_a_clause_rather_than_a_word() {
        let chunks = split("alpha beta, gamma delta epsilon zeta eta theta", 20);
        assert_eq!(chunks[0], "alpha beta,");
    }

    #[test]
    fn a_sentence_with_no_clause_boundary_breaks_where_it_must() {
        let chunks = split("aaaa bbbb cccc dddd eeee", 10);
        // Every chunk fits, and nothing is lost.
        assert!(chunks.iter().all(|chunk| chunk.len() <= 10));
        assert_eq!(chunks.join(" "), "aaaa bbbb cccc dddd eeee");
    }

    #[test]
    fn closing_punctuation_still_ends_the_sentence() {
        let chunks = split("He said \"stop!\" Then he left.", 16);
        assert_eq!(chunks, ["He said \"stop!\"", "Then he left."]);
    }

    #[test]
    fn a_line_break_inside_a_chunk_becomes_a_space() {
        // Not a paragraph break: the words either side are in the same group only if
        // no newline separates them, so this is one chunk per line.
        assert_eq!(split("one\ntwo", 220), ["one", "two"]);
        // But a soft-wrapped chunk's own text never keeps a newline.
        assert_eq!(normalize_speech_chunk_text("one\n two"), "one two");
        assert_eq!(normalize_speech_chunk_text("word , next"), "word, next");
    }

    #[test]
    fn nothing_readable_produces_nothing() {
        assert!(split("", 220).is_empty());
        assert!(split("   \n  \t ", 220).is_empty());
    }
}
