//! The registry mapping project names to custom storage directories.
//!
//! By default a project lives at `<AppData>/<project>`. When the user chooses a
//! different location — an iCloud or OneDrive folder, say — the absolute path to that
//! project's directory is recorded here. The registry itself is a small JSON file in
//! AppData, so it survives regardless of where projects live.
//!
//! A value is the absolute path to the project directory **itself**, not its parent.
//! Projects in the default location have no entry.
//!
//! Reads and writes the same registry file as `src/lib/projectLocations.js`.

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::paths::{join_path, LOCATIONS_FILE};
use super::StoreError;

pub type LocationMap = BTreeMap<String, String>;

pub struct ProjectLocations {
    registry_path: String,
    /// Read once and kept, as the JS does. A second process editing the file behind us
    /// is not a case either implementation handles.
    cache: Mutex<Option<LocationMap>>,
}

impl ProjectLocations {
    pub fn new(app_data_root: &str) -> Self {
        Self {
            registry_path: join_path(&[app_data_root, LOCATIONS_FILE]),
            cache: Mutex::new(None),
        }
    }

    fn load(&self) -> LocationMap {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(map) = cache.as_ref() {
            return map.clone();
        }

        // A missing or unreadable registry is an empty one: every project is then
        // assumed to be in the default location, which is the safe reading.
        let map = std::fs::read_to_string(&self.registry_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LocationMap>(&raw).ok())
            .unwrap_or_default();

        *cache = Some(map.clone());
        map
    }

    fn persist(&self, map: LocationMap) -> Result<(), StoreError> {
        {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some(map.clone());
        }

        // Two-space pretty-printing, as the JS writes it — this file is small, and a
        // user who opens it should see the same thing either implementation wrote.
        let json = serde_json::to_string_pretty(&map)?;
        if let Some(parent) = std::path::Path::new(&self.registry_path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.registry_path, json)?;
        Ok(())
    }

    pub fn list(&self) -> LocationMap {
        self.load()
    }

    /// The custom directory for a project, or `None` when it is in the default place.
    pub fn get(&self, name: &str) -> Option<String> {
        self.load().get(name).cloned()
    }

    pub fn set(&self, name: &str, absolute_path: &str) -> Result<(), StoreError> {
        let mut map = self.load();
        map.insert(name.to_string(), absolute_path.to_string());
        self.persist(map)
    }

    pub fn remove(&self, name: &str) -> Result<(), StoreError> {
        let mut map = self.load();
        if map.remove(name).is_some() {
            return self.persist(map);
        }
        Ok(())
    }

    /// Move an entry to a new name and path, for a project rename.
    pub fn rename(&self, old_name: &str, new_name: &str, new_path: &str) -> Result<(), StoreError> {
        let mut map = self.load();
        map.remove(old_name);
        map.insert(new_name.to_string(), new_path.to_string());
        self.persist(map)
    }
}
