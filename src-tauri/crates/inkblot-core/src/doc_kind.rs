//! Which kind of document a tree path refers to.
//!
//! Canvases live on disk as `<name>.canvas.json`, so their tree path is
//! `Folder/name.canvas`. Every path→file mapping appends `.json` to the tree path, so
//! canvases travel through save/load/rename/move/delete unchanged, and the document
//! kind is a pure function of the path — no file read required.
//!
//! The kind is deliberately NOT read from a `type` field inside the file: the save
//! path whitelists the keys it writes, so any such field is unreliable.
//!
//! Mirrors `src/lib/docKind.js`; `npm run parity` asserts the two agree.

use crate::types::DocKind;

pub const CANVAS_SUFFIX: &str = ".canvas";

/// The kind of document a tree path names.
pub fn get_doc_kind(path: &str) -> DocKind {
    if path.ends_with(CANVAS_SUFFIX) {
        DocKind::Canvas
    } else {
        DocKind::Text
    }
}

pub fn is_canvas_doc(path: &str) -> bool {
    matches!(get_doc_kind(path), DocKind::Canvas)
}

pub fn with_canvas_suffix(name: &str) -> String {
    if is_canvas_doc(name) {
        name.to_string()
    } else {
        format!("{name}{CANVAS_SUFFIX}")
    }
}

pub fn strip_canvas_suffix(name: &str) -> String {
    if is_canvas_doc(name) {
        // The suffix is ASCII, so a byte slice is the same cut JS makes.
        name[..name.len() - CANVAS_SUFFIX.len()].to_string()
    } else {
        name.to_string()
    }
}

/// Last path segment with the `.canvas` suffix stripped — what the UI shows.
pub fn get_doc_display_name(path: &str) -> String {
    let last = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .unwrap_or("");
    strip_canvas_suffix(last)
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
    fn display_name_takes_the_last_non_empty_segment() {
        assert_eq!(get_doc_display_name("A//B/board.canvas"), "board");
        assert_eq!(get_doc_display_name("board"), "board");
        assert_eq!(get_doc_display_name("A/B/"), "B");
        assert_eq!(get_doc_display_name(""), "");
    }
}
