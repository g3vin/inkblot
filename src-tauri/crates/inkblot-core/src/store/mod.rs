//! All persistence for projects and documents.
//!
//! ```text
//!   <projectRoot>/                      one directory per project
//!   <projectRoot>/<path/to/doc>.json    { content, notes, versions? }
//!   <projectRoot>/.versions/…           canvas version sidecars (a canvas file is
//!                                       spec-shaped JSON Canvas, so its history
//!                                       cannot ride inside it); also read for text
//!                                       documents with no embedded history
//! ```
//!
//! A project's root defaults to `<AppData>/<project>`, but the user may store a project
//! anywhere on disk. Custom locations are tracked in [`locations`]; every operation
//! resolves a project name to its absolute root before touching the filesystem, so both
//! default and relocated projects go through the same code paths.
//!
//! Mirrors `src/lib/FileSystem.js`, `projectPaths.ts`, `docLock.ts`, `versionStore.js`
//! and `projectLocations.js`.
//!
//! ## How it differs from the JS, and why
//!
//! - **The AppData root is injected.** `appDataDir()` is the shell's to know. The Tauri
//!   app passes what its path resolver reports.
//! - **`versions:changed` is a callback, not a DOM event.** [`ProjectStore::on_versions_changed`]
//!   takes a listener, which a shell wires to
//!   whatever it notifies with. Nothing here knows what a `window` is.
//! - **Failures are `Result`s.** The JS logs to the console and returns `false`/`null`,
//!   which makes "the save failed" and "there was nothing to save" the same value.
//!   Each function's doc comment says which JS return value it corresponds to.
//! - **The write lock is a real mutex** ([`doc_lock`]), so it holds across threads and
//!   across callers, not just across one webview's promise chain.

#[cfg(test)]
mod tests;

pub mod clock;
pub mod doc_lock;
pub mod locations;
pub mod paths;
pub mod preferences;
pub mod stats;
pub mod versions;

// ProjectStore's methods, one file per concern.
mod documents;
mod entries;
mod projects;
mod version_io;

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::doc_kind::{
    doc_kind_name, get_doc_kind, is_map_doc, is_text_doc, strip_doc_suffix, with_doc_suffix,
};
use crate::map::model::is_map_payload;
use crate::types::{JsonValue, TreeNode, TreeNodeType, VersionEntry};
use doc_lock::DocLocks;
use locations::ProjectLocations;
use paths::{
    file_path_for, folder_path_for, join_path, normalize_path, parent_of, strip_trailing_slash,
    versions_sidecar_path, FOLDER_FILE, ORDER_FILE,
};
use versions::{push_version_entry, NewTextVersion};

#[derive(Debug)]
pub enum StoreError {
    Io(std::io::Error),
    Json(serde_json::Error),
    /// The operation was refused because it would have destroyed something — the
    /// cases where the JS logs an error and returns without writing.
    Refused(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Io(error) => write!(f, "{error}"),
            StoreError::Json(error) => write!(f, "{error}"),
            StoreError::Refused(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        StoreError::Io(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        StoreError::Json(error)
    }
}

type Result<T> = std::result::Result<T, StoreError>;

/// Why a `linkProject` or `moveProject` call did not happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkRefusal {
    InvalidArguments,
    SourceMissing,
    /// A directory whose name starts with a dot, which `list_projects` would hide.
    InvalidName,
    /// A different, still-reachable project already holds this name.
    NameExists,
    TargetExists,
}

/// The document body a save writes. Exactly these keys survive — see
/// [`ProjectStore::save_document`].
pub struct DocumentBody {
    pub content: JsonValue,
    pub notes: JsonValue,
}

/// What to append to the version history alongside a save, if anything.
pub struct VersionRequest {
    pub content_html: Option<String>,
    pub content_json: Option<JsonValue>,
    pub name: Option<String>,
    pub auto: bool,
}

/// The fields `updateVersionEntry` is ever asked to change. The JS takes an arbitrary
/// patch object; the only caller (the history panel) renames or
/// un-names an entry, and a typed patch cannot corrupt an entry by merging a
/// stray key into it.
#[derive(Default)]
pub struct VersionPatch {
    /// `Some(None)` clears the name; `None` leaves it alone.
    pub name: Option<Option<String>>,
    pub auto: Option<bool>,
}

/// Where a document's versions live, and what they currently are.
enum VersionStore {
    /// Inside the document's own file, which this holds so a write can put it back.
    Embedded { root: String, doc: Value },
    /// In the `.versions/` sidecar.
    Sidecar { root: String },
}

pub struct ProjectStore {
    app_data_root: String,
    locations: ProjectLocations,
    locks: DocLocks,
    /// One id per launch, so the history panel can color-code edits by sitting.
    session_id: String,
    // Used only here, so an alias would name it once.
    #[allow(clippy::type_complexity)]
    listener: Mutex<Option<Box<dyn Fn(&str, &str) + Send + Sync>>>,
}

impl ProjectStore {
    /// `app_data_root` is the shell's AppData directory — the same path
    /// `@tauri-apps/api/path`'s `appDataDir()` returns.
    pub fn new(app_data_root: &str, session_id: &str) -> Self {
        let app_data_root = strip_trailing_slash(app_data_root).to_string();
        Self {
            locations: ProjectLocations::new(&app_data_root),
            app_data_root,
            locks: DocLocks::default(),
            session_id: session_id.to_string(),
            listener: Mutex::new(None),
        }
    }

    /// Called after a document's version list changes, with the project and document
    /// names.
    pub fn on_versions_changed(&self, listener: impl Fn(&str, &str) + Send + Sync + 'static) {
        let mut slot = self
            .listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = Some(Box::new(listener));
    }

    fn emit_versions_changed(&self, project_name: &str, doc_name: &str) {
        let slot = self
            .listener
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(listener) = slot.as_ref() {
            listener(project_name, doc_name);
        }
    }

    pub fn app_data_root(&self) -> &str {
        &self.app_data_root
    }

    /// Absolute directory for a project: its custom location, or the AppData default.
    pub fn project_root(&self, project_name: &str) -> String {
        match self.locations.get(project_name) {
            Some(custom) => strip_trailing_slash(&custom).to_string(),
            None => join_path(&[&self.app_data_root, project_name]),
        }
    }
}

/// What [`ProjectStore::locked_entries`] finds, by tree path.
#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockedEntries {
    pub documents: Vec<String>,
    pub folders: Vec<String>,
}

/// The one key a lock scan reads out of a document; serde skips the rest.
#[derive(Deserialize)]
struct LockFlag {
    #[serde(default)]
    locked: bool,
}

fn is_locked(doc: &Value) -> bool {
    doc.get("locked").and_then(Value::as_bool).unwrap_or(false)
}

fn collect_locked(root: &str, node: &TreeNode, found: &mut LockedEntries) {
    let path = join_path(&[root, &node.path]);
    if node.node_type == TreeNodeType::Folder {
        if read_json(&join_path(&[&path, FOLDER_FILE])).is_some_and(|marker| is_locked(&marker)) {
            found.folders.push(node.path.clone());
        }
        for child in node.children.iter().flatten() {
            collect_locked(root, child, found);
        }
    } else if std::fs::read_to_string(format!("{path}.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<LockFlag>(&raw).ok())
        .is_some_and(|flag| flag.locked)
    {
        found.documents.push(node.path.clone());
    }
}

/* ---------------- free helpers ---------------- */

/// `Path::exists`, which answers false for a path we cannot stat.
///
/// Deliberately not `std::fs::exists` — that needs Rust 1.81 and this crate declares
/// 1.77.2, which is Tauri's. It is also the answer the JS gives: every `exists()` call
/// there sits inside a try/catch that treats a failure as absent.
fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

fn read_json(path: &str) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn read_sidecar_versions(root: &str, doc_name: &str) -> Vec<VersionEntry> {
    read_json(&versions_sidecar_path(root, doc_name))
        .and_then(|raw| serde_json::from_value::<Vec<VersionEntry>>(raw).ok())
        .unwrap_or_default()
}

fn write_sidecar_versions(root: &str, doc_name: &str, versions: &[VersionEntry]) -> Result<()> {
    let file_path = versions_sidecar_path(root, doc_name);
    std::fs::create_dir_all(parent_of(&file_path))?;
    std::fs::write(&file_path, serde_json::to_string(versions)?)?;
    Ok(())
}

/// Move or delete a document's version sidecar alongside the document itself.
///
/// Best-effort, exactly as in JS: history must never block the file operation that
/// prompted it. A rename that succeeds and leaves its sidecar behind is recoverable;
/// a rename that fails because of a sidecar is not what the user asked for.
fn relocate_sidecar(root: &str, from_rel: &str, to_rel: Option<&str>) {
    let from = versions_sidecar_path(root, from_rel);
    if !exists(&from) {
        return;
    }
    let Some(to_rel) = to_rel else {
        let _ = std::fs::remove_file(&from);
        return;
    };
    let to = versions_sidecar_path(root, to_rel);
    let _ = std::fs::create_dir_all(parent_of(&to));
    let _ = std::fs::rename(&from, &to);
}

fn copy_dir_recursive(source_dir: &str, dest_dir: &str) -> Result<()> {
    std::fs::create_dir_all(dest_dir)?;
    for entry in std::fs::read_dir(source_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let from = join_path(&[source_dir, &name]);
        let to = join_path(&[dest_dir, &name]);
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if entry.file_type()?.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn read_directory(root: &str, relative_path: &str) -> Vec<TreeNode> {
    let dir_path = if relative_path.is_empty() {
        root.to_string()
    } else {
        join_path(&[root, relative_path])
    };

    let Ok(entries) = std::fs::read_dir(&dir_path) else {
        return Vec::new();
    };

    // Sorted, because `std::fs::read_dir` yields in directory order and the tree is
    // compared in tests. The UI applies its own order on top (fileTreeOrder.ts).
    let mut sorted: BTreeMap<String, std::fs::DirEntry> = BTreeMap::new();
    for entry in entries.flatten() {
        sorted.insert(entry.file_name().to_string_lossy().to_string(), entry);
    }

    let mut children = Vec::new();
    for (name, entry) in sorted {
        if name.is_empty() || name.starts_with('.') || name == ORDER_FILE {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };

        if kind.is_dir() {
            let folder_path = if relative_path.is_empty() {
                name.clone()
            } else {
                format!("{relative_path}/{name}")
            };
            children.push(TreeNode {
                node_type: TreeNodeType::Folder,
                children: Some(read_directory(root, &folder_path)),
                name,
                path: folder_path,
            });
        } else if kind.is_file() {
            let Some(base_name) = name.strip_suffix(".json") else {
                continue;
            };
            let file_path = if relative_path.is_empty() {
                base_name.to_string()
            } else {
                format!("{relative_path}/{base_name}")
            };
            children.push(TreeNode {
                node_type: TreeNodeType::File,
                name: base_name.to_string(),
                path: file_path,
                children: None,
            });
        }
    }

    children
}
