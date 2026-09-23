//! Version entries, the project tree, and the text document on disk.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::canvas::CanvasFile;
use super::json::JsonValue;
use super::note::Note;

/// Unnamed checkpoints beyond this are dropped oldest-first. Named versions are
/// landmarks the user placed deliberately and are NEVER evicted by the cap.
pub const VERSION_CAP: usize = 200;

/// Which kind of document a tree path refers to. A pure function of the path — see
/// `doc_kind` for why it is never read from a field inside the file.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    Canvas,
    Text,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionKind {
    Text,
    Canvas,
}

/// One point in a document's history.
///
/// A text entry stores **both** HTML and ProseMirror JSON: HTML for diffing and
/// preview, JSON for restore. A canvas entry stores the whole serialized canvas.
///
/// The two kinds also live in different places. A text document embeds its
/// `versions` array in its own file; a canvas keeps history in a `.versions/`
/// sidecar, because a canvas file must stay spec-shaped JSON Canvas so it round-trips
/// with Obsidian. The sidecar is also read for text documents that have no embedded history.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    pub timestamp: String,
    pub kind: VersionKind,
    /// A user-given name. Named entries are never evicted by `VERSION_CAP`.
    #[typeshare(typescript(type = "string | null"))]
    pub name: Option<String>,
    /// False once the user has named this entry.
    pub auto: bool,
    /// One id per app launch, so the panel can color-code edits by sitting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Absent on entries written before word counts were stamped; `version_words`
    /// recomputes it in that case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_json: Option<JsonValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<CanvasFile>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TreeNodeType {
    File,
    Folder,
}

/// One row of the project tree.
///
/// `path` is the *tree* path — no `.json` extension, and a canvas keeps its
/// `.canvas` suffix, which is what makes the document kind a pure function of the
/// path. Dotfiles and the order file are excluded when the tree is read.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    #[serde(rename = "type")]
    pub node_type: TreeNodeType,
    pub name: String,
    pub path: String,
    /// Present on folders only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

/// The JSON written to `<projectRoot>/<path/to/doc>.json`.
///
/// `saveDocument` whitelists exactly these keys, which is why the document kind is
/// never read from a `type` field inside the file — any such field is silently
/// dropped on the next save.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    /// A TipTap document. An array on documents written by older builds.
    pub content: JsonValue,
    pub notes: Vec<Note>,
    /// Absent on documents whose history still lives in the `.versions/` sidecar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub versions: Option<Vec<VersionEntry>>,
}
