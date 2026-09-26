//! The map document format.
//!
//! A map lives at `<projectRoot>/<path>.map.json` (tree path `Folder/Name.map`, see
//! `doc_kind`). Unlike a canvas, the runtime shape *is* the on-disk shape: every
//! collection is an array in paint order and every item a JSON object that keeps the
//! keys it does not model. That is why this module works on `serde_json::Value`
//! rather than typed structs — the typed schema in `types::map` describes the modeled
//! keys, and `tests::a_normalized_map_fits_the_typed_schema` holds the two together.
//!
//! Mirrors `src/lib/map/mapModel.js`; `npm run parity` asserts the two agree. A value
//! of the wrong JSON type is replaced by the default, never coerced, and ids are drawn
//! from `next_id` in exactly the order the JS draws them.

use std::collections::HashSet;

use serde_json::{json, Map, Value};

use crate::version_history::text_words;

pub const MAP_FORMAT_VERSION: u32 = 1;

pub const MAP_KINDS: [&str; 4] = ["blank", "image", "earth", "system"];
pub const EARTH_PROJECTIONS: [&str; 5] =
    ["equalEarth", "equirectangular", "mercator", "naturalEarth", "orthographic"];
pub const EARTH_DETAIL: [&str; 3] = ["auto", "110m", "50m"];
pub const ROUTE_SMOOTHING: [&str; 2] = ["linear", "catmullRom"];
pub const LINE_DASHES: [&str; 5] = ["solid", "dashed", "dotted", "inked", "rough"];
pub const HATCHES: [&str; 6] = ["none", "diagonal", "cross", "dots", "waves", "mountains"];
pub const TRANSPORT_MEDIA: [&str; 4] = ["land", "water", "air", "space"];
pub const MAP_THEMES: [&str; 4] = ["clean", "parchment", "ink", "night"];
pub const BODY_KINDS: [&str; 7] = ["star", "planet", "dwarf", "moon", "belt", "station", "barycenter"];
pub const RADIAL_MODES: [&str; 2] = ["linear", "log"];

/// A blank map is a sheet this big, in map units, until something says otherwise.
pub const BLANK_SHEET_WIDTH: f64 = 4000.0;
pub const BLANK_SHEET_HEIGHT: f64 = 3000.0;

/* ---------- reading raw JSON ---------- */

type Object = Map<String, Value>;

fn empty() -> &'static Object {
    static EMPTY: once_cell::sync::Lazy<Object> = once_cell::sync::Lazy::new(Map::new);
    &EMPTY
}

/// `isObject(value) ? value : {}`.
fn object_or(value: Option<&Value>) -> &Object {
    value.and_then(Value::as_object).unwrap_or_else(|| empty())
}

fn get<'a>(object: &'a Object, key: &str) -> Option<&'a Value> {
    object.get(key)
}

/// `Number.isFinite(value)` — JSON numbers are always finite, so any number qualifies.
fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|number| number.is_finite())
}

/// A number the way JS would write it back: the raw JSON value when it is one, so an
/// integer stays an integer.
fn number_or(value: Option<&Value>, fallback: Value) -> Value {
    match value {
        Some(number @ Value::Number(_)) if finite(Some(number)).is_some() => number.clone(),
        _ => fallback,
    }
}

fn positive(value: Option<&Value>) -> Option<&Value> {
    value.filter(|inner| finite(Some(inner)).is_some_and(|number| number > 0.0))
}

fn positive_or(value: Option<&Value>, fallback: Value) -> Value {
    positive(value).cloned().unwrap_or(fallback)
}

fn string_or(value: Option<&Value>, fallback: Value) -> Value {
    match value {
        Some(text @ Value::String(_)) => text.clone(),
        _ => fallback,
    }
}

fn bool_or(value: Option<&Value>, fallback: bool) -> Value {
    Value::Bool(value.and_then(Value::as_bool).unwrap_or(fallback))
}

fn one_of(value: Option<&Value>, allowed: &[&str], fallback: &str) -> Value {
    match value.and_then(Value::as_str) {
        Some(text) if allowed.contains(&text) => Value::String(text.to_string()),
        _ => Value::String(fallback.to_string()),
    }
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    // `Math.min(high, Math.max(low, value))`; no NaN can reach here from JSON.
    value.max(low).min(high)
}

fn non_empty_string(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|text| !text.is_empty())
}

/// `[x, y]` from anything; `None` unless both are numbers. Extra entries drop.
pub fn read_point(value: Option<&Value>) -> Option<Value> {
    let items = value?.as_array()?;
    if items.len() < 2 {
        return None;
    }
    finite(items.first())?;
    finite(items.get(1))?;
    Some(Value::Array(vec![items[0].clone(), items[1].clone()]))
}

fn read_points(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| read_point(Some(item))).collect())
        .unwrap_or_default()
}

/// Normalize an array of items that each carry an `id` — see `readList` in JS. The id
/// is drawn before `normalize_item` runs, so a dropped item still consumes one.
fn read_list(
    value: Option<&Value>,
    next_id: &mut dyn FnMut() -> String,
    normalize_item: &mut dyn FnMut(Object, &mut dyn FnMut() -> String) -> Option<Object>,
) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let Some(items) = value.and_then(Value::as_array) else { return out };
    for item in items {
        let Some(item) = item.as_object() else { continue };
        let id = match non_empty_string(item.get("id")) {
            Some(id) => id.to_string(),
            None => next_id(),
        };
        if seen.contains(&id) {
            continue;
        }
        let mut with_id = item.clone();
        with_id.insert("id".into(), Value::String(id.clone()));
        let Some(normalized) = normalize_item(with_id, next_id) else { continue };
        seen.insert(id);
        out.push(Value::Object(normalized));
    }
    out
}

fn ids_of(list: &[Value]) -> HashSet<String> {
    list.iter().filter_map(|item| item["id"].as_str().map(str::to_string)).collect()
}

fn set(object: &mut Object, key: &str, value: Value) {
    object.insert(key.to_string(), value);
}

/// A string reference kept only when it names something in `ids`.
fn reference(value: Option<&Value>, ids: &HashSet<String>) -> Value {
    match value.and_then(Value::as_str) {
        Some(id) if ids.contains(id) => Value::String(id.to_string()),
        _ => Value::Null,
    }
}

/* ---------- sections ---------- */

fn read_scale(raw: Option<&Value>) -> Value {
    let scale = object_or(raw);
    let calibration = object_or(scale.get("calibration"));
    let a = read_point(calibration.get("a"));
    let b = read_point(calibration.get("b"));
    let distance = positive(calibration.get("distance")).cloned();

    let mut out = scale.clone();
    set(&mut out, "kmPerUnit", positive_or(scale.get("kmPerUnit"), json!(1)));
    set(&mut out, "displayUnit", string_or(scale.get("displayUnit"), json!("km")));
    let calibration_value = match (a, b, distance) {
        (Some(a), Some(b), Some(distance)) => {
            let mut next = calibration.clone();
            set(&mut next, "a", a);
            set(&mut next, "b", b);
            set(&mut next, "distance", distance);
            set(&mut next, "unit", string_or(calibration.get("unit"), json!("km")));
            Value::Object(next)
        }
        _ => Value::Null,
    };
    set(&mut out, "calibration", calibration_value);
    let units = scale
        .get("customUnits")
        .and_then(Value::as_array)
        .map(|units| {
            units
                .iter()
                .filter_map(Value::as_object)
                .filter(|unit| non_empty_string(unit.get("id")).is_some() && positive(unit.get("km")).is_some())
                .map(|unit| {
                    let mut next = unit.clone();
                    set(&mut next, "name", string_or(unit.get("name"), unit["id"].clone()));
                    Value::Object(next)
                })
                .collect()
        })
        .unwrap_or_default();
    set(&mut out, "customUnits", Value::Array(units));
    Value::Object(out)
}

fn read_background(raw: Option<&Value>) -> Value {
    let background = object_or(raw);
    let opacity = finite(background.get("opacity")).unwrap_or(1.0);
    let mut out = background.clone();
    set(&mut out, "image", string_or(background.get("image"), Value::Null));
    set(&mut out, "width", positive_or(background.get("width"), Value::Null));
    set(&mut out, "height", positive_or(background.get("height"), Value::Null));
    // Keep a number that is already in range as it was written (an integer 1 stays 1).
    let opacity_value = if (0.0..=1.0).contains(&opacity) {
        number_or(background.get("opacity"), json!(1))
    } else {
        json!(clamp(opacity, 0.0, 1.0))
    };
    set(&mut out, "opacity", opacity_value);
    set(&mut out, "trace", string_or(background.get("trace"), Value::Null));
    set(&mut out, "showImage", bool_or(background.get("showImage"), true));
    Value::Object(out)
}

fn read_earth(raw: Option<&Value>) -> Value {
    let earth = object_or(raw);
    let mut out = earth.clone();
    set(&mut out, "projection", one_of(earth.get("projection"), &EARTH_PROJECTIONS, "equalEarth"));
    set(&mut out, "rotate", read_point(earth.get("rotate")).unwrap_or_else(|| json!([0, 0])));
    set(&mut out, "graticule", bool_or(earth.get("graticule"), true));
    set(&mut out, "borders", bool_or(earth.get("borders"), true));
    set(&mut out, "detail", one_of(earth.get("detail"), &EARTH_DETAIL, "auto"));
    Value::Object(out)
}

fn clamped_number(value: Option<&Value>, fallback: f64, low: f64, high: f64) -> Value {
    let number = finite(value).unwrap_or(fallback);
    if (low..=high).contains(&number) && finite(value).is_some() {
        value.cloned().unwrap_or(Value::Null)
    } else {
        json!(clamp(number, low, high))
    }
}

fn read_orbit(raw: Option<&Value>) -> Value {
    let Some(orbit) = raw.and_then(Value::as_object) else { return Value::Null };
    let Some(a_au) = positive(orbit.get("aAU")).cloned() else { return Value::Null };
    let mut out = orbit.clone();
    set(&mut out, "aAU", a_au);
    // Past 0.99 the Kepler solve stops converging in a fixed number of steps.
    set(&mut out, "e", clamped_number(orbit.get("e"), 0.0, 0.0, 0.99));
    set(&mut out, "periapsisDeg", number_or(orbit.get("periapsisDeg"), json!(0)));
    set(&mut out, "meanAnomalyDeg", number_or(orbit.get("meanAnomalyDeg"), json!(0)));
    set(&mut out, "periodDays", positive_or(orbit.get("periodDays"), Value::Null));
    set(&mut out, "retrograde", bool_or(orbit.get("retrograde"), false));
    Value::Object(out)
}

fn read_body(body: Object) -> Object {
    let mut out = body.clone();
    set(&mut out, "name", string_or(body.get("name"), json!("")));
    set(&mut out, "kind", one_of(body.get("kind"), &BODY_KINDS, "planet"));
    set(&mut out, "parent", string_or(body.get("parent"), Value::Null));
    set(&mut out, "massSun", positive_or(body.get("massSun"), Value::Null));
    set(&mut out, "radiusKm", positive_or(body.get("radiusKm"), Value::Null));
    set(&mut out, "color", string_or(body.get("color"), Value::Null));
    set(&mut out, "orbit", read_orbit(body.get("orbit")));
    out
}

fn read_system(raw: Option<&Value>, next_id: &mut dyn FnMut() -> String) -> Value {
    let system = object_or(raw);
    let display = object_or(system.get("display"));
    let mut bodies = read_list(system.get("bodies"), next_id, &mut |body, _| Some(read_body(body)));
    // A parent that is not a body here (or is the body itself) orbits nothing.
    let ids = ids_of(&bodies);
    for body in &mut bodies {
        let id = body["id"].as_str().unwrap_or_default().to_string();
        let orphan = match body["parent"].as_str() {
            Some(parent) => !ids.contains(parent) || parent == id,
            None => false,
        };
        if orphan {
            body["parent"] = Value::Null;
        }
    }

    let mut display_out = display.clone();
    set(&mut display_out, "radial", one_of(display.get("radial"), &RADIAL_MODES, "log"));
    set(&mut display_out, "pxPerAU", positive_or(display.get("pxPerAU"), json!(100)));

    let mut out = system.clone();
    set(&mut out, "bodies", Value::Array(bodies));
    set(&mut out, "display", Value::Object(display_out));
    Value::Object(out)
}

fn read_line_style(raw: Option<&Value>) -> Value {
    let style = object_or(raw);
    let mut out = style.clone();
    set(&mut out, "stroke", string_or(style.get("stroke"), Value::Null));
    set(&mut out, "width", positive_or(style.get("width"), json!(2)));
    set(&mut out, "dash", one_of(style.get("dash"), &LINE_DASHES, "solid"));
    set(&mut out, "arrow", bool_or(style.get("arrow"), false));
    Value::Object(out)
}

fn read_pin(pin: Object) -> Option<Object> {
    let at = read_point(pin.get("at"));
    let body = pin.get("body").and_then(Value::as_str).map(str::to_string);
    // Somewhere to be is the one thing a pin cannot do without. (`!body` in JS: an
    // empty string is no body either.)
    if at.is_none() && body.as_deref().is_none_or(str::is_empty) {
        return None;
    }
    let mut out = pin.clone();
    set(&mut out, "name", string_or(pin.get("name"), Value::Null));
    set(&mut out, "doc", string_or(pin.get("doc"), Value::Null));
    set(&mut out, "at", at.unwrap_or(Value::Null));
    set(&mut out, "body", body.map(Value::String).unwrap_or(Value::Null));
    set(&mut out, "icon", string_or(pin.get("icon"), json!("pin")));
    set(&mut out, "color", string_or(pin.get("color"), Value::Null));
    Some(out)
}

fn read_route(route: Object, pin_ids: &HashSet<String>) -> Option<Object> {
    let mut nodes = Vec::new();
    for node in route.get("nodes").and_then(Value::as_array).into_iter().flatten() {
        let Some(node) = node.as_object() else { continue };
        if node.get("pin").and_then(Value::as_str).is_some_and(|pin| pin_ids.contains(pin)) {
            let mut rest = node.clone();
            rest.remove("at");
            nodes.push(Value::Object(rest));
            continue;
        }
        if let Some(at) = read_point(node.get("at")) {
            let mut rest = node.clone();
            rest.remove("pin");
            set(&mut rest, "at", at);
            nodes.push(Value::Object(rest));
        }
    }
    // A route of fewer than two stops has no line to draw.
    if nodes.len() < 2 {
        return None;
    }
    let mut out = route.clone();
    set(&mut out, "name", string_or(route.get("name"), Value::Null));
    set(&mut out, "nodes", Value::Array(nodes));
    set(&mut out, "smooth", one_of(route.get("smooth"), &ROUTE_SMOOTHING, "linear"));
    set(&mut out, "style", read_line_style(route.get("style")));
    Some(out)
}

fn read_region(region: Object) -> Option<Object> {
    let rings: Vec<Value> = region
        .get("rings")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|ring| read_points(Some(ring)))
        .filter(|ring| ring.len() >= 3)
        .map(Value::Array)
        .collect();
    if rings.is_empty() {
        return None;
    }
    let mut out = region.clone();
    set(&mut out, "name", string_or(region.get("name"), Value::Null));
    set(&mut out, "rings", Value::Array(rings));
    set(&mut out, "terrain", string_or(region.get("terrain"), Value::Null));
    set(&mut out, "fill", string_or(region.get("fill"), Value::Null));
    set(&mut out, "hatch", one_of(region.get("hatch"), &HATCHES, "none"));
    set(&mut out, "stroke", string_or(region.get("stroke"), Value::Null));
    Some(out)
}

/// Speed multipliers keyed by transport id or `*<medium>`; only numbers ≥ 0 count.
fn read_multipliers(raw: Option<&Value>) -> Value {
    let multipliers = object_or(raw)
        .iter()
        .filter(|(_, value)| finite(Some(value)).is_some_and(|number| number >= 0.0))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    Value::Object(multipliers)
}

fn read_terrain(terrain: Object) -> Object {
    let mut out = terrain.clone();
    set(&mut out, "name", string_or(terrain.get("name"), terrain["id"].clone()));
    set(&mut out, "multipliers", read_multipliers(terrain.get("multipliers")));
    out
}

fn read_label(label: Object, route_ids: &HashSet<String>) -> Option<Object> {
    let at = read_point(label.get("at"));
    let route = reference(label.get("route"), route_ids);
    let path = read_points(label.get("path"));
    if at.is_none() && route.is_null() && path.len() < 2 {
        return None;
    }
    let mut out = label.clone();
    set(&mut out, "text", string_or(label.get("text"), json!("")));
    set(&mut out, "at", at.unwrap_or(Value::Null));
    set(&mut out, "route", route);
    set(&mut out, "path", if path.len() >= 2 { Value::Array(path) } else { Value::Null });
    set(&mut out, "startOffset", clamped_number(label.get("startOffset"), 0.5, 0.0, 1.0));
    set(&mut out, "size", positive_or(label.get("size"), json!(18)));
    set(&mut out, "rotation", number_or(label.get("rotation"), json!(0)));
    set(&mut out, "font", string_or(label.get("font"), json!("serif")));
    set(&mut out, "minZoom", number_or(label.get("minZoom"), json!(0)));
    set(&mut out, "maxZoom", positive_or(label.get("maxZoom"), Value::Null));
    Some(out)
}

fn read_transport(transport: Object) -> Object {
    let fraction_c = finite(transport.get("fractionC"));
    let mut out = transport.clone();
    set(&mut out, "name", string_or(transport.get("name"), transport["id"].clone()));
    set(&mut out, "kmh", positive_or(transport.get("kmh"), json!(5)));
    let hours = positive_or(transport.get("hoursPerDay"), json!(8));
    let hours = if hours.as_f64().unwrap_or(8.0) > 24.0 { json!(24) } else { hours };
    set(&mut out, "hoursPerDay", hours);
    set(&mut out, "medium", one_of(transport.get("medium"), &TRANSPORT_MEDIA, "land"));
    let fraction = match fraction_c {
        Some(fraction) if fraction > 0.0 && fraction < 1.0 => transport["fractionC"].clone(),
        _ => Value::Null,
    };
    set(&mut out, "fractionC", fraction);
    out
}

fn read_leg(leg: Object, route_ids: &HashSet<String>, pin_ids: &HashSet<String>) -> Object {
    let mut out = leg.clone();
    set(&mut out, "route", reference(leg.get("route"), route_ids));
    set(&mut out, "from", reference(leg.get("from"), pin_ids));
    set(&mut out, "to", reference(leg.get("to"), pin_ids));
    set(&mut out, "transport", string_or(leg.get("transport"), json!("walk")));
    set(&mut out, "departDay", number_or(leg.get("departDay"), Value::Null));
    let rest = finite(leg.get("restDays")).unwrap_or(0.0);
    set(&mut out, "restDays", if rest >= 0.0 { number_or(leg.get("restDays"), json!(0)) } else { json!(0) });
    out
}

fn read_traveler(
    traveler: Object,
    route_ids: &HashSet<String>,
    pin_ids: &HashSet<String>,
    next_id: &mut dyn FnMut() -> String,
) -> Object {
    let mut out = traveler.clone();
    set(&mut out, "doc", string_or(traveler.get("doc"), Value::Null));
    set(&mut out, "name", string_or(traveler.get("name"), Value::Null));
    set(&mut out, "color", string_or(traveler.get("color"), Value::Null));
    set(&mut out, "startPin", reference(traveler.get("startPin"), pin_ids));
    set(&mut out, "startDay", number_or(traveler.get("startDay"), json!(0)));
    let legs = read_list(traveler.get("legs"), next_id, &mut |leg, _| Some(read_leg(leg, route_ids, pin_ids)));
    set(&mut out, "legs", Value::Array(legs));
    out
}

/// A screen-anchored ornament: `at` is a fraction of the view, 0–1 on each axis.
fn read_ornament(raw: Option<&Value>, show: bool, at: [f64; 2], extra: &[(&str, Value)]) -> Value {
    let ornament = object_or(raw);
    let mut out = ornament.clone();
    for (key, value) in extra {
        set(&mut out, key, value.clone());
    }
    set(&mut out, "show", bool_or(ornament.get("show"), show));
    set(&mut out, "at", read_point(ornament.get("at")).unwrap_or_else(|| json!(at)));
    Value::Object(out)
}

fn read_style(raw: Option<&Value>) -> Value {
    let style = object_or(raw);
    let compass = object_or(style.get("compass"));
    let cartouche = object_or(style.get("cartouche"));
    let mut out = style.clone();
    set(&mut out, "theme", one_of(style.get("theme"), &MAP_THEMES, "clean"));
    set(
        &mut out,
        "compass",
        read_ornament(
            style.get("compass"),
            true,
            [0.92, 0.14],
            &[
                ("size", positive_or(compass.get("size"), json!(96))),
                ("style", string_or(compass.get("style"), json!("rose8"))),
            ],
        ),
    );
    set(&mut out, "scaleBar", read_ornament(style.get("scaleBar"), true, [0.05, 0.94], &[]));
    set(
        &mut out,
        "cartouche",
        read_ornament(
            style.get("cartouche"),
            false,
            [0.08, 0.08],
            &[
                ("title", string_or(cartouche.get("title"), Value::Null)),
                ("subtitle", string_or(cartouche.get("subtitle"), Value::Null)),
            ],
        ),
    );
    Value::Object(out)
}

/// Read the persisted viewport, tolerating a missing or malformed one.
pub fn read_map_viewport(raw: &Value) -> Value {
    let Some(viewport) = raw.get("viewport").and_then(Value::as_object) else {
        return json!({ "x": 0, "y": 0, "zoom": 1 });
    };
    json!({
        "x": number_or(get(viewport, "x"), json!(0)),
        "y": number_or(get(viewport, "y"), json!(0)),
        "zoom": positive_or(get(viewport, "zoom"), json!(1)),
    })
}

/* ---------- normalize ---------- */

/// Parse arbitrary on-disk JSON into a map, drawing ids for items that lack one from
/// `next_id`. Anything unrecognizable degrades to a blank map rather than failing.
pub fn normalize_map_with(raw: &Value, mut next_id: impl FnMut() -> String) -> Value {
    let source = raw.as_object().cloned().unwrap_or_default();
    let next_id: &mut dyn FnMut() -> String = &mut next_id;

    let pins = read_list(source.get("pins"), next_id, &mut |pin, _| read_pin(pin));
    let pin_ids = ids_of(&pins);
    let routes = read_list(source.get("routes"), next_id, &mut |route, _| read_route(route, &pin_ids));
    let route_ids = ids_of(&routes);

    let mut out = source.clone();
    set(&mut out, "type", json!("map"));
    set(&mut out, "formatVersion", json!(MAP_FORMAT_VERSION));
    set(&mut out, "mapKind", one_of(source.get("mapKind"), &MAP_KINDS, "blank"));
    set(&mut out, "scale", read_scale(source.get("scale")));
    set(&mut out, "background", read_background(source.get("background")));
    set(&mut out, "earth", read_earth(source.get("earth")));
    set(&mut out, "system", read_system(source.get("system"), next_id));
    set(&mut out, "pins", Value::Array(pins));
    set(&mut out, "routes", Value::Array(routes));
    let regions = read_list(source.get("regions"), next_id, &mut |region, _| read_region(region));
    set(&mut out, "regions", Value::Array(regions));
    let terrains = read_list(source.get("terrains"), next_id, &mut |terrain, _| Some(read_terrain(terrain)));
    set(&mut out, "terrains", Value::Array(terrains));
    let labels = read_list(source.get("labels"), next_id, &mut |label, _| read_label(label, &route_ids));
    set(&mut out, "labels", Value::Array(labels));
    let transports =
        read_list(source.get("transports"), next_id, &mut |transport, _| Some(read_transport(transport)));
    set(&mut out, "transports", Value::Array(transports));
    let travelers = read_list(source.get("travelers"), next_id, &mut |traveler, ids| {
        Some(read_traveler(traveler, &route_ids, &pin_ids, ids))
    });
    set(&mut out, "travelers", Value::Array(travelers));

    let timeline = object_or(source.get("timeline"));
    let mut timeline_out = timeline.clone();
    set(&mut timeline_out, "day", number_or(timeline.get("day"), json!(0)));
    set(&mut out, "timeline", Value::Object(timeline_out));
    set(&mut out, "style", read_style(source.get("style")));
    set(&mut out, "viewport", read_map_viewport(raw));
    Value::Object(out)
}

/// A fresh random id, the style canvases use.
pub fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or(0);
    let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{:016x}", (nanos as u64) ^ count.wrapping_mul(0x9e37_79b9_7f4a_7c15))
}

pub fn normalize_map(raw: &Value) -> Value {
    normalize_map_with(raw, new_id)
}

/// Is this raw file content a map (or nothing at all)? The store refuses to write a
/// map over anything else — a text document named `Something.map` predates maps.
pub fn is_map_payload(raw: Option<&Value>) -> bool {
    match raw {
        None | Some(Value::Null) => true,
        Some(Value::Object(object)) => object.get("type").and_then(Value::as_str) == Some("map"),
        _ => false,
    }
}

/// A new, empty map of `map_kind` (anything unknown is `blank`).
pub fn create_empty_map(map_kind: &str) -> Value {
    let kind = if MAP_KINDS.contains(&map_kind) { map_kind } else { "blank" };
    let mut base = json!({ "mapKind": kind });
    if kind == "blank" {
        base["background"] = json!({ "width": BLANK_SHEET_WIDTH, "height": BLANK_SHEET_HEIGHT });
    }
    normalize_map(&base)
}

/* ---------- queries ---------- */

/// Every piece of text written onto a map — names, labels and the cartouche — in the
/// order `count_map_words` and `map_text` read them.
fn map_strings(map: &Value) -> Vec<&str> {
    let Some(object) = map.as_object() else { return Vec::new() };
    let mut out = Vec::new();
    for key in ["pins", "routes", "regions", "travelers"] {
        for item in object.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(name) = item.as_object().and_then(|item| item.get("name")).and_then(Value::as_str) {
                out.push(name);
            }
        }
    }
    for label in object.get("labels").and_then(Value::as_array).into_iter().flatten() {
        if let Some(text) = label.as_object().and_then(|label| label.get("text")).and_then(Value::as_str) {
            out.push(text);
        }
    }
    let cartouche = object_or(object_or(object.get("style")).get("cartouche"));
    out.extend(["title", "subtitle"].into_iter().filter_map(|key| cartouche.get(key).and_then(Value::as_str)));
    out
}

/// Words written onto a map — names and labels. Mirrors `count_canvas_words`.
pub fn count_map_words(map: &Value) -> u32 {
    map_strings(map).into_iter().map(|text| text_words(text).len()).sum::<usize>() as u32
}

/// The text written onto a map, space-separated — what filtering a map's history
/// by a place's name searches.
pub fn map_text(map: &Value) -> String {
    map_strings(map).join(" ")
}

/// Every doc the map links to, deduplicated, in first-seen order.
pub fn map_doc_refs(map: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for key in ["pins", "travelers"] {
        for item in map.get(key).and_then(Value::as_array).into_iter().flatten() {
            if let Some(doc) = non_empty_string(item.get("doc")) {
                if !out.iter().any(|seen| seen == doc) {
                    out.push(doc.to_string());
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counter() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            let id = format!("gen{next}");
            next += 1;
            id
        }
    }

    #[test]
    fn garbage_opens_as_a_blank_map() {
        for raw in [json!(null), json!(7), json!("map"), json!([1, 2])] {
            let map = normalize_map_with(&raw, counter());
            assert_eq!(map["type"], "map");
            assert_eq!(map["mapKind"], "blank");
            assert_eq!(map["pins"], json!([]));
        }
    }

    #[test]
    fn unknown_keys_survive_at_every_level() {
        let raw = json!({
            "mapKind": "image",
            "futureKey": { "a": 1 },
            "pins": [{ "id": "p1", "at": [1, 2], "glow": true }],
            "style": { "compass": { "flourish": 3 } },
        });
        let map = normalize_map_with(&raw, counter());
        assert_eq!(map["futureKey"], json!({ "a": 1 }));
        assert_eq!(map["pins"][0]["glow"], true);
        assert_eq!(map["style"]["compass"]["flourish"], 3);
    }

    #[test]
    fn references_to_missing_items_are_cut() {
        let raw = json!({
            "pins": [{ "id": "a", "at": [0, 0] }, { "id": "b", "at": [5, 5] }],
            "routes": [
                { "id": "r", "nodes": [{ "pin": "a" }, { "pin": "gone" }, { "at": [9, 9] }] },
                { "id": "short", "nodes": [{ "pin": "a" }] },
            ],
            "travelers": [{ "startPin": "gone", "legs": [{ "from": "a", "to": "b", "route": "short" }] }],
        });
        let map = normalize_map_with(&raw, counter());
        assert_eq!(map["routes"].as_array().unwrap().len(), 1);
        assert_eq!(map["routes"][0]["nodes"], json!([{ "pin": "a" }, { "at": [9, 9] }]));
        let traveler = &map["travelers"][0];
        assert_eq!(traveler["id"], "gen0");
        assert_eq!(traveler["startPin"], Value::Null);
        assert_eq!(traveler["legs"][0]["id"], "gen1");
        assert_eq!(traveler["legs"][0]["route"], Value::Null);
    }

    #[test]
    fn only_a_map_or_nothing_counts_as_a_map_payload() {
        assert!(is_map_payload(None));
        assert!(is_map_payload(Some(&json!(null))));
        assert!(is_map_payload(Some(&json!({ "type": "map" }))));
        assert!(!is_map_payload(Some(&json!({ "content": [], "notes": [] }))));
    }

    #[test]
    fn words_come_from_names_and_labels() {
        let map = json!({
            "pins": [{ "name": "Old Harbour" }],
            "labels": [{ "text": "The Salt Road" }],
            "style": { "cartouche": { "title": "Aria" } },
        });
        assert_eq!(count_map_words(&map), 6);
    }

    #[test]
    fn a_normalized_map_fits_the_typed_schema() {
        let map = normalize_map_with(
            &json!({
                "pins": [{ "id": "a", "at": [0, 0], "doc": "Settings/Port" }],
                "routes": [{ "id": "r", "nodes": [{ "pin": "a" }, { "at": [3, 4] }] }],
                "regions": [{ "rings": [[[0, 0], [1, 0], [1, 1]]], "hatch": "waves" }],
                "labels": [{ "text": "Sea", "route": "r" }],
                "transports": [{ "id": "wyvern", "kmh": 60, "medium": "air" }],
                "terrains": [{ "id": "forest", "multipliers": { "walk": 0.7 } }],
                "travelers": [{ "doc": "Characters/Anna", "legs": [{ "from": "a", "to": "a" }] }],
                "system": { "bodies": [{ "id": "sun", "kind": "star", "massSun": 1 },
                                       { "id": "earth", "parent": "sun", "orbit": { "aAU": 1 } }] },
            }),
            counter(),
        );
        let typed: crate::types::MapFile = serde_json::from_value(map).expect("fits the schema");
        assert_eq!(typed.pins.len(), 1);
        assert_eq!(create_empty_map("blank")["background"]["width"], json!(BLANK_SHEET_WIDTH));
        serde_json::from_value::<crate::types::MapFile>(create_empty_map("system")).expect("empty fits");
    }
}
