//! The corpus's canvas values as the geometry and the model take them: viewports,
//! points, rects, sides, nodes and edges, decoded the way the JS side reads them.

use serde_json::Value;

use inkblot_core::canvas_model as model;
use inkblot_core::types::{
    CanvasEdge, CanvasNode, CanvasNodeType, EdgeSide, Point, Rect, Viewport,
};

use super::js_f64;

pub fn viewport(value: &Value) -> Viewport {
    Viewport {
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
        zoom: js_f64(&value["zoom"]),
    }
}

pub fn point(value: &Value) -> Point {
    Point {
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
    }
}

pub fn rect(value: &Value) -> Rect {
    Rect {
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
        width: js_f64(&value["width"]),
        height: js_f64(&value["height"]),
    }
}

/// A side out of the corpus, including the ones a foreign canvas file might carry.
/// `sideAnchor` and `sideNormal` both fall through to `right` for anything they do not
/// recognise, and an absent side is the same case.
pub fn edge_side(value: &Value) -> EdgeSide {
    match value.as_str() {
        Some("top") => EdgeSide::Top,
        Some("bottom") => EdgeSide::Bottom,
        Some("left") => EdgeSide::Left,
        _ => EdgeSide::Right,
    }
}

/// The optional form, for a field where the default is `left` rather than `right`.
pub fn optional_edge_side(value: &Value) -> Option<EdgeSide> {
    match value.as_str() {
        Some("top") => Some(EdgeSide::Top),
        Some("right") => Some(EdgeSide::Right),
        Some("bottom") => Some(EdgeSide::Bottom),
        Some("left") => Some(EdgeSide::Left),
        _ => None,
    }
}

/// Only the fields the geometry reads; the corpus builds nothing else.
pub fn canvas_node(value: &Value) -> CanvasNode {
    CanvasNode {
        id: value["id"].as_str().unwrap_or_default().to_string(),
        node_type: CanvasNodeType::Text,
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
        width: js_f64(&value["width"]),
        height: js_f64(&value["height"]),
        color: None,
        text: None,
        file: None,
        url: None,
        label: None,
        inkblot_tip_tap: None,
        inkblot_note_id: None,
        extra: Default::default(),
    }
}

pub fn canvas_edge(value: &Value) -> CanvasEdge {
    CanvasEdge {
        id: value["id"].as_str().unwrap_or_default().to_string(),
        from_node: value["fromNode"].as_str().unwrap_or_default().to_string(),
        from_side: optional_edge_side(&value["fromSide"]),
        to_node: value["toNode"].as_str().unwrap_or_default().to_string(),
        to_side: optional_edge_side(&value["toSide"]),
        from_end: None,
        to_end: None,
        color: None,
        label: None,
        extra: Default::default(),
    }
}

/// `newId()`, deterministically.
///
/// The real one is 16 random hex chars; this one counts, so a corpus case that leaves
/// a node without an id produces something the harness can line up against the JS
/// side. `tests/parity/cases/canvasModel.mjs` rewrites every id that was not in the
/// input, on both sides, before comparing.
pub fn counting_ids() -> impl FnMut() -> String {
    let mut counter: u64 = 0;
    move || {
        counter += 1;
        format!("{counter:016x}")
    }
}

pub fn canvas_state(value: &Value) -> inkblot_core::types::CanvasState {
    model::normalize_canvas_with(value, counting_ids())
}
