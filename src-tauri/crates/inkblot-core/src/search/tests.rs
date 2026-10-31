use serde_json::json;

use super::matcher::MatcherOptions;
use super::*;
use crate::store::DocumentBody;

/// The store's own tests own the temp-directory helper; this needs one too, and a
/// second six-line copy beats exporting test scaffolding from a module.
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "inkblot-search-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn doc(text: &str) -> serde_json::Value {
    json!({ "type": "doc", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": text }] },
    ] })
}

/// A project with one of everything the scopes have to tell apart.
fn populated(app_data: &TempDir) -> ProjectStore {
    let store = ProjectStore::new(app_data.0.to_str().unwrap(), "test-session");
    store.create_project("Novel", None).unwrap();
    store.create_folder("Novel", "Characters").unwrap();

    store
        .save_document(
            "Novel",
            "Chapter One",
            &DocumentBody {
                content: doc("the quick brown fox"),
                notes: json!([]),
            },
            None,
        )
        .unwrap();
    store
        .save_document(
            "Novel",
            "Characters/Ada",
            &DocumentBody {
                content: doc("a mathematician"),
                notes: json!([
                    { "id": "n1", "anchor": "the quick", "content": "check this" },
                    { "id": "n2", "anchor": "", "content": "nothing to see" },
                ]),
            },
            None,
        )
        .unwrap();
    store
        .write_document_raw(
            "Novel",
            "Board.canvas",
            &json!({
                "type": "canvas",
                "nodes": [{ "id": "card", "type": "text", "text": "the quick sketch" }],
                "edges": [],
            }),
        )
        .unwrap();

    store
}

fn matcher(query: &str) -> Matcher {
    Matcher::new(query, MatcherOptions::default())
}

fn search(store: &ProjectStore, scope: SearchScope, query: &str) -> Vec<SearchResult> {
    search_project(store, "Novel", scope, &matcher(query), |_| None, || false).unwrap()
}

#[test]
fn the_project_scope_reaches_documents_and_canvases_but_not_notes() {
    let app_data = TempDir::new();
    let store = populated(&app_data);

    let results = search(&store, SearchScope::Project, "quick");
    let paths: Vec<&str> = results.iter().map(|result| result.path.as_str()).collect();
    assert_eq!(paths, ["Board.canvas", "Chapter One"]);
    // The canvas hit is addressed by node, the document hit by position.
    assert_eq!(results[0].node_id.as_deref(), Some("card"));
    assert!(results[0].from.is_none());
    // Position 5: the paragraph opens at 0, its text starts at 1, and "quick" is
    // four characters into "the quick brown fox".
    assert_eq!(results[1].from, Some(5));
}

#[test]
fn the_notes_scope_skips_canvases_entirely() {
    let app_data = TempDir::new();
    let store = populated(&app_data);

    let results = search(&store, SearchScope::Notes, "quick");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].result_type, SearchResultType::NoteMatch);
    assert_eq!(results[0].title, "the quick");
    // A canvas has no notes, and must not be coerced into an empty document.
    assert!(!results
        .iter()
        .any(|result| result.path.ends_with(".canvas")));
}

#[test]
fn the_files_scope_matches_paths_rather_than_contents() {
    let app_data = TempDir::new();
    let store = populated(&app_data);

    let results = search(&store, SearchScope::Files, "Ada");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].result_type, SearchResultType::FileEntry);
    assert_eq!(results[0].path, "Characters/Ada");
    // "quick" is in a document, not in any path.
    assert!(search(&store, SearchScope::Files, "quick").is_empty());
}

#[test]
fn an_open_documents_unsaved_text_is_searched_instead_of_the_saved_copy() {
    let app_data = TempDir::new();
    let store = populated(&app_data);

    let live = |path: &str| {
        (path == "Chapter One").then(|| json!({ "content": doc("a rewritten sentence") }))
    };
    let results = search_project(
        &store,
        "Novel",
        SearchScope::Project,
        &matcher("rewritten"),
        live,
        || false,
    )
    .unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].path, "Chapter One");

    // And the saved text is no longer found, because it is not what is on screen.
    let results = search_project(
        &store,
        "Novel",
        SearchScope::Project,
        &matcher("brown"),
        live,
        || false,
    )
    .unwrap();
    assert!(results.is_empty());
}

#[test]
fn a_cancelled_search_returns_nothing_rather_than_a_partial_answer() {
    let app_data = TempDir::new();
    let store = populated(&app_data);
    let results = search_project(
        &store,
        "Novel",
        SearchScope::Project,
        &matcher("quick"),
        |_| None,
        || true,
    )
    .unwrap();
    assert!(results.is_empty());
}

#[test]
fn an_empty_or_broken_query_searches_nothing() {
    let app_data = TempDir::new();
    let store = populated(&app_data);
    assert!(search(&store, SearchScope::Project, "").is_empty());

    let broken = Matcher::new(
        "foo(",
        MatcherOptions {
            use_regex: true,
            ..Default::default()
        },
    );
    assert!(search_project(
        &store,
        "Novel",
        SearchScope::Project,
        &broken,
        |_| None,
        || false
    )
    .unwrap()
    .is_empty());
}
