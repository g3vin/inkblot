//! A document's version history on disk: listing, appending, editing and deleting
//! entries, wherever the store keeps them (inside the document or in a sidecar).
//! The pure half is `versions.rs`.

use super::*;

impl ProjectStore {
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
    pub(super) fn read_version_store(
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

    pub(super) fn write_version_store(
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
}
