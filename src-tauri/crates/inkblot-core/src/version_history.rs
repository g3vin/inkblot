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
use crate::types::{
    CanvasDiff, CanvasEdge, CanvasFile, CanvasNode, CanvasNodeChange, DiffChunk, DiffOp,
    DiffOpType, HtmlBlock, MergeChoice, VersionEntry, VersionRow, WordDelta,
};

/* ============================================================
Editing sessions
============================================================ */

/// Stable session → hue. Same session, same color, across reloads of the panel.
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
    let hue = (i64::from(hash)).abs() % 360;
    format!("hsl({hue}, 55%, 55%)")
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
    if newer.canvas.is_some() {
        return canvas_delta(newer, before);
    }
    word_delta(&entry_text(before), &entry_text(Some(newer)))
}

/* ============================================================
Token diff (word level)
============================================================ */

/// Above this many DP cells the middle is treated as a plain replace: edits in prose
/// are local, so the prefix/suffix trim almost always keeps us under it.
const LCS_CELL_LIMIT: u64 = 400_000;

/// Diff two token slices into runs of equal, added and removed tokens.
///
/// Common prefix and suffix are trimmed first; the middle gets a real LCS when it is
/// small enough and a whole-run replace when it is not.
pub fn diff_tokens(a: &[String], b: &[String]) -> Vec<DiffOp> {
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }

    let mut end = 0;
    while end < a.len() - start
        && end < b.len() - start
        && a[a.len() - 1 - end] == b[b.len() - 1 - end]
    {
        end += 1;
    }

    let mid_a = &a[start..a.len() - end];
    let mid_b = &b[start..b.len() - end];

    let mut ops: Vec<DiffOp> = Vec::new();
    let mut push = |op_type: DiffOpType, tokens: &[String]| {
        if tokens.is_empty() {
            return;
        }
        match ops.last_mut() {
            Some(last) if last.op_type == op_type => last.tokens.extend_from_slice(tokens),
            _ => ops.push(DiffOp {
                op_type,
                tokens: tokens.to_vec(),
            }),
        }
    };

    push(DiffOpType::Equal, &a[..start]);

    let cells = mid_a.len() as u64 * mid_b.len() as u64;
    if mid_a.is_empty() || mid_b.is_empty() || cells > LCS_CELL_LIMIT {
        push(DiffOpType::Removed, mid_a);
        push(DiffOpType::Added, mid_b);
    } else {
        // Standard LCS table over the trimmed middles, walked back into runs.
        let rows = mid_a.len() + 1;
        let cols = mid_b.len() + 1;
        let mut table = vec![0u32; rows * cols];
        for i in 1..rows {
            for j in 1..cols {
                table[i * cols + j] = if mid_a[i - 1] == mid_b[j - 1] {
                    table[(i - 1) * cols + (j - 1)] + 1
                } else {
                    table[(i - 1) * cols + j].max(table[i * cols + (j - 1)])
                };
            }
        }

        let mut reversed: Vec<(DiffOpType, &String)> = Vec::new();
        let mut i = mid_a.len();
        let mut j = mid_b.len();
        while i > 0 || j > 0 {
            if i > 0 && j > 0 && mid_a[i - 1] == mid_b[j - 1] {
                reversed.push((DiffOpType::Equal, &mid_a[i - 1]));
                i -= 1;
                j -= 1;
            } else if j > 0 && (i == 0 || table[i * cols + (j - 1)] >= table[(i - 1) * cols + j]) {
                reversed.push((DiffOpType::Added, &mid_b[j - 1]));
                j -= 1;
            } else {
                reversed.push((DiffOpType::Removed, &mid_a[i - 1]));
                i -= 1;
            }
        }
        for (op_type, token) in reversed.into_iter().rev() {
            push(op_type, std::slice::from_ref(token));
        }
    }

    push(
        DiffOpType::Equal,
        if end > 0 { &a[a.len() - end..] } else { &[] },
    );
    ops
}

/// Word diff of two plain texts.
pub fn diff_words(a_text: &str, b_text: &str) -> Vec<DiffOp> {
    diff_tokens(&text_words(a_text), &text_words(b_text))
}

/// How many words a change added and removed.
pub fn word_delta(a_text: &str, b_text: &str) -> WordDelta {
    let mut delta = WordDelta::default();
    for op in diff_words(a_text, b_text) {
        match op.op_type {
            DiffOpType::Added => delta.added += op.tokens.len() as u32,
            DiffOpType::Removed => delta.removed += op.tokens.len() as u32,
            DiffOpType::Equal => {}
        }
    }
    delta
}

/* ============================================================
Block diff (paragraph level, for side-by-side compare/merge)
============================================================ */

/// Diff two block lists into aligned chunks for a two-column view.
///
/// Takes the blocks rather than the HTML: splitting HTML into blocks needs a real
/// `DOMParser`, so `htmlToBlocks` stays in the webview and hands its result here.
pub fn diff_block_lists(a_blocks: &[HtmlBlock], b_blocks: &[HtmlBlock]) -> Vec<DiffChunk> {
    let a_keys: Vec<String> = a_blocks.iter().map(|block| block.text.clone()).collect();
    let b_keys: Vec<String> = b_blocks.iter().map(|block| block.text.clone()).collect();
    let ops = diff_tokens(&a_keys, &b_keys);

    let mut chunks: Vec<DiffChunk> = Vec::new();
    let mut ai = 0;
    let mut bi = 0;

    let push_changed = |chunks: &mut Vec<DiffChunk>, left: &[HtmlBlock], right: &[HtmlBlock]| {
        if let Some(last) = chunks.last_mut() {
            if let (Some(last_left), Some(last_right)) = (&mut last.left, &mut last.right) {
                last_left.extend_from_slice(left);
                last_right.extend_from_slice(right);
                return;
            }
        }
        chunks.push(DiffChunk::changed(left.to_vec(), right.to_vec()));
    };

    for op in ops {
        let count = op.tokens.len();
        match op.op_type {
            DiffOpType::Equal => {
                chunks.push(DiffChunk::equal(b_blocks[bi..bi + count].to_vec()));
                ai += count;
                bi += count;
            }
            DiffOpType::Removed => {
                push_changed(&mut chunks, &a_blocks[ai..ai + count], &[]);
                ai += count;
            }
            DiffOpType::Added => {
                push_changed(&mut chunks, &[], &b_blocks[bi..bi + count]);
                bi += count;
            }
        }
    }

    chunks
}

/// Build merged HTML from compare chunks and the user's per-chunk choices.
///
/// A chunk with no choice defaults to the right side; equal chunks pass through.
pub fn merge_chunks_to_html(chunks: &[DiffChunk], choices: &HashMap<usize, MergeChoice>) -> String {
    let mut parts: Vec<&str> = Vec::new();

    for (index, chunk) in chunks.iter().enumerate() {
        if let Some(blocks) = &chunk.blocks {
            for block in blocks {
                parts.push(&block.html);
            }
            continue;
        }

        let choice = choices.get(&index).copied().unwrap_or(MergeChoice::Right);
        if matches!(choice, MergeChoice::Left | MergeChoice::Both) {
            for block in chunk.left.iter().flatten() {
                parts.push(&block.html);
            }
        }
        if matches!(choice, MergeChoice::Right | MergeChoice::Both) {
            for block in chunk.right.iter().flatten() {
                parts.push(&block.html);
            }
        }
    }

    let merged = parts.concat();
    if merged.is_empty() {
        "<p></p>".to_string()
    } else {
        merged
    }
}

/* ============================================================
Canvas diff (card level)
============================================================ */

/// What a card says, for previews and text diffs.
pub fn canvas_node_text(node: &CanvasNode) -> String {
    // Each fall-through is JS truthiness, so an empty string moves on to the next.
    let non_empty = |value: &Option<String>| value.clone().filter(|text| !text.is_empty());

    if let Some(text) = non_empty(&node.text) {
        return text;
    }
    if let Some(label) = non_empty(&node.label) {
        return label;
    }
    if let Some(url) = non_empty(&node.url) {
        return url;
    }
    if let Some(file) = non_empty(&node.file) {
        // `split('/').pop() || file` — a trailing slash falls back to the whole path.
        let last = file.split('/').next_back().unwrap_or("");
        return if last.is_empty() {
            file
        } else {
            last.to_string()
        };
    }
    String::new()
}

/// Nodes by id, keeping the order they appear in, with O(1) lookup.
///
/// A repeated id takes the later node's content at the earlier one's position, which
/// is what `Map.set` does. The map is what makes this linear: a canvas can hold
/// hundreds of cards, and scanning a Vec per lookup would make the diff quadratic.
fn canvas_nodes_by_id(canvas: &CanvasFile) -> (Vec<&str>, HashMap<&str, &CanvasNode>) {
    let mut order: Vec<&str> = Vec::new();
    let mut by_id: HashMap<&str, &CanvasNode> = HashMap::new();

    for node in &canvas.nodes {
        if node.id.is_empty() {
            continue;
        }
        if by_id.insert(&node.id, node).is_none() {
            order.push(&node.id);
        }
    }

    (order, by_id)
}

/// Whether two cards differ in anything the user typed or chose.
///
/// JS compares `JSON.stringify` of each key, which makes two TipTap documents with the
/// same content but different key order count as an edit. Comparing the parsed values
/// here does not. That is the one place this is deliberately less faithful, and it is
/// less faithful in the direction of being right.
fn node_content_changed(a: &CanvasNode, b: &CanvasNode) -> bool {
    a.text != b.text
        || a.inkblot_tip_tap != b.inkblot_tip_tap
        || a.label != b.label
        || a.file != b.file
        || a.url != b.url
        || a.color != b.color
        || a.inkblot_note_id != b.inkblot_note_id
}

fn node_moved(a: &CanvasNode, b: &CanvasNode) -> bool {
    a.x != b.x || a.y != b.y || a.width != b.width || a.height != b.height
}

/// Card-level diff of two serialized canvases (left = older, right = newer).
pub fn diff_canvases(left: &CanvasFile, right: &CanvasFile) -> CanvasDiff {
    let (left_order, left_nodes) = canvas_nodes_by_id(left);
    let (right_order, right_nodes) = canvas_nodes_by_id(right);

    let mut diff = CanvasDiff::default();

    for id in &right_order {
        let node = right_nodes[id];
        match left_nodes.get(id) {
            None => diff.added.push(node.clone()),
            Some(before) if node_content_changed(before, node) => {
                diff.edited.push(CanvasNodeChange {
                    before: (*before).clone(),
                    after: node.clone(),
                })
            }
            Some(before) if node_moved(before, node) => diff.moved.push(CanvasNodeChange {
                before: (*before).clone(),
                after: node.clone(),
            }),
            Some(_) => {}
        }
    }
    for id in &left_order {
        if !right_nodes.contains_key(id) {
            diff.removed.push(left_nodes[id].clone());
        }
    }

    fn edge_ids(canvas: &CanvasFile) -> HashSet<&str> {
        canvas
            .edges
            .iter()
            .map(|edge| edge.id.as_str())
            .filter(|id| !id.is_empty())
            .collect()
    }
    let left_edge_ids = edge_ids(left);
    let right_edge_ids = edge_ids(right);
    let kept = |edges: &[CanvasEdge], seen: &HashSet<&str>| -> Vec<CanvasEdge> {
        edges
            .iter()
            .filter(|edge| !edge.id.is_empty() && !seen.contains(edge.id.as_str()))
            .cloned()
            .collect()
    };
    diff.edges_added = kept(&right.edges, &left_edge_ids);
    diff.edges_removed = kept(&left.edges, &right_edge_ids);

    diff
}

pub fn canvas_diff_is_empty(diff: &CanvasDiff) -> bool {
    diff.added.is_empty()
        && diff.removed.is_empty()
        && diff.edited.is_empty()
        && diff.moved.is_empty()
        && diff.edges_added.is_empty()
        && diff.edges_removed.is_empty()
}

/// One-line summary for a condensed history row: "+2 cards · 1 edited · 3 moved".
pub fn describe_canvas_diff(diff: &CanvasDiff) -> String {
    let plural = |count: usize| if count == 1 { "" } else { "s" };
    let mut parts: Vec<String> = Vec::new();

    if !diff.added.is_empty() {
        parts.push(format!(
            "+{} card{}",
            diff.added.len(),
            plural(diff.added.len())
        ));
    }
    if !diff.removed.is_empty() {
        // U+2212 MINUS SIGN, to line up with the + above it.
        parts.push(format!(
            "\u{2212}{} card{}",
            diff.removed.len(),
            plural(diff.removed.len())
        ));
    }
    if !diff.edited.is_empty() {
        parts.push(format!("{} edited", diff.edited.len()));
    }
    if !diff.moved.is_empty() {
        parts.push(format!("{} moved", diff.moved.len()));
    }
    let edge_count = diff.edges_added.len() + diff.edges_removed.len();
    if edge_count > 0 {
        parts.push(format!("{edge_count} arrow{}", plural(edge_count)));
    }

    if parts.is_empty() {
        "No card changes".to_string()
    } else {
        parts.join(" · ")
    }
}

/// Merge two canvases from per-change decisions.
///
/// The result starts as the RIGHT side; each decision key flips one change back to the
/// left side:
///
/// ```text
///   added:<id>    take 'left'  -> drop the card right added
///   removed:<id>  take 'left'  -> bring back the card right deleted
///   edited:<id>   take 'left'  -> keep the older card content
///   moved:<id>    take 'left'  -> keep the older position
/// ```
///
/// Edges survive when both endpoints do; edge add/removes follow the same keys.
pub fn merge_canvases(
    right: &CanvasFile,
    diff: &CanvasDiff,
    decisions: &HashMap<String, MergeChoice>,
) -> CanvasFile {
    let take = |key: &str| decisions.get(key) == Some(&MergeChoice::Left);
    let mut nodes: Vec<CanvasNode> = Vec::new();

    let added_ids: HashSet<&str> = diff.added.iter().map(|node| node.id.as_str()).collect();
    let edited_by_id: HashMap<&str, &CanvasNodeChange> = diff
        .edited
        .iter()
        .map(|edit| (edit.after.id.as_str(), edit))
        .collect();
    let moved_by_id: HashMap<&str, &CanvasNodeChange> = diff
        .moved
        .iter()
        .map(|moved| (moved.after.id.as_str(), moved))
        .collect();

    for node in &right.nodes {
        if added_ids.contains(node.id.as_str()) && take(&format!("added:{}", node.id)) {
            continue;
        }

        if let Some(edit) = edited_by_id.get(node.id.as_str()) {
            if take(&format!("edited:{}", node.id)) {
                nodes.push(edit.before.clone());
                continue;
            }
        }

        if let Some(moved) = moved_by_id.get(node.id.as_str()) {
            if take(&format!("moved:{}", node.id)) {
                nodes.push(moved.before.clone());
                continue;
            }
        }

        nodes.push(node.clone());
    }

    for node in &diff.removed {
        if take(&format!("removed:{}", node.id)) {
            nodes.push(node.clone());
        }
    }

    let node_ids: Vec<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
    let mut edges: Vec<CanvasEdge> = Vec::new();
    let mut seen_edges: Vec<String> = Vec::new();
    let push_edge = |edges: &mut Vec<CanvasEdge>, seen: &mut Vec<String>, edge: &CanvasEdge| {
        if edge.id.is_empty() || seen.contains(&edge.id) {
            return;
        }
        if !node_ids.contains(&edge.from_node.as_str())
            || !node_ids.contains(&edge.to_node.as_str())
        {
            return;
        }
        seen.push(edge.id.clone());
        edges.push(edge.clone());
    };

    for edge in &right.edges {
        if diff.edges_added.iter().any(|added| added.id == edge.id)
            && take(&format!("edgeAdded:{}", edge.id))
        {
            continue;
        }
        push_edge(&mut edges, &mut seen_edges, edge);
    }
    for edge in &diff.edges_removed {
        if take(&format!("edgeRemoved:{}", edge.id)) {
            push_edge(&mut edges, &mut seen_edges, edge);
        }
    }

    CanvasFile {
        nodes,
        edges,
        ..right.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<String> {
        text_words(text)
    }

    fn text_version(id: &str, html: &str, session: &str) -> VersionEntry {
        VersionEntry {
            id: id.into(),
            timestamp: "2026-09-22T12:00:00.000Z".into(),
            kind: crate::types::VersionKind::Text,
            name: None,
            auto: true,
            session_id: Some(session.into()),
            words: None,
            content_html: Some(html.into()),
            content_json: None,
            canvas: None,
        }
    }

    #[test]
    fn a_row_describes_the_change_from_the_entry_before_it() {
        // Newest first, as stored.
        let versions = vec![
            text_version("v3", "<p>she hesitated at the red door</p>", "s2"),
            text_version("v2", "<p>she hesitated at the door</p>", "s1"),
            text_version("v1", "<p>she stood</p>", "s1"),
        ];
        let rows = version_rows(&versions);
        assert_eq!(
            rows[0].delta,
            WordDelta {
                added: 1,
                removed: 0
            }
        );
        assert_eq!(
            rows[0]
                .snippet
                .iter()
                .map(|op| (op.op_type, op.tokens.join(" ")))
                .collect::<Vec<_>>(),
            vec![
                (DiffOpType::Equal, "hesitated at the".to_string()),
                (DiffOpType::Added, "red".to_string()),
                (DiffOpType::Equal, "door".to_string()),
            ]
        );
        // The oldest has nothing before it, so all of it is new.
        assert_eq!(
            rows[2].delta,
            WordDelta {
                added: 2,
                removed: 0
            }
        );
        assert_eq!(rows[0].session_color, session_color("s2"));
        assert!(rows[0].summary.is_none());
    }

    #[test]
    fn a_burst_is_measured_from_before_its_oldest_entry() {
        let versions = vec![
            text_version("v3", "<p>one two three four</p>", "s"),
            text_version("v2", "<p>one two three</p>", "s"),
            text_version("v1", "<p>one</p>", "s"),
        ];
        // The burst v3..v2 is measured against v1.
        assert_eq!(
            span_delta(&versions, 0, 1),
            WordDelta {
                added: 3,
                removed: 0
            }
        );
        assert_eq!(span_delta(&versions, 9, 9), WordDelta::default());
    }

    #[test]
    fn a_snippet_stops_at_a_long_unchanged_run() {
        let long_tail = "a b c d e f g h";
        let ops = diff_words("start old", &format!("start new {long_tail} changed"));
        let snippet = change_snippet(&ops);
        assert!(snippet.iter().all(|op| op.tokens.join(" ") != long_tail));
        assert_eq!(change_snippet(&[]).len(), 1);
    }

    #[test]
    fn the_word_splitter_matches_javascripts_whitespace() {
        // U+FEFF is whitespace to JS and not to Unicode, so `regex`'s \s would call
        // this one word.
        assert_eq!(words("one\u{feff}two"), ["one", "two"]);
        assert_eq!(
            words("  leading and trailing  "),
            ["leading", "and", "trailing"]
        );
        assert_eq!(words("\u{a0}\u{2009}nbsp\u{3000}"), ["nbsp"]);
        assert!(words("   ").is_empty());
    }

    #[test]
    fn entities_and_block_tags() {
        // The opening tags become spaces, which is why the leading space is there.
        assert_eq!(html_to_text("<p>one</P><p>two</p>"), " one\n two\n");
        assert_eq!(html_to_text("a<BR/>b<br >c"), "a\nb\nc");
        assert_eq!(html_to_text("&AMP;&nbsp;&#39;"), "& '");
    }

    #[test]
    fn the_diff_trims_prefix_and_suffix_before_the_lcs() {
        let ops = diff_words("the quick brown fox", "the slow brown fox");
        let shape: Vec<(DiffOpType, usize)> =
            ops.iter().map(|op| (op.op_type, op.tokens.len())).collect();
        assert_eq!(
            shape,
            [
                (DiffOpType::Equal, 1),
                (DiffOpType::Removed, 1),
                (DiffOpType::Added, 1),
                (DiffOpType::Equal, 2)
            ]
        );
    }

    #[test]
    fn an_identical_pair_is_one_equal_run() {
        let ops = diff_words("same words here", "same words here");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op_type, DiffOpType::Equal);
        assert_eq!(ops[0].tokens.len(), 3);
    }

    #[test]
    fn session_color_hashes_utf16_code_units() {
        assert_eq!(session_color(""), "var(--text-subtle)");
        // An astral character is two code units; hashing chars would give another hue.
        assert!(session_color("🎨").starts_with("hsl("));
        assert_eq!(session_color("abc"), session_color("abc"));
    }

    #[test]
    fn word_delta_counts_both_directions() {
        let delta = word_delta("one two three", "one four five six");
        assert_eq!(
            delta,
            WordDelta {
                added: 3,
                removed: 2
            }
        );
    }
}
