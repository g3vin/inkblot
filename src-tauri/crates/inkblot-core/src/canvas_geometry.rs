//! The canvas's coordinate math. Pure functions only.
//!
//! A viewport is `{ x, y, zoom }` where (x, y) is the WORLD coordinate sitting at the
//! container's top-left corner. The world layer renders it as a single transform
//! (with `transform-origin: 0 0`):
//!
//! ```text
//!   translate(-x * zoom, -y * zoom) scale(zoom)
//! ```
//!
//! Screen coordinates are always relative to the container's bounding rect, so callers
//! must subtract `rect.left`/`rect.top` before handing a pointer position in.
//!
//! Mirrors `src/lib/canvasGeometry.js`, expression for expression — the arithmetic is
//! transcribed rather than rearranged, because reassociating float operations changes
//! the answer in the last bit and `npm run parity` compares exactly.

use crate::js_number::format_js_number;
use crate::types::{BezierPath, CanvasEdge, CanvasNode, EdgeSide, Point, Rect, Viewport};

pub const MIN_ZOOM: f64 = 0.1;
pub const MAX_ZOOM: f64 = 4.0;

/// `Math.min`, which propagates NaN. Rust's `f64::min` ignores it and returns the
/// other operand, which would quietly turn a corrupt coordinate into a plausible one.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if b < a {
        b
    } else {
        a
    }
}

/// `Math.max`, propagating NaN for the same reason as [`js_min`].
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if b > a {
        b
    } else {
        a
    }
}

/// `Math.hypot`, which is not the same function as `f64::hypot`.
///
/// The platform's `hypot` is correctly rounded; V8's is a scale-and-Kahan-sum that is
/// not, so the two disagree in the last bit — `hypot(-202, -50)` is 208.09613163151303
/// on the platform and 208.09613163151306 in V8. That difference reaches the screen:
/// it feeds `control_reach`, so an SVG path string came out as `-240.83845265260524`
/// here and `-240.83845265260527` in the webview. Transcribed from V8's
/// implementation rather than improved on — the point is to agree, not to be right.
fn js_hypot(x: f64, y: f64) -> f64 {
    // Infinity wins over NaN, which is what the spec asks for and what V8 does.
    if x.is_infinite() || y.is_infinite() {
        return f64::INFINITY;
    }
    if x.is_nan() || y.is_nan() {
        return f64::NAN;
    }

    let values = [x.abs(), y.abs()];
    let mut max = js_max(values[0], values[1]);
    if max == 0.0 {
        max = 1.0;
    }

    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let n = value / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }

    sum.sqrt() * max
}

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    js_min(max, js_max(min, value))
}

pub fn clamp_zoom(zoom: f64) -> f64 {
    clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

pub fn world_to_screen(wx: f64, wy: f64, v: Viewport) -> Point {
    Point { x: (wx - v.x) * v.zoom, y: (wy - v.y) * v.zoom }
}

pub fn screen_to_world(sx: f64, sy: f64, v: Viewport) -> Point {
    Point { x: sx / v.zoom + v.x, y: sy / v.zoom + v.y }
}

/// The CSS transform for the world layer.
pub fn world_transform(v: Viewport) -> String {
    format!(
        "translate({}px, {}px) scale({})",
        format_js_number(-v.x * v.zoom),
        format_js_number(-v.y * v.zoom),
        format_js_number(v.zoom)
    )
}

/// Scale by `factor` while pinning the world point currently under (sx, sy) — i.e.
/// zoom toward the cursor rather than the origin.
pub fn zoom_at(v: Viewport, factor: f64, sx: f64, sy: f64) -> Viewport {
    let zoom = clamp_zoom(v.zoom * factor);
    if zoom == v.zoom {
        return v;
    }
    let anchor = screen_to_world(sx, sy, v);
    Viewport { zoom, x: anchor.x - sx / zoom, y: anchor.y - sy / zoom }
}

/// Scale to an exact zoom level, pinning the center of the container.
pub fn zoom_to(v: Viewport, zoom: f64, width: f64, height: f64) -> Viewport {
    zoom_at(v, clamp_zoom(zoom) / v.zoom, width / 2.0, height / 2.0)
}

pub fn pan_by(v: Viewport, dx_screen: f64, dy_screen: f64) -> Viewport {
    Viewport { x: v.x + dx_screen / v.zoom, y: v.y + dy_screen / v.zoom, zoom: v.zoom }
}

/// The rect a node occupies in world space.
pub fn node_rect(node: &CanvasNode) -> Rect {
    Rect { x: node.x, y: node.y, width: node.width, height: node.height }
}

/// Bounding box of a list of rects in world space, or `None` if there are none.
pub fn nodes_bounds(nodes: &[Rect]) -> Option<Rect> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for node in nodes {
        min_x = js_min(min_x, node.x);
        min_y = js_min(min_y, node.y);
        max_x = js_max(max_x, node.x + node.width);
        max_y = js_max(max_y, node.y + node.height);
    }

    if !min_x.is_finite() {
        return None;
    }
    Some(Rect { x: min_x, y: min_y, width: max_x - min_x, height: max_y - min_y })
}

/// The options `fitViewport` takes, with the defaults its destructuring supplies.
#[derive(Debug, Clone, Copy)]
pub struct FitOptions {
    pub padding: f64,
    pub max_zoom: f64,
}

impl Default for FitOptions {
    fn default() -> Self {
        Self { padding: 64.0, max_zoom: 1.0 }
    }
}

/// Viewport that centers `bounds` in a container of the given size with `padding`
/// screen pixels of breathing room. An empty canvas resets to the origin.
pub fn fit_viewport(bounds: Option<Rect>, width: f64, height: f64, options: FitOptions) -> Viewport {
    // `!width` in JS is true for 0 and for NaN, and false for a negative width.
    let falsy = |value: f64| value == 0.0 || value.is_nan();
    let Some(bounds) = bounds else { return Viewport::default() };
    if falsy(width) || falsy(height) {
        return Viewport::default();
    }

    let usable_width = js_max(1.0, width - options.padding * 2.0);
    let usable_height = js_max(1.0, height - options.padding * 2.0);
    let zoom = clamp(
        js_min(
            usable_width / js_max(1.0, bounds.width),
            usable_height / js_max(1.0, bounds.height),
        ),
        MIN_ZOOM,
        options.max_zoom,
    );

    let center_x = bounds.x + bounds.width / 2.0;
    let center_y = bounds.y + bounds.height / 2.0;

    Viewport { zoom, x: center_x - width / (2.0 * zoom), y: center_y - height / (2.0 * zoom) }
}

pub fn rects_intersect(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
}

/// True when `inner` sits entirely within `outer` — how a group claims its members.
pub fn rect_contains(outer: Rect, inner: Rect) -> bool {
    inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height
}

/// Grow a rect by `padding` on every side.
pub fn pad_rect(rect: Rect, padding: f64) -> Rect {
    Rect {
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2.0,
        height: rect.height + padding * 2.0,
    }
}

/// Normalize a drag between two points into a positive-extent rect (for marquees).
pub fn rect_from_points(a: Point, b: Point) -> Rect {
    Rect {
        x: js_min(a.x, b.x),
        y: js_min(a.y, b.y),
        width: (a.x - b.x).abs(),
        height: (a.y - b.y).abs(),
    }
}

/* ---------------- edges ---------------- */

/// Where an edge attaches on a node's side (world coords).
pub fn side_anchor(node: Rect, side: EdgeSide) -> Point {
    match side {
        EdgeSide::Top => Point { x: node.x + node.width / 2.0, y: node.y },
        EdgeSide::Bottom => Point { x: node.x + node.width / 2.0, y: node.y + node.height },
        EdgeSide::Left => Point { x: node.x, y: node.y + node.height / 2.0 },
        EdgeSide::Right => Point { x: node.x + node.width, y: node.y + node.height / 2.0 },
    }
}

/// Outward direction of a side — the curve leaves and enters along these.
pub fn side_normal(side: EdgeSide) -> Point {
    match side {
        EdgeSide::Top => Point { x: 0.0, y: -1.0 },
        EdgeSide::Bottom => Point { x: 0.0, y: 1.0 },
        EdgeSide::Left => Point { x: -1.0, y: 0.0 },
        EdgeSide::Right => Point { x: 1.0, y: 0.0 },
    }
}

const CONTROL_MIN: f64 = 40.0;
const CONTROL_MAX: f64 = 160.0;

/// How far an edge stops short of the card it touches.
///
/// Nodes paint on top of the edge layer, so an arrowhead that ends exactly on the
/// border is half-buried under the card — its tip is the part that disappears. The gap
/// lands the head just outside the card, where it can be seen whole.
pub const EDGE_ENDPOINT_GAP: f64 = 6.0;

/// Control-point reach for one end of a curve.
///
/// `away` is how far the other endpoint lies along this side's outward normal. When it
/// is positive the target is out in front of the port and a modest reach is all a
/// graceful curve needs. When it is NEGATIVE the target is *behind* the card the arrow
/// is leaving: a short control point makes the curve turn immediately and cut straight
/// back across the card it just left. Reaching further out first is what makes the line
/// swing clear of the card instead of disappearing behind it.
fn control_reach(distance: f64, away: f64) -> f64 {
    let base = clamp(distance * 0.4, CONTROL_MIN, CONTROL_MAX);
    if away >= 0.0 {
        return base;
    }
    clamp(base + away.abs() * 0.8, CONTROL_MIN, CONTROL_MAX * 2.5)
}

/// Cubic bezier between two anchors, with control points pushed along each side's
/// outward normal so the curve leaves the card perpendicular to the edge it touches.
pub fn bezier_path(from: Point, from_side: EdgeSide, to: Point, to_side: EdgeSide) -> BezierPath {
    let distance = js_hypot(to.x - from.x, to.y - from.y);

    let n0 = side_normal(from_side);
    let n1 = side_normal(to_side);

    // Signed distance of each endpoint along the OTHER end's outward normal.
    let away_from = (to.x - from.x) * n0.x + (to.y - from.y) * n0.y;
    let away_to = (from.x - to.x) * n1.x + (from.y - to.y) * n1.y;

    let reach0 = control_reach(distance, away_from);
    let reach1 = control_reach(distance, away_to);

    let c0 = Point { x: from.x + n0.x * reach0, y: from.y + n0.y * reach0 };
    let c1 = Point { x: to.x + n1.x * reach1, y: to.y + n1.y * reach1 };

    BezierPath {
        d: format!(
            "M {} {} C {} {} {} {} {} {}",
            format_js_number(from.x),
            format_js_number(from.y),
            format_js_number(c0.x),
            format_js_number(c0.y),
            format_js_number(c1.x),
            format_js_number(c1.y),
            format_js_number(to.x),
            format_js_number(to.y)
        ),
        mid: Point {
            x: (from.x + 3.0 * c0.x + 3.0 * c1.x + to.x) / 8.0,
            y: (from.y + 3.0 * c0.y + 3.0 * c1.y + to.y) / 8.0,
        },
    }
}

/// An anchor pushed `gap` out along its side's normal, clear of the card.
pub fn offset_anchor(anchor: Point, side: EdgeSide, gap: f64) -> Point {
    let n = side_normal(side);
    Point { x: anchor.x + n.x * gap, y: anchor.y + n.y * gap }
}

/// The path (and label point) for an edge between two nodes.
///
/// An unset side — or, in a foreign file, one spelled in a way we do not recognise —
/// falls back to the same defaults JS reaches through `sideAnchor`'s `default:` branch.
pub fn edge_geometry(edge: &CanvasEdge, from_node: &CanvasNode, to_node: &CanvasNode) -> BezierPath {
    let from_side = edge.from_side.unwrap_or(EdgeSide::Right);
    let to_side = edge.to_side.unwrap_or(EdgeSide::Left);
    bezier_path(
        offset_anchor(side_anchor(node_rect(from_node), from_side), from_side, EDGE_ENDPOINT_GAP),
        from_side,
        offset_anchor(side_anchor(node_rect(to_node), to_side), to_side, EDGE_ENDPOINT_GAP),
        to_side,
    )
}

/// Best side of `node` to attach to when connecting from `point` — used when the user
/// drops on a card's body rather than a specific port. Stored sides are sticky
/// afterwards, which is what Obsidian does and what users expect.
pub fn infer_side(node: Rect, point: Point) -> EdgeSide {
    let dx = point.x - (node.x + node.width / 2.0);
    let dy = point.y - (node.y + node.height / 2.0);
    if dx.abs() > dy.abs() {
        return if dx > 0.0 { EdgeSide::Right } else { EdgeSide::Left };
    }
    if dy > 0.0 {
        EdgeSide::Bottom
    } else {
        EdgeSide::Top
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn min_and_max_propagate_nan_the_way_math_min_does() {
        assert!(clamp(f64::NAN, 0.0, 1.0).is_nan());
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert!(js_max(1.0, f64::NAN).is_nan());
        // A list containing NaN has no bounds at all, rather than bounds that skip it.
        assert!(nodes_bounds(&[Rect { x: f64::NAN, y: 0.0, width: 10.0, height: 10.0 }]).is_none());
    }

    #[test]
    fn clamp_keeps_the_sign_of_zero() {
        // JSON cannot carry -0, so the parity harness cannot check this one; it is the
        // same path `Math.min(1, Math.max(-1, -0))` takes.
        assert!(clamp(-0.0, -1.0, 1.0).is_sign_negative());
        assert!(clamp(0.0, -1.0, 1.0).is_sign_positive());
    }

    #[test]
    fn hypot_matches_v8_rather_than_the_platform() {
        // The case the parity corpus found: the correctly-rounded hypot (the
        // platform's, and Python's) gives 208.09613163151303, V8 gives …306, and the
        // difference survives into the SVG path string.
        let v8 = js_hypot(-202.0, -50.0);
        assert_eq!(crate::js_number::format_js_number(v8), "208.09613163151306");
        assert_eq!(crate::js_number::format_js_number((-202.0f64).hypot(-50.0)), "208.09613163151303");
        assert!(js_hypot(f64::INFINITY, f64::NAN).is_infinite());
        assert!(js_hypot(f64::NAN, 1.0).is_nan());
        assert_eq!(js_hypot(0.0, 0.0), 0.0);
    }
}
