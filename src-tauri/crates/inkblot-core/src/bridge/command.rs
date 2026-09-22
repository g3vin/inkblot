//! `NativeCommand` — what the shell tells the document surface to do.
//!
//! Every variant carries a named payload struct rather than an anonymous one. That is
//! not style: typeshare emits an anonymous struct variant as an inline TypeScript
//! object and a `NativeCommandFooInner` Swift struct, neither of which anything can
//! name. A named struct gives all three languages a type per command, which is what
//! lets a handler be written against one command instead of against the union.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{Alignment, EditorTarget, MarkKind, Pane, RangeEdit, TextAnchor};
use crate::types::json::JsonValue;
use crate::types::note::Note;

/// A command aimed at an editor with nothing else to say.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetOnly {
    pub target: EditorTarget,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyMarkCommand {
    pub target: EditorTarget,
    pub mark: MarkKind,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetColorCommand {
    pub target: EditorTarget,
    /// A CSS color. Not validated here — the webview passes it to TipTap as given.
    pub color: String,
}

/// Set the highlight color, and say what the remembered color becomes.
///
/// This is sharp edge #1's second half. `Toolbar.jsx:240` writes the chosen color to
/// `editor.storage.lastHighlightColor` and `contextMenu/editorMenu.js:78` reads it
/// back — shared mutable state on a live editor object, reachable from both sides of
/// a seam that does not exist yet. The value is part of the protocol instead: the
/// command says what to remember, and `ToolbarState` reports it back.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetHighlightCommand {
    pub target: EditorTarget,
    pub color: String,
    /// Whether this color becomes the one the context menu's "Highlight" item uses.
    /// False for a preview while the user is still dragging in the color picker.
    pub remember: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFontFamilyCommand {
    pub target: EditorTarget,
    /// The family *name* ("Georgia"), not a CSS font stack. The webview quotes it —
    /// `toCssFontFamily` — because the quoting rules are a CSS detail and a native
    /// shell should not have to know them.
    pub family: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFontSizeCommand {
    pub target: EditorTarget,
    /// A CSS length, e.g. `"18px"`. Carried as written because that is what is stored
    /// on the mark and what the toolbar displays.
    pub size: String,
}

/// Set alignment on whatever the selection is.
///
/// Deliberately one command and not three. Alignment means a different edit depending
/// on what is selected — a conversation tile and an image take it as a node attribute,
/// text takes it as a block attribute, and an image additionally has to drop out of a
/// wrap layout. All of that is schema knowledge, so it stays in the webview.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAlignmentCommand {
    pub target: EditorTarget,
    pub alignment: Alignment,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertTableCommand {
    pub target: EditorTarget,
    pub rows: u32,
    pub cols: u32,
    pub with_header_row: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentCommand {
    /// A project-relative tree path. A `.canvas` suffix makes it a canvas — routing is
    /// purely by suffix (`doc_kind`), so there is no kind field to get wrong.
    pub path: String,
    pub pane: Pane,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSelectionCommand {
    pub target: EditorTarget,
    pub anchor: TextAnchor,
    pub scroll_into_view: bool,
    pub focus: bool,
}

/// Put the selection on some text, re-finding it if the positions have gone stale.
///
/// The difference from `setSelection` is which half of the anchor is authoritative.
/// `setSelection` trusts the positions and uses the text only to check them;
/// `jumpToAnchor` trusts the text and uses the positions only as a starting guess.
/// Search results, workbench tiles and notes — anything native has been holding
/// across edits it did not see — use this one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpToAnchorCommand {
    pub target: EditorTarget,
    pub anchor: TextAnchor,
    /// Try the anchor's positions before searching. False for anything whose positions
    /// were never meaningful in this document, such as a hit found by scanning a file
    /// on disk.
    pub prefer_positions: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetContentCommand {
    pub pane: Pane,
    /// The document path this content belongs to. Checked before applying: a load that
    /// resolves after the user has already switched documents must not overwrite the
    /// one now open.
    pub doc_path: String,
    /// A TipTap document, or a serialized canvas for a canvas pane.
    pub content: JsonValue,
    /// Whether this replacement is a document *load* rather than an edit. Loads are
    /// the transaction note anchors must not be mapped through — mapping through a
    /// whole-document replacement lands every note at position 0
    /// (`useEditorNotes.js`).
    pub is_load: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRangesCommand {
    pub target: EditorTarget,
    pub edits: Vec<RangeEdit>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCaretAtDocPosCommand {
    pub target: EditorTarget,
    /// A ProseMirror position in UTF-16 code units. Clamped to the document.
    pub pos: u32,
}

/// One transcript from the speech engine.
///
/// Sharp edge #2 is why this is so thin. `DictationControl.replaceInlineDraft` is a
/// read-modify-write at speaking rate: it reads the text the draft range currently
/// covers, diffs the common prefix and suffix against the new transcript, and
/// dispatches the changed slice plus its decoration in a single transaction. Asking
/// native for the current draft text and waiting for the answer would put a round trip
/// inside that loop, and whisper would win the race. So the whole draft state machine —
/// the range, the diff, the drain, the duplicate suppression — stays in the webview,
/// and native sends nothing but the transcripts and the mic level.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationTranscript {
    pub text: String,
    /// Which dictation session this came from. Chunks are transcribed concurrently, so
    /// a transcript can outlive the session that produced it; the webview drops one
    /// whose session is no longer current.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationLevelCommand {
    /// Mic level, 0..=1.
    pub level: f64,
}

/// Abandon the current draft. `delete_text` distinguishes the user cancelling
/// (the draft text goes away with it) from the session ending (it stays).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationCancelCommand {
    pub delete_text: bool,
}

/// Publish a document's notes into the editor, which is what the annotation
/// decorations render from.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncNotesCommand {
    pub doc_path: String,
    pub notes: Vec<Note>,
}

/// Run a command on the canvas the user aimed at.
///
/// `surface_id` is how a command finds one canvas when split view is showing two. In
/// the React shell the aiming is done by hit-testing the DOM for a `.canvas-surface`
/// and dispatching on that element (`canvasEvents.js`); native cannot hit-test the
/// webview's DOM, so the id is assigned by the webview when a surface mounts and
/// reported with `activeEditorChanged`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCommandRequest {
    pub surface_id: String,
    /// The command name, as `CanvasSurface`'s handler spells it.
    pub command: String,
    /// Command-specific arguments. Untyped because this is the one place the vocabulary
    /// is still open — the canvas menu grows items faster than the protocol should
    /// churn. Everything a native shell sends today is a name and at most a node id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<JsonValue>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDropDocCommand {
    pub surface_id: String,
    pub path: String,
    /// Where on the canvas, in client coordinates.
    pub client_x: f64,
    pub client_y: f64,
}

/// Drop a note onto a canvas. `doc_path` is the document that *owns* the note — the
/// card references it there rather than copying it, which is what keeps the two in
/// sync.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDropNoteCommand {
    pub surface_id: String,
    pub doc_path: String,
    pub note_id: String,
    pub client_x: f64,
    pub client_y: f64,
}

/// Select and center a node on a canvas that may not be open yet.
///
/// Addressed by document path rather than surface id for that reason: the request
/// outlives the switch, and the canvas that mounts a moment later claims it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRevealCommand {
    pub doc_path: String,
    pub node_id: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRestoreCommand {
    pub doc_path: String,
    /// The serialized, on-disk-shaped canvas from the version entry.
    pub canvas: JsonValue,
}

/// Insert text at the selection with no formatting of its own — the text takes on the
/// marks around it.
///
/// This is Edit ▸ Paste and Match Style. The shell reads the pasteboard, not the
/// webview: `WKWebView` cannot read the clipboard without a user gesture inside the
/// page, and the menu item is not one. It replaces `__inkblot_forcePlainPaste`, a flag
/// that was read and never set.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertPlainTextCommand {
    pub target: EditorTarget,
    pub text: String,
}

/// What kind of entry `createEntry` makes.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Document,
    Canvas,
    Folder,
}

/// Create a document, canvas or folder in the open project, and open it if it is a
/// document.
///
/// The page does the writing, not the shell, for the same reason as every command
/// below: a new document gets a tab and a place in the tree's stored order, and those
/// live in the page. The empty canvas is also the page's to define — it is
/// `createEmptyCanvas()` serialized as JSON Canvas.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEntryCommand {
    /// Tree path of the folder to create in; empty for the project root.
    pub parent_folder: String,
    /// The bare name. For a canvas the page adds the `.canvas` suffix.
    pub name: String,
    pub kind: EntryKind,
}

/// Rename a file or folder in place.
///
/// **Why the page performs these rather than the shell.** A rename changes a path the
/// page may be holding — the open document, a tab, the split pane, notes and versions
/// keyed by path — and the autosave that fires when a pane lets go of a document writes
/// to the path it had. Done from outside, that final save lands on the old path and
/// recreates the file. The page closes what the entry touches, waits for those final
/// saves, does the disk operation, and reopens at the new paths (`useEntryOperations`).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEntryCommand {
    pub path: String,
    pub is_folder: bool,
    /// The bare name. A canvas keeps its `.canvas` suffix whatever this says.
    pub new_name: String,
}

/// Move a file or folder into another folder. See `RenameEntryCommand`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveEntryCommand {
    pub path: String,
    pub is_folder: bool,
    /// Tree path; empty for the project root.
    pub target_folder: String,
}

/// Delete a file or folder. The shell has already asked the user.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntryCommand {
    pub path: String,
    pub is_folder: bool,
}

/// Copy a document beside itself as "<name> copy", and open the copy.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateEntryCommand {
    pub path: String,
}

/// Everything the shell can ask the document surface to do.
///
/// Adjacently tagged (`{ "type": …, "payload": … }`) because that is the one enum
/// representation typeshare generates — and here it is also the one we want: it emits
/// a discriminated union in TypeScript and a real `Codable` enum in Swift, so an
/// unhandled command is a compile error on both sides rather than a silent no-op.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum NativeCommand {
    ApplyMark(ApplyMarkCommand),
    SetColor(SetColorCommand),
    SetHighlight(SetHighlightCommand),
    SetFontFamily(SetFontFamilyCommand),
    SetFontSize(SetFontSizeCommand),
    SetAlignment(SetAlignmentCommand),
    InsertTable(InsertTableCommand),
    InsertConversationTile(TargetOnly),
    OpenDocument(OpenDocumentCommand),
    SetSelection(SetSelectionCommand),
    JumpToAnchor(JumpToAnchorCommand),
    SetContent(SetContentCommand),
    ReplaceRanges(ReplaceRangesCommand),
    SetCaretAtDocPos(SetCaretAtDocPosCommand),
    DictationPartial(DictationTranscript),
    DictationFinal(DictationTranscript),
    DictationLevel(DictationLevelCommand),
    DictationCancel(DictationCancelCommand),
    SyncNotes(SyncNotesCommand),
    CanvasCommand(CanvasCommandRequest),
    CanvasDropDoc(CanvasDropDocCommand),
    CanvasDropNote(CanvasDropNoteCommand),
    CanvasReveal(CanvasRevealCommand),
    CanvasRestore(CanvasRestoreCommand),
    InsertPlainText(InsertPlainTextCommand),
    CreateEntry(CreateEntryCommand),
    RenameEntry(RenameEntryCommand),
    MoveEntry(MoveEntryCommand),
    DeleteEntry(DeleteEntryCommand),
    DuplicateEntry(DuplicateEntryCommand),
}
