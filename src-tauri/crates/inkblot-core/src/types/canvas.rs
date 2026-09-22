//! The canvas document format and its runtime shape.
//!
//! On disk we write the open JSON Canvas spec (<https://jsoncanvas.org>) so a canvas
//! made here opens in Obsidian and vice versa. Inkblot-only data rides along in
//! optional keys a foreign reader ignores (`inkblotTipTap`, `inkblotNoteId`, the
//! document-level `inkblot` block).
//!
//! Two properties this file exists to guarantee:
//!
//! 1. **Unknown keys survive.** Anything we do not model lands in `extra` and is
//!    written back out, so a round-trip through Inkblot never strips another app's
//!    data. A *known* key holding an unexpected JSON type also lands in `extra`
//!    rather than being dropped — see `canvas_model::normalize_canvas`.
//! 2. **A note node is a `file` node carrying an extra `inkblotNoteId`.** The note
//!    itself is never copied onto the canvas; the document that owns it stays the
//!    single source of truth, which is what keeps editing from either side in sync
//!    instead of forking into two versions.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::geometry::{EdgeSide, Viewport};
use super::json::{JsonMap, JsonValue};

/// The node types we understand. `draw` is reserved: it round-trips untouched so a
/// future freehand layer needs no format migration.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasNodeType {
    Text,
    File,
    Link,
    Group,
    Draw,
}

impl CanvasNodeType {
    /// `NODE_TYPES` in canvasModel.js, in declaration order.
    pub const ALL: [CanvasNodeType; 5] = [
        CanvasNodeType::Text,
        CanvasNodeType::File,
        CanvasNodeType::Link,
        CanvasNodeType::Group,
        CanvasNodeType::Draw,
    ];
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: CanvasNodeType,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// A JSON Canvas preset id ('1'–'6') or any hex color; passed through untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The lossy plain-text projection the spec asks for. `inkblot_tip_tap` holds the
    /// real content of a card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Tree path of the document a `file` node points at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The card's full TipTap document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inkblot_tip_tap: Option<JsonValue>,
    /// Set on a `file` node that shows one note out of the document it points at.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inkblot_note_id: Option<String>,
    #[typeshare(skip)]
    #[serde(flatten)]
    pub extra: JsonMap,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasEdge {
    pub id: String,
    pub from_node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_side: Option<EdgeSide>,
    pub to_node: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_side: Option<EdgeSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_end: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_end: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[typeshare(skip)]
    #[serde(flatten)]
    pub extra: JsonMap,
}

/// The runtime shape: id→object maps for O(1) patching, plus explicit order arrays
/// for stable z-order. Groups sort to the front of `node_order` because they render
/// behind everything else.
///
/// The maps are unordered — `node_order` and `edge_order` are the only thing that
/// may decide sequence. Anything that iterates `nodes` or `edges` directly is a bug
/// waiting for a different hash seed.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasState {
    pub nodes: HashMap<String, CanvasNode>,
    pub node_order: Vec<String>,
    pub edges: HashMap<String, CanvasEdge>,
    pub edge_order: Vec<String>,
}

/// The document-level `inkblot` block — the one part of the file the spec does not
/// describe.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CanvasFileMeta {
    pub version: u32,
    pub viewport: Viewport,
}

/// The spec-shaped object written to `<name>.canvas.json`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanvasFile {
    /// Always `"canvas"`. An interop and debugging marker only — never routed on,
    /// because the document kind is a pure function of the path (see `doc_kind`).
    #[serde(rename = "type")]
    pub file_type: String,
    pub nodes: Vec<CanvasNode>,
    pub edges: Vec<CanvasEdge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inkblot: Option<CanvasFileMeta>,
}
