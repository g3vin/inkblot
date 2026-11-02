//! Reading and writing documents: raw writes, maps, text documents with their notes,
//! existence, and a new document made from a version.

use super::*;

impl ProjectStore {
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
    pub(super) fn free_name(
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
}
