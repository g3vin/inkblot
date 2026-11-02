//! Projects: listing, creating, linking a folder elsewhere, deleting, renaming and
//! moving.

use super::*;

impl ProjectStore {
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
    /// The name is checked, not just the path beside the old directory: a
    /// custom-located project renamed onto an AppData project's name would leave both
    /// answering to it, the registry entry would win, and the AppData project would be
    /// unreachable — the stranding `link_project` refuses to cause. `renameProject` in
    /// JS makes the same check.
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
}
