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
use crate::types::page_setup::{AuthorProfile, BookSettings, PageSetup, PrintTypography};

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

/* ---------------- commands ---------------- */

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
