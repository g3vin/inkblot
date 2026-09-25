//! The built-in story folder presets (Characters, Settings, Outline, Novel).
//!
//! Presets give matching folders — and the files inside them — themed icons in the
//! file tree, matched by folder name (or alias) anywhere in an entry's path. Shared with the
//! Swift app's native file tree.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryFolderPreset {
    pub key: String,
    pub name: String,
    pub menu_label: String,
    /// What one document inside the folder is, for the file tree's contextual
    /// "New …" button.
    pub entry_label: String,
    pub folder_icon: String,
    pub file_icon: String,
    /// Other folder names that resolve to this preset.
    pub aliases: Vec<String>,
}

/// The nearest preset folder a file lives in, and the path to create siblings in.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoryFolderAncestor {
    pub preset: StoryFolderPreset,
    pub path: String,
}
