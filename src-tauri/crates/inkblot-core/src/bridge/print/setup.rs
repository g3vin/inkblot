//! Page and book setup commands: project fonts, page setup, formats, author,
//! cover, scope, book settings, zoom and density.

use super::*;

/// A font file kept in the project (`.assets/fonts/`), so the book sets — and embeds
/// in its PDF and EPUB — the same face on any Mac.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFont {
    pub family: String,
    /// Its project path.
    pub path: String,
    /// Whether its licence lets it be embedded in a PDF or an EPUB (its `fsType`).
    pub embeddable: bool,
}

/// Copy a font file into the project's fonts.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectFontCommand {
    pub path: String,
}

/// Write's page view on or off: the prose written on its pages, or in the continuous
/// editor. Typeset always shows pages, so turning them off there goes back to Write.
/// The view is the project's; `doc_path` is accepted for the shells that name one.
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
