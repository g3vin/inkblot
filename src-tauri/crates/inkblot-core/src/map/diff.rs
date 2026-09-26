//! Comparing and merging two states of a map, for version history.
//!
//! The map counterpart of `diff_canvases` / `merge_canvases` in `version_history`. A
//! map is a set of collections of id'd items plus a handful of whole-map settings, so
//! the diff is item by item within each collection, and section by section for the
//! rest:
//!
//! ```text
//!   added / removed   an item only one side has
//!   edited            the same item, with something other than its placement changed
//!   moved             the same item, changed only in where it sits
//!   settings          a whole-map section (style, scale, …) that differs
//! ```
//!
//! The viewport is where somebody was looking, not what they made, and is never a
//! difference. The timeline IS compared — the day it was left on is saved state.
//!
//! Works on `serde_json::Value` like the rest of `map`, so keys a newer build wrote
//! travel through a merge untouched. Mirrors `src/lib/map/mapDiff.js`; `npm run
//! parity` asserts the two agree.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::types::MergeChoice;

/// A collection a map holds. `geometry` is the keys that only place an item — a
/// change confined to them is a move, not an edit.
pub struct MapCollection {
    pub key: &'static str,
    pub one: &'static str,
    pub many: &'static str,
    pub geometry: &'static [&'static str],
}

/// Every collection, in the order a diff lists them. Bodies live at `system.bodies`.
pub const MAP_COLLECTIONS: [MapCollection; 8] = [
    MapCollection {
        key: "pins",
        one: "place",
        many: "places",
        geometry: &["at", "body"],
    },
    MapCollection {
        key: "routes",
        one: "route",
        many: "routes",
        geometry: &["nodes"],
    },
    MapCollection {
        key: "regions",
        one: "region",
        many: "regions",
        geometry: &["rings"],
    },
    MapCollection {
        key: "labels",
        one: "label",
        many: "labels",
        geometry: &["at", "route", "path", "startOffset", "rotation"],
    },
    MapCollection {
        key: "travelers",
        one: "traveler",
        many: "travelers",
        geometry: &[],
    },
    MapCollection {
        key: "bodies",
        one: "body",
        many: "bodies",
        geometry: &["orbit"],
    },
    MapCollection {
        key: "terrains",
        one: "terrain",
        many: "terrains",
        geometry: &[],
    },
    MapCollection {
        key: "transports",
        one: "transport",
        many: "transports",
        geometry: &[],
    },
];

/// The whole-map sections, with what the compare view calls them.
pub const MAP_SETTINGS: [(&str, &str); 7] = [
    ("mapKind", "Map kind"),
    ("scale", "Scale"),
    ("background", "Background"),
    ("earth", "Globe"),
    ("system", "Star system"),
    ("timeline", "Timeline"),
    ("style", "Style"),
];

/// An item only one side has.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MapItemChange {
    pub collection: String,
    pub item: Value,
}

/// The same item on both sides, differing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MapItemEdit {
    pub collection: String,
    pub before: Value,
    pub after: Value,
}

/// A whole-map section that differs. An absent section is `null`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MapSettingChange {
    pub section: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct MapDiff {
    pub added: Vec<MapItemChange>,
    pub removed: Vec<MapItemChange>,
    pub edited: Vec<MapItemEdit>,
    pub moved: Vec<MapItemEdit>,
    pub settings: Vec<MapSettingChange>,
}

/// Structural equality of two JSON values. Key order is not part of a value, and
/// numbers compare by value, so `1` and `1.0` are the same number as they are in JS.
pub fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same_json(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(key, value)| y.get(key).is_some_and(|other| same_json(value, other)))
        }
        _ => a == b,
    }
}

fn same_list(a: &[Value], b: &[Value]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same_json(x, y))
}

fn without(value: &Value, keys: &[&str]) -> Value {
    let mut out = value.clone();
    if let Some(object) = out.as_object_mut() {
        for key in keys {
            object.remove(*key);
        }
    }
    out
}

fn id_of(item: &Value) -> &str {
    item.get("id").and_then(Value::as_str).unwrap_or_default()
}

/// A collection's items: objects with a non-empty string id, first of each id kept —
/// the rule `normalize_map` reads lists by.
pub fn map_items(map: &Value, key: &str) -> Vec<Value> {
    let list = if key == "bodies" {
        map.get("system")
            .filter(|system| system.is_object())
            .and_then(|system| system.get("bodies"))
    } else {
        map.get(key)
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in list.and_then(Value::as_array).into_iter().flatten() {
        let Some(id) = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !item.is_object() || !seen.insert(id.to_string()) {
            continue;
        }
        out.push(item.clone());
    }
    out
}

/// A whole-map section as compared: `null` when absent; the system without its bodies.
fn section_of(map: &Value, key: &str) -> Value {
    let value = map
        .as_object()
        .and_then(|object| object.get(key))
        .cloned()
        .unwrap_or(Value::Null);
    if key == "system" && value.is_object() {
        return without(&value, &["bodies"]);
    }
    value
}

/// Item-level diff of two maps (left = older, right = newer).
pub fn diff_maps(left: &Value, right: &Value) -> MapDiff {
    let mut diff = MapDiff::default();

    for collection in &MAP_COLLECTIONS {
        let before = map_items(left, collection.key);
        let after = map_items(right, collection.key);
        let before_by_id: HashMap<&str, &Value> =
            before.iter().map(|item| (id_of(item), item)).collect();
        let after_ids: HashSet<&str> = after.iter().map(id_of).collect();

        for item in &after {
            let Some(old) = before_by_id.get(id_of(item)) else {
                diff.added.push(MapItemChange {
                    collection: collection.key.to_string(),
                    item: item.clone(),
                });
                continue;
            };
            if same_json(old, item) {
                continue;
            }
            let change = MapItemEdit {
                collection: collection.key.to_string(),
                before: (*old).clone(),
                after: item.clone(),
            };
            if same_json(
                &without(old, collection.geometry),
                &without(item, collection.geometry),
            ) {
                diff.moved.push(change);
            } else {
                diff.edited.push(change);
            }
        }
        for item in &before {
            if !after_ids.contains(id_of(item)) {
                diff.removed.push(MapItemChange {
                    collection: collection.key.to_string(),
                    item: item.clone(),
                });
            }
        }
    }

    for (section, _) in MAP_SETTINGS {
        let before = section_of(left, section);
        let after = section_of(right, section);
        if !same_json(&before, &after) {
            diff.settings.push(MapSettingChange {
                section: section.to_string(),
                before,
                after,
            });
        }
    }

    diff
}

pub fn map_diff_is_empty(diff: &MapDiff) -> bool {
    diff.added.is_empty()
        && diff.removed.is_empty()
        && diff.edited.is_empty()
        && diff.moved.is_empty()
        && diff.settings.is_empty()
}

/// One line for a history row: "+2 places · −1 route · 1 edited · 3 moved · Style".
pub fn describe_map_diff(diff: &MapDiff) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut counted = |changes: &[MapItemChange], sign: &str| {
        for collection in &MAP_COLLECTIONS {
            let count = changes
                .iter()
                .filter(|change| change.collection == collection.key)
                .count();
            if count > 0 {
                let noun = if count == 1 {
                    collection.one
                } else {
                    collection.many
                };
                parts.push(format!("{sign}{count} {noun}"));
            }
        }
    };
    counted(&diff.added, "+");
    // U+2212 MINUS SIGN, to line up with the + above it.
    counted(&diff.removed, "\u{2212}");
    if !diff.edited.is_empty() {
        parts.push(format!("{} edited", diff.edited.len()));
    }
    if !diff.moved.is_empty() {
        parts.push(format!("{} moved", diff.moved.len()));
    }
    for (section, label) in MAP_SETTINGS {
        if diff.settings.iter().any(|change| change.section == section) {
            parts.push(label.to_string());
        }
    }
    if parts.is_empty() {
        "No changes".to_string()
    } else {
        parts.join(" · ")
    }
}

/// The collections a snapshot row counts.
const SNAPSHOT_COUNTED: [(&str, &str, &str); 5] = [
    ("pins", "place", "places"),
    ("routes", "route", "routes"),
    ("regions", "region", "regions"),
    ("labels", "label", "labels"),
    ("travelers", "traveler", "travelers"),
];

/// One line for a history row: what a version holds when nothing came before it, or
/// how it differs from the version before it. Mirrors `summarizeMapChange` in
/// `mapModel.js`.
pub fn summarize_map_change(previous: Option<&Value>, next: &Value) -> String {
    if let Some(previous) = previous {
        return describe_map_diff(&diff_maps(previous, next));
    }
    let parts: Vec<String> = SNAPSHOT_COUNTED
        .iter()
        .filter_map(|(key, one, many)| {
            let count = next.get(*key).and_then(Value::as_array).map_or(0, Vec::len);
            (count > 0).then(|| format!("{count} {}", if count == 1 { one } else { many }))
        })
        .collect();
    if parts.is_empty() {
        "Snapshot · empty map".to_string()
    } else {
        format!("Snapshot · {}", parts.join(", "))
    }
}

/// Merge two maps from per-change decisions. The result starts as the RIGHT side; a
/// decision of `Left` flips one change back:
///
/// ```text
///   added:<collection>:<id>    drop the item right added
///   removed:<collection>:<id>  bring back the item right deleted, where it stood
///   edited:<collection>:<id>   keep the older item
///   moved:<collection>:<id>    keep the older placement
///   setting:<section>          keep the older section
/// ```
///
/// References left dangling by a choice are not repaired here: `normalize_map` drops
/// them when the result is loaded, the same rule it applies to any file.
pub fn merge_maps(
    left: &Value,
    right: &Value,
    diff: &MapDiff,
    decisions: &HashMap<String, MergeChoice>,
) -> Value {
    let take = |key: String| decisions.get(&key) == Some(&MergeChoice::Left);
    let mut merged: Map<String, Value> = right.as_object().cloned().unwrap_or_default();

    for change in &diff.settings {
        if !take(format!("setting:{}", change.section)) {
            continue;
        }
        if change.section == "system" {
            // The bodies are merged as a collection of their own, below; the setting
            // decides everything about the system except them.
            let bodies = merged
                .get("system")
                .filter(|system| system.is_object())
                .and_then(|system| system.get("bodies"))
                .cloned();
            let mut system = change.before.as_object().cloned().unwrap_or_default();
            if let Some(bodies) = &bodies {
                system.insert("bodies".to_string(), bodies.clone());
            }
            if change.before.is_null() && bodies.is_none() {
                merged.remove("system");
            } else if change.before.is_object() || bodies.is_some() {
                merged.insert("system".to_string(), Value::Object(system));
            } else {
                merged.insert("system".to_string(), change.before.clone());
            }
        } else if change.before.is_null() {
            merged.remove(&change.section);
        } else {
            merged.insert(change.section.clone(), change.before.clone());
        }
    }

    for collection in &MAP_COLLECTIONS {
        let key = collection.key;
        let added: HashSet<&str> = diff
            .added
            .iter()
            .filter(|change| change.collection == key)
            .map(|change| id_of(&change.item))
            .collect();
        let mut replaced: HashMap<&str, &Value> = HashMap::new();
        for (kind, list) in [("edited", &diff.edited), ("moved", &diff.moved)] {
            for change in list.iter().filter(|change| change.collection == key) {
                let id = id_of(&change.after);
                if take(format!("{kind}:{key}:{id}")) {
                    replaced.insert(id, &change.before);
                }
            }
        }

        let right_items = map_items(right, key);
        let mut items: Vec<Value> = Vec::new();
        for item in &right_items {
            let id = id_of(item);
            if added.contains(id) && take(format!("added:{key}:{id}")) {
                continue;
            }
            items.push(
                replaced
                    .get(id)
                    .map_or_else(|| item.clone(), |before| (*before).clone()),
            );
        }

        // A restored item goes back just above whatever it sat on top of in the older
        // map, so paint order survives the round trip.
        let left_items = map_items(left, key);
        for change in diff
            .removed
            .iter()
            .filter(|change| change.collection == key)
        {
            let id = id_of(&change.item);
            if !take(format!("removed:{key}:{id}")) {
                continue;
            }
            let index = left_items
                .iter()
                .position(|item| id_of(item) == id)
                .unwrap_or(0);
            let at = left_items[..index]
                .iter()
                .rev()
                .find_map(|below| items.iter().position(|item| id_of(item) == id_of(below)))
                .map_or(0, |found| found + 1);
            items.insert(at, change.item.clone());
        }

        if same_list(&items, &right_items) {
            continue;
        }
        if key == "bodies" {
            let mut system = merged
                .get("system")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            system.insert("bodies".to_string(), Value::Array(items));
            merged.insert("system".to_string(), Value::Object(system));
        } else {
            merged.insert(key.to_string(), Value::Array(items));
        }
    }

    Value::Object(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map(pins: Value) -> Value {
        json!({ "type": "map", "pins": pins, "style": { "theme": "clean" }, "viewport": { "x": 0 } })
    }

    #[test]
    fn a_placement_change_is_a_move_and_anything_else_an_edit() {
        let left = map(json!([
            { "id": "a", "name": "Harbour", "at": [0, 0] },
            { "id": "b", "name": "Keep", "at": [5, 5] },
        ]));
        let right = map(json!([
            { "id": "a", "name": "Harbour", "at": [9, 9] },
            { "id": "b", "name": "Old Keep", "at": [5, 5] },
        ]));
        let diff = diff_maps(&left, &right);
        assert_eq!(diff.moved.len(), 1);
        assert_eq!(diff.edited.len(), 1);
        assert_eq!(describe_map_diff(&diff), "1 edited · 1 moved");
    }

    #[test]
    fn the_viewport_is_never_a_difference() {
        let left = map(json!([]));
        let mut right = left.clone();
        right["viewport"] = json!({ "x": 400, "zoom": 3 });
        assert!(map_diff_is_empty(&diff_maps(&left, &right)));
        assert_eq!(describe_map_diff(&diff_maps(&left, &right)), "No changes");
    }

    #[test]
    fn a_restored_item_returns_to_its_place_in_paint_order() {
        let left = map(
            json!([{ "id": "a", "at": [0, 0] }, { "id": "b", "at": [1, 1] }, { "id": "c", "at": [2, 2] }]),
        );
        let right = map(json!([{ "id": "a", "at": [0, 0] }, { "id": "c", "at": [2, 2] }]));
        let diff = diff_maps(&left, &right);
        let decisions = HashMap::from([("removed:pins:b".to_string(), MergeChoice::Left)]);
        let merged = merge_maps(&left, &right, &diff, &decisions);
        let ids: Vec<&str> = merged["pins"]
            .as_array()
            .unwrap()
            .iter()
            .map(id_of)
            .collect();
        assert_eq!(ids, ["a", "b", "c"]);
    }

    #[test]
    fn keeping_the_older_system_keeps_the_merged_bodies() {
        let left = json!({ "system": { "display": { "radial": "log" }, "bodies": [] } });
        let right =
            json!({ "system": { "display": { "radial": "linear" }, "bodies": [{ "id": "sun" }] } });
        let diff = diff_maps(&left, &right);
        let decisions = HashMap::from([("setting:system".to_string(), MergeChoice::Left)]);
        let merged = merge_maps(&left, &right, &diff, &decisions);
        assert_eq!(merged["system"]["display"]["radial"], "log");
        assert_eq!(merged["system"]["bodies"][0]["id"], "sun");
    }

    #[test]
    fn numbers_compare_by_value() {
        assert!(same_json(
            &json!({ "at": [1, 2] }),
            &json!({ "at": [1.0, 2.0] })
        ));
    }
}
