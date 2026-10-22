//! The map document's modeled keys.
//!
//! `map::model` normalizes on `serde_json::Value` so that every key it does not model
//! survives a round-trip; these types describe the keys it *does* model, for the
//! TypeScript that reads a map. Every item also carries unknown keys, which
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

use crate::types::json::JsonValue;

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MapKind {
    Blank,
    Image,
    Earth,
    /// A planet or a star of the writer's own: a globe of `surface`.
    Planet,
    System,
    /// Star systems placed in a galaxy, in light-years.
    Galaxy,
    /// Galaxies placed in a universe, in megaparsecs.
    Universe,
    /// A 3D model (a station, a ship) to look around and pin.
    Model,
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
    /// `globe` (the zoomable globe) or `flat` (`projection`).
    pub view: String,
    /// `map`, `satellite` or `hybrid`; anything but `map` is fetched online.
    pub imagery: String,
    /// Mountains raised in 3D on the globe (online elevation).
    pub terrain3d: bool,
}

/// What a planet's or star's ground looks like.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSurfaceLook {
    /// `generated`, `texture`, `gas`, `ice` or `star`.
    pub kind: String,
    /// Every generated surface is its seed's own.
    pub seed: f64,
    /// 0–1: how much of a generated world is under water.
    pub sea_level: f64,
    /// 0–1: how rugged its land is.
    pub roughness: f64,
    pub palette: String,
    /// An equirectangular picture in `.assets/`, for `texture`.
    #[typeshare(typescript(type = "string | null"))]
    pub texture: Option<String>,
    /// A star's surface temperature, which sets its colour.
    pub temperature_k: f64,
}

/// A planet or star map's globe.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSurface {
    pub radius_km: f64,
    pub axial_tilt_deg: f64,
    pub day_hours: f64,
    pub look: MapSurfaceLook,
    /// Regions drawn as land raise the generated ground.
    pub terrain_from_regions: bool,
    pub atmosphere: bool,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapGalaxy {
    /// A Hubble class (`E0`…`E7`, `S0`, `Sa`…`Sd`, `SBa`…`SBd`) or `ring`, `irregular`,
    /// `dwarf`, `peculiar`.
    #[serde(rename = "type")]
    pub galaxy_type: String,
    pub seed: f64,
    pub radius_ly: f64,
    pub thickness_ly: f64,
    /// Shape settings the writer pinned; the seed decides the rest.
    pub params: HashMap<String, JsonValue>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapUniverse {
    pub seed: f64,
    pub extent_mpc: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapModel {
    /// A `.glb` in `.assets/`.
    #[typeshare(typescript(type = "string | null"))]
    pub asset: Option<String>,
    pub metres_per_unit: f64,
    /// `y` or `z`: which way is up in the model's file.
    pub up: String,
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
    /// Tilt of the orbit out of the system's plane.
    pub inclination_deg: f64,
    /// Where the orbit crosses the plane going up.
    pub ascending_node_deg: f64,
}

/// An N-body body's start: position (AU) and velocity (AU a day) on day 0.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBodyState {
    pub pos: Vec<f64>,
    pub vel: Vec<f64>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRings {
    pub inner_km: f64,
    pub outer_km: f64,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
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
    /// Where it starts when the system is N-body rather than Kepler.
    #[typeshare(typescript(type = "MapBodyState | null"))]
    pub state: Option<MapBodyState>,
    pub axial_tilt_deg: f64,
    #[typeshare(typescript(type = "number | null"))]
    pub rotation_hours: Option<f64>,
    #[typeshare(typescript(type = "MapRings | null"))]
    pub rings: Option<MapRings>,
    /// The planet or model map this body opens into.
    #[typeshare(typescript(type = "string | null"))]
    pub surface: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSystemDisplay {
    /// `linear` or `log`.
    pub radial: String,
    #[serde(rename = "pxPerAU")]
    pub px_per_au: f64,
    /// `3d` or `flat`.
    pub view: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSystem {
    pub bodies: Vec<MapBody>,
    pub display: MapSystemDisplay,
    /// How the system's plane sits in its galaxy.
    pub plane: MapSystemPlane,
    /// `kepler` (nested orbits) or `nbody` (bodies pulling on each other).
    pub dynamics: String,
    pub nbody: MapNbody,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSystemPlane {
    pub tilt_deg: f64,
    pub heading_deg: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapNbody {
    pub step_days: f64,
    #[serde(rename = "softeningAU")]
    pub softening_au: f64,
    /// How far ahead the simulation runs.
    pub horizon_days: f64,
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
    /// The layer it is on.
    #[typeshare(typescript(type = "string | null"))]
    pub layer: Option<String>,
    /// The story day it appears; null: always there.
    #[typeshare(typescript(type = "number | null"))]
    pub from: Option<f64>,
    /// The story day it goes; null: never.
    #[typeshare(typescript(type = "number | null"))]
    pub until: Option<f64>,
    /// A timeline event `from` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub from_event: Option<String>,
    /// A timeline event `until` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub until_event: Option<String>,
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
    /// The layer it is on.
    #[typeshare(typescript(type = "string | null"))]
    pub layer: Option<String>,
    /// The story day it appears; null: always there.
    #[typeshare(typescript(type = "number | null"))]
    pub from: Option<f64>,
    /// The story day it goes; null: never.
    #[typeshare(typescript(type = "number | null"))]
    pub until: Option<f64>,
    /// A timeline event `from` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub from_event: Option<String>,
    /// A timeline event `until` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub until_event: Option<String>,
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
    /// The layer it is on.
    #[typeshare(typescript(type = "string | null"))]
    pub layer: Option<String>,
    /// The story day it appears; null: always there.
    #[typeshare(typescript(type = "number | null"))]
    pub from: Option<f64>,
    /// The story day it goes; null: never.
    #[typeshare(typescript(type = "number | null"))]
    pub until: Option<f64>,
    /// A timeline event `from` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub from_event: Option<String>,
    /// A timeline event `until` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub until_event: Option<String>,
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
    /// The layer it is on.
    #[typeshare(typescript(type = "string | null"))]
    pub layer: Option<String>,
    /// The story day it appears; null: always there.
    #[typeshare(typescript(type = "number | null"))]
    pub from: Option<f64>,
    /// The story day it goes; null: never.
    #[typeshare(typescript(type = "number | null"))]
    pub until: Option<f64>,
    /// A timeline event `from` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub from_event: Option<String>,
    /// A timeline event `until` follows.
    #[typeshare(typescript(type = "string | null"))]
    pub until_event: Option<String>,
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
    pub legend: MapOrnament,
    /// How a 3D map is drawn: `cinematic`, `atlas` or `ink`.
    pub look: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
}

/// A saved view: the camera (as its view kind wrote it) and, optionally, a day.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapView {
    pub id: String,
    pub name: String,
    pub camera: HashMap<String, JsonValue>,
    #[typeshare(typescript(type = "number | null"))]
    pub day: Option<f64>,
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
    pub surface: MapSurface,
    pub system: MapSystem,
    pub galaxy: MapGalaxy,
    pub universe: MapUniverse,
    pub model: MapModel,
    pub pins: Vec<MapPin>,
    pub routes: Vec<MapRoute>,
    pub regions: Vec<MapRegion>,
    pub terrains: Vec<MapTerrain>,
    pub labels: Vec<MapLabel>,
    /// Custom transports; one sharing a built-in's id replaces it on this map.
    pub transports: Vec<MapTransport>,
    pub travelers: Vec<MapTraveler>,
    pub layers: Vec<MapLayer>,
    pub views: Vec<MapView>,
    pub timeline: MapTimeline,
    pub style: MapStyle,
    pub viewport: MapViewport,
}
