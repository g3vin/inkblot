//! The Rust half of the differential parity harness.
//!
//! Reads `{"cases":[{"id":N,"fn":"name","args":[...]}]}` on stdin and writes
//! `{"results":[{"id":N,"ok":<json>}|{"id":N,"err":"..."}]}` on stdout. The Node half
//! (`scripts/parity/run.mjs`) runs the same corpus through the JS implementation and
//! compares. Nothing here is part of the library's API; it exists so that "the Rust
//! implementation behaves identically" is a thing a gate can prove rather than a claim.
//!
//! **Why a subprocess rather than a Rust test with a checked-in corpus:** a corpus
//! two halves each maintain is a corpus that drifts. Piping one corpus through both
//! implementations in one run is the only version of this that stays honest.

use std::io::{self, Read, Write};

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use inkblot_core::notes::{self, NoteDefaults};
use inkblot_core::read_aloud;
use inkblot_core::search::matcher::{Matcher, MatcherOptions};
use inkblot_core::search::{self, ProjectFile};
use inkblot_core::store::{paths, versions};
use inkblot_core::types::{
    CanvasEdge, CanvasFile, CanvasNode, CanvasNodeType, DiffChunk, EdgeSide, HtmlBlock,
    MergeChoice, Note, Point, ReadAloudPayload, Rect, SearchScope, VersionEntry, Viewport,
};
use inkblot_core::{
    canvas_geometry as geo, canvas_model as model, doc_kind, js_number::format_js_number,
    story_structure as story, version_history as history,
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
    Viewport {
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
        zoom: js_f64(&value["zoom"]),
    }
}

fn point(value: &Value) -> Point {
    Point {
        x: js_f64(&value["x"]),
        y: js_f64(&value["y"]),
    }
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
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Deserialize a corpus value into a domain type.
///
/// Unlike `normalize_canvas`, this is not tolerant of a malformed shape — and does not
/// need to be. Everything it parses here is something Inkblot itself wrote:
/// `serializeCanvas` output, a version entry, the blocks `htmlToBlocks` produced.
fn parse<T: serde::de::DeserializeOwned>(value: &Value, what: &str) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|error| format!("bad {what}: {error}"))
}

fn merge_choice(value: &Value) -> Option<MergeChoice> {
    match value.as_str() {
        Some("left") => Some(MergeChoice::Left),
        Some("right") => Some(MergeChoice::Right),
        Some("both") => Some(MergeChoice::Both),
        _ => None,
    }
}

/// `{ "0": "left" }` — the compare panel keys its choices by chunk index.
fn indexed_choices(value: &Value) -> HashMap<usize, MergeChoice> {
    value
        .as_object()
        .map(|fields| {
            fields
                .iter()
                .filter_map(|(key, choice)| Some((key.parse().ok()?, merge_choice(choice)?)))
                .collect()
        })
        .unwrap_or_default()
}

/// `{ "edited:<id>": "left" }` — the canvas merge keys its decisions by change.
fn named_choices(value: &Value) -> HashMap<String, MergeChoice> {
    value
        .as_object()
        .map(|fields| {
            fields
                .iter()
                .filter_map(|(key, choice)| Some((key.clone(), merge_choice(choice)?)))
                .collect()
        })
        .unwrap_or_default()
}

fn matcher_options(value: &Value) -> MatcherOptions {
    MatcherOptions {
        match_case: value["matchCase"].as_bool().unwrap_or(false),
        whole_word: value["wholeWord"].as_bool().unwrap_or(false),
        use_regex: value["useRegex"].as_bool().unwrap_or(false),
    }
}

fn search_scope(value: &Value) -> SearchScope {
    match value.as_str() {
        Some("document") => SearchScope::Document,
        Some("notes") => SearchScope::Notes,
        Some("files") => SearchScope::Files,
        Some("project") => SearchScope::Project,
        _ => SearchScope::Panel,
    }
}

/// A hit, shaped the way `findAll` returns it in JS.
fn hit_json(hit: &inkblot_core::search::matcher::Hit) -> Value {
    json!({ "index": hit.index, "length": hit.length, "text": hit.text })
}

/// The shell's three contributions to a normalize, made deterministic.
///
/// `now` comes from the corpus so both sides fall back to the same instant; ids and the
/// formatted timestamp are constants the harness blanks on the JS side too. It takes a
/// callback because `NoteDefaults` borrows its closures and they cannot outlive the
/// function that builds them.
fn with_note_defaults<T>(now: &str, use_defaults: impl FnOnce(&NoteDefaults) -> T) -> T {
    let new_id = || "generated".to_string();
    let now = now.to_string();
    let now_iso = move || now.clone();
    let format_time = |_: &str| "formatted".to_string();
    use_defaults(&NoteDefaults {
        new_id: &new_id,
        now_iso: &now_iso,
        format_time: &format_time,
    })
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
        "clamp" => json!(geo::clamp(
            f64_arg(args, 0)?,
            f64_arg(args, 1)?,
            f64_arg(args, 2)?
        )),
        "clampZoom" => json!(geo::clamp_zoom(f64_arg(args, 0)?)),
        "worldToScreen" => {
            json!(geo::world_to_screen(
                f64_arg(args, 0)?,
                f64_arg(args, 1)?,
                viewport(&args[2])
            ))
        }
        "screenToWorld" => {
            json!(geo::screen_to_world(
                f64_arg(args, 0)?,
                f64_arg(args, 1)?,
                viewport(&args[2])
            ))
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
        "panBy" => json!(geo::pan_by(
            viewport(&args[0]),
            f64_arg(args, 1)?,
            f64_arg(args, 2)?
        )),
        "nodesBounds" => {
            let rects: Vec<Rect> = args[0]
                .as_array()
                .map(|list| list.iter().map(rect).collect())
                .unwrap_or_default();
            json!(geo::nodes_bounds(&rects))
        }
        "fitViewport" => {
            let bounds = if args[0].is_object() {
                Some(rect(&args[0]))
            } else {
                None
            };
            let options = geo::FitOptions {
                padding: js_f64(&args[3]["padding"]),
                max_zoom: js_f64(&args[3]["maxZoom"]),
            };
            json!(geo::fit_viewport(
                bounds,
                f64_arg(args, 1)?,
                f64_arg(args, 2)?,
                options
            ))
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
            json!(geo::offset_anchor(
                point(&args[0]),
                edge_side(&args[1]),
                f64_arg(args, 2)?
            ))
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
            json!(model::serialize_canvas(
                &canvas_state(&args[0]),
                viewport(&args[1])
            ))
        }
        "resolveCanvasColor" => {
            // JS does `String(color)` before the lookup, so the preset number 1 and
            // the preset string "1" resolve alike. That coercion is the shim's job.
            let coerced = match &args[0] {
                Value::Number(number) => {
                    Some(format_js_number(number.as_f64().unwrap_or(f64::NAN)))
                }
                Value::String(text) => Some(text.clone()),
                Value::Bool(true) => Some("true".to_string()),
                _ => None,
            };
            json!(model::resolve_canvas_color(coerced.as_deref()))
        }
        "groupMemberIds" => {
            json!(model::group_member_ids(
                &canvas_state(&args[0]),
                args[1].as_str().unwrap_or_default()
            ))
        }
        "groupFitRect" => {
            let state = canvas_state(&args[0]);
            json!(model::group_fit_rect(
                &state.nodes,
                &string_list(&args[1]),
                f64_arg(args, 2)?
            ))
        }
        "groupsToRefit" => {
            // JS returns an object keyed by group id; the Rust version returns pairs,
            // because the key order is `nodeOrder` and a map would throw it away.
            let fits = model::groups_to_refit(&canvas_state(&args[0]), &string_list(&args[1]));
            let object: Map<String, Value> = fits
                .into_iter()
                .map(|(id, members)| (id, json!(members)))
                .collect();
            Value::Object(object)
        }
        "expandGroupSelection" => {
            json!(model::expand_group_selection(
                &canvas_state(&args[0]),
                &string_list(&args[1])
            ))
        }
        "incidentEdgeIds" => {
            json!(model::incident_edge_ids(
                &canvas_state(&args[0]),
                &string_list(&args[1])
            ))
        }

        /* ---- story_structure ---- */
        "storyFolderPresets" => json!(story::story_folder_presets()),
        "getStoryFolderPresetByKey" => {
            json!(story::get_story_folder_preset_by_key(
                args[0].as_str().unwrap_or_default()
            ))
        }
        "getStoryFolderPresetByName" => {
            json!(story::get_story_folder_preset_by_name(
                args[0].as_str().unwrap_or_default()
            ))
        }
        "getStoryFolderPresetForEntry" => json!(story::get_story_folder_preset_for_entry(
            args[0].as_str().unwrap_or_default(),
            args.get(1).and_then(Value::as_str).unwrap_or("file")
        )),
        "getStoryFolderAncestor" => {
            json!(story::get_story_folder_ancestor(
                args[0].as_str().unwrap_or_default()
            ))
        }

        /* ---- version_history ---- */
        "htmlToText" => json!(history::html_to_text(args[0].as_str().unwrap_or_default())),
        "textWords" => json!(history::text_words(args[0].as_str().unwrap_or_default())),
        "countWords" => json!(history::count_words(
            args[0].as_str().unwrap_or_default(),
            args[1].as_bool().unwrap_or(true)
        )),
        "countCanvasWords" => json!(history::count_canvas_words(&parse::<CanvasFile>(
            &args[0], "canvas"
        )?)),
        "versionWords" => json!(history::version_words(&parse::<VersionEntry>(
            &args[0],
            "version entry"
        )?)),
        "sessionColor" => json!(history::session_color(args[0].as_str().unwrap_or_default())),
        "diffTokens" => json!(history::diff_tokens(
            &parse::<Vec<String>>(&args[0], "tokens")?,
            &parse::<Vec<String>>(&args[1], "tokens")?
        )),
        "diffWords" => json!(history::diff_words(
            args[0].as_str().unwrap_or_default(),
            args[1].as_str().unwrap_or_default()
        )),
        "wordDelta" => json!(history::word_delta(
            args[0].as_str().unwrap_or_default(),
            args[1].as_str().unwrap_or_default()
        )),
        "diffBlockLists" => json!(history::diff_block_lists(
            &parse::<Vec<HtmlBlock>>(&args[0], "blocks")?,
            &parse::<Vec<HtmlBlock>>(&args[1], "blocks")?
        )),
        "mergeChunksToHtml" => json!(history::merge_chunks_to_html(
            &parse::<Vec<DiffChunk>>(&args[0], "chunks")?,
            &indexed_choices(&args[1])
        )),
        "canvasNodeText" => json!(history::canvas_node_text(&parse::<CanvasNode>(
            &args[0], "node"
        )?)),
        "diffCanvases" => json!(history::diff_canvases(
            &parse::<CanvasFile>(&args[0], "canvas")?,
            &parse::<CanvasFile>(&args[1], "canvas")?
        )),
        "canvasDiffIsEmpty" => json!(history::canvas_diff_is_empty(&history::diff_canvases(
            &parse::<CanvasFile>(&args[0], "canvas")?,
            &parse::<CanvasFile>(&args[1], "canvas")?
        ))),
        "describeCanvasDiff" => json!(history::describe_canvas_diff(&history::diff_canvases(
            &parse::<CanvasFile>(&args[0], "canvas")?,
            &parse::<CanvasFile>(&args[1], "canvas")?
        ))),
        "mergeCanvases" => {
            let left = parse::<CanvasFile>(&args[0], "canvas")?;
            let right = parse::<CanvasFile>(&args[1], "canvas")?;
            let diff = history::diff_canvases(&left, &right);
            json!(history::merge_canvases(
                &right,
                &diff,
                &named_choices(&args[2])
            ))
        }

        /* ---- store::paths ---- */
        "stripTrailingSlash" => json!(paths::strip_trailing_slash(
            args[0].as_str().unwrap_or_default()
        )),
        "stripLeadingSlash" => json!(paths::strip_leading_slash(
            args[0].as_str().unwrap_or_default()
        )),
        "parentOf" => json!(paths::parent_of(args[0].as_str().unwrap_or_default())),
        "normalizePath" => json!(paths::normalize_path(args[0].as_str().unwrap_or_default())),
        "joinPath" => {
            let parts: Vec<&str> = args[0]
                .as_array()
                .map(|list| list.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            json!(paths::join_path(&parts))
        }
        "versionsSidecarPath" => json!(paths::versions_sidecar_path(
            args[0].as_str().unwrap_or_default(),
            args[1].as_str().unwrap_or_default()
        )),

        /* ---- store::versions ---- */
        "pushVersionEntry" => json!(versions::push_version_entry(
            &parse::<Vec<VersionEntry>>(&args[0], "versions")?,
            parse::<VersionEntry>(&args[1], "entry")?
        )),
        "buildTextVersionEntry" => {
            // The stamps are the clock's; the harness blanks them on both sides.
            json!(versions::build_text_version_entry(
                versions::NewTextVersion {
                    id: "stamped".to_string(),
                    timestamp: "stamped".to_string(),
                    session_id: "stamped".to_string(),
                    content_html: args[0]["contentHtml"].as_str().map(str::to_string),
                    content_json: Some(args[0]["contentJson"].clone())
                        .filter(|value| !value.is_null()),
                    name: args[0]["name"].as_str().map(str::to_string),
                    auto: args[0]["auto"].as_bool().unwrap_or(true),
                }
            ))
        }
        "buildCanvasVersionEntry" => json!(versions::build_canvas_version_entry(
            "stamped".to_string(),
            "stamped".to_string(),
            "stamped".to_string(),
            parse::<CanvasFile>(&args[0], "canvas")?,
            args[1].as_str().map(str::to_string),
            args[2].as_bool().unwrap_or(true)
        )),

        /* ---- search ---- */
        "matcherState" => {
            let matcher = Matcher::new(
                args[0].as_str().unwrap_or_default(),
                matcher_options(&args[1]),
            );
            // The error TEXT is each engine's own wording; only whether it compiled is
            // comparable.
            json!({ "isEmpty": matcher.is_empty, "valid": matcher.valid })
        }
        "findAll" => {
            let matcher = Matcher::new(
                args[0].as_str().unwrap_or_default(),
                matcher_options(&args[1]),
            );
            let hits = matcher.find_all(args[2].as_str().unwrap_or_default(), usize::MAX);
            json!(hits.iter().map(hit_json).collect::<Vec<_>>())
        }
        "buildPreview" => json!(search::build_preview(
            args[0].as_str().unwrap_or_default(),
            args[1].as_u64().unwrap_or(0) as usize,
            args[2].as_u64().unwrap_or(0) as usize,
            args[3].as_u64().unwrap_or(34) as usize
        )),
        "getEntryLabel" => json!(search::get_entry_label(
            args[0].as_str().unwrap_or_default()
        )),
        "collectMatchesFromDocJson" => {
            let matcher = Matcher::new(
                args[1].as_str().unwrap_or_default(),
                matcher_options(&args[2]),
            );
            json!(search::collect_matches_from_doc_json(
                &args[0],
                &matcher,
                args[3].as_str().unwrap_or_default()
            ))
        }
        "collectCanvasMatches" => {
            let matcher = Matcher::new(
                args[1].as_str().unwrap_or_default(),
                matcher_options(&args[2]),
            );
            json!(search::collect_canvas_matches(
                &args[0],
                &matcher,
                args[3].as_str().unwrap_or_default(),
                args[4].as_u64().unwrap_or(u64::MAX) as usize
            ))
        }
        "searchScopes" => json!(search::search_scopes()),
        "isFilterScope" => json!(search::is_filter_scope(search_scope(&args[0]))),
        "getPanelNoun" => json!(search::get_panel_noun(args[0].as_str().unwrap_or_default())),
        "getSearchPlaceholder" => json!(search::get_search_placeholder(
            search_scope(&args[0]),
            args[1].as_str().unwrap_or_default()
        )),
        "getRecommendedScopes" => {
            json!(search::get_recommended_scopes(
                args[0].as_str().unwrap_or_default()
            ))
        }
        "flattenProjectFiles" => {
            let tree = parse::<inkblot_core::types::TreeNode>(&args[0], "tree")?;
            let files: Vec<Value> = search::flatten_project_files(&tree)
                .iter()
                .map(|ProjectFile { path, name }| json!({ "path": path, "name": name }))
                .collect();
            json!(files)
        }

        /* ---- read_aloud ---- */
        "splitReadAloudText" => json!(read_aloud::split_read_aloud_text(
            args[0].as_str().unwrap_or_default(),
            args[1].as_u64().unwrap_or(220) as usize
        )),
        "buildReadAloudChunks" => json!(read_aloud::build_read_aloud_chunks(
            &parse::<ReadAloudPayload>(&args[0], "payload")?,
            args[1].as_u64().unwrap_or(220) as usize
        )),

        /* ---- notes ---- */
        "normalizeNote" => with_note_defaults(args[1].as_str().unwrap_or_default(), |defaults| {
            json!(notes::normalize_note(&args[0], defaults))
        }),
        "normalizeNotes" => with_note_defaults(args[1].as_str().unwrap_or_default(), |defaults| {
            json!(notes::normalize_notes(&args[0], defaults))
        }),
        "normalizeAudioClip" => {
            let now = args[1].as_str().unwrap_or_default().to_string();
            json!(notes::normalize_audio_clip(
                &args[0],
                &|| "generated".to_string(),
                &move || now.clone()
            ))
        }
        "normalizeNoteAudio" => {
            let now = args[1].as_str().unwrap_or_default().to_string();
            json!(notes::normalize_note_audio(
                &args[0],
                &|| "generated".to_string(),
                &move || now.clone()
            ))
        }
        "formatDuration" => json!(notes::format_duration(f64_arg(args, 0)?)),
        "collectNoteBranchIds" => {
            with_note_defaults(args[2].as_str().unwrap_or_default(), |defaults| {
                let all = notes::normalize_notes(&args[0], defaults);
                json!(notes::collect_note_branch_ids(
                    &all,
                    args[1].as_str().unwrap_or_default()
                ))
            })
        }
        "sortNotes" => with_note_defaults(args[1].as_str().unwrap_or_default(), |defaults| {
            let mut all: Vec<Note> = notes::normalize_notes(&args[0], defaults);
            all.sort_by(notes::compare_notes);
            json!(all)
        }),

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
            fields
                .into_iter()
                .map(|(key, inner)| (key, as_javascript_json(inner)))
                .collect(),
        ),
        other => other,
    }
}

fn main() -> io::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;

    let request: Value =
        serde_json::from_str(&input).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
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
