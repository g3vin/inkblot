//! Viewport, Rect, Point and EdgeSide — the bottom of the type dependency order.
//!
//! A viewport is `{ x, y, zoom }` where (x, y) is the WORLD coordinate sitting at the
//! container's top-left corner. Screen coordinates are always relative to the
//! container's bounding rect. See `canvas_geometry` for the math that uses these, and
//! `src/lib/canvasGeometry.js` for the JS implementation they stay in parity with.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Viewport {
    /// `DEFAULT_VIEWPORT` in canvasModel.js.
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, zoom: 1.0 }
    }
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Which side of a card an edge attaches to. Serializes as the lowercase strings the
/// JSON Canvas spec uses, so an unset side in a foreign file is simply absent.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeSide {
    Top,
    Right,
    Bottom,
    Left,
}

/// A cubic bezier between two side anchors, plus the point an edge label sits on.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BezierPath {
    /// An SVG path `d` attribute, spelled exactly as JavaScript would spell it — see
    /// `js_number`.
    pub d: String,
    /// t = 0.5 on the curve.
    pub mid: Point,
}

impl EdgeSide {
    /// The order `EDGE_SIDES` declares in canvasGeometry.js.
    pub const ALL: [EdgeSide; 4] = [EdgeSide::Top, EdgeSide::Right, EdgeSide::Bottom, EdgeSide::Left];
}
