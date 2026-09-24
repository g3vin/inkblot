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

use super::common::EditorTarget;
use crate::types::page_setup::{BookSettings, PageSetup};

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
}

/* ---------------- commands ---------------- */

/// Show the active pane as pages, or as the continuous editor.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrintLayoutCommand {
    pub enabled: bool,
}

/// Replace the active document's page setup. One undo step in the document.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPageSetupCommand {
    pub setup: PageSetup,
}

/// Replace the settings of the book the active document belongs to.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBookSettingsCommand {
    pub settings: BookSettings,
}

/// A zoom level (1 = 100%), or a fit. `fit` wins when both are present.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPrintZoomCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fit: Option<ZoomFit>,
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

/// Everything the Page tab shows. Published when the active document, its setup,
/// its page count or the zoom changes.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayoutState {
    /// Whether the active pane shows pages.
    pub enabled: bool,
    /// The active text document, or none (a canvas, or nothing open).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
    /// The setup the document lays out in — its own, or the default.
    pub setup: PageSetup,
    /// False while the document has never been given a setup of its own.
    pub has_own_setup: bool,
    pub page_count: u32,
    pub current_page: u32,
    pub zoom: f64,
    /// The book the active document belongs to.
    pub book: BookSettings,
    /// The book's chapters, in order: document tree paths.
    pub book_chapters: Vec<String>,
    /// A recommended inside margin for a book of this many pages, in mm.
    pub suggested_inside_margin_mm: f64,
    pub presets: Vec<PageSizeOption>,
    pub signature_advice: Vec<SignatureAdvice>,
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
