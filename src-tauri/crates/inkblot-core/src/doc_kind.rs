//! Which kind of document a tree path refers to.
//!
//! Canvases live on disk as `<name>.canvas.json`, so their tree path is
//! `Folder/name.canvas`; maps likewise as `<name>.map.json` → `Folder/name.map`, and
//! timeline views as `<name>.timeline.json` → `Folder/name.timeline`.
//! Every path→file mapping appends `.json` to the tree path, so structured documents
//! travel through save/load/rename/move/delete unchanged, and the document kind is a
//! pure function of the path — no file read required.
//!
//! The kind is deliberately NOT read from a `type` field inside the file: the save
//! path whitelists the keys it writes, so any such field is unreliable.
//!
//! Mirrors `src/lib/docKind.js`; `npm run parity` asserts the two agree.

use crate::types::DocKind;

pub const CANVAS_SUFFIX: &str = ".canvas";
pub const MAP_SUFFIX: &str = ".map";
pub const TIMELINE_SUFFIX: &str = ".timeline";

/// The suffix a kind carries on its tree path; a text document carries none.
fn kind_suffix(kind: DocKind) -> Option<&'static str> {
    match kind {
        DocKind::Canvas => Some(CANVAS_SUFFIX),
        DocKind::Map => Some(MAP_SUFFIX),
        DocKind::Timeline => Some(TIMELINE_SUFFIX),
        DocKind::Text => None,
    }
}

/// What the UI and error messages call a kind.
pub fn doc_kind_name(kind: DocKind) -> &'static str {
    match kind {
        DocKind::Canvas => "canvas",
        DocKind::Map => "map",
        DocKind::Timeline => "timeline",
        DocKind::Text => "text document",
    }
}

/// The kind of document a tree path names.
pub fn get_doc_kind(path: &str) -> DocKind {
    if path.ends_with(CANVAS_SUFFIX) {
        DocKind::Canvas
    } else if path.ends_with(MAP_SUFFIX) {
        DocKind::Map
    } else if path.ends_with(TIMELINE_SUFFIX) {
        DocKind::Timeline
    } else {
        DocKind::Text
    }
}

pub fn is_canvas_doc(path: &str) -> bool {
    matches!(get_doc_kind(path), DocKind::Canvas)
}

pub fn is_map_doc(path: &str) -> bool {
    matches!(get_doc_kind(path), DocKind::Map)
}

/// A timeline view: how one document shows the project's chronology (`types::timeline`).
pub fn is_timeline_doc(path: &str) -> bool {
    matches!(get_doc_kind(path), DocKind::Timeline)
}

/// A rich-text document — the only kind the text save path, autosave, print and word
/// counts handle. Anything else is structured, with its own reader and writer.
pub fn is_text_doc(path: &str) -> bool {
    matches!(get_doc_kind(path), DocKind::Text)
}

/// A canvas's file name for `name`, unchanged if it already has the suffix.
pub fn with_canvas_suffix(name: &str) -> String {
    if is_canvas_doc(name) {
        name.to_string()
    } else {
        format!("{name}{CANVAS_SUFFIX}")
    }
}

/// `name` without its canvas suffix, unchanged if it has none.
pub fn strip_canvas_suffix(name: &str) -> String {
    if is_canvas_doc(name) {
        // The suffix is ASCII, so a byte slice is the same cut JS makes.
        name[..name.len() - CANVAS_SUFFIX.len()].to_string()
    } else {
        name.to_string()
    }
}

/// `name` with the suffix `kind` needs, left alone when it already has it.
pub fn with_doc_suffix(name: &str, kind: DocKind) -> String {
    match kind_suffix(kind) {
        Some(suffix) if !name.ends_with(suffix) => format!("{name}{suffix}"),
        _ => name.to_string(),
    }
}

/// `name` with whichever kind suffix it carries removed.
pub fn strip_doc_suffix(name: &str) -> String {
    match kind_suffix(get_doc_kind(name)) {
        // ASCII suffix: the byte cut is the cut JS makes.
        Some(suffix) => name[..name.len() - suffix.len()].to_string(),
        None => name.to_string(),
    }
}

/// Last path segment with any kind suffix stripped — what the UI shows.
pub fn get_doc_display_name(path: &str) -> String {
    let last = path.split('/').filter(|segment| !segment.is_empty()).next_back().unwrap_or("");
    strip_doc_suffix(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_is_decided_by_the_suffix_alone() {
        assert_eq!(get_doc_kind("Notes/board.canvas"), DocKind::Canvas);
        assert_eq!(get_doc_kind("Notes/board"), DocKind::Text);
        // A file merely mentioning the suffix mid-name is a text document.
        assert_eq!(get_doc_kind("Notes/board.canvas.backup"), DocKind::Text);
        assert_eq!(get_doc_kind(""), DocKind::Text);
        assert_eq!(get_doc_kind("World/Aria.map"), DocKind::Map);
        assert_eq!(get_doc_kind("x.canvas.map"), DocKind::Map);
        assert_eq!(get_doc_kind("x.map.canvas"), DocKind::Canvas);
        assert_eq!(get_doc_kind("Plot/Main.timeline"), DocKind::Timeline);
        assert_eq!(get_doc_kind("Plot/Main.timeline.backup"), DocKind::Text);
    }

    #[test]
    fn suffix_helpers_are_idempotent() {
        assert_eq!(with_canvas_suffix("board"), "board.canvas");
        assert_eq!(with_canvas_suffix("board.canvas"), "board.canvas");
        assert_eq!(strip_canvas_suffix("board.canvas"), "board");
        assert_eq!(strip_canvas_suffix("board"), "board");
        // `.canvas` alone strips to the empty string, as it does in JS.
        assert_eq!(strip_canvas_suffix(".canvas"), "");
    }

    #[test]
    fn doc_suffix_helpers_cover_every_kind() {
        assert_eq!(with_doc_suffix("Aria", DocKind::Map), "Aria.map");
        assert_eq!(with_doc_suffix("Aria.map", DocKind::Map), "Aria.map");
        assert_eq!(with_doc_suffix("Aria", DocKind::Text), "Aria");
        assert_eq!(strip_doc_suffix("Aria.map"), "Aria");
        assert_eq!(strip_doc_suffix("board.canvas"), "board");
        assert_eq!(strip_doc_suffix("x.canvas.map"), "x.canvas");
        assert_eq!(with_doc_suffix("Main", DocKind::Timeline), "Main.timeline");
        assert_eq!(strip_doc_suffix("Main.timeline"), "Main");
    }

    #[test]
    fn display_name_takes_the_last_non_empty_segment() {
        assert_eq!(get_doc_display_name("A//B/board.canvas"), "board");
        assert_eq!(get_doc_display_name("World/Aria.map"), "Aria");
        assert_eq!(get_doc_display_name("Plot/Main.timeline"), "Main");
        assert_eq!(get_doc_display_name("board"), "board");
        assert_eq!(get_doc_display_name("A/B/"), "B");
        assert_eq!(get_doc_display_name(""), "");
    }
}
