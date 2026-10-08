//! The timeline's half of the protocol: a timeline view's toolbar and inspector, the
//! commands that attach text to events, and the project's time lens.
//!
//! A timeline view is the map's arrangement again (`map.rs`): the page owns the
//! chronology, every view of it and all of its maths (the calendar, sequence keys,
//! where each event is drawn), so it publishes the chrome already laid out and the
//! shell draws it:
//!
//! - **`TimelineChromeChanged`** is the active view's toolbar state and inspector. The
//!   inspector is the same form a map's is (`MapPanel`), so the shell draws it with
//!   the map's panel view; an edit goes back as `timelineCommand { command:
//!   "panel-field", detail: { id, value } }`, a button as `panel-action { id }`, and
//!   the toolbar's buttons by name (`add-event`, `undo`, `redo`, `zoom-in`, `zoom-out`,
//!   `fit`, `scale { value }`, `lens`, `delete`).
//! - **`AttachTimelineEvent`** attaches a passage — the selection, as a `TextAnchor` —
//!   to an event, a new one when none is named.
//! - **`SetTimeLens`**, **`SetTimelineRangeEditing`**: the lens, which lights every
//!   passage whose event falls in a window of time, and the handles for dragging where
//!   passages start and stop. Where the lens's window sits is the page's (it is dragged
//!   there), so these carry switches, never a window.
//! - **`TimelineCursorChanged`** tells the shell those switches' states, for its menus.
//! - **`TimelineRangesChanged`**: a document's passages, as its editor maps them.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{EditorTarget, TextAnchor};
use super::map::MapPanel;
use crate::types::json::JsonValue;
use crate::types::timeline::{TimelineRange, TimelineScale};

/* ---------------- a timeline view's chrome ---------------- */

/// The active timeline view's toolbar and inspector, or `None` when no view is showing.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineChromeChanged {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<TimelineChromeState>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineChromeState {
    /// The surface commands go back to.
    pub surface_id: String,
    pub doc_path: String,
    pub scale: TimelineScale,
    pub can_undo: bool,
    pub can_redo: bool,
    pub has_selection: bool,
    pub lens_on: bool,
    /// The inspector, as the map's is built.
    pub panel: MapPanel,
    /// Bumped when the page wants the inspector shown (an event just added or opened).
    pub reveal_panel: u32,
    /// The view is the active document, so the toolbar is its.
    #[serde(default)]
    pub active: bool,
}

/// Run a command on a timeline view.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCommandRequest {
    pub surface_id: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<JsonValue>,
}

/* ---------------- passages ---------------- */

/// Attach a passage to an event: `event_id`, or a new event (titled `title`, or after
/// the words chosen) placed in sequence after the one the passage before it tells.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachTimelineEventCommand {
    pub target: EditorTarget,
    pub anchor: TextAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Open a document at a passage of an event (a particular one when `range_id`).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpToTimelinePassageCommand {
    pub doc_path: String,
    pub event_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range_id: Option<String>,
}

/// Show an event in a timeline view — the one open, or the next to open.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealTimelineEventCommand {
    pub event_id: String,
}

/// A document's passages, as its editor now has them. Positions, like a quote note's:
/// an event, which the rule about bare positions does not cover.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRangesChanged {
    pub doc_path: String,
    pub ranges: Vec<TimelineRange>,
}

/* ---------------- the lens ---------------- */

/// Switch the time lens on or off, or its window's dragging; `None` leaves either be.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTimeLensCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editing: Option<bool>,
}

/// Show or hide the handles for dragging where passages start and stop.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTimelineRangeEditingCommand {
    pub on: bool,
}

/// The lens's and the handles' switches, for the shell's menus.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCursorChanged {
    pub lens_on: bool,
    pub lens_editing: bool,
    pub editing_ranges: bool,
}
