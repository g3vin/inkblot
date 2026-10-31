//! Entries inside a project: folders, deleting, duplicating, renaming and moving
//! files and folders (with their version sidecars), locks, and the project tree.

use super::*;

impl ProjectStore {
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
    pub(super) fn relocate_entry(
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
