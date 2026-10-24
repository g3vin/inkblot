//! The store against a real filesystem.
//!
//! These are not parity tests. The parity harness compares pure functions across the
//! seam, and the pure half of this module — the path arithmetic, the version list and
//! its cap — is covered there. What is left is I/O, where "the JS does the same thing"
//! is only interesting if the thing is right; so these assert against the layout on
//! disk directly. The paths they check are the ones that lose a user's writing when
//! they are wrong: version history surviving an autosave, the sidecar following a
//! rename, and the canvas refusal.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::{json, Value};

use super::*;
use crate::types::{VersionEntry, VersionKind};

/// A temp directory that removes itself. Hand-rolled rather than pulling in a crate
/// for six lines, and named per-process so concurrent test binaries do not collide.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "inkblot-store-{}-{}",
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

fn store(app_data: &TempDir) -> ProjectStore {
    ProjectStore::new(app_data.as_str(), "test-session")
}

fn body(content: Value, notes: Value) -> DocumentBody {
    DocumentBody { content, notes }
}

fn text(html: &str) -> VersionRequest {
    VersionRequest {
        content_html: Some(html.to_string()),
        content_json: None,
        name: None,
        auto: true,
    }
}

fn entry(id: &str, html: &str) -> VersionEntry {
    VersionEntry {
        id: id.to_string(),
        timestamp: clock::now_iso8601(),
        kind: VersionKind::Text,
        name: None,
        auto: true,
        session_id: Some("test-session".to_string()),
        words: None,
        content_html: Some(html.to_string()),
        content_json: None,
        canvas: None,
        map: None,
    }
}

/* ---------------- documents and their history ---------------- */

#[test]
fn an_autosave_carries_the_version_history_forward() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    store
        .save_document(
            "Novel",
            "Chapter One",
            &body(json!([1]), json!([])),
            Some(text("<p>first</p>")),
        )
        .unwrap();
    // The keystroke after: no version requested, and the history must survive it.
    store
        .save_document("Novel", "Chapter One", &body(json!([2]), json!([])), None)
        .unwrap();

    let versions = store.get_versions("Novel", "Chapter One");
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].content_html.as_deref(), Some("<p>first</p>"));

    let document = store
        .load_document("Novel", "Chapter One")
        .unwrap()
        .unwrap();
    assert_eq!(document["content"], json!([2]));
}

#[test]
fn an_autosave_carries_the_archive_and_the_citations_forward() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    let citations = json!({ "style": "mla", "bibliography": { "include": "cited", "annotated": false, "inPrint": true } });
    let archive = json!([{ "id": "x1", "archivedAt": "", "kind": "bubble", "title": "t" }]);
    store
        .write_document_raw(
            "Novel",
            "Chapter One",
            &json!({ "content": [], "notes": [], "archive": archive, "citations": citations }),
        )
        .unwrap();
    store
        .save_document("Novel", "Chapter One", &body(json!([2]), json!([])), None)
        .unwrap();

    let document = store
        .load_document("Novel", "Chapter One")
        .unwrap()
        .unwrap();
    assert_eq!(document["content"], json!([2]));
    assert_eq!(document["archive"], archive);
    assert_eq!(document["citations"], citations);
    let typed: crate::types::TextDocument = serde_json::from_value(document).unwrap();
    assert_eq!(typed.citations.unwrap().style.as_deref(), Some("mla"));
}

#[test]
fn saving_a_canvas_as_a_text_document_is_refused() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    let canvas = json!({ "type": "canvas", "nodes": [{ "id": "a" }], "edges": [] });
    store
        .write_document_raw("Novel", "Board.canvas", &canvas)
        .unwrap();

    let refused = store.save_document("Novel", "Board.canvas", &body(json!([]), json!([])), None);
    assert!(matches!(refused, Err(StoreError::Refused(_))));
    // And the canvas is still there, whole.
    assert_eq!(
        store
            .load_document("Novel", "Board.canvas")
            .unwrap()
            .unwrap(),
        canvas
    );
}

#[test]
fn a_map_is_neither_saved_as_text_nor_written_over_text() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    let map = crate::map::model::create_empty_map("image");
    store.save_map_document("Novel", "World.map", &map).unwrap();
    let refused = store.save_document("Novel", "World.map", &body(json!([]), json!([])), None);
    assert!(matches!(refused, Err(StoreError::Refused(_))));
    assert_eq!(
        store.load_document("Novel", "World.map").unwrap().unwrap(),
        map
    );

    // A text document from before maps existed, whose name happens to end in `.map`.
    let writing = json!({ "content": { "type": "doc", "content": [] }, "notes": [] });
    store
        .write_document_raw("Novel", "Treasure.map", &writing)
        .unwrap();
    let refused = store.save_map_document("Novel", "Treasure.map", &map);
    assert!(matches!(refused, Err(StoreError::Refused(_))));
    assert_eq!(
        store
            .load_document("Novel", "Treasure.map")
            .unwrap()
            .unwrap(),
        writing
    );

    // And only a `.map` path takes a map at all.
    assert!(matches!(
        store.save_map_document("Novel", "Chapter", &map),
        Err(StoreError::Refused(_))
    ));
}

#[test]
fn a_map_versions_into_the_sidecar_and_its_copy_stays_a_map() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_map_document(
            "Novel",
            "World.map",
            &crate::map::model::create_empty_map("blank"),
        )
        .unwrap();

    store
        .append_version_entry("Novel", "World.map", entry("m1", "<p>a</p>"))
        .unwrap();
    let root = store.project_root("Novel");
    assert!(PathBuf::from(paths::versions_sidecar_path(&root, "World.map")).exists());
    assert_eq!(
        store
            .duplicate_entry("Novel", "World.map")
            .unwrap()
            .as_deref(),
        Some("World copy.map")
    );
}

#[test]
fn a_canvas_versions_into_the_sidecar_and_a_text_document_into_its_own_file() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_document("Novel", "Chapter One", &body(json!([]), json!([])), None)
        .unwrap();
    store
        .write_document_raw(
            "Novel",
            "Board.canvas",
            &json!({ "nodes": [], "edges": [] }),
        )
        .unwrap();

    store
        .append_version_entry("Novel", "Chapter One", entry("t1", "<p>a</p>"))
        .unwrap();
    store
        .append_version_entry("Novel", "Board.canvas", entry("c1", "<p>b</p>"))
        .unwrap();

    let root = store.project_root("Novel");
    let document: Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{root}/Chapter One.json")).unwrap())
            .unwrap();
    assert_eq!(document["versions"].as_array().unwrap().len(), 1);
    assert!(!PathBuf::from(paths::versions_sidecar_path(&root, "Chapter One")).exists());
    assert!(PathBuf::from(paths::versions_sidecar_path(&root, "Board.canvas")).exists());
}

#[test]
fn a_legacy_sidecar_keeps_being_used_once_it_exists() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    // A document written by an older build: content in the file, history beside it.
    store
        .write_document_raw("Novel", "Old", &json!({ "content": [], "notes": [] }))
        .unwrap();
    let root = store.project_root("Novel");
    let sidecar = paths::versions_sidecar_path(&root, "Old");
    std::fs::create_dir_all(paths::parent_of(&sidecar)).unwrap();
    std::fs::write(
        &sidecar,
        serde_json::to_string(&vec![entry("legacy", "<p>old</p>")]).unwrap(),
    )
    .unwrap();

    assert_eq!(store.get_versions("Novel", "Old").len(), 1);

    store
        .append_version_entry("Novel", "Old", entry("new", "<p>new</p>"))
        .unwrap();
    let versions = store.get_versions("Novel", "Old");
    assert_eq!(versions.len(), 2);
    // It went back to the sidecar, not into the document — splitting a history in two
    // is how half of it stops being shown.
    let document = store.load_document("Novel", "Old").unwrap().unwrap();
    assert!(document.get("versions").is_none());
}

#[test]
fn a_version_entry_can_be_renamed_and_deleted() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_document("Novel", "Chapter One", &body(json!([]), json!([])), None)
        .unwrap();
    store
        .append_version_entry("Novel", "Chapter One", entry("v1", "<p>a</p>"))
        .unwrap();

    let renamed = store
        .update_version_entry(
            "Novel",
            "Chapter One",
            "v1",
            VersionPatch {
                name: Some(Some("Draft".into())),
                auto: Some(false),
            },
        )
        .unwrap();
    assert!(renamed);
    assert_eq!(
        store.get_versions("Novel", "Chapter One")[0]
            .name
            .as_deref(),
        Some("Draft")
    );

    assert!(!store
        .update_version_entry("Novel", "Chapter One", "nope", VersionPatch::default())
        .unwrap());
    assert!(store
        .delete_version_entry("Novel", "Chapter One", "v1")
        .unwrap());
    assert!(store.get_versions("Novel", "Chapter One").is_empty());
    assert!(!store
        .delete_version_entry("Novel", "Chapter One", "v1")
        .unwrap());
}

#[test]
fn the_versions_changed_listener_fires_for_every_history_write() {
    let app_data = TempDir::new();
    let mut store = store(&app_data);
    let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
    let recorder = std::sync::Arc::clone(&seen);
    store.on_versions_changed(move |project, doc| {
        recorder.lock().unwrap().push(format!("{project}/{doc}"));
    });
    store.create_project("Novel", None).unwrap();

    // A save without a version request is silent; one with a request is not.
    store
        .save_document("Novel", "Chapter One", &body(json!([]), json!([])), None)
        .unwrap();
    assert!(seen.lock().unwrap().is_empty());

    store
        .save_document(
            "Novel",
            "Chapter One",
            &body(json!([]), json!([])),
            Some(text("<p>a</p>")),
        )
        .unwrap();
    store
        .append_version_entry("Novel", "Chapter One", entry("v2", "<p>b</p>"))
        .unwrap();
    assert_eq!(
        *seen.lock().unwrap(),
        ["Novel/Chapter One", "Novel/Chapter One"]
    );
    let _ = &mut store;
}

#[test]
fn notes_can_be_saved_without_an_editor_but_not_onto_nothing() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_document(
            "Novel",
            "Chapter One",
            &body(json!([1]), json!([])),
            Some(text("<p>a</p>")),
        )
        .unwrap();

    assert!(store
        .save_document_notes("Novel", "Chapter One", &json!([{ "id": "n1" }]))
        .unwrap());
    let document = store
        .load_document("Novel", "Chapter One")
        .unwrap()
        .unwrap();
    assert_eq!(document["content"], json!([1]));
    assert_eq!(document["notes"][0]["id"], "n1");
    assert_eq!(document["versions"].as_array().unwrap().len(), 1);

    // A note pointing at a file that is gone must not resurrect it as an empty stub.
    assert!(!store
        .save_document_notes("Novel", "Missing", &json!([]))
        .unwrap());
    assert!(!store.document_exists("Novel", "Missing"));
}

#[test]
fn a_version_becomes_a_new_document_beside_the_original() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_document("Novel", "Chapter One", &body(json!([]), json!([])), None)
        .unwrap();

    let mut version = entry("v1", "<p>old</p>");
    version.content_json = Some(json!([{ "type": "paragraph" }]));

    let first = store
        .create_document_from_version("Novel", "Chapter One", &version, "restored")
        .unwrap();
    assert_eq!(first, "Chapter One (restored)");
    let second = store
        .create_document_from_version("Novel", "Chapter One", &version, "restored")
        .unwrap();
    assert_eq!(second, "Chapter One (restored 2)");

    let copy = store.load_document("Novel", &first).unwrap().unwrap();
    assert_eq!(copy["content"], json!([{ "type": "paragraph" }]));
    // The live draft is untouched.
    assert_eq!(
        store
            .load_document("Novel", "Chapter One")
            .unwrap()
            .unwrap()["content"],
        json!([])
    );
}

/* ---------------- entries ---------------- */

#[test]
fn the_sidecar_follows_its_document_through_rename_move_and_delete() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .write_document_raw(
            "Novel",
            "Board.canvas",
            &json!({ "nodes": [], "edges": [] }),
        )
        .unwrap();
    store
        .append_version_entry("Novel", "Board.canvas", entry("v1", "<p>a</p>"))
        .unwrap();
    let root = store.project_root("Novel");

    let renamed = store
        .rename_entry("Novel", "Board.canvas", "Plot.canvas", false)
        .unwrap();
    assert_eq!(renamed.as_deref(), Some("Plot.canvas"));
    assert!(!PathBuf::from(paths::versions_sidecar_path(&root, "Board.canvas")).exists());
    assert_eq!(store.get_versions("Novel", "Plot.canvas").len(), 1);

    store.create_folder("Novel", "Structure").unwrap();
    let moved = store
        .move_entry("Novel", "Plot.canvas", "Structure", false)
        .unwrap();
    assert_eq!(moved.as_deref(), Some("Structure/Plot.canvas"));
    assert_eq!(
        store.get_versions("Novel", "Structure/Plot.canvas").len(),
        1
    );

    store
        .delete_entry("Novel", "Structure/Plot.canvas", false)
        .unwrap();
    assert!(!PathBuf::from(paths::versions_sidecar_path(&root, "Structure/Plot.canvas")).exists());
}

#[test]
fn a_duplicate_keeps_the_canvas_suffix_and_counts_up() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .write_document_raw(
            "Novel",
            "Board.canvas",
            &json!({ "nodes": [{ "id": "a" }] }),
        )
        .unwrap();

    assert_eq!(
        store
            .duplicate_entry("Novel", "Board.canvas")
            .unwrap()
            .as_deref(),
        Some("Board copy.canvas")
    );
    assert_eq!(
        store
            .duplicate_entry("Novel", "Board.canvas")
            .unwrap()
            .as_deref(),
        Some("Board copy 2.canvas")
    );
    // Copied verbatim, not round-tripped through the text-document whitelist.
    let copy = store
        .load_document("Novel", "Board copy.canvas")
        .unwrap()
        .unwrap();
    assert_eq!(copy["nodes"][0]["id"], "a");

    assert!(store.duplicate_entry("Novel", "Missing").unwrap().is_none());
}

#[test]
fn renaming_or_moving_something_that_is_not_there_reports_it() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    assert!(store
        .rename_entry("Novel", "Missing", "Other", false)
        .unwrap()
        .is_none());
    assert!(store
        .move_entry("Novel", "Missing", "Folder", false)
        .unwrap()
        .is_none());
    // Deleting what is not there is a no-op rather than an error.
    store.delete_entry("Novel", "Missing", false).unwrap();
}

#[test]
fn the_tree_hides_dotfiles_and_the_order_file_and_keeps_the_suffix() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();
    store
        .save_document("Novel", "Chapter One", &body(json!([]), json!([])), None)
        .unwrap();
    store.create_folder("Novel", "Characters").unwrap();
    store
        .save_document("Novel", "Characters/Ada", &body(json!([]), json!([])), None)
        .unwrap();
    store
        .write_document_raw("Novel", "Board.canvas", &json!({}))
        .unwrap();

    let root = store.project_root("Novel");
    std::fs::write(format!("{root}/{}", paths::ORDER_FILE), "{}").unwrap();
    std::fs::write(format!("{root}/.hidden.json"), "{}").unwrap();
    std::fs::write(format!("{root}/notes.txt"), "not a document").unwrap();
    // The version sidecar directory is a dotfile and must not appear as a folder.
    store
        .append_version_entry("Novel", "Board.canvas", entry("v1", ""))
        .unwrap();

    let tree = store.list_project_tree("Novel");
    let children = tree.children.unwrap();
    let names: Vec<&str> = children.iter().map(|child| child.name.as_str()).collect();
    assert_eq!(names, ["Board.canvas", "Chapter One", "Characters"]);

    let characters = children
        .iter()
        .find(|child| child.name == "Characters")
        .unwrap();
    assert_eq!(characters.node_type, TreeNodeType::Folder);
    assert_eq!(
        characters.children.as_ref().unwrap()[0].path,
        "Characters/Ada"
    );
}

/* ---------------- projects ---------------- */

#[test]
fn a_project_can_live_anywhere_and_still_be_found_by_name() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);

    store.create_project("Default", None).unwrap();
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();

    assert_eq!(
        store.project_root("Cloud"),
        format!("{}/Cloud", elsewhere.as_str())
    );
    let mut projects = store.list_projects();
    projects.sort();
    assert_eq!(projects, ["Cloud", "Default"]);

    // Documents resolve through the custom root, not AppData.
    store
        .save_document("Cloud", "Chapter One", &body(json!([1]), json!([])), None)
        .unwrap();
    assert!(PathBuf::from(format!("{}/Cloud/Chapter One.json", elsewhere.as_str())).exists());
}

#[test]
fn a_project_whose_directory_is_gone_drops_out_of_the_list() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();

    std::fs::remove_dir_all(format!("{}/Cloud", elsewhere.as_str())).unwrap();
    assert!(store.list_projects().is_empty());
}

#[test]
fn linking_repairs_a_project_that_moved_behind_the_apps_back() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();

    // The user moves it in Finder. The registry still points at the old place.
    let moved_to = format!("{}/Moved/Cloud", elsewhere.as_str());
    std::fs::create_dir_all(&moved_to).unwrap();
    std::fs::remove_dir_all(format!("{}/Cloud", elsewhere.as_str())).unwrap();
    assert!(store.list_projects().is_empty());

    let (name, already) = store.link_project(&moved_to).unwrap().unwrap();
    assert_eq!((name.as_str(), already), ("Cloud", false));
    assert_eq!(store.list_projects(), ["Cloud"]);
    // Linking the same place twice says so rather than failing.
    assert!(store.link_project(&moved_to).unwrap().unwrap().1);
}

#[test]
fn linking_refuses_to_strand_another_project() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store.create_project("Cloud", None).unwrap();

    let impostor = format!("{}/Cloud", elsewhere.as_str());
    std::fs::create_dir_all(&impostor).unwrap();
    assert_eq!(
        store.link_project(&impostor).unwrap(),
        Err(LinkRefusal::NameExists)
    );

    let dotted = format!("{}/.hidden", elsewhere.as_str());
    std::fs::create_dir_all(&dotted).unwrap();
    assert_eq!(
        store.link_project(&dotted).unwrap(),
        Err(LinkRefusal::InvalidName)
    );

    assert_eq!(
        store
            .link_project(&format!("{}/nowhere", elsewhere.as_str()))
            .unwrap(),
        Err(LinkRefusal::SourceMissing)
    );
}

#[test]
fn renaming_a_project_moves_its_directory_and_its_registry_entry() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();
    store
        .save_document("Cloud", "Chapter One", &body(json!([1]), json!([])), None)
        .unwrap();

    assert_eq!(
        store.rename_project("Cloud", "Novel").unwrap().as_deref(),
        Some("Novel")
    );
    assert_eq!(
        store.project_root("Novel"),
        format!("{}/Novel", elsewhere.as_str())
    );
    assert_eq!(
        store
            .load_document("Novel", "Chapter One")
            .unwrap()
            .unwrap()["content"],
        json!([1])
    );

    // A name already in use, and a project that is not there. The name is checked
    // wherever it lives: "Taken" is in AppData and "Novel" is not, and the JS would
    // have allowed this rename and stranded the AppData project behind it.
    store.create_project("Taken", None).unwrap();
    assert!(store.rename_project("Novel", "Taken").unwrap().is_none());
    assert_eq!(
        store.project_root("Taken"),
        format!("{}/Taken", app_data.as_str())
    );
    assert!(store.rename_project("Missing", "Other").unwrap().is_none());
    // Renaming to the same name is a no-op success.
    assert_eq!(
        store.rename_project("Novel", "Novel").unwrap().as_deref(),
        Some("Novel")
    );
}

#[test]
fn moving_a_project_back_into_appdata_drops_its_registry_entry() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();
    store
        .save_document("Cloud", "Chapter One", &body(json!([1]), json!([])), None)
        .unwrap();

    let root = store
        .move_project("Cloud", app_data.as_str())
        .unwrap()
        .unwrap();
    assert_eq!(root, format!("{}/Cloud", app_data.as_str()));
    assert!(store.locations.get("Cloud").is_none());
    assert_eq!(
        store
            .load_document("Cloud", "Chapter One")
            .unwrap()
            .unwrap()["content"],
        json!([1])
    );

    // Moving somewhere already occupied is refused, and moving nowhere is a no-op.
    std::fs::create_dir_all(format!("{}/Cloud", elsewhere.as_str())).unwrap();
    assert_eq!(
        store.move_project("Cloud", elsewhere.as_str()).unwrap(),
        Err(LinkRefusal::TargetExists)
    );
    assert_eq!(
        store
            .move_project("Cloud", app_data.as_str())
            .unwrap()
            .unwrap(),
        format!("{}/Cloud", app_data.as_str())
    );
}

#[test]
fn deleting_a_project_takes_its_directory_and_its_registry_entry() {
    let app_data = TempDir::new();
    let elsewhere = TempDir::new();
    let store = store(&app_data);
    store
        .create_project("Cloud", Some(elsewhere.as_str()))
        .unwrap();

    store.delete_project("Cloud").unwrap();
    assert!(!PathBuf::from(format!("{}/Cloud", elsewhere.as_str())).exists());
    assert!(store.list_projects().is_empty());
    // And again, on a project that is already gone.
    store.delete_project("Cloud").unwrap();
}

#[test]
fn an_autosave_keeps_a_document_locked() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    store
        .write_document_raw(
            "Novel",
            "Chapter One",
            &json!({ "content": [1], "notes": [], "locked": true }),
        )
        .unwrap();
    let version = VersionRequest {
        content_html: Some("<p>2</p>".into()),
        content_json: None,
        name: None,
        auto: true,
    };
    store
        .save_document(
            "Novel",
            "Chapter One",
            &body(json!([2]), json!([{ "id": "n" }])),
            Some(version),
        )
        .unwrap();

    let document = store
        .load_document("Novel", "Chapter One")
        .unwrap()
        .unwrap();
    assert_eq!(document["notes"], json!([{ "id": "n" }]));
    assert_eq!(document["locked"], json!(true));
}

#[test]
fn locked_entries_finds_flagged_documents_and_marked_folders() {
    let app_data = TempDir::new();
    let store = store(&app_data);
    store.create_project("Novel", None).unwrap();

    store
        .write_document_raw("Novel", "Open", &json!({ "content": [], "notes": [] }))
        .unwrap();
    store
        .write_document_raw(
            "Novel",
            "Shut",
            &json!({ "content": [], "notes": [], "locked": true }),
        )
        .unwrap();
    store
        .write_document_raw("Novel", "Odd", &json!({ "content": [], "locked": "yes" }))
        .unwrap();
    store
        .write_document_raw(
            "Novel",
            "Drafts/Board.canvas",
            &json!({ "nodes": [], "edges": [], "locked": true }),
        )
        .unwrap();
    let root = store.project_root("Novel");
    std::fs::write(
        format!("{root}/Drafts/{}", paths::FOLDER_FILE),
        r#"{"locked":true}"#,
    )
    .unwrap();

    let found = store.locked_entries("Novel");
    assert_eq!(
        found.documents,
        vec!["Drafts/Board.canvas".to_string(), "Shut".to_string()]
    );
    assert_eq!(found.folders, vec!["Drafts".to_string()]);
}
