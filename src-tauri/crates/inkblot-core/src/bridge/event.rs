//! `WebviewEvent` — what the document surface tells the shell.
//!
//! The asymmetry with `NativeCommand` matters. Commands are
//! imperative and rare; events are observations and some of them fire on every
//! transaction. Each event below that can fire at that rate says so, and says what it
//! costs, because "batch it or it saturates the bridge" is only actionable if you know
//! which ones "it" means.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::archive::ArchiveChanged;
use super::bubble::{BubbleChipsChanged, BubbleSessionOpened};
use super::references::{ReferenceSchema, ReferencesChanged, RevealReference};
use super::common::{Alignment, BlockType, EditorTarget, Pane, TextAnchor};
use crate::types::json::JsonValue;
use super::sidebar::{
    ClipboardChanged, NotePreviewDismissed, NotesChanged, ShowSidebarTab, TilesChanged,
    VersionsChanged,
};
use super::workspace::{DraftPaneChanged, SentenceStructure, TabsChanged};
use crate::types::note::Note;
use crate::types::read_aloud::ReadAloudPayload;
use crate::types::search::SearchResult;
use super::print::{PageLayoutState, PrintRequest};

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
    /// Not marks either — whether the caret is in a bulleted or numbered list, for the
    /// toolbar's list toggles.
    pub bullet_list: bool,
    pub ordered_list: bool,
}

/// The formatting at the selection, pushed.
///
/// Reading it takes about ten synchronous facts off the live editor — text-style
/// attributes, four mark states resolved against the adjacent text node when the
/// selection is collapsed, the alignment of whichever of three node kinds is selected
/// — so the webview does the reading (`src/bridge/readState.ts`), once per animation
/// frame, and sends the answer. A toolbar renders this struct and never asks a
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
    /// What the Paragraph Style menu shows as current.
    pub block_type: BlockType,
    pub active_marks: ActiveMarks,
    /// Whether the editor's own history has a step to undo or redo — the document's
    /// Undo/Redo toolbar item. A canvas reports its own in `CanvasToolbarState`.
    pub can_undo: bool,
    pub can_redo: bool,
    /// The color the context menu's "Highlight" item would apply — what used to live
    /// on `editor.storage.lastHighlightColor`. See `SetHighlightCommand`.
    pub last_highlight_color: String,
}

/// Everything a context menu needs to build itself, resolved in one read.
///
/// A native context menu needs this as a *request*, not a push: the menu is built when the user
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
/// `useEditorNotes` remaps on every transaction — every keystroke in a document with
/// quote notes — and the shell holds those positions. Two things
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
/// offset it by the web view's frame. Nothing here is an object reference: every
/// field survives serialization.
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

/// Where one note marker is, for a shell that draws the markers itself. Client
/// coordinates inside the webview, as `NoteMarkerEvent`'s.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMarkerRect {
    pub note_id: String,
    pub color: String,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// Every note marker the user can see, and where — the whole list, so it is safe to
/// coalesce. Sent when any of them appears, goes, or moves (a scroll, a reflow). The
/// page still owns the markers' hover and click; the shell draws the dots, as Liquid
/// Glass, over the page's invisible ones.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMarkersChanged {
    pub markers: Vec<NoteMarkerRect>,
}

/// The active editor election changed.
///
/// The election is driven by mouse movement over a pane, which is a
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

/// The canvas's own controls, pushed.
///
/// A canvas has two toolbars that take turns: its own, and the formatting one while a
/// card's text is being edited. The page decides which — it is the one that knows a
/// card editor is live — and says so with `state`: present, the canvas toolbar is up;
/// absent, it is not (no canvas is active, or a card is being edited). A native
/// toolbar renders this and sends `canvasCommand`s back to `state.surface_id`.
///
/// Rare but not per keystroke: it changes with zoom, selection, undo depth and the
/// memo recorder's clock, and the sender coalesces it to one per frame.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasToolbarChanged {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<CanvasToolbarState>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasToolbarState {
    /// The surface the commands go back to.
    pub surface_id: String,
    /// 1 is 100%.
    pub zoom: f64,
    pub can_undo: bool,
    pub can_redo: bool,
    pub has_selection: bool,
    pub can_group: bool,
    pub can_ungroup: bool,
    /// Read mode: the editing tools are hidden, not merely disabled.
    pub locked: bool,
    pub alignment_guides: bool,
    pub snap_to_grid: bool,
    pub can_record: bool,
    pub is_recording: bool,
    /// How long the memo has been recording, in milliseconds. Zero when not recording.
    pub record_elapsed_ms: f64,
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

/// The page's own view settings that a shell offers as toolbar toggles, pushed whole
/// whenever either changes and once at startup. The page still owns both: the shell
/// asks with `setFocusMode` / `setWordCountVisible` and lights its buttons from this.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewOptions {
    pub focus_mode: bool,
    pub word_count_visible: bool,
}

/// Where one pane's word-count badge is, and what it says, for a shell that draws the
/// badges itself. Client coordinates inside the webview, as `NoteMarkerRect`'s.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCountBadge {
    pub text: String,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// Every word-count badge the user can see — the whole list, so it is safe to coalesce.
/// The page's badges stay where they are, invisible, to be measured; the shell draws
/// them as Liquid Glass, which only a view above the page can be.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCountsChanged {
    pub badges: Vec<WordCountBadge>,
}

/// What focus mode is showing.
///
/// `FocusModeOverlay` re-derives its view from the full document on every
/// transaction; sent at a keystroke's rate, the text would be the largest payload on
/// the bridge. So the overlay stays in the webview, and this event lets a native shell
/// mirror the *state* — which paragraph, how far through — without receiving the text.
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
/// A drag in Inkblot often starts in one component and ends in another — the
/// clipboard panel, an editor pane, a canvas — and in the Swift app one end can be
/// native. The drag events (`DragStarted`, `DragMoved`, `DragEnded`) carry the whole
/// hand-off, so nothing about a drag depends on shared state in the webview's
/// `window`. The webview side is `src/bridge/dragHandoff.ts`.
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
/// position. Coalesced to one per frame
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
/// `handled` is a *report*, not a negotiation: whichever drop target accepted the
/// payload says so when it does, and this event carries the final answer so the source
/// knows whether to remove what it was dragging. Two targets can see the same drop (an
/// editor and the clipboard panel underneath it); the first to claim it wins.
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
/// The project picker and its session restore are in the webview, and the
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
    CanvasToolbarChanged(CanvasToolbarChanged),
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
    /// The marker of an open hover preview moved — the document scrolled or reflowed.
    /// Coalesced to one per frame; it carries the whole rect, so a dropped one is
    /// superseded by the next.
    NoteMarkerMoved(NoteMarkerEvent),
    NotePreviewDismissed(NotePreviewDismissed),
    NoteMarkersChanged(NoteMarkersChanged),
    /// Open the bubble editor. Sent only to a shell that draws it (`bubble` chrome).
    BubbleSessionOpened(BubbleSessionOpened),
    /// Where the chips of sessions left open are, for a shell that draws them.
    BubbleChipsChanged(BubbleChipsChanged),
    ViewOptions(ViewOptions),
    /// A document's archive, whole (`archive.rs`).
    ArchiveChanged(ArchiveChanged),
    /// The project's sources, whole, for the document in view (`references.rs`).
    ReferencesChanged(ReferencesChanged),
    /// The kinds of source and the styles, sent once when the page mounts.
    ReferenceSchema(ReferenceSchema),
    /// Show a source in the panel.
    RevealReference(RevealReference),
    /// Where the word-count badges are, for a shell that draws them (`wordCount`
    /// chrome). Coalesced per frame; the total is itself debounced by the page.
    WordCountsChanged(WordCountsChanged),
    PageLayoutState(PageLayoutState),
    PrintRequest(PrintRequest),
    /// The tab dock, the new-tab chooser and the sentence bubble (see `workspace.rs`).
    TabsChanged(TabsChanged),
    DraftPaneChanged(DraftPaneChanged),
    SentenceStructure(SentenceStructure),
}
