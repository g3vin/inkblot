//! `WebviewEvent` — what the document surface tells the shell.
//!
//! The asymmetry with `NativeCommand` matters. Commands are
//! imperative and rare; events are observations and some of them fire on every
//! transaction. Each event below that can fire at that rate says so, and says what it
//! costs, because "batch it or it saturates the bridge" is only actionable if you know
//! which ones "it" means.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::map::MapChromeChanged;
use super::timeline::{TimelineChromeChanged, TimelineCursorChanged, TimelineRangesChanged};
use super::references::{ReferenceSchema, ReferencesChanged, RevealReference};
use super::common::{Alignment, BlockType, EditorTarget, Pane, TextAnchor, WritingFormat};
use super::sidebar::{ShowSidebarTab};
use super::tabs::TabsChanged;
use crate::types::read_aloud::ReadAloudPayload;
use super::print::{
    PageLayoutCatalog, PageLayoutState, PrintJobStatus, TypesetFocus,
    TypesetHistoryChanged,
};

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
    /// What the document is written as, which decides what the menu offers.
    #[serde(default)]
    pub writing_format: WritingFormat,
    pub active_marks: ActiveMarks,
    /// Whether the editor's own history has a step to undo or redo — the document's
    /// Undo/Redo toolbar item. A canvas reports its own in `CanvasToolbarState`.
    pub can_undo: bool,
    pub can_redo: bool,
    /// The color the context menu's "Highlight" item would apply. See
    /// `SetHighlightCommand`.
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
    /// the menu offers is built from — the workbench tiles and the quote note
    /// both take it verbatim. There is no separate `word` or `sentence`
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
    /// Positions inserted and removed since the last `DocChanged` for this pane.
    ///
    /// The page throttles this event, so these are sums over every transaction in the
    /// window, not one keystroke. Positions rather than characters — a split paragraph
    /// is two — which is close enough for "how much did the writer do", and exact for
    /// plain typing.
    #[serde(default)]
    pub inserted: u32,
    #[serde(default)]
    pub deleted: u32,
    /// The window was a paste or a drop. The page sends one on its own rather than
    /// folding it into the typing around it, so a shell can tell written words from
    /// pasted ones.
    #[serde(default)]
    pub paste: bool,
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
    ActiveEditorChanged(ActiveEditorChanged),
    CanvasToolbarChanged(CanvasToolbarChanged),
    /// The active map's toolbar and inspector (`map.rs`). Coalesced per frame.
    MapChromeChanged(MapChromeChanged),
    /// The active timeline view's toolbar and inspector (`timeline.rs`). Coalesced per frame.
    TimelineChromeChanged(TimelineChromeChanged),
    /// The time lens and passage handles, switched on or off.
    TimelineCursorChanged(TimelineCursorChanged),
    /// A document's timeline passages, as its editor maps them. Coalesced per frame.
    TimelineRangesChanged(TimelineRangesChanged),
    ReadAloudPayload(ReadAloudPayloadEvent),
    ProjectChanged(ProjectChanged),
    ShowSidebarTab(ShowSidebarTab),
    ViewOptions(ViewOptions),
    /// The project's sources, whole, for the document in view (`references.rs`).
    ReferencesChanged(ReferencesChanged),
    /// The kinds of source and the styles, sent once when the page mounts.
    ReferenceSchema(ReferenceSchema),
    /// Show a source in the panel.
    RevealReference(RevealReference),
    PageLayoutState(PageLayoutState),
    /// The Finishing tabs' fixed lists, sent once when the page mounts.
    PageLayoutCatalog(PageLayoutCatalog),
    PrintJobStatus(PrintJobStatus),
    /// A Typeset page's handle was picked: show its section in the inspector.
    TypesetFocus(TypesetFocus),
    /// A book's typeset history, newest first.
    TypesetHistoryChanged(TypesetHistoryChanged),
    /// The tabs and the split, whole (`tabs.rs`). Coalesced per frame.
    TabsChanged(TabsChanged),
}
