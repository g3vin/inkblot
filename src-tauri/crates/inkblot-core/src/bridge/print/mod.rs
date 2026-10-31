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
//! Printing is one command (`PrintDocument`): the page lays the pages out for paper
//! and prints its own web view; `PrintJobStatus` reports how far a job has got.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{EditorTarget, TextAnchor, WritingFormat};
use crate::types::page_setup::{
    AuthorProfile, BookItemKind, BookSettings, ChapterDesign, ChapterMeta, ChapterType, CoverFit,
    CoverPart, GeneratedKind, MatterKind, PageOptions, PageSetup, PrintTypography, RunningText,
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
    /// Whether the active pane shows pages: always in Typeset, and in Write while its
    /// page view is on.
    pub enabled: bool,
    /// Write or Typeset, for the whole window.
    #[serde(default)]
    pub mode: EditorMode,
    /// In Typeset, the printed pages or the e-book.
    #[serde(default)]
    pub typeset_view: TypesetView,
    /// Typeset's pages in spreads, the baseline grid drawn, the proof marks shown.
    #[serde(default)]
    pub spread: bool,
    #[serde(default)]
    pub show_grid: bool,
    #[serde(default)]
    pub proof: bool,
    /// What the proof finds on the chapter open, while it is on.
    #[serde(default)]
    pub proof_issues: Vec<ProofIssue>,
    /// What is set on the paragraph the caret is in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paragraph: Option<ParagraphTypeset>,
    /// The fonts kept in the project.
    #[serde(default)]
    pub project_fonts: Vec<ProjectFont>,
    /// The book's named text styles, as it sets them: the built-in ones and its own.
    #[serde(default)]
    pub text_styles: Vec<crate::types::TextStyleLook>,
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

// Each feature in its own file; every type stays at `bridge::print::<Type>`.
mod book;
mod covers;
mod output;
mod script;
mod setup;
mod typeset;

pub use book::*;
pub use covers::*;
pub use output::*;
pub use script::*;
pub use setup::*;
pub use typeset::*;
