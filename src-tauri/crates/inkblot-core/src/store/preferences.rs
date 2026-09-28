//! Everything the app remembers between launches that is not a document.
//!
//! Not `localStorage`: a web view gets its own store, per origin, that no native code
//! can read. On disk under AppData, the Rust side reaches the same state; the webview keeps a synchronous facade (`src/lib/preferences.ts`) over a
//! cache it hydrates once at launch.
//!
//! ## Three files, not one
//!
//! | scope | file | why it is its own file |
//! |---|---|---|
//! | [`PreferenceScope::App`] | `preferences.json` | theme, accent, session, fonts, snap — small, read at launch |
//! | [`PreferenceScope::FileTree`] | `file-tree-state.json` | per-project sort order and expansion, which grows with the number of projects |
//! | [`PreferenceScope::PinterestCache`] | `pinterest-cache.json` | one entry per scraped board, each holding pin data; by far the largest, and the only one that is a cache rather than a preference |
//!
//! Splitting them keeps a corrupt or enormous pin cache from taking the theme with it,
//! and means the file that is read on every launch stays small.
//!
//! ## What is deliberately not here
//!
//! - **Per-launch session values.** `inkblot:project-open-id` and the per-project Pinterest
//!   refresh flag are scoped to one app launch by design. On disk they would outlive
//!   the thing they describe, so they stay in memory in the webview facade.
//! - **The file tree's order and expansion stay machine-local.** They are here in
//!   AppData rather than in the project directory, because `fileTreeState.js` says
//!   plainly that they are kept out of the project so they do not travel with it.  The
//!   `.inkblot-order.json` name is reserved in the store and never written;
//!   using it would put one machine's collapsed folders into another's checkout.
//!
//! Values are opaque strings; callers that store structured data serialize it
//! themselves.

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::paths::join_path;
use super::StoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PreferenceScope {
    App,
    FileTree,
    PinterestCache,
}

impl PreferenceScope {
    pub const ALL: [PreferenceScope; 3] = [
        PreferenceScope::App,
        PreferenceScope::FileTree,
        PreferenceScope::PinterestCache,
    ];

    /// The wire name, which is also the stem of the file. Parsed rather than
    /// interpolated, so a caller cannot name a path.
    pub fn as_str(self) -> &'static str {
        match self {
            PreferenceScope::App => "app",
            PreferenceScope::FileTree => "file-tree",
            PreferenceScope::PinterestCache => "pinterest-cache",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|scope| scope.as_str() == name)
    }

    fn file_name(self) -> &'static str {
        match self {
            PreferenceScope::App => "preferences.json",
            PreferenceScope::FileTree => "file-tree-state.json",
            PreferenceScope::PinterestCache => "pinterest-cache.json",
        }
    }
}

pub type PreferenceMap = BTreeMap<String, String>;

pub struct PreferenceStore {
    app_data_root: String,
    scopes: Mutex<BTreeMap<PreferenceScope, PreferenceMap>>,
}

impl PreferenceStore {
    pub fn new(app_data_root: &str) -> Self {
        Self {
            app_data_root: super::paths::strip_trailing_slash(app_data_root).to_string(),
            scopes: Mutex::new(BTreeMap::new()),
        }
    }

    fn path(&self, scope: PreferenceScope) -> String {
        join_path(&[&self.app_data_root, scope.file_name()])
    }

    /// Read a scope, from the cache or from disk.
    ///
    /// A missing, unreadable or malformed file is an empty scope. Losing a theme
    /// preference is not worth refusing to launch over, and every caller already
    /// defaults when a key is absent.
    fn load(&self, scope: PreferenceScope) -> PreferenceMap {
        let mut scopes = self
            .scopes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(map) = scopes.get(&scope) {
            return map.clone();
        }

        let map = std::fs::read_to_string(self.path(scope))
            .ok()
            .and_then(|raw| serde_json::from_str::<PreferenceMap>(&raw).ok())
            .unwrap_or_default();

        scopes.insert(scope, map.clone());
        map
    }

    fn persist(&self, scope: PreferenceScope, map: PreferenceMap) -> Result<(), StoreError> {
        {
            let mut scopes = self
                .scopes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            scopes.insert(scope, map.clone());
        }
        std::fs::create_dir_all(&self.app_data_root)?;
        std::fs::write(self.path(scope), serde_json::to_string(&map)?)?;
        Ok(())
    }

    /// Every scope at once — what the webview asks for at launch so that its facade
    /// can answer synchronously afterwards.
    pub fn load_all(&self) -> BTreeMap<&'static str, PreferenceMap> {
        PreferenceScope::ALL
            .into_iter()
            .map(|scope| (scope.as_str(), self.load(scope)))
            .collect()
    }

    pub fn get(&self, scope: PreferenceScope, key: &str) -> Option<String> {
        self.load(scope).get(key).cloned()
    }

    pub fn set(&self, scope: PreferenceScope, key: &str, value: &str) -> Result<(), StoreError> {
        let mut map = self.load(scope);
        map.insert(key.to_string(), value.to_string());
        self.persist(scope, map)
    }

    pub fn remove(&self, scope: PreferenceScope, key: &str) -> Result<(), StoreError> {
        let mut map = self.load(scope);
        if map.remove(key).is_some() {
            return self.persist(scope, map);
        }
        Ok(())
    }

    /// Move every key starting with `from_prefix` to `to_prefix`, keeping the rest of
    /// each key. This is what a project rename does to the file tree's state.
    pub fn rename_prefix(
        &self,
        scope: PreferenceScope,
        from_prefix: &str,
        to_prefix: &str,
    ) -> Result<(), StoreError> {
        let map = self.load(scope);
        let mut next = PreferenceMap::new();
        let mut moved = false;

        for (key, value) in map {
            match key.strip_prefix(from_prefix) {
                Some(rest) => {
                    moved = true;
                    next.insert(format!("{to_prefix}{rest}"), value);
                }
                None => {
                    next.insert(key, value);
                }
            }
        }

        if moved {
            return self.persist(scope, next);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "inkblot-prefs-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }

        fn as_str(&self) -> &str {
            self.0.to_str().expect("utf-8 temp path")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_preference_survives_a_relaunch() {
        let app_data = TempDir::new();
        PreferenceStore::new(app_data.as_str())
            .set(PreferenceScope::App, "inkblot-theme", "dark")
            .unwrap();

        // A second store is a second launch: nothing is shared but the files.
        let relaunched = PreferenceStore::new(app_data.as_str());
        assert_eq!(
            relaunched
                .get(PreferenceScope::App, "inkblot-theme")
                .as_deref(),
            Some("dark")
        );
    }

    #[test]
    fn the_scopes_are_separate_files() {
        let app_data = TempDir::new();
        let store = PreferenceStore::new(app_data.as_str());
        store
            .set(PreferenceScope::App, "inkblot-theme", "dark")
            .unwrap();
        store
            .set(PreferenceScope::PinterestCache, "board", "[]")
            .unwrap();

        assert!(PathBuf::from(format!("{}/preferences.json", app_data.as_str())).exists());
        assert!(PathBuf::from(format!("{}/pinterest-cache.json", app_data.as_str())).exists());
        // And a corrupt cache cannot take the theme with it.
        std::fs::write(
            format!("{}/pinterest-cache.json", app_data.as_str()),
            "{{{{",
        )
        .unwrap();
        let relaunched = PreferenceStore::new(app_data.as_str());
        assert_eq!(
            relaunched
                .get(PreferenceScope::App, "inkblot-theme")
                .as_deref(),
            Some("dark")
        );
        assert!(relaunched
            .get(PreferenceScope::PinterestCache, "board")
            .is_none());
    }

    #[test]
    fn a_project_rename_carries_its_file_tree_state() {
        let app_data = TempDir::new();
        let store = PreferenceStore::new(app_data.as_str());
        store
            .set(PreferenceScope::FileTree, "inkblot-order:Novel", "{}")
            .unwrap();
        store
            .set(PreferenceScope::FileTree, "inkblot-expanded:Novel", "[]")
            .unwrap();
        store
            .set(PreferenceScope::FileTree, "inkblot-order:Other", "{}")
            .unwrap();

        store
            .rename_prefix(
                PreferenceScope::FileTree,
                "inkblot-order:Novel",
                "inkblot-order:Book",
            )
            .unwrap();
        store
            .rename_prefix(
                PreferenceScope::FileTree,
                "inkblot-expanded:Novel",
                "inkblot-expanded:Book",
            )
            .unwrap();

        assert!(store
            .get(PreferenceScope::FileTree, "inkblot-order:Novel")
            .is_none());
        assert_eq!(
            store
                .get(PreferenceScope::FileTree, "inkblot-order:Book")
                .as_deref(),
            Some("{}")
        );
        // Another project's state is untouched.
        assert_eq!(
            store
                .get(PreferenceScope::FileTree, "inkblot-order:Other")
                .as_deref(),
            Some("{}")
        );
    }

    #[test]
    fn a_scope_name_cannot_be_a_path() {
        assert_eq!(PreferenceScope::parse("app"), Some(PreferenceScope::App));
        assert!(PreferenceScope::parse("../../etc/passwd").is_none());
        assert!(PreferenceScope::parse("").is_none());
    }

    #[test]
    fn load_all_returns_every_scope_even_when_empty() {
        let app_data = TempDir::new();
        let all = PreferenceStore::new(app_data.as_str()).load_all();
        assert_eq!(all.len(), 3);
        assert!(all.values().all(BTreeMap::is_empty));
    }
}
