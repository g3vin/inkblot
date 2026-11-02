//! Everything version history computes, none of what it stores.
//!
//! Storage keeps version entries; this module gives them meaning:
//!   - the editing-session color (the single-user analogue of "which collaborator
//!     made this edit")
//!   - word counting and text extraction from either document kind
//!   - the diff engine: word-level token diff, paragraph-level block diff for
//!     side-by-side compare/merge, and a card-level diff for canvases
//!   - merge builders that turn per-chunk and per-card choices into a new document
//!
//! Mirrors `src/lib/versionHistory.js`; `npm run parity` asserts the two agree.
//!
//! **Three things live only in the webview**, because they need it:
//!   - `htmlToBlocks`, which needs a real `DOMParser`. [`diff_block_lists`] takes the
//!     blocks it produces, so the alignment — the part with the algorithm in it —
//!     is here.
//!   - the `toLocaleString` formatters, which are locale-dependent by design.
//!   - `groupVersions`, which is built out of those formatters.

use std::collections::{HashMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_string::JS_WHITESPACE_CLASS;
use crate::types::note::INK_IDS;
use crate::types::{
    CanvasDiff, CanvasEdge, CanvasFile, CanvasNode, CanvasNodeChange, DiffChunk, DiffOp,
    DiffOpType, HtmlBlock, MergeChoice, VersionEntry, VersionRow, WordDelta,
};

/* ============================================================
Editing sessions
============================================================ */

/// Stable session → ink. Same session, same color, across reloads of the panel.
///
/// The hash runs over UTF-16 code units, because `charCodeAt` does; iterating Rust
/// `char`s would give a different hue for any id containing an astral character.
pub fn session_color(session_id: &str) -> String {
    if session_id.is_empty() {
        return "var(--text-subtle)".to_string();
    }

    let mut hash: i32 = 0;
    for unit in session_id.encode_utf16() {
        // `| 0` in JS: wrap to a signed 32-bit integer at every step.
        hash = hash.wrapping_mul(31).wrapping_add(i32::from(unit));
    }

    // i32::MIN has no positive counterpart; JS does this in doubles and gets
    // 2147483648, so widen before taking the absolute value.
    let ink = INK_IDS[((i64::from(hash)).abs() % INK_IDS.len() as i64) as usize];
    format!("var(--ink-{ink})")
}

/* ============================================================
Text extraction and word counts
============================================================ */

static BLOCK_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)</(p|h[1-6]|li|blockquote|pre|div|tr)>|<br\s*/?>").unwrap());
static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());

/// `\s+`, spelled out rather than borrowed from `regex` — see [`JS_WHITESPACE_CLASS`].
static WHITESPACE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(&format!("[{JS_WHITESPACE_CLASS}]+")).unwrap());

/// HTML → plain text, with block boundaries becoming line breaks.
pub fn html_to_text(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let text = BLOCK_TAG_RE.replace_all(html, "\n");
    let text = TAG_RE.replace_all(&text, " ");
    // The same entities the JS does, in the same order, case-insensitively.
    let mut text = text.into_owned();
    for (entity, replacement) in [
        ("&nbsp;", " "),
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&quot;", "\""),
    ] {
        text = replace_ignore_ascii_case(&text, entity, replacement);
    }
    text
}

/// `String.replace(/needle/gi, replacement)` for a literal needle.
fn replace_ignore_ascii_case(haystack: &str, needle: &str, replacement: &str) -> String {
    let lowered = haystack.to_ascii_lowercase();
    let needle = needle.to_ascii_lowercase();
    let mut out = String::with_capacity(haystack.len());
    let mut cursor = 0;
    while let Some(offset) = lowered[cursor..].find(&needle) {
        let start = cursor + offset;
        out.push_str(&haystack[cursor..start]);
        out.push_str(replacement);
        cursor = start + needle.len();
    }
    out.push_str(&haystack[cursor..]);
    out
}

/// `text.split(/\s+/).filter(Boolean)` — the words in a string.
pub fn text_words(text: &str) -> Vec<String> {
    WHITESPACE_RE
        .split(text)
        .filter(|word| !word.is_empty())
        .map(|word| word.to_string())
        .collect()
}

/// Whitespace-separated words in `html_or_text`, read as HTML when `is_html`.
pub fn count_words(html_or_text: &str, is_html: bool) -> u32 {
    let text = if is_html {
        html_to_text(html_or_text)
    } else {
        html_or_text.to_string()
    };
    text_words(&text).len() as u32
}

/// Words on a canvas: everything typed into cards, labels, and edge labels.
pub fn count_canvas_words(canvas: &CanvasFile) -> u32 {
    let mut total = 0;
    for node in &canvas.nodes {
        total += node
            .text
            .as_deref()
            .map_or(0, |text| text_words(text).len());
        total += node
            .label
            .as_deref()
            .map_or(0, |label| text_words(label).len());
    }
    for edge in &canvas.edges {
        total += edge
            .label
            .as_deref()
            .map_or(0, |label| text_words(label).len());
    }
    total as u32
}

/// Words in a version entry, whichever kind it is. Older entries lack `words`.
pub fn version_words(entry: &VersionEntry) -> u32 {
    if let Some(words) = entry.words {
        return words;
    }
    if let Some(canvas) = &entry.canvas {
        return count_canvas_words(canvas);
    }
    if let Some(map) = &entry.map {
        return crate::map::model::count_map_words(map);
    }
    count_words(entry.content_html.as_deref().unwrap_or(""), true)
}

/* ============================================================
Timeline rows
============================================================ */

fn entry_text(entry: Option<&VersionEntry>) -> String {
    entry
        .map(|e| html_to_text(e.content_html.as_deref().unwrap_or("")))
        .unwrap_or_default()
}

/// The change in word count between two structured entries (a canvas or a map),
/// whose words are names and labels rather than prose to diff.
fn canvas_delta(newer: &VersionEntry, older: Option<&VersionEntry>) -> WordDelta {
    let diff = version_words(newer) as i64 - older.map(version_words).unwrap_or(0) as i64;
    WordDelta {
        added: diff.max(0) as u32,
        removed: (-diff).max(0) as u32,
    }
}

/// A word diff trimmed to what `ChangeSnippet` in `HistoryPanel.jsx` shows: three words
/// of context, then up to 24 words of change, stopping at the first long unchanged run.
/// With no change at all, the first twelve words.
pub fn change_snippet(ops: &[DiffOp]) -> Vec<DiffOp> {
    let op = |op_type, tokens: &[String]| DiffOp {
        op_type,
        tokens: tokens.to_vec(),
    };
    let Some(first_change) = ops.iter().position(|o| o.op_type != DiffOpType::Equal) else {
        let tokens = ops
            .first()
            .map(|o| &o.tokens[..o.tokens.len().min(12)])
            .unwrap_or(&[]);
        return vec![op(DiffOpType::Equal, tokens)];
    };

    let mut parts = Vec::new();
    let mut budget = 24usize;
    if first_change > 0 {
        let context = &ops[first_change - 1].tokens;
        parts.push(op(
            DiffOpType::Equal,
            &context[context.len().saturating_sub(3)..],
        ));
    }
    for current in &ops[first_change..] {
        if budget == 0 {
            break;
        }
        let tokens = &current.tokens[..current.tokens.len().min(budget)];
        if current.op_type == DiffOpType::Equal && current.tokens.len() > 6 {
            break;
        }
        parts.push(op(current.op_type, tokens));
        budget -= tokens.len();
    }
    parts
}

/// Every entry's row, newest first as stored. See [`VersionRow`].
pub fn version_rows(versions: &[VersionEntry]) -> Vec<VersionRow> {
    versions
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let previous = versions.get(index + 1);
            let (delta, snippet, summary) = if let Some(canvas) = &entry.canvas {
                let summary = match previous.and_then(|p| p.canvas.as_ref()) {
                    Some(before) => describe_canvas_diff(&diff_canvases(before, canvas)),
                    None => {
                        let cards = canvas.nodes.len();
                        format!(
                            "Snapshot · {cards} card{}",
                            if cards == 1 { "" } else { "s" }
                        )
                    }
                };
                (canvas_delta(entry, previous), Vec::new(), Some(summary))
            } else if let Some(map) = &entry.map {
                let summary = crate::map::diff::summarize_map_change(
                    previous.and_then(|p| p.map.as_ref()),
                    map,
                );
                (canvas_delta(entry, previous), Vec::new(), Some(summary))
            } else {
                let before = entry_text(previous);
                let after = entry_text(Some(entry));
                (
                    word_delta(&before, &after),
                    change_snippet(&diff_words(&before, &after)),
                    None,
                )
            };
            VersionRow {
                id: entry.id.clone(),
                timestamp: entry.timestamp.clone(),
                name: entry.name.clone(),
                auto: entry.auto,
                session_id: entry.session_id.clone(),
                session_color: session_color(entry.session_id.as_deref().unwrap_or("")),
                delta,
                snippet,
                summary,
            }
        })
        .collect()
}

/// The change across a burst of edits: from the entry before `oldest` to `newest`,
/// both given as indices into the newest-first list.
pub fn span_delta(versions: &[VersionEntry], newest: usize, oldest: usize) -> WordDelta {
    let Some(newer) = versions.get(newest) else {
        return WordDelta::default();
    };
    let before = versions.get(oldest + 1);
    if newer.canvas.is_some() || newer.map.is_some() {
        return canvas_delta(newer, before);
    }
    word_delta(&entry_text(before), &entry_text(Some(newer)))
}

mod canvas_diff;
mod text_diff;

pub use canvas_diff::{
    canvas_diff_is_empty, canvas_node_text, describe_canvas_diff, diff_canvases, merge_canvases,
};
pub use text_diff::{diff_block_lists, diff_tokens, diff_words, merge_chunks_to_html, word_delta};

#[cfg(test)]
mod tests;
