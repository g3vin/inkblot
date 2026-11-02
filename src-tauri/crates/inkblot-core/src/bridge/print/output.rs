//! Getting pages out: breaks and footnotes, going to a page, print and export,
//! preflight and the publishing report, the last export, and print job status.

use super::*;

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertBreakCommand {
    pub target: EditorTarget,
    pub kind: PageBreakKind,
}

/// Put a footnote at the caret, and open it to be written.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertFootnoteCommand {
    pub target: EditorTarget,
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

/* ---------------- events ---------------- */

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
