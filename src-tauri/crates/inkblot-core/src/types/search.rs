//! What a search returns, to the page's search bar and the Swift app's inspector alike.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::json::JsonValue;

/// The scopes, in the order they appear in the bar.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchScope {
    /// The default: filter whatever panel is showing. Every other scope searches content and shows its own results, so the
    /// panel underneath is left unfiltered.
    Panel,
    Document,
    Notes,
    Files,
    Project,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScopeInfo {
    pub value: SearchScope,
    pub label: String,
    pub hint: String,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchResultType {
    /// A hit in a saved document, addressed by ProseMirror position.
    ProjectMatch,
    /// A hit in the open document.
    DocumentMatch,
    /// A file or folder whose path matched.
    FileEntry,
    NoteMatch,
    /// A hit on a canvas, addressed by node id — a canvas has no positions.
    CanvasMatch,
}

/// One row of results.
///
/// Which fields are set depends on `result_type`, and the absences are meaningful: a
/// `file-entry` has no position, a `canvas-match` has a `node_id` instead of one. Like
/// `DiffChunk`, this is a struct rather than an enum because the wire format is
/// internally tagged and typeshare only generates adjacently-tagged enums.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    #[serde(rename = "type")]
    pub result_type: SearchResultType,
    pub doc_name: String,
    pub title: String,
    pub path: String,
    pub preview: String,
    /// A ProseMirror position — a count of UTF-16 code units, not bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_text: Option<String>,
    /// The canvas node to select and center.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<JsonValue>,
}
