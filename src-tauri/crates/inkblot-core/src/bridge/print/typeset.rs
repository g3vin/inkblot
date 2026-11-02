//! Typeset mode: saved typeset versions, the editor/typeset switch and view, and
//! proofing (issues, fixes, per-paragraph typesetting).

use super::*;

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
/// Write is where the prose is written, with the drafting toolbar and panels: as the
/// continuous editor, or — with its page view on (`SetPrintLayoutCommand`) — on the
/// pages it will print on. Typeset always shows the pages, set as the book, with the
/// typeset toolbar and panels and the chapters' prose locked — it is edited in Write,
/// where proofing happens. Either mode can show the book's navigator in place of the
/// file tree. The page owns the mode; the shell asks for a change.
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

/// Typeset's view of the book: its printed pages, or the e-book as a reader shows it.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TypesetView {
    #[default]
    Print,
    Digital,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTypesetViewCommand {
    pub view: TypesetView,
}

/* ---------------- proofing the pages ---------------- */

/// What the proof finds wrong with a typeset page, as a typesetter would mark it.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProofKind {
    /// A justified line spaced out so far its words stand apart.
    Loose,
    /// A paragraph's last line alone at the head of a page.
    Widow,
    /// A paragraph's first line alone at the foot of a page.
    Orphan,
    /// A paragraph ending on a line of one short word.
    Runt,
    /// More lines in a row ending in a hyphen than the composition allows.
    StackedHyphens,
    /// A chapter's last page with only a line or two on it.
    ShortPage,
}

/// A fix the proof offers: each is one of `SetParagraphTypesetCommand`'s.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProofFix {
    /// Letter-spacing a little tighter, to take a line back.
    Tighten,
    /// A little looser, to push one over.
    Loosen,
    KeepTogether,
    KeepWithNext,
    /// The page runs a line long, to take a widow back.
    RunLong,
    /// A line short, to send one over.
    RunShort,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofIssue {
    pub id: String,
    pub kind: ProofKind,
    /// The printed page it is on, counted from the chapter's first.
    pub page: u32,
    /// The words at fault. A fix is set on the paragraph they are in.
    pub anchor: TextAnchor,
    pub fixes: Vec<ProofFix>,
}

/// Set what the typesetter sets on a paragraph — the one the anchor is in, or those
/// selected. Each field present is set; `nudge_tracking` adds to what is there.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetParagraphTypesetCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<TextAnchor>,
    /// Thousandths of an em, −10 to +10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracking: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nudge_tracking: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_together: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_with_next: Option<bool>,
    /// The page the paragraph starts on runs this many lines long (1) or short (−1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_adjust: Option<i32>,
}

/// What is set on the paragraph the caret is in, for the toolbar and the Proof section.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphTypeset {
    pub tracking: i32,
    pub keep_together: bool,
    pub keep_with_next: bool,
    pub page_adjust: i32,
    /// Its named text style, if it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
}

/// Give the selected paragraphs a named text style, or none (`style` absent).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTextStyleCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

/// Scroll the pages to a proof mark and select its paragraph.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowProofIssueCommand {
    pub anchor: TextAnchor,
}

/// How Typeset shows its pages: in spreads, with the baseline grid drawn, with the proof
/// marks. Each field present is set.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTypesetDisplayCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spread: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proof: Option<bool>,
}

/* ---------------- the project's fonts ---------------- */
