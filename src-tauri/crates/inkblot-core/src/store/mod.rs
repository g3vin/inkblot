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

    /* ---------------- documents ---------------- */

    /// Write a document file verbatim — no key whitelist, no version merging.
    ///
    /// [`Self::save_document`] only ever emits `{ content, notes, versions }`, which is
    /// right for text documents and destructive for anything else. Document kinds with
    /// their own shape — canvases — persist through here instead.
    pub fn write_document_raw(
        &self,
        project_name: &str,
        doc_name: &str,
        data: &Value,
    ) -> Result<()> {
        let file_path = join_path(&[
            &self.project_root(project_name),
            &format!("{doc_name}.json"),
        ]);
        std::fs::create_dir_all(parent_of(&file_path))?;
        std::fs::write(&file_path, serde_json::to_string(data)?)?;
        Ok(())
    }

    /// Write a map, refusing to overwrite a file that is not one.
    ///
    /// A text document named `Something.map` was an ordinary document before maps
    /// existed, and routing is by suffix alone — so without this check the first
    /// autosave of the map view would replace the writing with an empty map.
    pub fn save_map_document(&self, project_name: &str, doc_name: &str, map: &Value) -> Result<()> {
        if !is_map_doc(doc_name) {
            return Err(StoreError::Refused(format!("{doc_name} is not a map")));
        }
        self.locks.with_doc_lock(project_name, doc_name, || {
            let existing = self.load_document(project_name, doc_name)?;
            if !is_map_payload(existing.as_ref()) {
                return Err(StoreError::Refused(format!(
                    "{doc_name} holds something other than a map; it was not overwritten"
                )));
            }
            self.write_document_raw(project_name, doc_name, map)
        })
    }

    /// Save a text document, carrying its version history forward.
    ///
    /// Version history lives in this same file, so every write has to re-read and
    /// re-write it. An autosave that rebuilt the file from `{ content, notes }` alone
    /// would erase the history — including named snapshots — on the next keystroke.
    ///
    /// Only `content`, `notes`, `versions`, `archive` and `citations` survive; everything
    /// else is dropped. That
    /// makes this unsafe for any other document kind, so a canvas is **refused** rather
    /// than silently overwritten with an empty text document.
    pub fn save_document(
        &self,
        project_name: &str,
        doc_name: &str,
        body: &DocumentBody,
        append_version: Option<VersionRequest>,
    ) -> Result<()> {
        if !is_text_doc(doc_name) {
            return Err(StoreError::Refused(format!(
                "{doc_name} is a {}; saving it as a text document would erase it",
                doc_kind_name(get_doc_kind(doc_name))
            )));
        }

        self.locks.with_doc_lock(project_name, doc_name, || {
            let root = self.project_root(project_name);
            let file_path = join_path(&[&root, &format!("{doc_name}.json")]);
            std::fs::create_dir_all(parent_of(&file_path))?;

            let existing = read_json(&file_path);
            let mut versions = existing
                .as_ref()
                .and_then(|doc| doc.get("versions"))
                .and_then(|value| serde_json::from_value::<Vec<VersionEntry>>(value.clone()).ok())
                .unwrap_or_default();

            let appended = append_version.is_some();
            if let Some(request) = append_version {
                let entry = versions::build_text_version_entry(NewTextVersion {
                    id: clock::new_version_id(),
                    timestamp: clock::now_iso8601(),
                    session_id: self.session_id.clone(),
                    content_html: request.content_html,
                    content_json: request.content_json,
                    name: request.name,
                    auto: request.auto,
                });
                versions = push_version_entry(&versions, entry);
            }

            let mut document = json!({
                "content": body.content,
                "notes": body.notes,
                "versions": versions,
            });
            // The archive, the citation settings and the timeline passages live in this
            // file too, owned by their own stores (`archiveStore.js`, `referenceStore.js`,
            // `TimelineAnchors.js`), and are carried forward the way the JS save does.
            if let (Some(existing), Some(fields)) = (existing.as_ref(), document.as_object_mut()) {
                if let Some(archive) = existing
                    .get("archive")
                    .filter(|a| a.as_array().is_some_and(|a| !a.is_empty()))
                {
                    fields.insert("archive".to_string(), archive.clone());
                }
                if let Some(citations) = existing.get("citations").filter(|c| c.is_object()) {
                    fields.insert("citations".to_string(), citations.clone());
                }
                // So are the passages attached to timeline events, which the page's editor
                // writes (`saveDocumentTimeline`).
                if let Some(timeline) = existing
                    .get("timeline")
                    .filter(|t| t.as_array().is_some_and(|t| !t.is_empty()))
                {
                    fields.insert("timeline".to_string(), timeline.clone());
                }
                // So is the writer's lock (`docLocks.ts`); the page keeps the text
                // from changing, the save only keeps the flag.
                if is_locked(existing) {
                    fields.insert("locked".to_string(), Value::Bool(true));
                }
            }
            std::fs::write(&file_path, serde_json::to_string(&document)?)?;

            if appended {
                self.emit_versions_changed(project_name, doc_name);
            }
            Ok(())
        })
    }

    /// Replace only a document's `notes`, preserving content and version history.
    ///
    /// This exists for note cards on a canvas. Notes normally ride along with a
    /// document save, which needs a live editor to supply `content` — so a note
    /// belonging to a document that is not open in a pane has no way to persist.
    ///
    /// Returns `false` where the JS does: the document is gone. A note pointing at a
    /// file that is no longer there must not resurrect it as an empty stub.
    pub fn save_document_notes(
        &self,
        project_name: &str,
        doc_name: &str,
        notes: &Value,
    ) -> Result<bool> {
        if !is_text_doc(doc_name) {
            return Err(StoreError::Refused(format!(
                "{doc_name} is not a text document and has no notes"
            )));
        }

        self.locks.with_doc_lock(project_name, doc_name, || {
            let Some(mut existing) = self.load_document(project_name, doc_name)? else {
                return Ok(false);
            };
            if let Some(fields) = existing.as_object_mut() {
                fields.insert(
                    "notes".to_string(),
                    if notes.is_array() {
                        notes.clone()
                    } else {
                        json!([])
                    },
                );
            }
            self.write_document_raw(project_name, doc_name, &existing)?;
            Ok(true)
        })
    }

    /// The document's JSON, or `None` when there is no such file.
    pub fn load_document(&self, project_name: &str, doc_name: &str) -> Result<Option<Value>> {
        let file_path = join_path(&[
            &self.project_root(project_name),
            &format!("{doc_name}.json"),
        ]);
        if !exists(&file_path) {
            return Ok(None);
        }
        Ok(Some(serde_json::from_str(&std::fs::read_to_string(
            &file_path,
        )?)?))
    }

    pub fn document_exists(&self, project_name: &str, doc_name: &str) -> bool {
        if project_name.is_empty() || doc_name.is_empty() {
            return false;
        }
        let file_path = join_path(&[
            &self.project_root(project_name),
            &format!("{doc_name}.json"),
        ]);
        exists(&file_path)
    }

    /// "Make a copy": materialize a version as a NEW document beside the original, so
    /// old text can be pulled out without touching the live draft. Returns the new
    /// document's tree path.
    pub fn create_document_from_version(
        &self,
        project_name: &str,
        doc_name: &str,
        version: &VersionEntry,
        label: &str,
    ) -> Result<String> {
        let root = self.project_root(project_name);
        // `<name> (label)`, then `<name> (label 2)` — the counter goes INSIDE the
        // parentheses here and outside the word for a duplicate. Two different
        // shapes, both load-bearing for how the results read in the file tree.
        let suffix = if label.is_empty() { "copy" } else { label }.replace(['/', '\\'], "-");
        let candidate = self.free_name(&root, doc_name, |base, counter| match counter {
            None => format!("{base} ({suffix})"),
            Some(counter) => format!("{base} ({suffix} {counter})"),
        })?;

        let data = match &version.canvas {
            Some(canvas) => serde_json::to_value(canvas)?,
            None => json!({
                "content": version.content_json.clone().unwrap_or_else(|| json!([])),
                "notes": [],
            }),
        };

        self.write_document_raw(project_name, &candidate, &data)?;
        Ok(candidate)
    }

    /// The first name `name_for` offers that nothing is using yet.
    ///
    /// `name_for` is handed the base name and the attempt number — `None` first, then
    /// 2, 3, … The `.canvas` suffix carries the document's kind, so it is stripped
    /// before the caller names anything and put back afterwards: a copy of a canvas is
    /// still a canvas.
    fn free_name(
        &self,
        root: &str,
        doc_name: &str,
        name_for: impl Fn(&str, Option<u32>) -> String,
    ) -> Result<String> {
        let rel = normalize_path(doc_name);
        let kind = get_doc_kind(&rel);
        let base = strip_doc_suffix(&rel);
        let base = base.as_str();
        let with_suffix = |name: String| with_doc_suffix(&name, kind);

        let mut candidate = with_suffix(name_for(base, None));
        let mut counter = 2;
        while exists(&file_path_for(root, &candidate)) {
            candidate = with_suffix(name_for(base, Some(counter)));
            counter += 1;
        }
        Ok(candidate)
    }

    /* ---------------- version history ---------------- */

    /// A document's version history.
    ///
    /// Text documents embed their versions in the document file; canvases keep theirs
    /// in a `.versions/` sidecar, because the canvas file is spec-shaped JSON Canvas and
    /// must stay that way. The sidecar is also read for text documents that have no
    /// embedded history.
    pub fn get_versions(&self, project_name: &str, doc_name: &str) -> Vec<VersionEntry> {
        let root = self.project_root(project_name);

        if is_text_doc(doc_name) {
            let embedded = read_json(&join_path(&[&root, &format!("{doc_name}.json")]))
                .and_then(|doc| doc.get("versions").cloned())
                .and_then(|value| serde_json::from_value::<Vec<VersionEntry>>(value).ok())
                .unwrap_or_default();
            if !embedded.is_empty() {
                return embedded;
            }
        }

        read_sidecar_versions(&root, doc_name)
    }

    /// Append a version entry outside the autosave path — manual snapshots, the safety
    /// checkpoint taken before a restore, and canvas checkpoints all land here.
    ///
    /// Returns the entry actually stored, which may be an earlier one: deduping can fold
    /// the new entry into the latest. `None` means there was nowhere to write — a text
    /// document must exist before it can be versioned.
    pub fn append_version_entry(
        &self,
        project_name: &str,
        doc_name: &str,
        entry: VersionEntry,
    ) -> Result<Option<VersionEntry>> {
        self.locks.with_doc_lock(project_name, doc_name, || {
            let Some((location, existing)) = self.read_version_store(project_name, doc_name)?
            else {
                return Ok(None);
            };

            let versions = push_version_entry(&existing, entry);
            let stored = versions.first().cloned();
            self.write_version_store(project_name, doc_name, &location, &versions)?;
            Ok(stored)
        })
    }

    /// Rename (or un-name) a version. `false` when there is no entry with that id.
    pub fn update_version_entry(
        &self,
        project_name: &str,
        doc_name: &str,
        version_id: &str,
        patch: VersionPatch,
    ) -> Result<bool> {
        self.locks.with_doc_lock(project_name, doc_name, || {
            let Some((location, existing)) = self.read_version_store(project_name, doc_name)?
            else {
                return Ok(false);
            };

            let mut found = false;
            let versions: Vec<VersionEntry> = existing
                .into_iter()
                .map(|mut entry| {
                    if entry.id == version_id {
                        found = true;
                        if let Some(name) = patch.name.clone() {
                            entry.name = name;
                        }
                        if let Some(auto) = patch.auto {
                            entry.auto = auto;
                        }
                    }
                    entry
                })
                .collect();

            if !found {
                return Ok(false);
            }
            self.write_version_store(project_name, doc_name, &location, &versions)?;
            Ok(true)
        })
    }

    /// `false` when there is no entry with that id.
    pub fn delete_version_entry(
        &self,
        project_name: &str,
        doc_name: &str,
        version_id: &str,
    ) -> Result<bool> {
        self.locks.with_doc_lock(project_name, doc_name, || {
            let Some((location, existing)) = self.read_version_store(project_name, doc_name)?
            else {
                return Ok(false);
            };

            let before = existing.len();
            let versions: Vec<VersionEntry> = existing
                .into_iter()
                .filter(|entry| entry.id != version_id)
                .collect();
            if versions.len() == before {
                return Ok(false);
            }

            self.write_version_store(project_name, doc_name, &location, &versions)?;
            Ok(true)
        })
    }

    /// Where a document's versions live and what they currently are — the one place
    /// that knows embedded-from-sidecar, so every mutation above shares it.
    fn read_version_store(
        &self,
        project_name: &str,
        doc_name: &str,
    ) -> Result<Option<(VersionStore, Vec<VersionEntry>)>> {
        let root = self.project_root(project_name);

        if !is_text_doc(doc_name) {
            let versions = read_sidecar_versions(&root, doc_name);
            return Ok(Some((VersionStore::Sidecar { root }, versions)));
        }

        let doc = read_json(&join_path(&[&root, &format!("{doc_name}.json")]));
        let embedded = doc
            .as_ref()
            .and_then(|doc| doc.get("versions"))
            .and_then(|value| serde_json::from_value::<Vec<VersionEntry>>(value.clone()).ok())
            .unwrap_or_default();

        if let Some(doc) = doc.clone() {
            if !embedded.is_empty() {
                return Ok(Some((VersionStore::Embedded { root, doc }, embedded)));
            }
        }

        // No embedded history yet: the legacy sidecar if there is one, otherwise start
        // embedding — which needs the document to exist.
        let legacy = read_sidecar_versions(&root, doc_name);
        if !legacy.is_empty() {
            return Ok(Some((VersionStore::Sidecar { root }, legacy)));
        }
        Ok(doc.map(|doc| (VersionStore::Embedded { root, doc }, Vec::new())))
    }

    fn write_version_store(
        &self,
        project_name: &str,
        doc_name: &str,
        location: &VersionStore,
        versions: &[VersionEntry],
    ) -> Result<()> {
        match location {
            VersionStore::Sidecar { root } => write_sidecar_versions(root, doc_name, versions)?,
            VersionStore::Embedded { root, doc } => {
                let mut document = doc.clone();
                if let Some(fields) = document.as_object_mut() {
                    fields.insert("versions".to_string(), serde_json::to_value(versions)?);
                }
                std::fs::write(
                    join_path(&[root, &format!("{doc_name}.json")]),
                    serde_json::to_string(&document)?,
                )?;
            }
        }
        self.emit_versions_changed(project_name, doc_name);
        Ok(())
    }

    /* ---------------- projects ---------------- */

    /// Every project the app can open: the AppData subdirectories, plus registry
    /// entries whose directory still exists. Not sorted — the JS does not sort either,
    /// and the picker is what decides presentation.
    pub fn list_projects(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&self.app_data_root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_directory = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
                if is_directory && !name.is_empty() && !name.starts_with('.') {
                    names.push(name);
                }
            }
        }

        for (name, absolute_path) in self.locations.list() {
            if exists(&absolute_path) && !names.contains(&name) {
                names.push(name);
            }
        }

        names.dedup();
        names
    }

    /// Create a project. With `target_parent_dir`, the directory is created inside it
    /// and the custom location recorded; otherwise it goes in the AppData default.
    pub fn create_project(
        &self,
        project_name: &str,
        target_parent_dir: Option<&str>,
    ) -> Result<bool> {
        let name = project_name.trim();
        if name.is_empty() {
            return Ok(false);
        }

        let root = match target_parent_dir {
            Some(parent) => join_path(&[parent, name]),
            None => join_path(&[&self.app_data_root, name]),
        };
        std::fs::create_dir_all(&root)?;

        if target_parent_dir.is_some() {
            self.locations.set(name, &root)?;
        }
        Ok(true)
    }

    /// Adopt a project directory that already exists on disk, under the name of the
    /// folder itself.
    ///
    /// This is the repair path for a project that has stopped appearing in the app.
    /// [`Self::list_projects`] hides a registry entry whose directory is gone, so a
    /// project that was moved, renamed or restored from a backup outside the app
    /// silently drops out of the picker while its documents sit untouched on disk.
    ///
    /// Returns the project's name and whether it was already linked there.
    pub fn link_project(
        &self,
        project_dir: &str,
    ) -> Result<std::result::Result<(String, bool), LinkRefusal>> {
        let dir = strip_trailing_slash(project_dir);
        if dir.is_empty() {
            return Ok(Err(LinkRefusal::InvalidArguments));
        }
        if !exists(dir) {
            return Ok(Err(LinkRefusal::SourceMissing));
        }

        let name = dir
            .split(['/', '\\'])
            .rfind(|part| !part.is_empty())
            .unwrap_or("");
        // A dotted directory is skipped by list_projects, so linking one would
        // "succeed" into a project that never appears.
        if name.is_empty() || name.starts_with('.') {
            return Ok(Err(LinkRefusal::InvalidName));
        }

        // Never hijack a name a different, still-reachable project holds — that would
        // strand the other one. A stale entry, its directory gone, is exactly what this
        // exists to repair, so overwriting that is the point.
        let current_root = self.project_root(name);
        let already_linked = strip_trailing_slash(&current_root) == dir;
        if !already_linked && exists(&current_root) {
            return Ok(Err(LinkRefusal::NameExists));
        }

        // A project in the default AppData location is found by directory scan and
        // needs no registry entry.
        if dir == join_path(&[&self.app_data_root, name]) {
            self.locations.remove(name)?;
        } else {
            self.locations.set(name, dir)?;
        }

        Ok(Ok((name.to_string(), already_linked)))
    }

    pub fn delete_project(&self, project_name: &str) -> Result<()> {
        let root = self.project_root(project_name);
        if exists(&root) {
            std::fs::remove_dir_all(&root)?;
        }
        self.locations.remove(project_name)
    }

    /// Returns the new name, or `None` when the project is missing or the name is taken.
    ///
    /// **Stricter than the JS**, deliberately. `renameProject` only checks whether a
    /// directory already sits at the new path *inside the same parent*, so a
    /// custom-located project can be renamed onto a name an AppData project already
    /// holds. Both then answer to that name, `getProjectRoot` resolves to the registry
    /// entry, and the AppData project becomes unreachable — the exact stranding
    /// `link_project` refuses to cause. This checks the name, not just the path.
    pub fn rename_project(&self, project_name: &str, new_name: &str) -> Result<Option<String>> {
        let (current, next) = (project_name.trim(), new_name.trim());
        if current.is_empty() || next.is_empty() {
            return Ok(None);
        }
        if current == next {
            return Ok(Some(next.to_string()));
        }

        let old_root = self.project_root(current);
        if !exists(&old_root) {
            return Ok(None);
        }

        // Nothing already answering to the new name, anywhere...
        if exists(&self.project_root(next)) {
            return Ok(None);
        }
        // ...and nothing already sitting where the directory is going.
        let new_root = join_path(&[&parent_of(&old_root), next]);
        if exists(&new_root) {
            return Ok(None);
        }

        std::fs::rename(&old_root, &new_root)?;

        // Keep the registry consistent for a custom-located project.
        if self.locations.get(current).is_some() {
            self.locations.rename(current, next, &new_root)?;
        }
        Ok(Some(next.to_string()))
    }

    /// Move a project's directory to a new parent folder. Falls back to a recursive
    /// copy and delete when a plain rename crosses filesystem boundaries — which is
    /// exactly what moving into a cloud folder on another volume does.
    pub fn move_project(
        &self,
        project_name: &str,
        target_parent_dir: &str,
    ) -> Result<std::result::Result<String, LinkRefusal>> {
        let name = project_name.trim();
        let parent = strip_trailing_slash(target_parent_dir);
        if name.is_empty() || parent.is_empty() {
            return Ok(Err(LinkRefusal::InvalidArguments));
        }

        let old_root = self.project_root(name);
        let new_root = join_path(&[parent, name]);
        if strip_trailing_slash(&old_root) == new_root {
            return Ok(Ok(new_root));
        }
        if !exists(&old_root) {
            return Ok(Err(LinkRefusal::SourceMissing));
        }
        if exists(&new_root) {
            return Ok(Err(LinkRefusal::TargetExists));
        }

        if std::fs::rename(&old_root, &new_root).is_err() {
            copy_dir_recursive(&old_root, &new_root)?;
            std::fs::remove_dir_all(&old_root)?;
        }

        // A project moved back into AppData reverts to the default and loses its entry.
        if new_root == join_path(&[&self.app_data_root, name]) {
            self.locations.remove(name)?;
        } else {
            self.locations.set(name, &new_root)?;
        }

        Ok(Ok(new_root))
    }

    /* ---------------- entries ---------------- */

    pub fn create_folder(&self, project_name: &str, folder_path: &str) -> Result<()> {
        let root = self.project_root(project_name);
        std::fs::create_dir_all(folder_path_for(&root, folder_path))?;
        Ok(())
    }

    /// Absolute path of an entry on disk — what "Copy Path" and "Reveal in Finder" need.
    pub fn entry_file_path(&self, project_name: &str, entry_path: &str, is_folder: bool) -> String {
        let root = self.project_root(project_name);
        if is_folder {
            folder_path_for(&root, entry_path)
        } else {
            file_path_for(&root, entry_path)
        }
    }

    pub fn delete_entry(
        &self,
        project_name: &str,
        entry_path: &str,
        is_folder: bool,
    ) -> Result<()> {
        let root = self.project_root(project_name);
        let rel = normalize_path(entry_path);
        let target = self.entry_file_path(project_name, entry_path, is_folder);

        if !exists(&target) {
            return Ok(());
        }

        if is_folder {
            std::fs::remove_dir_all(&target)?;
        } else {
            std::fs::remove_file(&target)?;
            relocate_sidecar(&root, &rel, None);
        }
        Ok(())
    }

    /// Copy a document beside itself as "`<name>` copy", then "copy 2", …
    ///
    /// The bytes are copied verbatim rather than round-tripped through load and save,
    /// because that pair whitelists the keys of a *text* document and would quietly
    /// strip a canvas down to nothing. `None` when the source is not there.
    pub fn duplicate_entry(&self, project_name: &str, entry_path: &str) -> Result<Option<String>> {
        let root = self.project_root(project_name);
        let rel = normalize_path(entry_path);
        let source = file_path_for(&root, &rel);
        if !exists(&source) {
            return Ok(None);
        }

        let candidate = self.free_name(&root, &rel, |base, counter| match counter {
            None => format!("{base} copy"),
            Some(counter) => format!("{base} copy {counter}"),
        })?;
        std::fs::copy(&source, file_path_for(&root, &candidate))?;
        Ok(Some(candidate))
    }

    /// Returns the entry's new tree path, or `None` when the source is not there.
    pub fn rename_entry(
        &self,
        project_name: &str,
        entry_path: &str,
        new_name: &str,
        is_folder: bool,
    ) -> Result<Option<String>> {
        let rel = normalize_path(entry_path);
        let segments: Vec<&str> = rel.split('/').filter(|part| !part.is_empty()).collect();
        let parent = segments[..segments.len().saturating_sub(1)].join("/");
        let next_path = if parent.is_empty() {
            new_name.to_string()
        } else {
            format!("{parent}/{new_name}")
        };

        self.relocate_entry(project_name, &rel, &next_path, is_folder)
    }

    /// Returns the entry's new tree path, or `None` when the source is not there.
    pub fn move_entry(
        &self,
        project_name: &str,
        entry_path: &str,
        target_folder_path: &str,
        is_folder: bool,
    ) -> Result<Option<String>> {
        let rel = normalize_path(entry_path);
        let target_folder = normalize_path(target_folder_path);
        let base_name = rel.split('/').rfind(|part| !part.is_empty()).unwrap_or("");
        let next_path = if target_folder.is_empty() {
            base_name.to_string()
        } else {
            format!("{target_folder}/{base_name}")
        };

        self.relocate_entry(project_name, &rel, &next_path, is_folder)
    }

    /// The move a rename and a move both are, with the sidecar following along.
    fn relocate_entry(
        &self,
        project_name: &str,
        rel: &str,
        next_path: &str,
        is_folder: bool,
    ) -> Result<Option<String>> {
        let root = self.project_root(project_name);
        let (old_path, new_path) = if is_folder {
            (
                folder_path_for(&root, rel),
                folder_path_for(&root, next_path),
            )
        } else {
            (file_path_for(&root, rel), file_path_for(&root, next_path))
        };

        if !exists(&old_path) {
            return Ok(None);
        }

        let new_parent = parent_of(&new_path);
        if !new_parent.is_empty() {
            std::fs::create_dir_all(&new_parent)?;
        }

        std::fs::rename(&old_path, &new_path)?;
        if !is_folder {
            relocate_sidecar(&root, rel, Some(next_path));
        }
        Ok(Some(next_path.to_string()))
    }

    /// Every document and folder a writer has locked (`src/lib/docLocks.ts`). A
    /// document is locked by its own `locked` flag and a folder by the marker file
    /// inside it, so both travel with the project. Only the flag is read out of each
    /// document.
    pub fn locked_entries(&self, project_name: &str) -> LockedEntries {
        let root = self.project_root(project_name);
        let mut found = LockedEntries::default();
        for child in self
            .list_project_tree(project_name)
            .children
            .iter()
            .flatten()
        {
            collect_locked(&root, child, &mut found);
        }
        found
    }

    /// A project's full folder and file tree. Dotfiles and the order file are excluded.
    pub fn list_project_tree(&self, project_name: &str) -> TreeNode {
        let root = self.project_root(project_name);
        TreeNode {
            node_type: TreeNodeType::Folder,
            name: project_name.to_string(),
            path: String::new(),
            children: Some(read_directory(&root, "")),
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
