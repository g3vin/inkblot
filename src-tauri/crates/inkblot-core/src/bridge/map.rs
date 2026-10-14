//! A map's half of the protocol: its toolbar and its inspector panel. The scale bar,
//! the compass, the tool hint and the story timeline stay in the page, over the map.
//!
//! The same arrangement as a canvas's toolbar (`CanvasToolbarChanged`), taken further.
//! The page owns every map — the document, the view, the selection, the tool in hand,
//! the story day — and every figure the chrome shows is worked out there, by maths that
//! is JavaScript only (distances, travel times, orbits, the calendar). So the page does
//! not publish the map for the shell to lay out; it publishes the chrome already laid
//! out, and the shell draws it natively and sends every click back as a `mapCommand`:
//!
//! - **`MapChromeChanged`** is the active map's toolbar and inspector. Present while a
//!   map is the active document; absent otherwise, which is when the document toolbar
//!   comes back. The inspector is a form (`MapPanel`): tabs, sections and typed fields,
//!   each field named by an id the page gave it. An edit goes back as
//!   `mapCommand { command: "panel-field", detail: { id, value } }`, a button as
//!   `panel-action { id }` — the page looks the id up in the form it last built, so the
//!   shell never learns what a field means, only how to draw it. The page's own
//!   inspector (the Tauri app's) is drawn from the same form.
//!
//! Coalesced to one per frame; it carries the whole state, never a delta.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::types::json::JsonValue;
use crate::types::map::MapKind;

/* ---------------- the toolbar and the panel ---------------- */

/// The map's toolbar and inspector, or `None` when no map is showing. A map in a split
/// stays here while the other pane is being worked in, `active` false: its inspector
/// panel stays in the bar, and the toolbar goes back to the document's.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapChromeChanged {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<MapChromeState>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapChromeState {
    /// The surface commands go back to.
    pub surface_id: String,
    pub doc_path: String,
    pub tool: MapTool,
    /// 1 is 100%.
    pub zoom: f64,
    /// The zoom as the page writes it: `250%`, `12×`.
    pub zoom_label: String,
    pub can_undo: bool,
    pub can_redo: bool,
    pub has_selection: bool,
    pub panel: MapPanel,
    /// Bumped when the page wants the inspector shown on this panel: a label just
    /// placed, an item double-clicked, a traveller dropped on. The shell compares it
    /// with the last value it saw, so a republish of the same state shows nothing.
    pub reveal_panel: u32,
    /// The map is the active document, so the toolbar is its.
    #[serde(default)]
    pub active: bool,
    /// What kind of map it is, so the toolbar offers what fits: the scale tool only on
    /// a sheet or a picture.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_kind: Option<MapKind>,
}

/// The map's tools, as the toolbar offers them. `Pan` is not on the toolbar — the
/// space bar and the middle button reach it — but it can be the tool in hand.
/// `Calibrate` (set the scale from two points) is, on a sheet or a picture.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MapTool {
    Select,
    Pan,
    Pin,
    Route,
    Region,
    Label,
    Ruler,
    Area,
    Calibrate,
}

/// The inspector: the map's settings in tabs, or the one thing selected.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPanel {
    /// The map's name, or what is selected ("Place", "Route").
    pub title: String,
    /// Something is selected; `panel-back` returns to the map's settings.
    pub can_go_back: bool,
    /// How many problems the journeys have (someone in two places at once).
    pub problems: u32,
    /// Empty while one thing is being edited.
    pub tabs: Vec<MapPanelTab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab: Option<String>,
    pub sections: Vec<MapPanelSection>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPanelTab {
    pub id: String,
    pub label: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPanelSection {
    pub id: String,
    /// May be empty: a section that is only a Delete button.
    pub title: String,
    /// Buttons beside the title ("Add", "Show").
    pub actions: Vec<MapPanelButton>,
    pub fields: Vec<MapPanelField>,
}

/// One row of a section. Each is named by an `id` where it can be edited or clicked,
/// which is all a command carries back.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum MapPanelField {
    Text(MapTextInput),
    Number(MapNumberInput),
    Choice(MapChoiceInput),
    Toggle(MapToggleInput),
    Color(MapColorInput),
    Stat(MapStatRow),
    Note(MapNoteText),
    Button(MapPanelButton),
    Buttons(MapButtonRow),
    ListRow(MapListRow),
    Markers(MapMarkerInput),
    Date(MapDateInput),
    Table(MapTableView),
    Preview(MapShapePreview),
    Group(MapPanelGroup),
}

/// Committed on Return or when focus leaves, never per keystroke: a name typed is one
/// undo step. The value sent back is a string.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTextInput {
    pub id: String,
    pub label: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    pub multiline: bool,
    /// Changes when the page wants the caret here with the text selected — a rename.
    /// Zero is never a request.
    pub focus_key: u32,
}

/// Committed as `number` fields are on the page: on Return or blur, clamped to
/// `min`/`max`. The value sent back is a number, or `null` to clear an `allow_empty`
/// field.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapNumberInput {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// What the stepper adds; `None` for any value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    pub allow_empty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

/// A pop-up menu. The value sent back is the chosen option's `value`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapChoiceInput {
    pub id: String,
    pub label: String,
    pub value: String,
    pub options: Vec<MapChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapChoice {
    pub value: String,
    pub label: String,
    /// The heading this option sits under; consecutive options share one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapToggleInput {
    pub id: String,
    pub label: String,
    pub value: bool,
}

/// A colour well. `value` is `None` for the default (drawn as `fallback`); the value
/// sent back is `#rrggbb`, or `null` for Reset.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapColorInput {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub fallback: String,
}

/// A figure: "Length — 42 km". With `action`, the figure is a button (an arrival date
/// that jumps the timeline there).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapStatRow {
    pub label: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<MapPanelButton>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MapNoteTone {
    Note,
    Warning,
}

/// A line of explanation, or a warning. `swatch` is a colour shown before it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapNoteText {
    pub text: String,
    pub tone: MapNoteTone,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swatch: Option<String>,
    /// A button after the text ("Go there").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<MapPanelButton>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MapButtonRole {
    Normal,
    Primary,
    Destructive,
}

/// Clicked, it sends `panel-action { id }`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPanelButton {
    pub id: String,
    pub label: String,
    pub role: MapButtonRole,
    pub disabled: bool,
    /// A semantic icon name (src/ui/icons.js), for a button that shows one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapButtonRow {
    pub buttons: Vec<MapPanelButton>,
}

/// A row in a list of things on the map; clicked, it sends `panel-action { id }`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapListRow {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swatch: Option<String>,
    /// How many levels in (a moon under its planet).
    pub indent: u32,
}

/// A place's marker: one of `options`, whose values are the page's icon ids. The value
/// sent back is the id.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapMarkerInput {
    pub id: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub options: Vec<MapChoice>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MapCalendarMode {
    /// Day 1, Day 2…: only `day` counts.
    Day,
    Gregorian,
    /// The world's own months (`MapDateInput.months`).
    Custom,
}

/// A date in the project's calendar, taken apart. The page puts it back together, so
/// the shell never does calendar arithmetic.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapDateParts {
    pub year: f64,
    /// 1-based, into `MapDateInput.months`.
    pub month: f64,
    pub day: f64,
    pub hour: f64,
    pub minute: f64,
}

/// A date field. The value sent back is `MapDateParts`, or `null` to clear an
/// `allow_empty` one. With no `value`, the field is a button offering to set one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapDateInput {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<MapDateParts>,
    pub mode: MapCalendarMode,
    /// The months' names, in order.
    pub months: Vec<String>,
    pub allow_empty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

/// The table of distances between places.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTableView {
    pub columns: Vec<String>,
    pub rows: Vec<MapTableRowView>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTableRowView {
    pub label: String,
    pub cells: Vec<MapTableCell>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapTableCell {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub strong: bool,
}

/// A traced picture's outlines, previewed: polylines in `width` × `height` space,
/// written as SVG path data using only `M`, `L` and `Z`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapShapePreview {
    pub width: f64,
    pub height: f64,
    pub path: String,
    pub filled: bool,
}

/// Rows that belong to one thing — a leg of a journey, a terrain — with their own
/// title and buttons. `collapsible` ones start closed.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPanelGroup {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swatch: Option<String>,
    pub actions: Vec<MapPanelButton>,
    pub fields: Vec<MapPanelField>,
    pub collapsible: bool,
}

/* ---------------- commands ---------------- */

/// Run a command on a map, named by surface id as a canvas command is.
///
/// The vocabulary is `MapSurface`'s: `tool { tool }`, `undo`, `redo`, `zoom-in`,
/// `zoom-out`, `zoom-to-fit`, `delete`, `panel-tab { id }`, `panel-back`,
/// `panel-field { id, value }`, `panel-action { id }`. Untyped, as `CanvasCommandRequest`'s
/// is: a field's value is whatever that field holds.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCommandRequest {
    pub surface_id: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<JsonValue>,
}
