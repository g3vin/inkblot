//! The search engine behind the right sidebar's search bar.
//!
//! The sidebar has one search bar, shared by every panel, that expands into a full
//! search surface. This holds everything about that search which is not React: how a
//! query becomes a matcher ([`matcher`]), how the scopes are searched, and what the bar
//! recommends when the query is empty.
//!
//! Mirrors `src/lib/sidebarSearch.js` and `src/lib/canvasSearch.js`.
//!
//! **`collectEditorMatches` stays in JS.** It walks a live ProseMirror document, which
//! only exists inside the webview. Its saved-document twin,
//! [`collect_matches_from_doc_json`], is here — and it is the one that has to be right,
//! because it is what searches the documents nobody has open.
//!
//! **Recent searches stay in JS too.** They live in `localStorage`, and moving that to
//! disk is its own item in the migration.

pub mod matcher;

use serde_json::Value;

use crate::doc_kind::{is_canvas_doc, is_map_doc};
use crate::js_string::{js_trim, utf16_len, utf16_slice};
use crate::store::{ProjectStore, StoreError};
use crate::types::{SearchResult, SearchResultType, SearchScope, SearchScopeInfo};
use matcher::Matcher;

pub const MAX_RESULTS_PER_DOCUMENT: usize = 24;
pub const MAX_PROJECT_RESULTS: usize = 120;
pub const MAX_RECENT_SEARCHES: usize = 6;

const PREVIEW_RADIUS: usize = 34;

/// The scopes, in the order they appear in the bar.
pub fn search_scopes() -> Vec<SearchScopeInfo> {
    let scope = |value, label: &str, hint: &str| SearchScopeInfo {
        value,
        label: label.to_string(),
        hint: hint.to_string(),
    };
    vec![
        scope(SearchScope::Panel, "This panel", "Filter what is on screen"),
        scope(SearchScope::Document, "Document", "Find and replace in the open document"),
        scope(SearchScope::Notes, "Notes", "Every note in the project"),
        scope(SearchScope::Files, "Files", "File and folder names"),
        scope(SearchScope::Project, "All documents", "Full text of every document"),
    ]
}

pub fn is_filter_scope(scope: SearchScope) -> bool {
    scope == SearchScope::Panel
}

/// The text around a match, trimmed. Offsets are UTF-16 units, as everywhere here.
pub fn build_preview(text: &str, from: usize, to: usize, radius: usize) -> String {
    let start = from.saturating_sub(radius);
    let end = (to + radius).min(utf16_len(text));
    js_trim(utf16_slice(text, start, end)).to_string()
}

/// The last segment of a path, or the whole path when it has none.
pub fn get_entry_label(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .unwrap_or(path)
        .to_string()
}

/* ---- saved-document matching ---------------------------------------------- */

/// ProseMirror's size rule over raw document JSON: a text node counts its length, any
/// other node adds 2 for its open and close tokens.
///
/// This is what lets a document that is saved but not open be searched without
/// instantiating an editor — and why the positions it reports can be handed straight to
/// the editor when the user clicks a result.
fn json_node_size(node: &Value, is_root: bool) -> usize {
    if node.is_null() {
        return 0;
    }
    if node["type"] == "text" {
        return utf16_len(node["text"].as_str().unwrap_or(""));
    }

    let children = node["content"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let child_size: usize = children.iter().map(|child| json_node_size(child, false)).sum();

    if children.is_empty() {
        return 1;
    }
    if is_root {
        child_size
    } else {
        child_size + 2
    }
}

fn walk_json_text_nodes(node: &Value, pos: usize, is_root: bool, visit: &mut impl FnMut(&str, usize)) {
    if node.is_null() {
        return;
    }

    if node["type"] == "text" {
        if let Some(text) = node["text"].as_str() {
            visit(text, pos);
        }
        return;
    }

    let children = node["content"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let mut child_pos = if is_root { pos } else { pos + 1 };

    for child in children {
        walk_json_text_nodes(child, child_pos, false, visit);
        child_pos += json_node_size(child, false);
    }
}

/// Matches in a saved document's JSON, with document positions and previews.
pub fn collect_matches_from_doc_json(
    content: &Value,
    matcher: &Matcher,
    doc_name: &str,
) -> Vec<SearchResult> {
    if content.is_null() || matcher.is_empty || !matcher.valid {
        return Vec::new();
    }

    let root = if content["type"] == "doc" {
        content.clone()
    } else {
        serde_json::json!({
            "type": "doc",
            "content": content["content"].as_array().cloned().unwrap_or_default(),
        })
    };

    let mut matches: Vec<SearchResult> = Vec::new();
    walk_json_text_nodes(&root, 0, true, &mut |text, pos| {
        if matches.len() >= MAX_RESULTS_PER_DOCUMENT {
            return;
        }
        let remaining = MAX_RESULTS_PER_DOCUMENT - matches.len();

        for hit in matcher.find_all(text, remaining) {
            matches.push(SearchResult {
                id: format!("{doc_name}-{}-{}", pos + hit.index, matches.len()),
                result_type: SearchResultType::ProjectMatch,
                doc_name: doc_name.to_string(),
                title: get_entry_label(doc_name),
                path: doc_name.to_string(),
                preview: build_preview(text, hit.index, hit.index + hit.length, PREVIEW_RADIUS),
                from: Some((pos + hit.index) as u32),
                to: Some((pos + hit.index + hit.length) as u32),
                match_text: Some(hit.text),
                node_id: None,
                note: None,
            });
        }
    });

    matches
}

/* ---- canvases -------------------------------------------------------------- */

/// First line of a card, which is what identifies it in a list of results.
fn title_of(text: &str, fallback: &str) -> String {
    let first_line = text.split('\n').map(str::trim).find(|line| !line.is_empty());
    match first_line {
        None => fallback.to_string(),
        Some(line) if utf16_len(line) > 60 => format!("{}…", utf16_slice(line, 0, 60)),
        Some(line) => line.to_string(),
    }
}

/// Every match in a canvas's raw (on-disk) JSON.
///
/// A canvas has no ProseMirror positions: its text lives in independent cards, so a hit
/// is addressed by NODE ID, and revealing it means selecting and centering that node
/// rather than placing a caret.
///
/// It reads `node.text` — the plain-text projection the JSON Canvas spec asks every card
/// to carry — not `node.inkblotTipTap`. That keeps this a pure string walk and means a
/// canvas authored in Obsidian is searchable too.
pub fn collect_canvas_matches(
    raw: &Value,
    matcher: &Matcher,
    doc_path: &str,
    limit: usize,
) -> Vec<SearchResult> {
    if raw.is_null() || matcher.is_empty || !matcher.valid {
        return Vec::new();
    }

    let mut matches: Vec<SearchResult> = Vec::new();

    let scan = |text: &str, node_id: &str, title: String, matches: &mut Vec<SearchResult>| {
        if text.is_empty() || matches.len() >= limit {
            return;
        }
        let remaining = limit - matches.len();

        for hit in matcher.find_all(text, remaining) {
            matches.push(SearchResult {
                id: format!("{doc_path}-{node_id}-{}", hit.index),
                result_type: SearchResultType::CanvasMatch,
                doc_name: doc_path.to_string(),
                path: doc_path.to_string(),
                node_id: Some(node_id.to_string()),
                title: title.clone(),
                preview: build_preview(text, hit.index, hit.index + hit.length, PREVIEW_RADIUS),
                match_text: Some(hit.text),
                from: None,
                to: None,
                note: None,
            });
        }
    };

    for node in raw["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        if matches.len() >= limit {
            break;
        }
        let Some(id) = node["id"].as_str().filter(|id| !id.is_empty()) else { continue };
        let node_type = node["type"].as_str().unwrap_or("");

        if node_type == "group" {
            let label = node["label"].as_str().unwrap_or("");
            let title = if label.is_empty() { "Group".to_string() } else { label.to_string() };
            scan(label, id, title, &mut matches);
            continue;
        }

        if node_type == "file" {
            // The path is the only text a file card has of its own; its document's
            // contents are searched under that document's own entry in the file list.
            let file = node["file"].as_str().unwrap_or("");
            let title = if file.is_empty() { "File".to_string() } else { file.to_string() };
            scan(file, id, title, &mut matches);
            continue;
        }

        let text = node["text"].as_str().unwrap_or("");
        let title = title_of(text, "Card");
        scan(text, id, title, &mut matches);
    }

    for edge in raw["edges"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        if matches.len() >= limit {
            break;
        }
        if edge["id"].as_str().filter(|id| !id.is_empty()).is_none() {
            continue;
        }
        // An edge label is revealed by centering the node it leaves from — an edge has
        // no position of its own, and its endpoints are the only thing selectable.
        let label = edge["label"].as_str().unwrap_or("");
        let title = if label.is_empty() { "Arrow".to_string() } else { label.to_string() };
        let from_node = edge["fromNode"].as_str().unwrap_or("").to_string();
        scan(label, &from_node, title, &mut matches);
    }

    matches
}

/* ---- maps ------------------------------------------------------------------ */

/// What each searchable collection on a map is called, which key holds its text, the
/// key to fall back to when that is empty, and the title a nameless one gets.
const MAP_SEARCH_FIELDS: [(&str, &str, Option<&str>, &str); 5] = [
    ("pins", "name", Some("doc"), "Place"),
    ("routes", "name", None, "Route"),
    ("regions", "name", None, "Region"),
    ("labels", "text", None, "Label"),
    ("travelers", "name", Some("doc"), "Traveler"),
];

/// Every match in a map's raw (on-disk) JSON, addressed by the id of the item that
/// carries the text. A pin or traveler with no name of its own is searched by the
/// path of the doc it links to — that is the name it shows.
pub fn collect_map_matches(raw: &Value, matcher: &Matcher, doc_path: &str, limit: usize) -> Vec<SearchResult> {
    if raw.is_null() || matcher.is_empty || !matcher.valid {
        return Vec::new();
    }
    let mut matches: Vec<SearchResult> = Vec::new();

    for (collection, key, fallback, nameless) in MAP_SEARCH_FIELDS {
        for item in raw[collection].as_array().map(Vec::as_slice).unwrap_or(&[]) {
            if matches.len() >= limit {
                return matches;
            }
            let Some(id) = item["id"].as_str().filter(|id| !id.is_empty()) else { continue };
            let own = item[key].as_str().unwrap_or("");
            let text = match fallback {
                Some(fallback) if own.is_empty() => item[fallback].as_str().unwrap_or(""),
                _ => own,
            };
            if text.is_empty() {
                continue;
            }
            let title = title_of(text, nameless);
            let remaining = limit - matches.len();
            for hit in matcher.find_all(text, remaining) {
                matches.push(SearchResult {
                    id: format!("{doc_path}-{id}-{}", hit.index),
                    result_type: SearchResultType::MapMatch,
                    doc_name: doc_path.to_string(),
                    path: doc_path.to_string(),
                    node_id: Some(id.to_string()),
                    title: title.clone(),
                    preview: build_preview(text, hit.index, hit.index + hit.length, PREVIEW_RADIUS),
                    match_text: Some(hit.text),
                    from: None,
                    to: None,
                    note: None,
                });
            }
        }
    }

    matches
}

/* ---- the project scopes ---------------------------------------------------- */

/// A file entry in the project tree: its tree path and its display name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFile {
    pub path: String,
    pub name: String,
}

pub fn flatten_project_files(node: &crate::types::TreeNode) -> Vec<ProjectFile> {
    let mut files = Vec::new();
    collect_files(node, &mut files);
    files
}

fn collect_files(node: &crate::types::TreeNode, files: &mut Vec<ProjectFile>) {
    if node.node_type == crate::types::TreeNodeType::File {
        files.push(ProjectFile { path: node.path.clone(), name: node.name.clone() });
        return;
    }
    for child in node.children.iter().flatten() {
        collect_files(child, files);
    }
}

fn build_note_preview(note: &Value, matcher: &Matcher) -> String {
    let parts: Vec<&str> = [note["anchor"].as_str().unwrap_or(""), note["content"].as_str().unwrap_or("")]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
    let combined = parts.join(" — ");

    match matcher.find_all(&combined, 1).first() {
        None if combined.is_empty() => "Untitled note".to_string(),
        None => combined,
        Some(hit) => {
            build_preview(&combined, hit.index, hit.index + hit.length, PREVIEW_RADIUS)
        }
    }
}

/// Search a project for the `notes`, `files` and `project` scopes.
///
/// `live_doc` lets the caller supply the unsaved contents of a document that is open in
/// an editor; everything else is read from the store. The JS injects `listProjectTree`
/// and `loadDocument` for the same reason, but here the store is already an argument.
pub fn search_project(
    store: &ProjectStore,
    project_name: &str,
    scope: SearchScope,
    matcher: &Matcher,
    live_doc: impl Fn(&str) -> Option<Value>,
    is_cancelled: impl Fn() -> bool,
) -> Result<Vec<SearchResult>, StoreError> {
    if project_name.is_empty() || matcher.is_empty || !matcher.valid {
        return Ok(Vec::new());
    }

    let tree = store.list_project_tree(project_name);
    if is_cancelled() {
        return Ok(Vec::new());
    }
    let file_entries = flatten_project_files(&tree);

    if scope == SearchScope::Files {
        return Ok(file_entries
            .iter()
            .filter(|entry| matcher.test(&entry.path))
            .enumerate()
            .map(|(index, entry)| SearchResult {
                id: format!("file-{}-{index}", entry.path),
                result_type: SearchResultType::FileEntry,
                doc_name: entry.path.clone(),
                title: entry.name.clone(),
                path: entry.path.clone(),
                preview: entry.path.clone(),
                from: None,
                to: None,
                match_text: None,
                node_id: None,
                note: None,
            })
            .take(MAX_PROJECT_RESULTS)
            .collect());
    }

    let mut results: Vec<SearchResult> = Vec::new();

    for entry in &file_entries {
        if results.len() >= MAX_PROJECT_RESULTS {
            break;
        }

        // A canvas has no live editor to read and no notes — its text lives in cards,
        // addressed by node id rather than by document position. Without this branch
        // collect_matches_from_doc_json would coerce it to an empty doc and it would
        // silently never match.
        if is_canvas_doc(&entry.path) {
            if scope == SearchScope::Notes {
                continue;
            }
            let Some(canvas) = store.load_document(project_name, &entry.path)? else { continue };
            if is_cancelled() {
                return Ok(Vec::new());
            }
            results.extend(collect_canvas_matches(
                &canvas,
                matcher,
                &entry.path,
                MAX_RESULTS_PER_DOCUMENT,
            ));
            continue;
        }

        // A map is the same: no notes, and its text is addressed by item id.
        if is_map_doc(&entry.path) {
            if scope == SearchScope::Notes {
                continue;
            }
            let Some(map) = store.load_document(project_name, &entry.path)? else { continue };
            if is_cancelled() {
                return Ok(Vec::new());
            }
            results.extend(collect_map_matches(&map, matcher, &entry.path, MAX_RESULTS_PER_DOCUMENT));
            continue;
        }

        let document = match live_doc(&entry.path) {
            Some(document) => Some(document),
            None => store.load_document(project_name, &entry.path)?,
        };
        if is_cancelled() {
            return Ok(Vec::new());
        }
        let Some(document) = document else { continue };

        if scope == SearchScope::Notes {
            let notes = document["notes"].as_array().cloned().unwrap_or_default();
            for (index, note) in notes.iter().enumerate() {
                let anchor = note["anchor"].as_str().unwrap_or("");
                let content = note["content"].as_str().unwrap_or("");
                if !matcher.test(anchor) && !matcher.test(content) {
                    continue;
                }
                let note_id = note["id"].as_str().map(str::to_string).unwrap_or(index.to_string());
                results.push(SearchResult {
                    id: format!("note-{}-{note_id}", entry.path),
                    result_type: SearchResultType::NoteMatch,
                    doc_name: entry.path.clone(),
                    title: if anchor.is_empty() {
                        get_entry_label(&entry.path)
                    } else {
                        anchor.to_string()
                    },
                    path: entry.path.clone(),
                    preview: build_note_preview(note, matcher),
                    note: Some(note.clone()),
                    from: None,
                    to: None,
                    match_text: None,
                    node_id: None,
                });
            }
        } else {
            results.extend(collect_matches_from_doc_json(&document["content"], matcher, &entry.path));
        }
    }

    results.truncate(MAX_PROJECT_RESULTS);
    Ok(results)
}

/* ---- what the bar says ----------------------------------------------------- */

/// What each panel's own filter is actually filtering, for the bar's placeholder.
pub fn get_panel_noun(tab: &str) -> &'static str {
    match tab {
        "clipboard" => "clipboard entries",
        "workbench" => "tiles",
        "notes" => "notes on this document",
        "history" => "versions",
        _ => "this panel",
    }
}

pub fn get_search_placeholder(scope: SearchScope, tab: &str) -> String {
    if is_filter_scope(scope) {
        return format!("Filter {}", get_panel_noun(tab));
    }
    let label = search_scopes()
        .into_iter()
        .find(|info| info.value == scope)
        .map(|info| info.label)
        .unwrap_or_default();
    format!("Search {}", label.to_lowercase())
}

/// Scope suggestions shown while the query is empty, with the one most relevant to the
/// panel you are on promoted to the top (Notes while on the Notes panel).
pub fn get_recommended_scopes(tab: &str) -> Vec<SearchScopeInfo> {
    let mut order = Vec::new();
    if tab == "notes" {
        order.push(SearchScope::Notes);
    }
    for scope in
        [SearchScope::Document, SearchScope::Project, SearchScope::Notes, SearchScope::Files]
    {
        if !order.contains(&scope) {
            order.push(scope);
        }
    }

    let scopes = search_scopes();
    order
        .into_iter()
        .filter_map(|value| scopes.iter().find(|info| info.value == value).cloned())
        .collect()
}

#[cfg(test)]
mod tests {
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
                &DocumentBody { content: doc("the quick brown fox"), notes: json!([]) },
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
        assert!(!results.iter().any(|result| result.path.ends_with(".canvas")));
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
        let results =
            search_project(&store, "Novel", SearchScope::Project, &matcher("rewritten"), live, || false)
                .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "Chapter One");

        // And the saved text is no longer found, because it is not what is on screen.
        let results =
            search_project(&store, "Novel", SearchScope::Project, &matcher("brown"), live, || false)
                .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn a_cancelled_search_returns_nothing_rather_than_a_partial_answer() {
        let app_data = TempDir::new();
        let store = populated(&app_data);
        let results =
            search_project(&store, "Novel", SearchScope::Project, &matcher("quick"), |_| None, || true)
                .unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn an_empty_or_broken_query_searches_nothing() {
        let app_data = TempDir::new();
        let store = populated(&app_data);
        assert!(search(&store, SearchScope::Project, "").is_empty());

        let broken = Matcher::new("foo(", MatcherOptions { use_regex: true, ..Default::default() });
        assert!(search_project(&store, "Novel", SearchScope::Project, &broken, |_| None, || false)
            .unwrap()
            .is_empty());
    }
}
