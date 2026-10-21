//! `NativeCommand` — what the shell tells the document surface to do.
//!
//! Every variant carries a named payload struct rather than an anonymous one. That is
//! not style: typeshare emits an anonymous struct variant as an inline TypeScript
//! object, which nothing can name. A named struct gives each language a type per
//! command, which is what
//! lets a handler be written against one command instead of against the union.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{
    Alignment, BlockType, EditorTarget, HistoryAction, ListKind, MarkKind, Pane, RangeEdit,
    TextAnchor, WritingFormat,
};
use super::map::MapCommandRequest;
use super::print::{
    AddBookItemCommand, AddProjectFontCommand, ApplyBookStyleCommand, ApplyFormatCommand,
    ClearBookSetupCommand, EditBookItemCommand, EditCoverSetsCommand, EditEditionsCommand,
    ExportAgainCommand, ExportAllEditionsCommand, ExportDocumentCommand, GoToPageCommand,
    ImportScriptCommand, InsertBreakCommand, InsertFootnoteCommand, MeasureBookCommand,
    MoveBookItemCommand, OpenBookItemCommand, PreviewTypesetVersionCommand, PrintDocumentCommand,
    RefreshBookChaptersCommand, RemoveBookItemCommand, RenameTypesetVersionCommand,
    SaveTypesetVersionCommand, ScriptReportCommand, SetAuthorProfileCommand, SetBookCoverCommand,
    SetBookItemHiddenCommand, SetBookSettingsCommand, SetChapterMetaCommand, SetCoverImageCommand,
    SetDisplayDensityCommand, SetEditorModeCommand, SetFolderBookOptionsCommand,
    SetHeadImageCommand, SetPageSetupCommand, SetParagraphTypesetCommand, SetPrintLayoutCommand,
    SetPrintScopeCommand, SetPrintZoomCommand, SetSceneNumbersCommand, SetTextStyleCommand,
    SetTypesetDisplayCommand, SetTypesetViewCommand, ShowProofIssueCommand, TypesetVersionRef,
    UseSetupForBookCommand,
};
use super::references::{
    AddReferenceCommand, ChooseReferenceCandidateCommand, CreateReferenceCommand,
    InsertBibliographyCommand, InsertCitationCommand, ReferenceRef, SetBibliographyOptionsCommand,
    SetCitationStyleCommand, SetReferenceAttachedCommand, UpdateReferenceCommand,
};
use super::sidebar::{
    AddReplyCommand, ClipboardDropCommand, InsertClipboardEntryCommand, NoteRef,
    RemoveClipboardEntriesCommand, RemoveTilesCommand, RenameVersionCommand,
    ReplaceTileWordCommand, RevealSearchResultCommand, TileRef, UpdateNoteCommand,
    VersionActionCommand,
};
use super::tabs::{
    CloseSplitCommand, NewTabCommand, OpenDocInTabCommand, OpenDocInWindowCommand,
    OpenInSplitCommand, SetTabOrderCommand, TabRef,
};
use super::timeline::{
    AttachTimelineEventCommand, JumpToTimelinePassageCommand, RevealTimelineEventCommand,
    SetTimeLensCommand, SetTimelineRangeEditingCommand, TimelineCommandRequest,
};
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
/// The remembered highlight color is protocol state rather than state on a live
/// editor object, because both the toolbar and the context menu need it and either
/// may be native: the command says what to remember, and `ToolbarState` reports it
/// back.
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
/// Deliberately thin. `DictationControl.replaceInlineDraft` is a
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
/// `surface_id` is how a command finds one canvas when split view is showing two. The
/// page aims by hit-testing the DOM for a `.canvas-surface` (`canvasEvents.js`); a
/// native shell cannot hit-test the webview's DOM, so the id is assigned by the
/// webview when a surface mounts and reported with `activeEditorChanged`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCommandRequest {
    pub surface_id: String,
    /// The command name, as `CanvasSurface`'s handler spells it.
    pub command: String,
    /// Command-specific arguments. Untyped because this is the one place the vocabulary
    /// is still open — the canvas menu grows items faster than the protocol should
    /// churn. What the native shell sends is a name and at most a node id.
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
/// This is Edit ▸ Paste and Match Style: the clipboard's text, read by whatever the
/// writer used — the menu item or the toolbar button — and inserted as plain text.
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
    Map,
    Timeline,
    Folder,
}

/// Create a document, canvas, map, timeline or folder in the open project, and open it if it is
/// not a folder.
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
    /// The bare name. For a canvas, map or timeline the page adds its suffix.
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

/// Open a project, as picking it on the web landing page would.
///
/// The shell's project picker is its own window; the page still owns everything that
/// opening a project restores (its tabs, panes and sidebar state), so the picker only
/// names the project.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectCommand {
    pub project_name: String,
}

/// Turn the selection's blocks into paragraphs or headings — the toolbar's Paragraph
/// Style menu.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBlockTypeCommand {
    pub target: EditorTarget,
    pub block: BlockType,
}

/// Write the document as prose, a screenplay or a stage play, converting its lines.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWritingFormatCommand {
    pub target: EditorTarget,
    pub format: WritingFormat,
}

/// Toggle a list around the selection's blocks, as the page's input rules do for `- `
/// and `1. `.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleListCommand {
    pub target: EditorTarget,
    pub list: ListKind,
}

/// Undo or redo in one editor. A canvas has its own history and its own command
/// (`canvasCommand` `undo`/`redo`); this is a document's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHistoryCommand {
    pub target: EditorTarget,
    pub action: HistoryAction,
}

/// Open or leave focus mode. The page answers with `viewOptions`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFocusModeCommand {
    pub open: bool,
}

/// Show or hide the per-pane word-count badge — the page's own preference, which it
/// stores and then answers with `viewOptions`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWordCountVisibleCommand {
    pub visible: bool,
}

/// Everything the shell can ask the document surface to do.
///
/// Adjacently tagged (`{ "type": …, "payload": … }`) because that is the one enum
/// representation typeshare generates — and here it is also the one we want: it emits
/// a discriminated union in TypeScript, so an unhandled command is a compile error
/// rather than a silent no-op.
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
    /// Run a command on a map (`map.rs`).
    MapCommand(MapCommandRequest),
    /// Run a command on a timeline view (`timeline.rs`).
    TimelineCommand(TimelineCommandRequest),
    /// Attach a passage to a timeline event.
    AttachTimelineEvent(AttachTimelineEventCommand),
    JumpToTimelinePassage(JumpToTimelinePassageCommand),
    RevealTimelineEvent(RevealTimelineEventCommand),
    SetTimeLens(SetTimeLensCommand),
    SetTimelineRangeEditing(SetTimelineRangeEditingCommand),
    InsertPlainText(InsertPlainTextCommand),
    CreateEntry(CreateEntryCommand),
    RenameEntry(RenameEntryCommand),
    MoveEntry(MoveEntryCommand),
    DeleteEntry(DeleteEntryCommand),
    DuplicateEntry(DuplicateEntryCommand),
    UpdateNote(UpdateNoteCommand),
    RemoveNote(NoteRef),
    JumpToNote(NoteRef),
    ClipboardDrop(ClipboardDropCommand),
    RemoveClipboardEntries(RemoveClipboardEntriesCommand),
    InsertClipboardEntry(InsertClipboardEntryCommand),
    RemoveTiles(RemoveTilesCommand),
    ReplaceTileWord(ReplaceTileWordCommand),
    SelectTileWord(TileRef),
    VersionAction(VersionActionCommand),
    RenameVersion(RenameVersionCommand),
    RevealSearchResult(RevealSearchResultCommand),
    AddReply(AddReplyCommand),
    OpenProject(OpenProjectCommand),
    SetBlockType(SetBlockTypeCommand),
    SetWritingFormat(SetWritingFormatCommand),
    ToggleList(ToggleListCommand),
    EditorHistory(EditorHistoryCommand),
    SetFocusMode(SetFocusModeCommand),
    SetWordCountVisible(SetWordCountVisibleCommand),
    /* References (`references.rs`). */
    AddReference(AddReferenceCommand),
    CreateReference(CreateReferenceCommand),
    UpdateReference(UpdateReferenceCommand),
    DeleteReference(ReferenceRef),
    RetryReferenceLookup(ReferenceRef),
    ChooseReferenceCandidate(ChooseReferenceCandidateCommand),
    SetReferenceAttached(SetReferenceAttachedCommand),
    InsertCitation(InsertCitationCommand),
    InsertBibliography(InsertBibliographyCommand),
    SetCitationStyle(SetCitationStyleCommand),
    SetBibliographyOptions(SetBibliographyOptionsCommand),
    SetEditorMode(SetEditorModeCommand),
    /* The Book navigator (`print.rs`). */
    MoveBookItem(MoveBookItemCommand),
    SetBookItemHidden(SetBookItemHiddenCommand),
    AddBookItem(AddBookItemCommand),
    RemoveBookItem(RemoveBookItemCommand),
    EditBookItem(EditBookItemCommand),
    OpenBookItem(OpenBookItemCommand),
    /* Chapter openings and book styles (`print.rs`). */
    ApplyBookStyle(ApplyBookStyleCommand),
    SetChapterMeta(SetChapterMetaCommand),
    SetHeadImage(SetHeadImageCommand),
    /* Covers (`print.rs`). */
    SetFolderBookOptions(SetFolderBookOptionsCommand),
    SetTypesetView(SetTypesetViewCommand),
    SetParagraphTypeset(SetParagraphTypesetCommand),
    ShowProofIssue(ShowProofIssueCommand),
    SetTypesetDisplay(SetTypesetDisplayCommand),
    AddProjectFont(AddProjectFontCommand),
    SetTextStyle(SetTextStyleCommand),
    InsertFootnote(InsertFootnoteCommand),
    EditEditions(EditEditionsCommand),
    ExportAllEditions(ExportAllEditionsCommand),
    SetCoverImage(SetCoverImageCommand),
    EditCoverSets(EditCoverSetsCommand),
    /* The typeset history (`print.rs`). */
    SaveTypesetVersion(SaveTypesetVersionCommand),
    RestoreTypesetVersion(TypesetVersionRef),
    RenameTypesetVersion(RenameTypesetVersionCommand),
    DeleteTypesetVersion(TypesetVersionRef),
    PreviewTypesetVersion(PreviewTypesetVersionCommand),
    SetPrintLayout(SetPrintLayoutCommand),
    SetPageSetup(SetPageSetupCommand),
    SetBookSettings(SetBookSettingsCommand),
    SetPrintZoom(SetPrintZoomCommand),
    SetDisplayDensity(SetDisplayDensityCommand),
    InsertBreak(InsertBreakCommand),
    GoToPage(GoToPageCommand),
    PrintDocument(PrintDocumentCommand),
    ExportDocument(ExportDocumentCommand),
    ApplyFormat(ApplyFormatCommand),
    UseSetupForBook(UseSetupForBookCommand),
    ClearBookSetup(ClearBookSetupCommand),
    RefreshBookChapters(RefreshBookChaptersCommand),
    SetPrintScope(SetPrintScopeCommand),
    SetAuthorProfile(SetAuthorProfileCommand),
    SetBookCover(SetBookCoverCommand),
    ExportAgain(ExportAgainCommand),
    /* The tab bar and split view, drawn by the shell (`tabs.rs`). */
    SelectTab(TabRef),
    CloseTab(TabRef),
    SetTabOrder(SetTabOrderCommand),
    NewTab(NewTabCommand),
    OpenDocInTab(OpenDocInTabCommand),
    OpenDocInWindow(OpenDocInWindowCommand),
    OpenInSplit(OpenInSplitCommand),
    CloseSplit(CloseSplitCommand),
    MeasureBook(MeasureBookCommand),
    ImportScript(ImportScriptCommand),
    SetSceneNumbers(SetSceneNumbersCommand),
    ScriptReport(ScriptReportCommand),
}
