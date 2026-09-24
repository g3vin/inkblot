//! The map document's modeled keys.
//!
//! `map::model` normalizes on `serde_json::Value` so that every key it does not model
//! survives a round-trip; these types describe the keys it *does* model, for the
//! TypeScript and Swift that read a map. Every item also carries unknown keys, which
//! typeshare cannot express — the hand-written `Stored*` façade in
//! `src/types/index.ts` adds the index signature, as it does for canvas nodes.
//!
//! A point is `[x, y]`: pixels on a plane map, `[lon, lat]` degrees on an Earth map,
//! AU on a star system. Only `mapSpace.js` interprets one.
//!
//! Nullable fields are always *present* after normalizing (as `null`), hence the
//! `T | null` overrides rather than typeshare's default optional `field?: T`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MapKind {
    Blank,
    Image,
    Earth,
    System,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCalibration {
    pub a: Vec<f64>,
    pub b: Vec<f64>,
    /// The distance between `a` and `b`, in `unit`.
    pub distance: f64,
    pub unit: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCustomUnit {
    pub id: String,
    pub name: String,
    pub km: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapScale {
    /// Kilometres per map unit on a plane map. Earth and system maps carry their own
    /// intrinsic scale and ignore it.
    pub km_per_unit: f64,
    pub display_unit: String,
    #[typeshare(typescript(type = "MapCalibration | null"))]
    pub calibration: Option<MapCalibration>,
    pub custom_units: Vec<MapCustomUnit>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBackground {
    /// A project asset path (`.assets/<hash>.<ext>`).
    #[typeshare(typescript(type = "string | null"))]
    pub image: Option<String>,
    #[typeshare(typescript(type = "number | null"))]
    pub width: Option<f64>,
    #[typeshare(typescript(type = "number | null"))]
    pub height: Option<f64>,
    pub opacity: f64,
    /// The traced vector outline, an SVG asset.
    #[typeshare(typescript(type = "string | null"))]
    pub trace: Option<String>,
    pub show_image: bool,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EarthProjection {
    EqualEarth,
    Equirectangular,
    Mercator,
    NaturalEarth,
    Orthographic,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEarth {
    pub projection: EarthProjection,
    /// `[λ, φ]` rotation in degrees; what an orthographic globe is turned to.
    pub rotate: Vec<f64>,
    pub graticule: bool,
    pub borders: bool,
    /// `auto`, `110m` or `50m`.
    pub detail: String,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BodyKind {
    Star,
    Planet,
    Dwarf,
    Moon,
    Belt,
    Station,
    Barycenter,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapOrbit {
    /// Semi-major axis, in AU.
    #[serde(rename = "aAU")]
    pub a_au: f64,
    /// Eccentricity, 0 to 0.99.
    pub e: f64,
    pub periapsis_deg: f64,
    /// Mean anomaly at day 0.
    pub mean_anomaly_deg: f64,
    /// Overrides the period Kepler's third law gives.
    #[typeshare(typescript(type = "number | null"))]
    pub period_days: Option<f64>,
    pub retrograde: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBody {
    pub id: String,
    pub name: String,
    pub kind: BodyKind,
    #[typeshare(typescript(type = "string | null"))]
    pub parent: Option<String>,
    #[typeshare(typescript(type = "number | null"))]
    pub mass_sun: Option<f64>,
    #[typeshare(typescript(type = "number | null"))]
    pub radius_km: Option<f64>,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
    #[typeshare(typescript(type = "MapOrbit | null"))]
    pub orbit: Option<MapOrbit>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSystemDisplay {
    /// `linear` or `log`.
    pub radial: String,
    #[serde(rename = "pxPerAU")]
    pub px_per_au: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSystem {
    pub bodies: Vec<MapBody>,
    pub display: MapSystemDisplay,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPin {
    pub id: String,
    /// Overrides the linked doc's name.
    #[typeshare(typescript(type = "string | null"))]
    pub name: Option<String>,
    /// Tree path of the linked doc — a location, usually.
    #[typeshare(typescript(type = "string | null"))]
    pub doc: Option<String>,
    #[typeshare(typescript(type = "number[] | null"))]
    pub at: Option<Vec<f64>>,
    /// On a star system, the body the pin rides on instead of a fixed point.
    #[typeshare(typescript(type = "string | null"))]
    pub body: Option<String>,
    pub icon: String,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
}

/// One stop on a route: a pin (which the route then follows when it moves) or a
/// free point. Exactly one of the two is set.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRouteNode {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<Vec<f64>>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLineStyle {
    #[typeshare(typescript(type = "string | null"))]
    pub stroke: Option<String>,
    pub width: f64,
    /// `solid`, `dashed`, `dotted`, `inked` or `rough`.
    pub dash: String,
    pub arrow: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRoute {
    pub id: String,
    #[typeshare(typescript(type = "string | null"))]
    pub name: Option<String>,
    pub nodes: Vec<MapRouteNode>,
    /// `linear` or `catmullRom`.
    pub smooth: String,
    pub style: MapLineStyle,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRegion {
    pub id: String,
    #[typeshare(typescript(type = "string | null"))]
    pub name: Option<String>,
    /// The outer ring first; any further ring is a hole.
    pub rings: Vec<Vec<Vec<f64>>>,
    /// A terrain id; travel across the region takes its multipliers.
    #[typeshare(typescript(type = "string | null"))]
    pub terrain: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub fill: Option<String>,
    pub hatch: String,
    #[typeshare(typescript(type = "string | null"))]
    pub stroke: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTerrain {
    pub id: String,
    pub name: String,
    /// Speed multipliers keyed by transport id, or `*land`/`*water`/… for a whole
    /// medium. 0 is impassable; a transport that is not listed moves at full speed.
    pub multipliers: HashMap<String, f64>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLabel {
    pub id: String,
    pub text: String,
    #[typeshare(typescript(type = "number[] | null"))]
    pub at: Option<Vec<f64>>,
    /// A route the text runs along.
    #[typeshare(typescript(type = "string | null"))]
    pub route: Option<String>,
    /// A free path the text runs along.
    #[typeshare(typescript(type = "number[][] | null"))]
    pub path: Option<Vec<Vec<f64>>>,
    pub start_offset: f64,
    pub size: f64,
    pub rotation: f64,
    pub font: String,
    pub min_zoom: f64,
    #[typeshare(typescript(type = "number | null"))]
    pub max_zoom: Option<f64>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportMedium {
    Land,
    Water,
    Air,
    Space,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTransport {
    pub id: String,
    pub name: String,
    pub kmh: f64,
    /// Hours actually spent moving in a day.
    pub hours_per_day: f64,
    pub medium: TransportMedium,
    /// Set on relativistic transports: the speed as a fraction of c (then `kmh` is
    /// derived from it).
    #[serde(rename = "fractionC")]
    #[typeshare(typescript(type = "number | null"))]
    pub fraction_c: Option<f64>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLeg {
    pub id: String,
    /// The route to follow; straight (or great-circle) from `from` to `to` without one.
    #[typeshare(typescript(type = "string | null"))]
    pub route: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub from: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub to: Option<String>,
    pub transport: String,
    /// A fixed departure day; null leaves when the previous leg arrives (plus rest).
    #[typeshare(typescript(type = "number | null"))]
    pub depart_day: Option<f64>,
    pub rest_days: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTraveler {
    pub id: String,
    /// Tree path of the character doc.
    #[typeshare(typescript(type = "string | null"))]
    pub doc: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub name: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub start_pin: Option<String>,
    pub start_day: f64,
    pub legs: Vec<MapLeg>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTimeline {
    /// The story day the map shows, a float; day 0 is the story's epoch.
    pub day: f64,
}

/// A screen-anchored ornament; `at` is a fraction of the view on each axis.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapOrnament {
    pub show: bool,
    pub at: Vec<f64>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCompass {
    pub show: bool,
    pub at: Vec<f64>,
    pub size: f64,
    pub style: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCartouche {
    pub show: bool,
    pub at: Vec<f64>,
    #[typeshare(typescript(type = "string | null"))]
    pub title: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub subtitle: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapStyle {
    /// `clean`, `parchment`, `ink` or `night`.
    pub theme: String,
    pub compass: MapCompass,
    pub scale_bar: MapOrnament,
    pub cartouche: MapCartouche,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// The object written to `<name>.map.json`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapFile {
    /// Always `"map"`. Never routed on (the kind is the path's), but the store checks
    /// it before overwriting a file, so a text document named `x.map` survives.
    #[serde(rename = "type")]
    pub file_type: String,
    pub format_version: u32,
    pub map_kind: MapKind,
    pub scale: MapScale,
    pub background: MapBackground,
    pub earth: MapEarth,
    pub system: MapSystem,
    pub pins: Vec<MapPin>,
    pub routes: Vec<MapRoute>,
    pub regions: Vec<MapRegion>,
    pub terrains: Vec<MapTerrain>,
    pub labels: Vec<MapLabel>,
    /// Custom transports; one sharing a built-in's id replaces it on this map.
    pub transports: Vec<MapTransport>,
    pub travelers: Vec<MapTraveler>,
    pub timeline: MapTimeline,
    pub style: MapStyle,
    pub viewport: MapViewport,
}
