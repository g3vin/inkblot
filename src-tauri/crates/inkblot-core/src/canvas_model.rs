//! The canvas document format and its runtime shape.
//!
//! On disk we write the open JSON Canvas spec (<https://jsoncanvas.org>) so a canvas
//! made here opens in Obsidian and vice versa. Inkblot-only data rides along in
//! optional keys a foreign reader ignores:
//!   - `node.inkblotTipTap` — the card's full TipTap JSON (`node.text` is the lossy
//!     plain-text projection the spec asks for)
//!   - `doc.inkblot` — `{ version, viewport }`
//!
//! At runtime nodes and edges are normalized into id→object maps plus explicit order
//! arrays: the maps give O(1) patching, the arrays give stable z-order. Nothing here
//! touches the filesystem, so the reducer can rely on it.
//!
//! Mirrors `src/lib/canvasModel.js`; `npm run parity` asserts the two agree.
//!
//! **One deliberate difference.** JS reads `raw.nodes[i].id` with whatever type it
//! finds and uses it as an object key, so an edge whose `fromNode` is the *number* 5
//! still finds the node with id `"5"`. Here a non-string endpoint is treated as an
//! absent one and the edge is dropped, because `CanvasEdge::from_node` is a `String`
//! and coercing it would change what gets written back out. The spec says these are
//! strings; a file where they are not is malformed, and one arrow disappearing from
//! it is the smaller harm. See `tests::an_edge_with_a_non_string_endpoint_is_dropped`.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::canvas_geometry::{node_rect, nodes_bounds, pad_rect, rect_contains};
use crate::types::{
    CanvasEdge, CanvasFile, CanvasFileMeta, CanvasNode, CanvasNodeType, CanvasState, EdgeSide,
    JsonMap, Rect, Viewport,
};

pub const CANVAS_FORMAT_VERSION: u32 = 1;

/// A JSON Canvas color preset. A node may also carry any hex color, which passes
/// through untouched.
pub struct CanvasColorPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub value: &'static str,
}

pub const CANVAS_COLOR_PRESETS: [CanvasColorPreset; 6] = [
    CanvasColorPreset { id: "1", label: "Red", value: "#e5534b" },
    CanvasColorPreset { id: "2", label: "Orange", value: "#e8873c" },
    CanvasColorPreset { id: "3", label: "Yellow", value: "#e0b341" },
    CanvasColorPreset { id: "4", label: "Green", value: "#4fb477" },
    CanvasColorPreset { id: "5", label: "Cyan", value: "#3fa9c4" },
    CanvasColorPreset { id: "6", label: "Purple", value: "#a07cd4" },
];

/// Resolve a spec color ('1'–'6' or '#rrggbb') to a CSS color.
///
/// Unset resolves to `--canvas-ink` — near-white in dark mode, near-black in light —
/// NOT the accent color. An uncolored card or arrow is the neutral default state, and
/// painting every one of them accent-blue made the accent meaningless: it should mark
/// what is *selected*, not what merely exists.
pub fn resolve_canvas_color(color: Option<&str>) -> String {
    // `!color` in JS is also true for the empty string.
    let Some(color) = color.filter(|value| !value.is_empty()) else {
        return "var(--canvas-ink)".to_string();
    };
    CANVAS_COLOR_PRESETS
        .iter()
        .find(|preset| preset.id == color)
        .map(|preset| preset.value.to_string())
        .unwrap_or_else(|| color.to_string())
}

/// A node's width and height.
pub struct NodeSize {
    pub width: f64,
    pub height: f64,
}

/// The size given to a node stored without dimensions.
pub const DEFAULT_TEXT_NODE_SIZE: NodeSize = NodeSize { width: 260.0, height: 140.0 };
pub const MIN_NODE_SIZE: NodeSize = NodeSize { width: 100.0, height: 60.0 };

pub const DEFAULT_VIEWPORT: Viewport = Viewport { x: 0.0, y: 0.0, zoom: 1.0 };

/* ---------- reading raw JSON ---------- */

/// `Number.isFinite(value) ? value : fallback`. Note that this is `Number.isFinite`,
/// not the global `isFinite` — a numeric *string* does not qualify.
fn finite_or(value: &Value, fallback: f64) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().filter(|float| float.is_finite()).unwrap_or(fallback),
        _ => fallback,
    }
}

/// A modeled key's value if it has the type we model, `None` otherwise. A key that
/// fails this test is left in `extra`, so a node carrying `text: 42` still round-trips
/// with its 42 rather than losing it.
fn typed_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key)?.as_str().map(|text| text.to_string())
}

fn typed_side(object: &Map<String, Value>, key: &str) -> Option<EdgeSide> {
    match object.get(key)?.as_str()? {
        "top" => Some(EdgeSide::Top),
        "right" => Some(EdgeSide::Right),
        "bottom" => Some(EdgeSide::Bottom),
        "left" => Some(EdgeSide::Left),
        _ => None,
    }
}

fn node_type_of(object: &Map<String, Value>) -> CanvasNodeType {
    match object.get("type").and_then(Value::as_str) {
        Some("text") => CanvasNodeType::Text,
        Some("file") => CanvasNodeType::File,
        Some("link") => CanvasNodeType::Link,
        Some("group") => CanvasNodeType::Group,
        Some("draw") => CanvasNodeType::Draw,
        _ => CanvasNodeType::Text,
    }
}

/// Every key we did not consume into a modeled field.
///
/// `taken` is the set of keys whose modeled field actually holds the raw value; a
/// modeled key that was the wrong type is *not* in it and stays here instead.
fn extras(object: &Map<String, Value>, taken: &[&str]) -> JsonMap {
    object
        .iter()
        .filter(|(key, _)| !taken.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

/* ---------- normalize / serialize ---------- */

/// Parse arbitrary on-disk JSON into the runtime shape, generating ids with `next_id`
/// for nodes and edges that lack one.
///
/// Anything unrecognizable degrades to an empty canvas rather than failing — a corrupt
/// or foreign file should open blank, never crash the pane. Unknown node and edge keys
/// are preserved so a round-trip through Inkblot does not strip another app's data.
pub fn normalize_canvas_with(raw: &Value, mut next_id: impl FnMut() -> String) -> CanvasState {
    let mut state = CanvasState::default();
    let Some(raw) = raw.as_object() else { return state };

    for node in raw.get("nodes").and_then(Value::as_array).unwrap_or(&Vec::new()) {
        let Some(node) = node.as_object() else { continue };

        let id = match node.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => next_id(),
        };
        if state.nodes.contains_key(&id) {
            continue;
        }

        let mut taken = vec!["id", "type", "x", "y", "width", "height"];
        let mut take = |key: &'static str, value: Option<String>| {
            if value.is_some() {
                taken.push(key);
            }
            value
        };

        let color = take("color", typed_string(node, "color"));
        let text = take("text", typed_string(node, "text"));
        let file = take("file", typed_string(node, "file"));
        let url = take("url", typed_string(node, "url"));
        let label = take("label", typed_string(node, "label"));
        let inkblot_note_id = take("inkblotNoteId", typed_string(node, "inkblotNoteId"));
        let inkblot_tip_tap = node.get("inkblotTipTap").cloned();
        if inkblot_tip_tap.is_some() {
            taken.push("inkblotTipTap");
        }

        state.nodes.insert(
            id.clone(),
            CanvasNode {
                node_type: node_type_of(node),
                x: finite_or(node.get("x").unwrap_or(&Value::Null), 0.0),
                y: finite_or(node.get("y").unwrap_or(&Value::Null), 0.0),
                width: MIN_NODE_SIZE.width.max(finite_or(
                    node.get("width").unwrap_or(&Value::Null),
                    DEFAULT_TEXT_NODE_SIZE.width,
                )),
                height: MIN_NODE_SIZE.height.max(finite_or(
                    node.get("height").unwrap_or(&Value::Null),
                    DEFAULT_TEXT_NODE_SIZE.height,
                )),
                color,
                text,
                file,
                url,
                label,
                inkblot_tip_tap,
                inkblot_note_id,
                extra: extras(node, &taken),
                id: id.clone(),
            },
        );
        state.node_order.push(id);
    }

    // Groups render behind everything else, so they sort to the front of nodeOrder.
    // A stable sort, like Array.prototype.sort, so z-order is otherwise untouched.
    let nodes = &state.nodes;
    state.node_order.sort_by_key(|id| {
        u8::from(nodes.get(id).map(|node| node.node_type) != Some(CanvasNodeType::Group))
    });

    for edge in raw.get("edges").and_then(Value::as_array).unwrap_or(&Vec::new()) {
        let Some(edge) = edge.as_object() else { continue };

        let id = match edge.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => next_id(),
        };
        if state.edges.contains_key(&id) {
            continue;
        }

        // An edge to a node that isn't here is unrenderable; drop it.
        let from_node = edge.get("fromNode").and_then(Value::as_str).unwrap_or_default();
        let to_node = edge.get("toNode").and_then(Value::as_str).unwrap_or_default();
        if !state.nodes.contains_key(from_node) || !state.nodes.contains_key(to_node) {
            continue;
        }

        let mut taken = vec!["id", "fromNode", "toNode"];
        let mut take = |key: &'static str, present: bool| {
            if present {
                taken.push(key);
            }
        };

        let from_side = typed_side(edge, "fromSide");
        take("fromSide", from_side.is_some());
        let to_side = typed_side(edge, "toSide");
        take("toSide", to_side.is_some());
        let from_end = typed_string(edge, "fromEnd");
        take("fromEnd", from_end.is_some());
        let to_end = typed_string(edge, "toEnd");
        take("toEnd", to_end.is_some());
        let color = typed_string(edge, "color");
        take("color", color.is_some());
        let label = typed_string(edge, "label");
        take("label", label.is_some());

        state.edges.insert(
            id.clone(),
            CanvasEdge {
                id: id.clone(),
                from_node: from_node.to_string(),
                from_side,
                to_node: to_node.to_string(),
                to_side,
                from_end,
                to_end,
                color,
                label,
                extra: extras(edge, &taken),
            },
        );
        state.edge_order.push(id);
    }

    state
}

/// Read the persisted viewport, tolerating a missing or malformed `inkblot` block.
pub fn read_viewport(raw: &Value) -> Viewport {
    let viewport = &raw["inkblot"]["viewport"];
    if !viewport.is_object() {
        return DEFAULT_VIEWPORT;
    }
    Viewport {
        x: finite_or(&viewport["x"], DEFAULT_VIEWPORT.x),
        y: finite_or(&viewport["y"], DEFAULT_VIEWPORT.y),
        zoom: finite_or(&viewport["zoom"], DEFAULT_VIEWPORT.zoom),
    }
}

/// Runtime shape → the spec-shaped object we write to disk.
pub fn serialize_canvas(state: &CanvasState, viewport: Viewport) -> CanvasFile {
    CanvasFile {
        // Interop and debugging marker only — never routed on (see `doc_kind`).
        file_type: "canvas".to_string(),
        nodes: state.node_order.iter().filter_map(|id| state.nodes.get(id).cloned()).collect(),
        edges: state.edge_order.iter().filter_map(|id| state.edges.get(id).cloned()).collect(),
        inkblot: Some(CanvasFileMeta {
            version: CANVAS_FORMAT_VERSION,
            viewport: Viewport {
                x: if viewport.x.is_finite() { viewport.x } else { DEFAULT_VIEWPORT.x },
                y: if viewport.y.is_finite() { viewport.y } else { DEFAULT_VIEWPORT.y },
                zoom: if viewport.zoom.is_finite() { viewport.zoom } else { DEFAULT_VIEWPORT.zoom },
            },
        }),
    }
}

/* ---------- groups ---------- */

/// The nodes a group contains.
///
/// Membership is GEOMETRIC and never stored: a node belongs to a group exactly when
/// its rect sits inside the group's, resolved fresh at the moment it matters
/// (pointer-down). That is what Obsidian does, and it keeps the on-disk format
/// spec-clean — a group is just a rect with a label, so a canvas grouped here still
/// opens correctly anywhere else.
pub fn group_member_ids(state: &CanvasState, group_id: &str) -> Vec<String> {
    let Some(group) = state.nodes.get(group_id) else { return Vec::new() };
    if group.node_type != CanvasNodeType::Group {
        return Vec::new();
    }

    state
        .node_order
        .iter()
        .filter(|id| id.as_str() != group_id)
        .filter(|id| {
            state.nodes.get(*id).is_some_and(|node| rect_contains(node_rect(group), node_rect(node)))
        })
        .cloned()
        .collect()
}

/// The rect a group must occupy to hold `member_ids`, padded. `None` if it holds none.
pub fn group_fit_rect(
    nodes: &HashMap<String, CanvasNode>,
    member_ids: &[String],
    padding: f64,
) -> Option<Rect> {
    let members: Vec<Rect> =
        member_ids.iter().filter_map(|id| nodes.get(id)).map(node_rect).collect();
    nodes_bounds(&members).map(|bounds| pad_rect(bounds, padding))
}

/// The groups that must be re-fitted because a drag touches something they hold.
///
/// Returns `{ groupId: [memberIds] }`, with membership taken NOW — before the move.
/// That snapshot is the whole point: if a card is dragged out past its group's edge,
/// geometric membership would say it had left, and the group would snap shut behind
/// it. Holding the pre-drag list instead means the group stretches to follow the card,
/// which is what the gesture looks like it should do.
///
/// Groups that are themselves being dragged are excluded — they move rigidly with
/// their contents and must not resize.
pub fn groups_to_refit(state: &CanvasState, moving_ids: &[String]) -> Vec<(String, Vec<String>)> {
    let moving: HashSet<&String> = moving_ids.iter().collect();
    let mut fits = Vec::new();

    for id in &state.node_order {
        let is_group = state.nodes.get(id).map(|node| node.node_type) == Some(CanvasNodeType::Group);
        if !is_group || moving.contains(id) {
            continue;
        }

        let members = group_member_ids(state, id);
        if members.iter().any(|member_id| moving.contains(member_id)) {
            fits.push((id.clone(), members));
        }
    }

    fits
}

/// Expand a selection to everything a drag of it should carry: every group in the
/// selection brings its members, and a member that is itself a group brings its own.
///
/// Walked with a worklist rather than recursion because containment is not a tree —
/// two groups drawn on top of each other each contain the other, and a naive walk
/// would not terminate. `seen` makes that case a no-op instead of a hang.
pub fn expand_group_selection(state: &CanvasState, ids: &[String]) -> Vec<String> {
    // Insertion-ordered, because JS returns `[...seen]` from a Set and the order is
    // what the caller renders.
    let mut seen: Vec<String> = Vec::new();
    let mut in_seen: HashSet<String> = HashSet::new();
    let mut queue: Vec<String> = ids.to_vec();

    while let Some(id) = queue.pop() {
        if !in_seen.insert(id.clone()) {
            continue;
        }
        seen.push(id.clone());

        let is_group = state.nodes.get(&id).map(|node| node.node_type) == Some(CanvasNodeType::Group);
        if is_group {
            for member_id in group_member_ids(state, &id) {
                if !in_seen.contains(&member_id) {
                    queue.push(member_id);
                }
            }
        }
    }

    seen
}

/// Every edge touching one of `node_ids` — deleting a node must take these with it.
pub fn incident_edge_ids(state: &CanvasState, node_ids: &[String]) -> Vec<String> {
    let targets: HashSet<&String> = node_ids.iter().collect();
    state
        .edge_order
        .iter()
        .filter(|id| {
            state
                .edges
                .get(*id)
                .is_some_and(|edge| targets.contains(&edge.from_node) || targets.contains(&edge.to_node))
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalize(raw: Value) -> CanvasState {
        let mut counter = 0;
        normalize_canvas_with(&raw, move || {
            counter += 1;
            format!("gen:{counter}")
        })
    }

    #[test]
    fn an_edge_with_a_non_string_endpoint_is_dropped() {
        // The documented difference from JS, where `nodes[5]` finds the node "5".
        let state = normalize(json!({
            "nodes": [{ "id": "5", "type": "text", "x": 0, "y": 0, "width": 100, "height": 60 }],
            "edges": [{ "id": "e", "fromNode": 5, "toNode": "5" }],
        }));
        assert!(state.edge_order.is_empty());
    }

    #[test]
    fn a_modeled_key_of_the_wrong_type_survives_in_extra() {
        let state = normalize(json!({ "nodes": [{ "id": "a", "text": 42, "mystery": [1, 2] }] }));
        let node = &state.nodes["a"];
        assert_eq!(node.text, None);
        assert_eq!(node.extra["text"], json!(42));
        assert_eq!(node.extra["mystery"], json!([1, 2]));
    }

    #[test]
    fn groups_sort_to_the_front_and_the_rest_keep_their_order() {
        let state = normalize(json!({ "nodes": [
            { "id": "a", "type": "text" },
            { "id": "g", "type": "group" },
            { "id": "b", "type": "text" },
            { "id": "h", "type": "group" },
        ] }));
        assert_eq!(state.node_order, ["g", "h", "a", "b"]);
    }

    #[test]
    fn two_groups_containing_each_other_terminate() {
        let square = |id: &str| {
            json!({ "id": id, "type": "group", "x": 0, "y": 0, "width": 500, "height": 500 })
        };
        let state = normalize(json!({ "nodes": [square("g"), square("h")] }));
        let expanded = expand_group_selection(&state, &["g".to_string()]);
        assert_eq!(expanded.len(), 2);
    }

    #[test]
    fn a_corrupt_file_opens_blank_rather_than_failing() {
        assert_eq!(normalize(json!("not a canvas")), CanvasState::default());
        assert_eq!(normalize(json!({ "nodes": "nope" })), CanvasState::default());
    }
}
