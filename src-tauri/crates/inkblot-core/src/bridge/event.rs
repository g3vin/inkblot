//! `WebviewEvent` — what the document surface tells the shell.
//!
//! The asymmetry with `NativeCommand` is the point of the phase. Commands are
//! imperative and rare; events are observations and some of them fire on every
//! transaction. Each event below that can fire at that rate says so, and says what it
//! costs, because "batch it or it saturates the bridge" is only actionable if you know
//! which ones "it" means.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{Alignment, EditorTarget, Pane, TextAnchor};
use crate::types::json::JsonValue;
use super::sidebar::{ClipboardChanged, NotesChanged, ShowSidebarTab, TilesChanged, VersionsChanged};
use crate::types::note::Note;
use crate::types::read_aloud::ReadAloudPayload;
use crate::types::search::SearchResult;

/// Which marks are on at the selection.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveMarks {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    /// Not a mark — whether the caret is inside a table. It rides along because the
    /// toolbar's table button is lit by the same read.
    pub table: bool,
}

/// The formatting at the selection, pushed.
///
/// **Sharp edge #1.** `Toolbar.jsx:102-145` pulls this today: on every
/// `selectionUpdate` it reaches into the live editor and reads about ten facts —
/// text-style attributes, four mark states resolved against the adjacent text node
/// when the selection is collapsed, the alignment of whichever of three node kinds is
/// selected. All of it is synchronous, and none of it survives a process boundary.
///
/// So the direction inverts: the webview does the reading, once per animation frame,
/// and sends the answer. A native toolbar renders this struct and never asks a
/// question. The frame coalescing is not an optimization — `selectionUpdate` fires on
/// every cursor move, including every keystroke.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolbarState {
    /// Absent when no editor is live — a canvas with no card open, or an empty pane.
    /// The toolbar renders disabled rather than stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
    pub color: String,
    pub highlight: String,
    /// The family *name*, already parsed back out of the CSS font stack
    /// (`fromCssFontFamily`). A native font menu should not have to unquote CSS.
    pub font: String,
    pub font_size: String,
    pub alignment: Alignment,
    pub active_marks: ActiveMarks,
    /// The color the context menu's "Highlight" item would apply — what used to live
    /// on `editor.storage.lastHighlightColor`. See `SetHighlightCommand`.
    pub last_highlight_color: String,
}

/// Everything a context menu needs to build itself, resolved in one read.
///
/// Phase 5 needs this as a *request*, not a push: the menu is built when the user
/// right-clicks, and it must be built from the selection as it is at that moment. It
/// is also pushed on selection change, because a native shell wants to enable and
/// disable menu bar items without asking.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// What is selected. `anchor.text` is the selected text, which is what every item
    /// the menu offers is built from — the workbench tiles, the quote note, the
    /// analytic bubble all take it verbatim. There is no separate `word` or `sentence`
    /// field because nothing derives one: `editorMenu.js` reads the selection and
    /// stops.
    pub anchor: TextAnchor,
    pub empty: bool,
    /// Whether the selection overlaps a highlight mark, which is what decides between
    /// offering "Highlight" and "Remove Highlight".
    pub touches_highlight: bool,
    /// True when the pane is showing a canvas. The editor items do not apply.
    pub is_canvas: bool,
}

/// The document changed.
///
/// Fires on every transaction that touched the document, so it carries no content —
/// only the facts a shell needs to decide whether to do something expensive. A shell
/// that wants the text asks for it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocChanged {
    pub pane: Pane,
    pub doc_path: String,
    /// False while a document load is in flight, so autosave and version checkpoints
    /// do not treat a load as the user's edit.
    pub user_edit: bool,
    pub word_count: u32,
    pub char_count: u32,
}

/// Note anchors after a remap.
///
/// **Sharp edge #4.** `useEditorNotes` remaps on every transaction — every keystroke
/// in a document with quote notes — and native is holding those positions. Two things
/// keep that off the bridge's back:
///
/// 1. The event is coalesced to one per frame by the sender. Sending per transaction
///    saturates the bridge with nothing new; a caret that moved three times in one
///    frame has one final answer.
/// 2. It carries the **whole** remapped set, never a delta. That is what makes
///    coalescing safe: dropping an intermediate state loses nothing, because the next
///    one is complete. A delta stream would not survive a single dropped message.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesRemapped {
    pub doc_path: String,
    pub notes: Vec<Note>,
    /// Notes whose range collapsed to nothing in this remap. They have lost what they
    /// were about and have been dropped from `notes`; they are named here so a shell
    /// can tell "deleted" from "never sent".
    pub dropped_note_ids: Vec<String>,
}

/// The pointer entered, left, or clicked a note marker in the document.
///
/// `anchor_rect` is in client coordinates *inside the webview*, so a native shell must
/// offset it by the web view's frame. This is the event that `NoteAnnotation.js:155`
/// currently ships a live `EditorView` object in — an object, over an event, to a
/// listener in the same process. That field is gone: nothing here is a reference.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMarkerEvent {
    pub note_id: String,
    pub doc_path: String,
    pub anchor_left: f64,
    pub anchor_top: f64,
    pub anchor_right: f64,
    pub anchor_bottom: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Note>,
}

/// The active editor election changed.
///
/// **Sharp edge #5.** The election is driven by mouse movement over a pane, which is a
/// webview-side fact, so the webview stays the returning officer and reports the
/// result. `surface_id` is set when the winner is a canvas card, and it is what lets a
/// native canvas command find the right surface when split view shows two.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveEditorChanged {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// Set when `target` is `canvasCard`: the surface hosting the card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_id: Option<String>,
}

/// Search results from inside the open document.
///
/// Project-wide search is `inkblot-core`'s job and does not come through here; this is
/// only the part that needs a live document, because a ProseMirror position cannot be
/// computed from a file on disk.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatches {
    pub query: String,
    pub doc_path: String,
    pub results: Vec<SearchResult>,
    /// Which result is current, as an index into `results`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_index: Option<u32>,
}

/// What focus mode is showing.
///
/// `FocusModeOverlay` re-derives this from the full document on every transaction, and
/// the handoff flags that as the cost to watch: at a keystroke's rate this is the
/// largest payload on the bridge. It stays in the webview in Phase 5 for exactly that
/// reason, and this event exists so a native shell can mirror the *state* — which
/// paragraph, how far through — without receiving the text.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusModeView {
    pub active: bool,
    pub doc_path: String,
    /// Index of the paragraph the caret is in.
    pub paragraph_index: u32,
    pub paragraph_count: u32,
    pub word_count: u32,
}

/// The readable text of the document and the words resolved out of it.
///
/// Sent when Read Aloud starts, not continuously: it is the whole document. The
/// highlight scheduler that consumes it stays in the webview — mapping audio time back
/// to a ProseMirror position cannot cross the boundary — so what goes native is audio
/// generation and playback, and this is what they are given.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAloudPayloadEvent {
    pub doc_path: String,
    pub payload: ReadAloudPayload,
}

/// What is being dragged.
///
/// This is what replaces the `window.__inkblot_*` globals. They are six mutable
/// variables on `window` that four unrelated components read and write to coordinate
/// one drag — the clipboard panel writes what it picked up, the editor reads it on
/// drop and writes back whether it handled it, and the last pointer position is parked
/// there because the HTML5 drag events do not carry a usable one. None of that
/// survives a process boundary: `window` is the webview's, and a native drag source is
/// not in it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DragPayloadKind {
    /// A selection dragged out of an editor.
    EditorSelection,
    /// An entry dragged out of the clipboard history panel.
    ClipboardEntry,
    /// A document dragged out of the file tree.
    Document,
    /// A note card dragged out of the notes panel.
    NoteCard,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragStarted {
    pub drag_id: String,
    pub kind: DragPayloadKind,
    /// The plain text being dragged, where there is any.
    pub text: String,
    /// The entry, document or note the drag came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// Where in the source document the selection came from, for a drag that will move
    /// rather than copy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<TextAnchor>,
    /// Anything the drop target needs that the fields above do not model — a
    /// clipboard entry's rich content, a note's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<JsonValue>,
}

/// The pointer moved during a drag.
///
/// Carried explicitly because the DOM's own drag events do not reliably give a
/// position — which is why `__inkblot_dragPoint` existed. Coalesced to one per frame
/// by the sender, like `notesRemapped`, and for the same reason: only the last one
/// means anything.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragMoved {
    pub drag_id: String,
    pub client_x: f64,
    pub client_y: f64,
}

/// The drag ended — however it ended.
///
/// `handled` is the one that used to be `__inkblot_dropHandled`, and it is a
/// *report*, not a negotiation: whichever drop target accepted the payload says so
/// when it does, and this event carries the final answer so the source knows whether
/// to remove what it was dragging. Two targets can see the same drop (an editor and
/// the clipboard panel underneath it); the first to claim it wins, which is what the
/// flag arbitrated before.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DragEnded {
    pub drag_id: String,
    pub handled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_y: Option<f64>,
}

/// The project the webview has open changed.
///
/// The project picker and its session restore are still in the webview, and the
/// native sidebar has to show the tree of whatever project that is. `None` is the
/// landing screen: no project is open.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanged {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    /// Absolute. Present whenever `project_name` is, so the shell never has to
    /// re-derive a relocated project's root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
}

/// Everything the document surface reports to the shell.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum WebviewEvent {
    ToolbarState(ToolbarState),
    SelectionContext(SelectionContext),
    DocChanged(DocChanged),
    NotesRemapped(NotesRemapped),
    NoteMarkerHover(NoteMarkerEvent),
    NoteMarkerLeave(NoteMarkerEvent),
    NoteMarkerPin(NoteMarkerEvent),
    ActiveEditorChanged(ActiveEditorChanged),
    SearchMatches(SearchMatches),
    FocusModeView(FocusModeView),
    ReadAloudPayload(ReadAloudPayloadEvent),
    DragStarted(DragStarted),
    DragMoved(DragMoved),
    DragEnded(DragEnded),
    ProjectChanged(ProjectChanged),
    NotesChanged(NotesChanged),
    ClipboardChanged(ClipboardChanged),
    TilesChanged(TilesChanged),
    VersionsChanged(VersionsChanged),
    ShowSidebarTab(ShowSidebarTab),
}
