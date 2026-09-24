//! Building and capping a document's version list. Pure; the I/O is in `mod.rs`.
//!
//! Mirrors the pure half of `src/lib/versionStore.js`; `npm run parity` asserts the
//! two agree.

use crate::types::{CanvasFile, VersionEntry, VersionKind, VERSION_CAP};
use crate::version_history::{count_canvas_words, count_words};

/// A user-given name. An empty string is not one — JS tests `entry.name` for truth.
fn is_named(entry: &VersionEntry) -> bool {
    entry.name.as_deref().is_some_and(|name| !name.is_empty())
}

/// What a new entry needs from its caller. `id` and `timestamp` are stamped by the
/// store, because they come from the clock and the clock is not ours to fake here.
pub struct NewTextVersion {
    pub id: String,
    pub timestamp: String,
    pub session_id: String,
    pub content_html: Option<String>,
    pub content_json: Option<crate::types::JsonValue>,
    pub name: Option<String>,
    pub auto: bool,
}

/// A version entry for a text document, stamped with session and word count.
pub fn build_text_version_entry(new_version: NewTextVersion) -> VersionEntry {
    VersionEntry {
        id: new_version.id,
        timestamp: new_version.timestamp,
        kind: VersionKind::Text,
        name: new_version.name.filter(|name| !name.is_empty()),
        auto: new_version.auto,
        session_id: Some(new_version.session_id),
        words: Some(count_words(
            new_version.content_html.as_deref().unwrap_or(""),
            true,
        )),
        content_html: new_version.content_html,
        content_json: new_version.content_json,
        canvas: None,
        map: None,
    }
}

/// A version entry holding a full serialized canvas.
pub fn build_canvas_version_entry(
    id: String,
    timestamp: String,
    session_id: String,
    canvas: CanvasFile,
    name: Option<String>,
    auto: bool,
) -> VersionEntry {
    VersionEntry {
        id,
        timestamp,
        kind: VersionKind::Canvas,
        name: name.filter(|name| !name.is_empty()),
        auto,
        session_id: Some(session_id),
        words: Some(count_canvas_words(&canvas)),
        content_html: None,
        content_json: None,
        canvas: Some(canvas),
        map: None,
    }
}

/// A version entry holding a full serialized map.
pub fn build_map_version_entry(
    id: String,
    timestamp: String,
    session_id: String,
    map: crate::types::JsonValue,
    name: Option<String>,
    auto: bool,
) -> VersionEntry {
    VersionEntry {
        id,
        timestamp,
        kind: VersionKind::Map,
        name: name.filter(|name| !name.is_empty()),
        auto,
        session_id: Some(session_id),
        words: Some(crate::map::model::count_map_words(&map)),
        content_html: None,
        content_json: None,
        canvas: None,
        map: Some(map),
    }
}

/// A map with the parts that are where you looked, not what you made, taken out.
fn map_content(entry: &VersionEntry) -> Option<crate::types::JsonValue> {
    let mut map = entry.map.clone()?;
    if let Some(object) = map.as_object_mut() {
        object.remove("viewport");
    }
    Some(map)
}

/// Two entries hold the same document state (viewport and metadata aside).
///
/// JS compares `JSON.stringify` of the nodes and edges; this compares the parsed
/// values, so two canvases differing only in the key order of an unknown key are the
/// same state here and different states there. Same trade as `diff_canvases`.
pub fn same_version_content(a: &VersionEntry, b: &VersionEntry) -> bool {
    if a.map.is_some() || b.map.is_some() {
        return map_content(a) == map_content(b);
    }
    if a.canvas.is_some() || b.canvas.is_some() {
        let parts = |entry: &VersionEntry| {
            entry
                .canvas
                .as_ref()
                .map(|canvas| (canvas.nodes.clone(), canvas.edges.clone()))
        };
        return parts(a) == parts(b);
    }
    a.content_html
        .as_deref()
        .is_some_and(|html| !html.is_empty())
        && a.content_html == b.content_html
}

/// Push `entry` onto a newest-first version list.
///
/// Consecutive duplicates fold away: naming a state identical to the latest checkpoint
/// names that checkpoint instead of stacking a twin on top of it. The cap only ever
/// evicts unnamed entries — a named version is a landmark the user placed deliberately.
pub fn push_version_entry(versions: &[VersionEntry], entry: VersionEntry) -> Vec<VersionEntry> {
    let mut next = versions.to_vec();

    if let Some(latest) = next.first() {
        if same_version_content(latest, &entry) {
            if is_named(&entry) && !is_named(latest) {
                let mut renamed = latest.clone();
                renamed.name = entry.name;
                renamed.auto = false;
                next[0] = renamed;
                return next;
            }
            if !is_named(&entry) {
                return next;
            }
        }
    }

    next.insert(0, entry);

    let mut unnamed = next.iter().filter(|entry| !is_named(entry)).count();
    let mut index = next.len();
    while index > 0 && unnamed > VERSION_CAP {
        index -= 1;
        if !is_named(&next[index]) {
            next.remove(index);
            unnamed -= 1;
        }
    }

    next
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_entry(id: &str, html: &str, name: Option<&str>) -> VersionEntry {
        build_text_version_entry(NewTextVersion {
            id: id.to_string(),
            timestamp: "2026-01-01T00:00:00.000Z".to_string(),
            session_id: "s".to_string(),
            content_html: Some(html.to_string()),
            content_json: None,
            name: name.map(str::to_string),
            auto: name.is_none(),
        })
    }

    #[test]
    fn naming_an_unchanged_state_names_the_checkpoint_already_there() {
        let versions = vec![text_entry("1", "<p>same</p>", None)];
        let next = push_version_entry(&versions, text_entry("2", "<p>same</p>", Some("Draft")));
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "1");
        assert_eq!(next[0].name.as_deref(), Some("Draft"));
        assert!(!next[0].auto);
    }

    #[test]
    fn an_unnamed_duplicate_is_dropped_entirely() {
        let versions = vec![text_entry("1", "<p>same</p>", None)];
        let next = push_version_entry(&versions, text_entry("2", "<p>same</p>", None));
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "1");
    }

    #[test]
    fn the_cap_never_evicts_a_named_version() {
        let mut versions: Vec<VersionEntry> = Vec::new();
        for index in 0..(VERSION_CAP + 50) {
            let name = if index == 3 {
                Some("Final Submission")
            } else {
                None
            };
            versions = push_version_entry(
                &versions,
                text_entry(&index.to_string(), &format!("<p>{index}</p>"), name),
            );
        }

        let unnamed = versions.iter().filter(|entry| !is_named(entry)).count();
        assert_eq!(unnamed, VERSION_CAP);
        assert!(versions
            .iter()
            .any(|entry| entry.name.as_deref() == Some("Final Submission")));
        // Eviction is oldest-first, so the newest entry is still at the front.
        assert_eq!(versions[0].id, (VERSION_CAP + 49).to_string());
    }

    #[test]
    fn an_empty_document_is_not_a_duplicate_of_another_empty_one() {
        // `Boolean(a.contentHtml) && ...` — two empty entries are both kept.
        let versions = vec![text_entry("1", "", None)];
        let next = push_version_entry(&versions, text_entry("2", "", None));
        assert_eq!(next.len(), 2);
    }
}
