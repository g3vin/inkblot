//! The Rust half of the differential parity harness.
//!
//! Reads `{"cases":[{"id":N,"fn":"name","args":[...]}]}` on stdin and writes
//! `{"results":[{"id":N,"ok":<json>}|{"id":N,"err":"..."}]}` on stdout. The Node half
//! (`scripts/parity/run.mjs`) runs the same corpus through the JS implementation and
//! compares. Nothing here is part of the library's API; it exists so that "the Rust
//! port behaves identically" is a thing a gate can prove rather than a claim.
//!
//! **Why a subprocess rather than a Rust test with a checked-in corpus:** a corpus
//! two halves each maintain is a corpus that drifts. Piping one corpus through both
//! implementations in one run is the only version of this that stays honest.

use std::io::{self, Read, Write};

use serde_json::{json, Map, Value};

use inkblot_core::types::{CanvasEdge, CanvasNode, CanvasNodeType, EdgeSide, Point, Rect, Viewport};
use inkblot_core::{
    canvas_geometry as geo, canvas_model as model, doc_kind, js_number::format_js_number,
    story_structure as story,
};

/// `String(x || '')`, the coercion the JS entry points open with.
///
/// The Rust functions take `&str` — they are not defensive about being handed a
/// number, because nothing inside the core ever is. This shim is where that
/// difference lives, so the corpus can still carry the non-string values the JS side
/// tolerates and the harness can still compare the results.
fn js_string_or_empty(value: Option<&Value>) -> Result<String, String> {
    Ok(match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(false)) => String::new(),
        Some(Value::Bool(true)) => "true".to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => {
            let float = number.as_f64().unwrap_or(f64::NAN);
            // `0 || ''` and `NaN || ''` are both falsy, so both coerce to empty.
            if float == 0.0 || float.is_nan() {
                String::new()
            } else {
                format_js_number(float)
            }
        }
        Some(other) => {
            return Err(format!(
                "the corpus may not carry {other} — String() on arrays and objects is \
                 a JS-ism the core has no opinion about"
            ))
        }
    })
}

/// A number out of the corpus. JSON has no NaN, Infinity or -0, so those arrive as
/// the string spellings `scripts/parity/encode.mjs` writes.
fn js_f64(value: &Value) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => match text.as_str() {
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            "-0" => -0.0,
            _ => f64::NAN,
        },
        // `undefined` reaching arithmetic is NaN in JS too.
        _ => f64::NAN,
    }
}

fn f64_arg(args: &[Value], index: usize) -> Result<f64, String> {
    args.get(index)
        .map(js_f64)
        .ok_or_else(|| format!("arg {index} is missing"))
}

fn viewport(value: &Value) -> Viewport {
    Viewport { x: js_f64(&value["x"]), y: js_f64(&value["y"]), zoom: js_f64(&value["zoom"]) }
}

fn point(value: &Value) -> Point {
    Point { x: js_f64(&value["x"]), y: js_f64(&value["y"]) }
}

fn rect(value: &Value) -> Rect {
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
fn edge_side(value: &Value) -> EdgeSide {
    match value.as_str() {
        Some("top") => EdgeSide::Top,
        Some("bottom") => EdgeSide::Bottom,
        Some("left") => EdgeSide::Left,
        _ => EdgeSide::Right,
    }
}

/// The optional form, for a field where the default is `left` rather than `right`.
fn optional_edge_side(value: &Value) -> Option<EdgeSide> {
    match value.as_str() {
        Some("top") => Some(EdgeSide::Top),
        Some("right") => Some(EdgeSide::Right),
        Some("bottom") => Some(EdgeSide::Bottom),
        Some("left") => Some(EdgeSide::Left),
        _ => None,
    }
}

/// Only the fields the geometry reads; the corpus builds nothing else.
fn canvas_node(value: &Value) -> CanvasNode {
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

fn canvas_edge(value: &Value) -> CanvasEdge {
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
/// side. `scripts/parity/cases/canvasModel.mjs` rewrites every id that was not in the
/// input, on both sides, before comparing.
fn counting_ids() -> impl FnMut() -> String {
    let mut counter: u64 = 0;
    move || {
        counter += 1;
        format!("{counter:016x}")
    }
}

fn canvas_state(value: &Value) -> inkblot_core::types::CanvasState {
    model::normalize_canvas_with(value, counting_ids())
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(|item| item.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn dispatch(name: &str, args: &[Value]) -> Result<Value, String> {
    let text = || js_string_or_empty(args.first());

    Ok(match name {
        /* ---- js_number ---- */
        "formatJsNumber" => json!(format_js_number(f64_arg(args, 0)?)),

        /* ---- doc_kind ---- */
        "getDocKind" => json!(doc_kind::get_doc_kind(&text()?)),
        "isCanvasDoc" => json!(doc_kind::is_canvas_doc(&text()?)),
        "withCanvasSuffix" => json!(doc_kind::with_canvas_suffix(&text()?)),
        "stripCanvasSuffix" => json!(doc_kind::strip_canvas_suffix(&text()?)),
        "getDocDisplayName" => json!(doc_kind::get_doc_display_name(&text()?)),

        /* ---- canvas_geometry ---- */
        "clamp" => json!(geo::clamp(f64_arg(args, 0)?, f64_arg(args, 1)?, f64_arg(args, 2)?)),
        "clampZoom" => json!(geo::clamp_zoom(f64_arg(args, 0)?)),
        "worldToScreen" => {
            json!(geo::world_to_screen(f64_arg(args, 0)?, f64_arg(args, 1)?, viewport(&args[2])))
        }
        "screenToWorld" => {
            json!(geo::screen_to_world(f64_arg(args, 0)?, f64_arg(args, 1)?, viewport(&args[2])))
        }
        "worldTransform" => json!(geo::world_transform(viewport(&args[0]))),
        "zoomAt" => json!(geo::zoom_at(
            viewport(&args[0]),
            f64_arg(args, 1)?,
            f64_arg(args, 2)?,
            f64_arg(args, 3)?
        )),
        "zoomTo" => json!(geo::zoom_to(
            viewport(&args[0]),
            f64_arg(args, 1)?,
            f64_arg(args, 2)?,
            f64_arg(args, 3)?
        )),
        "panBy" => json!(geo::pan_by(viewport(&args[0]), f64_arg(args, 1)?, f64_arg(args, 2)?)),
        "nodesBounds" => {
            let rects: Vec<Rect> = args[0].as_array().map(|list| list.iter().map(rect).collect()).unwrap_or_default();
            json!(geo::nodes_bounds(&rects))
        }
        "fitViewport" => {
            let bounds = if args[0].is_object() { Some(rect(&args[0])) } else { None };
            let options = geo::FitOptions {
                padding: js_f64(&args[3]["padding"]),
                max_zoom: js_f64(&args[3]["maxZoom"]),
            };
            json!(geo::fit_viewport(bounds, f64_arg(args, 1)?, f64_arg(args, 2)?, options))
        }
        "rectsIntersect" => json!(geo::rects_intersect(rect(&args[0]), rect(&args[1]))),
        "rectContains" => json!(geo::rect_contains(rect(&args[0]), rect(&args[1]))),
        "padRect" => json!(geo::pad_rect(rect(&args[0]), f64_arg(args, 1)?)),
        "rectFromPoints" => json!(geo::rect_from_points(point(&args[0]), point(&args[1]))),
        "sideAnchor" => json!(geo::side_anchor(rect(&args[0]), edge_side(&args[1]))),
        "sideNormal" => json!(geo::side_normal(edge_side(&args[0]))),
        "bezierPath" => json!(geo::bezier_path(
            point(&args[0]),
            edge_side(&args[1]),
            point(&args[2]),
            edge_side(&args[3])
        )),
        "offsetAnchor" => {
            json!(geo::offset_anchor(point(&args[0]), edge_side(&args[1]), f64_arg(args, 2)?))
        }
        "edgeGeometry" => json!(geo::edge_geometry(
            &canvas_edge(&args[0]),
            &canvas_node(&args[1]),
            &canvas_node(&args[2])
        )),
        "inferSide" => json!(geo::infer_side(rect(&args[0]), point(&args[1]))),

        /* ---- canvas_model ---- */
        "normalizeCanvas" => json!(canvas_state(&args[0])),
        "readViewport" => json!(model::read_viewport(&args[0])),
        "serializeCanvas" => {
            json!(model::serialize_canvas(&canvas_state(&args[0]), viewport(&args[1])))
        }
        "resolveCanvasColor" => {
            // JS does `String(color)` before the lookup, so the preset number 1 and
            // the preset string "1" resolve alike. That coercion is the shim's job.
            let coerced = match &args[0] {
                Value::Number(number) => Some(format_js_number(number.as_f64().unwrap_or(f64::NAN))),
                Value::String(text) => Some(text.clone()),
                Value::Bool(true) => Some("true".to_string()),
                _ => None,
            };
            json!(model::resolve_canvas_color(coerced.as_deref()))
        }
        "groupMemberIds" => {
            json!(model::group_member_ids(&canvas_state(&args[0]), args[1].as_str().unwrap_or_default()))
        }
        "groupFitRect" => {
            let state = canvas_state(&args[0]);
            json!(model::group_fit_rect(&state.nodes, &string_list(&args[1]), f64_arg(args, 2)?))
        }
        "groupsToRefit" => {
            // JS returns an object keyed by group id; the Rust version returns pairs,
            // because the key order is `nodeOrder` and a map would throw it away.
            let fits = model::groups_to_refit(&canvas_state(&args[0]), &string_list(&args[1]));
            let object: Map<String, Value> =
                fits.into_iter().map(|(id, members)| (id, json!(members))).collect();
            Value::Object(object)
        }
        "expandGroupSelection" => {
            json!(model::expand_group_selection(&canvas_state(&args[0]), &string_list(&args[1])))
        }
        "incidentEdgeIds" => {
            json!(model::incident_edge_ids(&canvas_state(&args[0]), &string_list(&args[1])))
        }

        /* ---- story_structure ---- */
        "storyFolderPresets" => json!(story::story_folder_presets()),
        "getStoryFolderPresetByKey" => {
            json!(story::get_story_folder_preset_by_key(args[0].as_str().unwrap_or_default()))
        }
        "getStoryFolderPresetByName" => {
            json!(story::get_story_folder_preset_by_name(args[0].as_str().unwrap_or_default()))
        }
        "getStoryFolderPresetForEntry" => json!(story::get_story_folder_preset_for_entry(
            args[0].as_str().unwrap_or_default(),
            args.get(1).and_then(Value::as_str).unwrap_or("file")
        )),
        "getStoryFolderAncestor" => {
            json!(story::get_story_folder_ancestor(args[0].as_str().unwrap_or_default()))
        }

        unknown => return Err(format!("no such function: {unknown}")),
    })
}

/// Serialize the way `JSON.stringify` would, so the two sides are compared on equal
/// terms rather than on Rust's serializer being more precise.
///
/// The only place they differ is the sign of zero: serde_json writes `-0.0`, JS writes
/// `0`, and the comparison is exact. `clamp(-0, -1, 1)` really does return -0 in both
/// implementations — `canvas_geometry::tests::clamp_keeps_the_sign_of_zero` is where
/// that is asserted, because this harness cannot see it.
fn as_javascript_json(value: Value) -> Value {
    match value {
        Value::Number(ref number) => match number.as_f64() {
            Some(float) if float == 0.0 && float.is_sign_negative() => json!(0.0),
            _ => value,
        },
        Value::Array(items) => Value::Array(items.into_iter().map(as_javascript_json).collect()),
        Value::Object(fields) => Value::Object(
            fields.into_iter().map(|(key, inner)| (key, as_javascript_json(inner))).collect(),
        ),
        other => other,
    }
}

fn main() -> io::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;

    let request: Value = serde_json::from_str(&input)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let cases = request["cases"].as_array().cloned().unwrap_or_default();

    let results: Vec<Value> = cases
        .iter()
        .map(|case| {
            let id = case["id"].clone();
            let name = case["fn"].as_str().unwrap_or_default();
            let args = case["args"].as_array().cloned().unwrap_or_default();

            let mut row = Map::new();
            row.insert("id".to_string(), id);
            match dispatch(name, &args) {
                Ok(value) => row.insert("ok".to_string(), as_javascript_json(value)),
                Err(message) => row.insert("err".to_string(), Value::String(message)),
            };
            Value::Object(row)
        })
        .collect();

    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &json!({ "results": results }))?;
    stdout.write_all(b"\n")?;
    Ok(())
}
