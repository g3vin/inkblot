//! Resolving names and tree paths to places on disk. Pure string arithmetic.
//!
//! Every filesystem call in this crate uses an absolute path, and every one of those
//! is built here. Tree paths are relative, forward-slashed, and carry no extension —
//! `filePathFor` is what appends `.json`, which is why a canvas keeps its `.canvas`
//! suffix all the way through save, load, rename, move and delete.
//!
//! Mirrors `src/lib/projectPaths.ts`; `npm run parity` asserts the two agree.

use crate::doc_kind::CANVAS_SUFFIX;

/// The file tree's stored sort order. Reserved, and never written: the order is
/// machine-local, kept in the preference store (see `store::preferences`).
pub const ORDER_FILE: &str = ".inkblot-order.json";
/// Inside a folder: `{ "locked": true }` when the writer has locked it (`docLocks.ts`).
pub const FOLDER_FILE: &str = ".inkblot-folder.json";

pub const CANVAS_SUFFIX_LENGTH: usize = CANVAS_SUFFIX.len();

/// Where the project-name → absolute-directory registry lives, inside AppData.
pub const LOCATIONS_FILE: &str = ".inkblot-project-locations.json";

pub fn strip_trailing_slash(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
}

pub fn strip_leading_slash(path: &str) -> &str {
    path.trim_start_matches(['/', '\\'])
}

/// Join parts with exactly one separator between them. Empty parts are dropped, so
/// `join_path(&[root, "", "a"])` is `root/a` rather than `root//a`.
pub fn join_path(parts: &[&str]) -> String {
    let mut joined: Vec<&str> = Vec::new();
    for (index, part) in parts.iter().filter(|part| !part.is_empty()).enumerate() {
        joined.push(if index == 0 {
            strip_trailing_slash(part)
        } else {
            strip_leading_slash(strip_trailing_slash(part))
        });
    }
    joined.join("/")
}

/// The folder holding `abs_path` (a trailing slash ignored); "" at the root.
pub fn parent_of(abs_path: &str) -> String {
    let trimmed = strip_trailing_slash(abs_path);
    let mut segments: Vec<&str> = trimmed.split('/').collect();
    segments.pop();
    segments.join("/")
}

/// Normalize a tree path: callers pass them loosely.
///
/// **This collapses only the FIRST run of slashes**, because the JS regex has no `g`
/// flag (`projectPaths.ts`). `a//b//c` normalizes to `a/b//c`. That is almost
/// certainly not what was intended, but it decides file names on disk — a document
/// saved under the doubled path is only findable under the doubled path — so it is
/// reproduced rather than fixed. Changing it is a migration, not a cleanup.
pub fn normalize_path(path: &str) -> String {
    let collapsed = match path.find('/') {
        Some(start) => {
            let run_end = path[start..]
                .find(|c| c != '/')
                .map_or(path.len(), |o| start + o);
            format!("{}/{}", &path[..start], &path[run_end..])
        }
        None => path.to_string(),
    };
    collapsed
        .strip_prefix('/')
        .unwrap_or(&collapsed)
        .to_string()
}

/// The document file for a tree path: `<root>/<path>.json`.
pub fn file_path_for(root: &str, entry_path: &str) -> String {
    let rel = normalize_path(entry_path);
    if rel.is_empty() {
        format!("{root}.json")
    } else {
        join_path(&[root, &format!("{rel}.json")])
    }
}

/// The folder for a tree path. An empty path is the project root itself.
pub fn folder_path_for(root: &str, entry_path: &str) -> String {
    let rel = normalize_path(entry_path);
    if rel.is_empty() {
        root.to_string()
    } else {
        join_path(&[root, &rel])
    }
}

/// A document's version sidecar: `<root>/.versions/<path>.versions.json`.
pub fn versions_sidecar_path(root: &str, doc_name: &str) -> String {
    let rel = normalize_path(doc_name);
    let name = if rel.is_empty() { doc_name } else { &rel };
    join_path(&[root, ".versions", &format!("{name}.versions.json")])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_collapses_exactly_one_separator() {
        assert_eq!(join_path(&["/root/", "/a/", "b"]), "/root/a/b");
        assert_eq!(join_path(&["/root", "", "b"]), "/root/b");
        assert_eq!(join_path(&["/root"]), "/root");
        assert_eq!(join_path(&[]), "");
    }

    #[test]
    fn normalize_collapses_only_the_first_run() {
        // The documented JS quirk, reproduced deliberately.
        assert_eq!(normalize_path("a//b//c"), "a/b//c");
        assert_eq!(normalize_path("/a/b"), "a/b");
        assert_eq!(normalize_path("//a"), "a");
        assert_eq!(normalize_path(""), "");
    }

    #[test]
    fn a_canvas_keeps_its_suffix_through_the_path_mapping() {
        assert_eq!(
            file_path_for("/p", "Notes/board.canvas"),
            "/p/Notes/board.canvas.json"
        );
        assert_eq!(folder_path_for("/p", "Notes"), "/p/Notes");
        assert_eq!(folder_path_for("/p", ""), "/p");
        assert_eq!(
            versions_sidecar_path("/p", "Notes/board.canvas"),
            "/p/.versions/Notes/board.canvas.versions.json"
        );
    }
}
