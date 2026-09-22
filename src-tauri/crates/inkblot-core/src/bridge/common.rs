//! The vocabulary every message shares: who a message is aimed at, and how it names
//! a place in a document.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// Which editor a message concerns.
///
/// This is sharp edge #5 made explicit. Today the active editor is elected by mouse
/// movement over a pane, and the winner is a live TipTap object passed around by
/// reference — `EditorLayout` reads `__inkblotCanvasCard` off it to tell the third
/// state apart. An object reference cannot cross a process boundary, so the election
/// result has to be a *name*, and the three names are these.
///
/// `CanvasCard` is the third state: a canvas card opened for editing holds the only
/// live editor on that pane, and the pane's own two TipTap instances sit idle holding
/// no document. A toolbar pointed at `Primary` while a card is being edited would be
/// driving an empty editor, which is exactly the bug the `__inkblotCanvasCard` gate
/// exists to prevent.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorTarget {
    Primary,
    Secondary,
    /// The live editor of a canvas card being edited, wherever that canvas sits.
    CanvasCard,
}

/// Which pane a document-level message concerns.
///
/// Distinct from `EditorTarget` on purpose: a pane can be showing a canvas, which has
/// no editor at all, so "open this document in the right-hand pane" and "apply bold in
/// the right-hand editor" are not the same address.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pane {
    Primary,
    Secondary,
}

/// A place in a document, as the protocol carries it.
///
/// **This is the one type sharp edge #3 is about, so it is worth reading the reason.**
/// A ProseMirror position is an index into a document that every edit invalidates.
/// In one process that is survivable: the holder maps its positions through each
/// transaction's mapping and is never more than a tick out of date. Across a process
/// boundary it is not — native holds a note, a workbench tile, a search result or a
/// read-aloud word, the user types, and the positions native is holding now address
/// different text with no signal that they do.
///
/// So nothing in this protocol carries a bare position. Everything carries the text
/// the position was resolved from as well, and the webview re-resolves by that text
/// when the positions no longer cover it. Two places in the React shell already do
/// exactly this dance by hand (`EditorLayout.jsx:291-304`, `Workbench.jsx:40-64`);
/// this type is that dance promoted to the protocol.
///
/// `from` and `to` are **UTF-16 code units**, like every other offset in this
/// codebase — see `js_string`. A byte offset or a `char` offset puts the caret in the
/// wrong place in any document containing an emoji.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAnchor {
    pub from: u32,
    pub to: u32,
    /// The text `from..to` covered when this anchor was made. The webview falls back
    /// to searching for it when the positions no longer do.
    pub text: String,
}

impl TextAnchor {
    pub fn new(from: u32, to: u32, text: impl Into<String>) -> Self {
        Self { from, to, text: text.into() }
    }

    /// A caret rather than a range.
    pub fn caret(pos: u32) -> Self {
        Self { from: pos, to: pos, text: String::new() }
    }

    pub fn is_empty(&self) -> bool {
        self.from >= self.to
    }
}

/// The marks the toolbar can toggle.
///
/// A closed set rather than a string because the toolbar is going native: a Swift
/// button sending `"bolb"` should not compile, and an enum is what makes that true in
/// all three languages at once.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkKind {
    Bold,
    Italic,
    Underline,
    Strike,
}

/// Text alignment, as the toolbar offers it.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alignment {
    Left,
    Center,
    Right,
}

/// One edit in a `replaceRanges` batch.
///
/// Batched because the ranges in a batch are resolved against one document state and
/// applied in one transaction. Sent one at a time, each would be resolved against a
/// document the previous one had already moved.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeEdit {
    pub anchor: TextAnchor,
    /// What to put there. Empty deletes the range.
    pub text: String,
}
