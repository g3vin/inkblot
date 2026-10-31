//! Covers and editions: the cover sets the page shows, and the commands that edit
//! them and export every edition.

use super::*;

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

/* ---------------- editions ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditionAction {
    /// A new edition from its kind's preset, made active.
    Add,
    Duplicate,
    Rename,
    Delete,
    /// Typeset it: its page and cover are the book's until another is chosen. `id`
    /// absent goes back to the book as set up.
    Activate,
    /// Give it a cover version (`cover_set_id`; absent, the book's).
    SetCover,
    /// A new edition set as a typeset version was (`id` is the version's).
    FromTypesetVersion,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditEditionsCommand {
    pub action: EditionAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<crate::types::EditionKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_set_id: Option<String>,
}

/// Export every edition into a folder the author picks: each print edition's interior
/// PDF and cover PDF, each e-book edition's EPUB.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAllEditionsCommand {}

/* ---------------- the typeset history ---------------- */
