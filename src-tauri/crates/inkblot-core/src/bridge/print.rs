//! Print Layout's half of the protocol: page setup, zoom, breaks, printing, binding
//! and export.
//!
//! Like the sidebar, this is "the page owns it, the shell edits by command". A
//! document's page setup lives on its `doc` node, so only the page can change it
//! without racing autosave; book settings live in preferences the page hydrates.
//! The page publishes `PageLayoutState` — everything the inspector's Page tab shows,
//! including the size presets, so the list is defined once (pageSizes.ts) — and the
//! shell answers with the commands below.
//!
//! Printing crosses the bridge twice: the shell asks for a print (`PrintDocument`),
//! the page lays the pages out for paper and asks the shell to run the print
//! operation on its web view at the paper size it needs (`PrintRequest`), and the
//! shell reports back (`PrintFinished`) so the page can tear its print DOM down.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{EditorTarget, WritingFormat};
use crate::types::page_setup::{
    AuthorProfile, BookItemKind, BookSettings, ChapterDesign, ChapterMeta, ChapterType, CoverFit, CoverPart, RunningText, GeneratedKind, MatterKind, PageOptions, PageSetup,
    PrintTypography,
};

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageBreakKind {
    Page,
    Column,
    /// The next right-hand (odd) page, as a chapter opening.
    Recto,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomFit {
    Width,
    Page,
    /// Physical size on this display; needs `SetDisplayDensity` first.
    Actual,
}

/// What a print or export covers.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintScope {
    /// The active document.
    Document,
    /// The active document's folder, compiled as a book.
    Folder,
    /// The whole project, compiled as a book.
    Project,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Pdf,
    Epub,
    Markdown,
    Html,
    /// Word, for an editor or an agent: styles, sections, headers and footers.
    Docx,
    /// Plain text, for a submission form or an email.
    PlainText,
    /// Fountain, the plain-text screenplay format.
    Fountain,
    /// Final Draft's own file.
    Fdx,
    /// A report on a script, as a spreadsheet.
    Csv,
    /// The book's cover as one full-wrap PDF — back, spine and front, with bleed — as
    /// KDP and IngramSpark take it.
    CoverPdf,
}

/// Which part of what the scope covers is printed.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintRange {
    #[default]
    All,
    /// The chapter the cursor is in: the active document in a book, or the Heading 1
    /// section around the cursor in a document.
    CurrentChapter,
    /// The selected text, laid out alone.
    Selection,
    /// Sides: the pages the scenes in `scenes` are on, with their page and scene
    /// numbers as in the whole script.
    Scenes,
}

/// How a print or a PDF is narrowed and marked. Every field is optional on the wire:
/// no options is the whole thing, unmarked.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrintOptions {
    pub range: PrintRange,
    /// Printed page numbers, as typed: `3-7, 10`. Empty prints every page.
    pub pages: String,
    /// Text set faintly across every page — "DRAFT", or "Read copy for {recipient}".
    pub watermark: String,
    /// Who a watermarked copy is for, one PDF each; filled into `{recipient}`.
    pub recipients: Vec<String>,
    /// The scenes Sides print, by index in the script (0 is the first scene).
    pub scenes: Vec<u32>,
    /// A character whose speeches are highlighted, for an actor's copy.
    pub highlight_character: String,
}

/* ---------------- the book's contents ---------------- */

/// Where in the book an entry is: before the first chapter, among them, or after.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookRowSection {
    Front,
    Body,
    Back,
}

/// One entry of a book as the navigator draws it: a `BookItem` with what the page
/// worked out about it — its number, its label, which part it is in.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRow {
    pub id: String,
    pub kind: BookItemKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<MatterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_type: Option<ChapterType>,
    /// A numbered chapter's number, or a part's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u32>,
    /// "Chapter One", "Prologue", "Part II" — what its head says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub section: BookRowSection,
    /// The part it is in, by id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    /// Its page options, its own over its kind's.
    pub page: PageOptions,
    /// Printed from text from before matter pages were documents; opening it makes it one.
    #[serde(default)]
    pub legacy: bool,
}

/// Move an entry to before another (or to the end, with none). Only the book's order
/// changes — never the file tree.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveBookItemCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
}

/// Hide an entry from the Typeset pages, print, export and the continuous document, or
/// show it again.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBookItemHiddenCommand {
    pub id: String,
    pub hidden: bool,
}

/// Add a page of front or back matter (a document, made from its kind's template), a
/// page the book lays out itself, or a part divider — where the standard order has it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddBookItemCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matter: Option<MatterKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedKind>,
    /// A part divider, before the entry `before` (or at the end of the chapters).
    #[serde(default)]
    pub part: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// For a kind that can go either side (Also By): the back.
    #[serde(default)]
    pub back: bool,
}

/// Take a matter page, a generated page or a part out of the book. A matter page's
/// document is deleted with it (the navigator asks first). A chapter cannot be removed
/// here — only hidden: it is the manuscript's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveBookItemCommand {
    pub id: String,
}

/// Rename an entry, change what kind of chapter it is, or how its page sits. Each field
/// present is set; absent ones are left as they are.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBookItemCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_type: Option<ChapterType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageOptions>,
}

/// Select an entry: open its document, or show its page, and make it This Page.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBookItemCommand {
    pub id: String,
}

/// Something on a Typeset page was picked — a margin, a running head, a chapter's
/// number — and the inspector should show where it is set: the Typeset tab, with that
/// section open (`FinishingSectionID`).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetFocus {
    pub section_id: String,
}

/// A folder's book options, from the file tree's menu: numbering its documents in the
/// tree, where they count from, and scrolling from one into the next. Each field present
/// is set; the rest of the folder's book is left as it is.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFolderBookOptionsCommand {
    pub folder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_in_tree: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_at: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuous: Option<bool>,
}

/* ---------------- covers ---------------- */

/// A cover version as the Cover section draws it: its pictures as files on disk.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverSetView {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub front_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrap_file: Option<String>,
    pub fit: CoverFit,
}

/// A book's covers, the size of its full wrap, and what is wrong with them.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverState {
    pub sets: Vec<CoverSetView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    pub trim_width_mm: f64,
    pub trim_height_mm: f64,
    /// From the page count and the paper; 0 until the pages are counted.
    pub spine_width_mm: f64,
    pub bleed_mm: f64,
    pub wrap_width_mm: f64,
    pub wrap_height_mm: f64,
    pub page_count: u32,
    pub checks: Vec<PreflightIssue>,
    /// The cover is what the Typeset view is showing.
    #[serde(default)]
    pub showing: bool,
}

/// A picture for a part of a cover version — the active one, with no id — copied into
/// the project; none takes the part's picture away.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCoverImageCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_id: Option<String>,
    pub part: CoverPart,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// What is done to the book's cover versions.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverSetAction {
    /// A new, empty version, made active.
    Add,
    Duplicate,
    Rename,
    Delete,
    /// Make it the one print, export and the EPUB use.
    Activate,
    /// How its pictures are fitted to the parts.
    SetFit,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditCoverSetsCommand {
    pub action: CoverSetAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<CoverFit>,
}

/* ---------------- the typeset history ---------------- */

/// Why a typeset version was kept.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TypesetVersionKind {
    /// A while after the typesetting changed.
    Auto,
    /// Saved, and named, by the writer.
    Named,
    /// What a print or an export was made from.
    Export,
    /// The typeset as it was just before another was restored.
    Restore,
}

/// One typeset version of a book, as the History tab lists it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetVersionRow {
    pub id: String,
    /// ISO 8601.
    pub timestamp: String,
    pub kind: TypesetVersionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// What changed since the version before it, a line a change.
    pub summary: Vec<String>,
}

/// A book's typeset history, newest first. Published by the page when it changes and
/// when the book in view does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetHistoryChanged {
    pub folder: String,
    pub rows: Vec<TypesetVersionRow>,
    /// The version the Typeset view is previewing, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previewing: Option<String>,
    /// And whether beside the current typeset, to compare.
    #[serde(default)]
    pub comparing: bool,
    /// What the last restore could not put back: "2 settings had no paragraph left".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Keep the book's typeset as it is now, under a name.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTypesetVersionCommand {
    pub name: String,
}

/// A typeset version, by id: to restore, delete, or stop previewing (`id` absent).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetVersionRef {
    pub id: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTypesetVersionCommand {
    pub id: String,
    pub name: String,
}

/// Show a typeset version's pages in the Typeset view — alone, or beside the current
/// typeset to compare them. No id stops previewing.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTypesetVersionCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub compare: bool,
}

/* ---------------- commands ---------------- */

/// The window's mode: writing a draft, or setting it as a book.
///
/// Write shows every text pane as the continuous editor in the writer's own font, with
/// the file tree and the drafting panels. Typeset shows every text pane as the pages it
/// will print on, with the book's navigator in place of the file tree, the typeset
/// toolbar and panels, and the chapters' prose locked — it is edited in Write, where
/// proofing happens. The page owns the mode; the shell asks for a change.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    #[default]
    Write,
    Typeset,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEditorModeCommand {
    pub mode: EditorMode,
}

/// Show a document as pages, or as the continuous editor: the one named — a pane's own
/// toggle names the document in it — or else the active one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrintLayoutCommand {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
}

/// Which setup an edit goes to: the active document's own, or the one every chapter of
/// its book prints in.
#[typeshare]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageSetupTarget {
    #[default]
    Document,
    Book,
}

/// Replace the active document's page setup — one undo step in the document — or the
/// book's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPageSetupCommand {
    pub setup: PageSetup,
    /// Absent from an older shell, which only ever edited the document.
    #[serde(default)]
    pub target: PageSetupTarget,
}

/// Replace a setup with one of the catalog's formats (`FormatOption::id`). The page
/// builds the setup, so every shell's "Standard Manuscript" is the same one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyFormatCommand {
    pub format_id: String,
    #[serde(default)]
    pub target: PageSetupTarget,
}

/// Give the book the active document's setup, so every chapter prints in it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UseSetupForBookCommand {}

/// Take the book's own setup away: the book prints in its first chapter's again.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClearBookSetupCommand {}

/// The documents in the book's folder changed — list its chapters again.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefreshBookChaptersCommand {}

/// Replace the writer's profile — byline and contact details — for every project.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAuthorProfileCommand {
    pub profile: AuthorProfile,
}

/// Give the book a cover: an image file the shell picked, which the page copies into
/// the project's assets. No path takes the cover away.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBookCoverCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// What Print and Export cover, and which book the Book tab shows: the active
/// document's folder, or the whole project. `Document` shows the folder's book.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrintScopeCommand {
    pub scope: PrintScope,
}

/// Replace the settings of the book the active document belongs to.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBookSettingsCommand {
    pub settings: BookSettings,
}

/// A zoom level (1 = 100%), or a fit. `fit` wins when both are present. Each document
/// has its own zoom: this is the named one's, or else the active one's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrintZoomCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<ZoomFit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
}

/// The display's logical density — its width in points over its width in inches —
/// which is what "Actual size" zoom needs and only the shell can measure.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisplayDensityCommand {
    pub points_per_inch: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertBreakCommand {
    pub target: EditorTarget,
    pub kind: PageBreakKind,
}

/// Scroll a page (1-based, as numbered on screen) into view.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoToPageCommand {
    pub page: u32,
}

/// Print. `bound` imposes the pages for binding, with the book's binding settings.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintDocumentCommand {
    pub scope: PrintScope,
    pub bound: bool,
    #[serde(default)]
    pub options: PrintOptions,
}

/// Export to a file. The page asks where (a save panel) and writes it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentCommand {
    pub format: ExportFormat,
    pub scope: PrintScope,
    /// PDF only: imposed for binding.
    #[serde(default)]
    pub bound: bool,
    /// PDF only: a range, a watermark.
    #[serde(default)]
    pub options: PrintOptions,
}

/// Lay the book (or the document) out without printing it, to count its pages and
/// words for the Publish tab.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasureBookCommand {}

/// How much a preflight finding matters.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreflightSeverity {
    /// The service will reject the file.
    Error,
    /// It will print, but not as well as it could.
    Warning,
    /// Worth knowing.
    Note,
}

/// One thing the preflight found, and how to put it right when the page knows how.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightIssue {
    pub id: String,
    pub severity: PreflightSeverity,
    pub message: String,
    /// The button's title — "Widen the Gutter" — when there is a fix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix_label: Option<String>,
    /// The setup with the fix made: applied as any other edit to it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_setup: Option<PageSetup>,
}

/// The Publish tab's figures for what Print covers, at its setup.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishingReport {
    /// 0 until the pages are known: shown, or measured.
    pub page_count: u32,
    /// The pages were counted by laying the whole scope out, not read off the screen.
    pub measured: bool,
    pub words: u32,
    /// At 250 words a minute.
    pub reading_minutes: u32,
    /// For the service and paper chosen; 0 without a page count.
    pub spine_width_mm: f64,
    /// Whether the spine is wide enough to carry text (KDP: more than 79 pages).
    pub spine_text: bool,
    pub issues: Vec<PreflightIssue>,
}

/// Import a script: File ▸ Import Fountain Script…. The page asks for the file and
/// makes a new document of it beside the one open.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScriptCommand {}

/// Export the last export again — same format, scope and file — without asking where.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAgainCommand {}

/// The export Export Again repeats.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastExport {
    pub format: ExportFormat,
    pub scope: PrintScope,
    pub path: String,
}

/// The shell finished (or abandoned) a `PrintRequest`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintFinishedCommand {
    pub job_id: String,
    pub completed: bool,
}

/* ---------------- events ---------------- */

/// A page size the inspector can offer.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSizeOption {
    pub id: String,
    pub label: String,
    /// A heading to group the menu by ("ISO A", "Book trim sizes", …).
    pub group: String,
    pub width_mm: f64,
    pub height_mm: f64,
}

/// One line of advice beside the sheets-per-signature control.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureAdvice {
    pub sheets: u32,
    pub label: String,
}

/// Where the setup a document lays out in came from.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupSource {
    /// The document's own.
    Document,
    /// Its book's, which the document has none of its own to override.
    Book,
    /// Neither: the default.
    Default,
}

/// What a format is for, which decides what else the Finishing tabs offer with it.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatKind {
    Prose,
    Screenplay,
    StagePlay,
}

/// A whole page setup by name: "Standard Manuscript", "Trade Paperback 6 × 9".
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub id: String,
    pub label: String,
    pub group: String,
    /// One line on what it is and who asks for it.
    pub summary: String,
    pub kind: FormatKind,
}

/// A running-head token and what it stands for, for the token menu.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningToken {
    /// As typed: `{page}`.
    pub token: String,
    pub label: String,
}

/// What the Finishing tabs offer that never changes while the app runs. Sent once when
/// the page mounts, apart from `PageLayoutState`, which goes out far more often.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayoutCatalog {
    pub presets: Vec<PageSizeOption>,
    pub formats: Vec<FormatOption>,
    pub signature_advice: Vec<SignatureAdvice>,
    pub tokens: Vec<RunningToken>,
    /// What "Set Type for Print" starts from.
    pub default_typography: PrintTypography,
    /// Whole designs for a book, one click each: its type, how its chapters open, its
    /// running heads.
    #[serde(default)]
    pub book_styles: Vec<BookStyleOption>,
}

/// A book style (`bookStyles.ts`): a coordinated design, applied whole.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookStyleOption {
    pub id: String,
    pub label: String,
    /// One line: what it looks like, and what it suits.
    pub description: String,
    pub typography: PrintTypography,
    pub design: ChapterDesign,
    pub header: RunningText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verso_header: Option<RunningText>,
}

/// Apply a book style to the book: its type, its chapter design and its running heads.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBookStyleCommand {
    pub id: String,
}

/// Set the active chapter's subtitle, picture and epigraph.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetChapterMetaCommand {
    pub meta: ChapterMeta,
}

/// Which picture of a chapter head a file is for.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HeadImageTarget {
    /// The active chapter's own picture.
    Chapter,
    /// The ornament every chapter's head carries.
    Ornament,
}

/// A picture for a chapter head, copied into the project — or none, to take it away.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetHeadImageCommand {
    pub target: HeadImageTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Everything the Finishing tabs show that changes. Published when the active
/// document, its setup, its page count, the book, the scope or the zoom changes — and
/// only then: the page skips a state identical to the last.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayoutState {
    /// Whether the active pane shows pages.
    pub enabled: bool,
    /// Write or Typeset, for the whole window.
    #[serde(default)]
    pub mode: EditorMode,
    /// The active text document, or none (a canvas, or nothing open).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// False while the document's editor is not yet there to take an edit. An edit sent
    /// meanwhile is kept and applied when it is.
    pub ready: bool,
    /// The setup the document lays out in — its own, its book's, or the default.
    pub setup: PageSetup,
    pub setup_source: SetupSource,
    /// False while the document has never been given a setup of its own.
    pub has_own_setup: bool,
    /// The catalog format `setup` was made from, if it matches one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_id: Option<String>,
    /// `setup` was made from `format_id` and then changed.
    pub format_modified: bool,
    pub page_count: u32,
    pub current_page: u32,
    pub zoom: f64,
    /// What Print and Export cover.
    pub scope: PrintScope,
    /// The book: the active document's folder's, or the project's under `Project`.
    pub book: BookSettings,
    /// The book has a setup of its own, which every chapter prints in.
    pub book_setup_active: bool,
    /// The book's chapters, in order: document tree paths.
    pub book_chapters: Vec<String>,
    /// The book's contents in book order, as the Book navigator lists them.
    #[serde(default)]
    pub book_items: Vec<BookRow>,
    /// The entry the navigator has selected, whose page the Typeset tab's This Page
    /// section shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_book_item: Option<String>,
    /// The active chapter's head: its subtitle, picture and epigraph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_meta: Option<ChapterMeta>,
    /// The book's covers and its wrap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<CoverState>,
    /// The chapter's picture and the book's ornament picture on disk, for thumbnails.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_image_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ornament_image_file: Option<String>,
    /// A recommended inside margin for a book of this many pages, in mm.
    pub suggested_inside_margin_mm: f64,
    /// Who wrote it: the title page's byline and contact details.
    #[serde(default)]
    pub author: AuthorProfile,
    /// Words in what Print covers — the document, or the book — as a title page
    /// gives them.
    #[serde(default)]
    pub word_count: u32,
    /// The book's cover as a file on disk, for the Book tab's thumbnail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_file: Option<String>,
    /// The project's last export, for Export Again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_export: Option<LastExport>,
    /// Text is selected in the active document, so Print can print just that.
    #[serde(default)]
    pub has_selection: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publishing: Option<PublishingReport>,
    /// A screenplay's or a play's scenes and cast, for the Publish tab's Script
    /// Production section. None for prose.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<ScriptSummary>,
}

/// How a script's scenes are numbered.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SceneNumbering {
    #[default]
    Off,
    /// Numbered in order, renumbering as scenes come and go.
    On,
    /// Fixed where they are, for a shooting script: a scene added later is 12A.
    Locked,
}

/// One scene of a script.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSummary {
    /// Its number, when scenes are numbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    pub heading: String,
    /// The page it starts on, once the script is laid out; 0 before.
    pub page: u32,
}

/// A script's scenes and cast.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSummary {
    pub format: WritingFormat,
    pub scene_numbers: SceneNumbering,
    /// Everyone who speaks, most lines first.
    pub characters: Vec<String>,
    pub scenes: Vec<SceneSummary>,
}

/// Number the active script's scenes, stop, or lock them.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSceneNumbersCommand {
    pub mode: SceneNumbering,
}

/// A breakdown of the active script.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptReportKind {
    /// Who speaks, how often, in which scenes.
    Characters,
    /// Every scene: its page, its length in eighths of a page, who is in it.
    Scenes,
    /// Every place, and the scenes set there.
    Locations,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportOutput {
    /// Printed, on the script's own pages.
    Print,
    /// A spreadsheet file.
    Csv,
}

/// Print or save a report on the active script.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptReportCommand {
    pub report: ScriptReportKind,
    pub output: ReportOutput,
}

/// What a print or export job is.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintJobKind {
    Print,
    Export,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintJobPhase {
    /// Gathering the chapters.
    Preparing,
    /// Laying chapters out as pages: `done` of `total`.
    Laying,
    /// Handing the pages to the printer, or writing the file.
    Writing,
    Done,
    Failed,
    /// The author dismissed the print or save panel.
    Cancelled,
}

/// Where a print or export has got to. One job's statuses share its `job_id`; the last
/// is `Done`, `Failed` or `Cancelled`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobStatus {
    pub job_id: String,
    pub kind: PrintJobKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ExportFormat>,
    pub phase: PrintJobPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    /// What went wrong, for `Failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The file written, for an export that is `Done`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Print the web view as it is now, on paper of this size, with no margins and no
/// scaling: the page has laid out exactly what goes on each sheet.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    pub job_id: String,
    pub job_name: String,
    pub paper_width_pt: f64,
    pub paper_height_pt: f64,
    /// Save as PDF here instead of printing. Absent shows the print panel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_path: Option<String>,
}
