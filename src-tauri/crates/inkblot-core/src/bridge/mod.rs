//! The bridge protocol: what the chrome and the document surface say to each other.
//!
//! Inkblot's document surface is ProseMirror, in a web view. The chrome around it —
//! the toolbar, the sidebars, the tab bar, the menus — renders what the surface
//! publishes and changes it by command, and this module is the contract between them.
//!
//! **Why it is defined here, in Rust.** One definition, generated outwards (see the
//! crate docs), so the Rust side's view of a message cannot drift from the page's;
//! `npm run types:check` makes that a build failure. The chrome runs on this protocol
//! through the in-process transport in `src/bridge/`, which copies every message
//! through JSON, so a native shell could join the wire without the page changing.
//!
//! The layout:
//!
//! ```text
//! common      EditorTarget, Pane, TextAnchor, MarkKind, Alignment, RangeEdit
//!   -> command    NativeCommand    (shell -> webview)
//!   -> event      WebviewEvent     (webview -> shell)
//!   -> sidebar    the inspector's notes, clipboard, tiles and versions
//!   -> tabs       the tab bar and split view
//!   -> timeline   a timeline view's chrome, passages attached to events, the time lens
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
//! 2. Re-export it below, add an instance to `every_command` / `every_event` (in
//!    `tests/fixtures.rs`), and its wire name to the matching test in `tests/mod.rs`.
//! 3. `npm run types` to regenerate the TypeScript.
//! 4. Handle it on the webview side: a command in `src/bridge/surface.ts` (or a
//!    delegate the app registers, for anything that changes what the app is showing);
//!    an event is published through a `documentSurface.publish…` method.
//! 5. Use it from the chrome: `shellBridge.send` for a command, `useLatestBridgeState`
//!    for an event.
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
pub mod print;
pub mod references;
pub mod sidebar;
pub mod tabs;
pub mod timeline;

pub use archive::{ArchivedItem, ArchivedKind};
pub use bubble::{BubbleAside, BubbleForm, BubbleMode, BubbleSession, BubbleWord};
pub use command::{
    ApplyMarkCommand, CanvasCommandRequest, CanvasDropDocCommand, CanvasDropNoteCommand,
    CanvasRestoreCommand, CanvasRevealCommand, CreateEntryCommand, DeleteEntryCommand,
    DictationCancelCommand, DictationLevelCommand, DictationTranscript, DuplicateEntryCommand,
    EditorHistoryCommand, EntryKind, InsertPlainTextCommand, InsertTableCommand,
    JumpToAnchorCommand, MoveEntryCommand, NativeCommand, OpenDocumentCommand, OpenProjectCommand,
    RenameEntryCommand, ReplaceRangesCommand, SetAlignmentCommand, SetBlockTypeCommand,
    SetCaretAtDocPosCommand, SetColorCommand, SetContentCommand, SetFocusModeCommand,
    SetFontFamilyCommand, SetFontSizeCommand, SetHighlightCommand, SetSelectionCommand,
    SetWordCountVisibleCommand, SetWritingFormatCommand, SyncNotesCommand, TargetOnly,
    ToggleListCommand,
};
pub use common::{
    Alignment, BlockType, EditorTarget, HistoryAction, ListKind, MarkKind, Pane, RangeEdit,
    TextAnchor, WritingFormat,
};
pub use envelope::{
    BridgeError, BridgeErrorCode, BridgeReply, BridgeRequest, CommandEnvelope, DocumentText,
    EditorQuery, EventEnvelope, InboundMessage, OutboundMessage, ReadAloudQuery, ReplyEnvelope,
    RequestEnvelope,
};
pub use event::{
    ActiveEditorChanged, ActiveMarks, CanvasToolbarChanged, CanvasToolbarState, DocChanged,
    ProjectChanged, ReadAloudPayloadEvent, SelectionContext, ToolbarState, ViewOptions,
    WebviewEvent,
};
pub use map::{
    MapButtonRole, MapButtonRow, MapCalendarMode, MapChoice, MapChoiceInput, MapChromeChanged,
    MapChromeState, MapColorInput, MapCommandRequest, MapDateInput, MapDateParts, MapListRow,
    MapMarkerInput, MapMenuItem, MapNoteText, MapNoteTone, MapNumberInput, MapPanel,
    MapPanelButton, MapPanelField, MapPanelGroup, MapPanelSection, MapPanelTab, MapShapePreview,
    MapStatRow, MapTableCell, MapTableRowView, MapTableView, MapTextInput, MapToggleInput, MapTool,
};
pub use print::{
    AddBookItemCommand, AddProjectFontCommand, ApplyBookStyleCommand, ApplyFormatCommand, BookRow,
    BookRowSection, BookStyleOption, ClearBookSetupCommand, CoverSetAction, CoverSetView,
    CoverState, EditBookItemCommand, EditCoverSetsCommand, EditEditionsCommand, EditionAction,
    EditorMode, ExportAgainCommand, ExportAllEditionsCommand, ExportDocumentCommand, ExportFormat,
    FormatKind, FormatOption, GoToPageCommand, HeadImageTarget, ImportScriptCommand,
    InsertBreakCommand, InsertFootnoteCommand, LastExport, MeasureBookCommand, MoveBookItemCommand,
    OpenBookItemCommand, PageBreakKind, PageLayoutCatalog, PageLayoutState, PageSetupTarget,
    PageSizeOption, ParagraphTypeset, PreflightIssue, PreflightSeverity,
    PreviewTypesetVersionCommand, PrintDocumentCommand, PrintJobKind, PrintJobPhase,
    PrintJobStatus, PrintOptions, PrintRange, PrintScope, ProjectFont, ProofFix, ProofIssue,
    ProofKind, PublishingReport, RefreshBookChaptersCommand, RemoveBookItemCommand,
    RenameTypesetVersionCommand, ReportOutput, RunningToken, SaveTypesetVersionCommand,
    SceneNumbering, SceneSummary, ScriptReportCommand, ScriptReportKind, ScriptSummary,
    SetAuthorProfileCommand, SetBookCoverCommand, SetBookItemHiddenCommand, SetBookSettingsCommand,
    SetChapterMetaCommand, SetCoverImageCommand, SetDisplayDensityCommand, SetEditorModeCommand,
    SetFolderBookOptionsCommand, SetHeadImageCommand, SetPageSetupCommand,
    SetParagraphTypesetCommand, SetPrintLayoutCommand, SetPrintScopeCommand, SetPrintZoomCommand,
    SetSceneNumbersCommand, SetTextStyleCommand, SetTypesetDisplayCommand, SetTypesetViewCommand,
    SetupSource, ShowProofIssueCommand, SignatureAdvice, TypesetFocus, TypesetHistoryChanged,
    TypesetVersionKind, TypesetVersionRef, TypesetVersionRow, TypesetView, UseSetupForBookCommand,
    ZoomFit,
};
pub use references::{
    AddReferenceCommand, BibliographyInclude, BibliographyOptions, ChooseReferenceCandidateCommand,
    CitationStyleSpec, Contributor, ContributorRoleSpec, CreateReferenceCommand,
    InsertBibliographyCommand, InsertCitationCommand, Reference, ReferenceCandidate,
    ReferenceFieldInput, ReferenceFieldSpec, ReferenceKindSpec, ReferenceOrigin, ReferencePatch,
    ReferenceRef, ReferenceSchema, ReferenceStatus, ReferenceView, ReferencesChanged,
    RevealReference, SetBibliographyOptionsCommand, SetCitationStyleCommand,
    SetReferenceAttachedCommand, UpdateReferenceCommand,
};
pub use sidebar::{
    AddReplyCommand, ClipboardDropCommand, ClipboardEntry, InsertClipboardEntryCommand, NotePatch,
    NoteRef, RemoveClipboardEntriesCommand, RemoveTilesCommand, RenameVersionCommand,
    ReplaceTileWordCommand, RevealSearchResultCommand, ShowSidebarTab, SidebarTab, TileKind,
    TileRef, UpdateNoteCommand, VersionAction, VersionActionCommand, WorkbenchTile,
};
pub use tabs::{
    CloseSplitCommand, DocTab, NewTabCommand, OpenDocInTabCommand, OpenDocInWindowCommand,
    OpenInSplitCommand, ScreenPoint, SetTabOrderCommand, SplitOrientation, TabRef, TabsChanged,
};
pub use timeline::{
    AttachTimelineEventCommand, JumpToTimelinePassageCommand, RevealTimelineEventCommand,
    SetTimeLensCommand, SetTimelineRangeEditingCommand, TimelineChromeChanged, TimelineChromeState,
    TimelineCommandRequest, TimelineCursorChanged, TimelineRangesChanged,
};

#[cfg(test)]
mod tests;
