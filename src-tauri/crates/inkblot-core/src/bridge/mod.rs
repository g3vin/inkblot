//! The bridge protocol: what a shell and the document surface say to each other.
//!
//! Inkblot's document surface is ProseMirror, and ProseMirror runs in a web view. That
//! is true in the Tauri app today and it stays true under a Swift shell — the editor is
//! the one part that does not go native. Everything else does, and this module is the
//! contract between the two halves.
//!
//! **Why this is defined here, in Rust, rather than in either shell.** The same reason
//! `types/` is: three languages, one definition, generated outwards. A protocol that
//! lives in the TypeScript client is a protocol Swift can get wrong at runtime.
//! `npm run types:check` is what makes that a build failure instead.
//!
//! **Why the React shell is refactored onto it before the Swift shell exists.** The
//! protocol is a guess until something runs on it. Moving the existing React shell onto
//! the bridge while both halves are still in one process turns every wrong guess into a
//! failing test today, rather than into a puzzling silence in an Xcode debugger later —
//! and it leaves the app shippable the whole way. The in-process transport in
//! `src/bridge/` is the reference implementation the Swift side is written against.
//!
//! The layout:
//!
//! ```text
//! common    EditorTarget, Pane, TextAnchor, MarkKind, Alignment, RangeEdit
//!   -> command   NativeCommand    (shell -> webview)
//!   -> event     WebviewEvent     (webview -> shell)
//!   -> envelope  what goes on the wire, plus the request/reply pair
//! ```
//!
//! **The one rule worth carrying out of here:** no message carries a bare ProseMirror
//! position. See `TextAnchor`.

pub mod command;
pub mod common;
pub mod envelope;
pub mod event;
pub mod sidebar;

pub use command::{
    ApplyMarkCommand, CanvasCommandRequest, CanvasDropDocCommand, CanvasDropNoteCommand,
    CanvasRestoreCommand, CanvasRevealCommand, DictationCancelCommand, DictationLevelCommand,
    CreateEntryCommand, DeleteEntryCommand, DictationTranscript, DuplicateEntryCommand, EntryKind,
    InsertPlainTextCommand, MoveEntryCommand, RenameEntryCommand, InsertTableCommand, JumpToAnchorCommand, NativeCommand,
    OpenDocumentCommand, ReplaceRangesCommand, SetAlignmentCommand, SetCaretAtDocPosCommand,
    SetColorCommand, SetContentCommand, SetFontFamilyCommand, SetFontSizeCommand,
    SetHighlightCommand, SetSelectionCommand, SyncNotesCommand, TargetOnly,
};
pub use sidebar::{
    AddReplyCommand, NotePreviewDismissed, ClipboardChanged, ClipboardDropCommand, ClipboardEntry, InsertClipboardEntryCommand, NotePatch,
    NoteRef, NotesChanged, RemoveClipboardEntriesCommand, RemoveTilesCommand, RenameVersionCommand,
    ReplaceTileWordCommand, RevealSearchResultCommand, ShowSidebarTab, SidebarTab, TileKind, TileRef,
    TilesChanged, UpdateNoteCommand, VersionAction, VersionActionCommand, VersionsChanged,
    WorkbenchTile,
};
pub use common::{Alignment, EditorTarget, MarkKind, Pane, RangeEdit, TextAnchor};
pub use envelope::{
    BridgeError, BridgeErrorCode, BridgeReply, BridgeRequest, CommandEnvelope, DocumentText,
    EditorQuery, EventEnvelope, InboundMessage, OutboundMessage, ReadAloudQuery, ReplyEnvelope,
    RequestEnvelope,
};
pub use event::{
    ActiveEditorChanged, ActiveMarks, DocChanged, DragEnded, DragMoved, DragPayloadKind,
    DragStarted, FocusModeView, NoteMarkerEvent, NotesRemapped, ProjectChanged, ReadAloudPayloadEvent,
    SearchMatches, SelectionContext, ToolbarState, WebviewEvent,
};

#[cfg(test)]
mod tests;
