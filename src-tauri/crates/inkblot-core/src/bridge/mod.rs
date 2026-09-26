//! The bridge protocol: what a shell and the document surface say to each other.
//!
//! Inkblot's document surface is ProseMirror, and ProseMirror runs in a web view under
//! every shell. The chrome around it is either React (the Tauri app) or partly native
//! (the Swift app), and this module is the contract between chrome and surface.
//!
//! **Why it is defined here, in Rust, rather than in either shell.** Three languages,
//! one definition, generated outwards (see the crate docs). A protocol that lived in
//! the TypeScript client would be one Swift could get wrong at runtime;
//! `npm run types:check` makes that a build failure instead. The React chrome runs on
//! this protocol too, through the in-process transport in `src/bridge/`, so the test
//! suites exercise every message the Swift app depends on.
//!
//! The layout:
//!
//! ```text
//! common      EditorTarget, Pane, TextAnchor, MarkKind, Alignment, RangeEdit
//!   -> command    NativeCommand    (shell -> webview)
//!   -> event      WebviewEvent     (webview -> shell)
//!   -> sidebar    the inspector's notes, clipboard, tiles and versions
//!   -> tabs       the tab bar and split view
//!   -> envelope   what goes on the wire, plus the request/reply pair
//! ```
//!
//! **The one rule:** no message carries a bare ProseMirror position. See `TextAnchor`.
//! `tests::only_set_caret_addresses_a_document_by_bare_position` enforces it.
//!
//! ## Adding a command or an event
//!
//! 1. Define a named payload struct (see `command.rs` for why it must be named), with
//!    `#[typeshare]` and `#[serde(rename_all = "camelCase")]`, in the file for its
//!    area, and add the variant to `NativeCommand` or `WebviewEvent`. An empty
//!    payload still needs a struct (with no fields): adjacent tagging sends one for
//!    every variant.
//! 2. Re-export it below, and add an instance to `every_command` / `every_event` and
//!    its wire name to the matching test in `tests.rs`.
//! 3. `npm run types` to regenerate the TypeScript and Swift.
//! 4. Handle it on the webview side: a command in `src/bridge/surface.ts` (or a
//!    delegate the app registers, for anything that changes what the app is showing);
//!    an event is published through a `documentSurface.publish…` method.
//! 5. Handle it in Swift (`native/…/Bridge/ShellBridge.swift` and whichever model owns
//!    that state). The generated decoder uses `try?` per case, so a payload that
//!    fails to decode drops the whole message; `ShellBridge` logs the raw JSON.
//!
//! A request (the shell asking and waiting for an answer) goes in `envelope.rs` as a
//! `BridgeRequest`/`BridgeReply` pair. The surface always replies, with an error if it
//! must: a shell waiting on an answer that never comes is a hang with no symptom.

pub mod archive;
pub mod bubble;
pub mod command;
pub mod common;
pub mod envelope;
pub mod event;
pub mod map;
pub mod references;
pub mod print;
pub mod sidebar;
pub mod tabs;

pub use archive::{ArchiveAction, ArchiveActionCommand, ArchiveChanged, ArchivedItem, ArchivedKind};
pub use bubble::{BubbleAside, BubbleChipRect, BubbleChipsChanged, BubbleForm, BubbleMode, BubbleSession, BubbleSessionOpened, BubbleWord, CloseBubbleSessionCommand};
pub use command::{
    ApplyMarkCommand, CanvasCommandRequest, CanvasDropDocCommand, CanvasDropNoteCommand,
    CanvasRestoreCommand, CanvasRevealCommand, DictationCancelCommand, DictationLevelCommand,
    CreateEntryCommand, DeleteEntryCommand, DictationTranscript, DuplicateEntryCommand, EntryKind,
    InsertPlainTextCommand, MoveEntryCommand, RenameEntryCommand, SetTitlebarInsetCommand, SetPanelInsetsCommand, InsertTableCommand, OpenProjectCommand, JumpToAnchorCommand, NativeCommand,
    OpenDocumentCommand, ReplaceRangesCommand, SetAlignmentCommand, SetCaretAtDocPosCommand,
    SetColorCommand, SetContentCommand, SetFontFamilyCommand, SetFontSizeCommand,
    SetHighlightCommand, SetSelectionCommand, SyncNotesCommand, TargetOnly,
    SetBlockTypeCommand, SetWritingFormatCommand, ToggleListCommand, EditorHistoryCommand, SetFocusModeCommand, SetWordCountVisibleCommand,
};
pub use references::{
    AddReferenceCommand, BibliographyInclude, BibliographyOptions, ChooseReferenceCandidateCommand,
    CitationStyleSpec, Contributor, ContributorRoleSpec, CreateReferenceCommand, InsertBibliographyCommand,
    InsertCitationCommand, Reference, ReferenceCandidate, ReferenceFieldInput, ReferenceFieldSpec,
    ReferenceKindSpec, ReferenceOrigin, ReferencePatch, ReferenceRef, ReferenceSchema, ReferenceStatus,
    ReferenceView, ReferencesChanged, RevealReference, SetBibliographyOptionsCommand,
    SetCitationStyleCommand, SetReferenceAttachedCommand, UpdateReferenceCommand,
};
pub use print::{
    ExportAgainCommand, ImportScriptCommand, LastExport, MeasureBookCommand, ReportOutput, SceneNumbering, SceneSummary,
    ScriptReportCommand, ScriptReportKind, ScriptSummary, SetSceneNumbersCommand, PreflightIssue, PreflightSeverity, PrintOptions, PrintRange,
    PublishingReport,
    ApplyFormatCommand, ClearBookSetupCommand, ExportDocumentCommand, ExportFormat, FormatKind,
    FormatOption, GoToPageCommand, InsertBreakCommand, PageBreakKind, PageLayoutCatalog,
    PageLayoutState, PageSetupTarget, PageSizeOption, PrintDocumentCommand, PrintFinishedCommand,
    AddBookItemCommand, ApplyBookStyleCommand, BookStyleOption, HeadImageTarget, SetChapterMetaCommand,
    SetHeadImageCommand, BookRow, BookRowSection, EditBookItemCommand, EditorMode, MoveBookItemCommand,
    OpenBookItemCommand, RemoveBookItemCommand, SetBookItemHiddenCommand, PrintJobKind, PrintJobPhase, PrintJobStatus, PrintRequest, PrintScope, RefreshBookChaptersCommand, TypesetFocus, TypesetHistoryChanged, TypesetVersionRow,
    TypesetVersionKind, SaveTypesetVersionCommand, TypesetVersionRef, RenameTypesetVersionCommand,
    PreviewTypesetVersionCommand,
    RunningToken, SetAuthorProfileCommand, SetBookCoverCommand, SetBookSettingsCommand, SetDisplayDensityCommand, SetPageSetupCommand,
    SetEditorModeCommand, SetPrintLayoutCommand, SetPrintScopeCommand, SetPrintZoomCommand, SetupSource, SignatureAdvice,
    UseSetupForBookCommand, ZoomFit,
};
pub use sidebar::{
    AddReplyCommand, HighlightNoteCommand, NotePreviewDismissed, ClipboardChanged, ClipboardDropCommand, ClipboardEntry, InsertClipboardEntryCommand, NotePatch,
    NoteRef, NotesChanged, RemoveClipboardEntriesCommand, RemoveTilesCommand, RenameVersionCommand,
    ReplaceTileWordCommand, RevealSearchResultCommand, ShowSidebarTab, SidebarTab, TileKind, TileRef,
    TilesChanged, UpdateNoteCommand, VersionAction, VersionActionCommand, VersionsChanged,
    WorkbenchTile,
};
pub use map::{
    MapButtonRole, MapButtonRow, MapCalendarMode, MapChoice, MapChoiceInput, MapChromeChanged, MapChromeState,
    MapColorInput, MapCommandRequest, MapDateInput, MapDateParts, MapListRow, MapMarkerInput, MapNoteText,
    MapNoteTone, MapNumberInput, MapPanel, MapPanelButton, MapPanelField, MapPanelGroup, MapPanelSection,
    MapPanelTab, MapShapePreview, MapStatRow,
    MapTableCell, MapTableRowView, MapTableView, MapTextInput, MapToggleInput,
    MapTool,
};
pub use common::{Alignment, BlockType, EditorTarget, HistoryAction, ListKind, MarkKind, Pane, RangeEdit, TextAnchor, WritingFormat};
pub use envelope::{
    BridgeError, BridgeErrorCode, BridgeReply, BridgeRequest, CommandEnvelope, DocumentText,
    EditorQuery, EventEnvelope, InboundMessage, OutboundMessage, ReadAloudQuery, ReplyEnvelope,
    RequestEnvelope,
};
pub use event::{
    ActiveEditorChanged, ActiveMarks, CanvasToolbarChanged, CanvasToolbarState, DocChanged, DragEnded, DragMoved, DragPayloadKind,
    DragStarted, FocusModeView, NoteMarkerEvent, NoteMarkerRect, NoteMarkersChanged, NotesRemapped, ProjectChanged, ReadAloudPayloadEvent,
    SearchMatches, SelectionContext, ToolbarState, ViewOptions, WebviewEvent, WordCountBadge, WordCountsChanged, PaneStatus,
};
pub use tabs::{
    CloseSplitCommand, DocTab, NewTabCommand, OpenDocInTabCommand, OpenDocInWindowCommand, OpenInSplitCommand,
    SetTabOrderCommand, SplitOrientation, TabRef, TabsChanged,
};

#[cfg(test)]
mod tests;
