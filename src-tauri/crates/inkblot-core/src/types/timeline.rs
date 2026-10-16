//! The story timeline's modeled keys.
//!
//! Three things are stored:
//!
//! - **the chronology**, `.story/timeline.json`: every event in the project, its lanes,
//!   eras and tags. One per project, beside `.story/calendar.json`.
//! - **timeline views**, `<name>.timeline.json`: how one document shows the chronology
//!   (a date scale, even sequence, or the manuscript against it) and what it filters.
//!   They hold no events.
//! - **passages**, a text document's `timeline` array: ranges of its text attached to
//!   events, kept as ProseMirror positions plus the text they cover.
//!
//! Time is the map's axis: a day number (a float, day 0 the story's epoch) written in
//! the project calendar. A date is optional; `order`, a fractional-index key, is what
//! places every event in sequence, dated or not.
//!
//! The logic (`src/lib/timeline/timelineModel.js`) is JavaScript only, as the map's
//! is: the page owns every timeline and the shell draws the chrome it lays out. These
//! types describe the files for the TypeScript and Swift that read them. Nullable
//! fields are always present after normalizing, as `null`.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// What an event links to, by path — kept right through renames by `timelineLinks.js`.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineLinkKind {
    /// Passages in a text document (`doc`); the ranges themselves are in that document.
    Text,
    /// A map journey's leg (`map`, `traveler`, `leg`): the event leaves when it does.
    MapLeg,
    /// A card on a canvas (`path`, `node`).
    Canvas,
    /// A note in a document (`doc`, `noteId`).
    Note,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLink {
    pub kind: TimelineLinkKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traveler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
}

/// Where an event happens: a pin (or another item) on a map, or a location document.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePlace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin: Option<String>,
    /// What else on the map it is at: `region`, `route`, `label` or `body` (with `item`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

/// A note on an event: on the whole of it, or on one moment in it (`at`, a day).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEventNote {
    pub id: String,
    pub text: String,
    #[typeshare(typescript(type = "number | null"))]
    pub at: Option<f64>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub title: String,
    pub summary: String,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
    #[typeshare(typescript(type = "string | null"))]
    pub lane_id: Option<String>,
    pub tag_ids: Vec<String>,
    /// A fractional-index key: events in sequence are events sorted by it, as strings.
    pub order: String,
    /// The day it starts; null when it is undated and placed by `order` alone.
    #[typeshare(typescript(type = "number | null"))]
    pub start: Option<f64>,
    /// The day a window ends; null for a moment.
    #[typeshare(typescript(type = "number | null"))]
    pub end: Option<f64>,
    /// Tree paths of the documents (characters, mostly) taking part.
    pub participants: Vec<String>,
    #[typeshare(typescript(type = "TimelinePlace | null"))]
    pub place: Option<TimelinePlace>,
    pub links: Vec<TimelineLink>,
    pub notes: Vec<TimelineEventNote>,
}

/// A swimlane: a plotline, a point of view.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineLane {
    pub id: String,
    pub name: String,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
}

/// A span drawn behind everything: a war, a reign, a winter.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEra {
    pub id: String,
    pub name: String,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
    pub start: f64,
    pub end: f64,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineTag {
    pub id: String,
    pub name: String,
    #[typeshare(typescript(type = "string | null"))]
    pub color: Option<String>,
}

/// `.story/timeline.json`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryTimeline {
    pub version: u32,
    pub events: Vec<TimelineEvent>,
    pub lanes: Vec<TimelineLane>,
    pub eras: Vec<TimelineEra>,
    pub tags: Vec<TimelineTag>,
}

/// How a view lays the chronology out.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimelineScale {
    /// Along the calendar.
    Time,
    /// Every event one step apart, dated or not.
    Sequence,
    /// Passages in reading order, each joined to when it happens.
    Manuscript,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineViewFilter {
    pub lanes: Vec<String>,
    pub tags: Vec<String>,
    pub participants: Vec<String>,
    pub text: String,
}

/// `<name>.timeline.json`: one document's view of the chronology.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineViewFile {
    /// Always `timeline-view`: what a save checks before writing over a file.
    #[serde(rename = "type")]
    pub kind: String,
    pub version: u32,
    pub scale: TimelineScale,
    /// The folder the manuscript scale reads, in tree order; empty for the project.
    #[serde(default)]
    pub manuscript_folder: String,
    /// The days shown last, `[from, to]`, on a date scale.
    #[typeshare(typescript(type = "number[] | null"))]
    pub range: Option<Vec<f64>>,
    pub filter: TimelineViewFilter,
    pub collapsed_lanes: Vec<String>,
    pub show_journeys: bool,
}

/// A passage of a text document attached to an event: ProseMirror positions, and the
/// text they covered when last saved. Held in the document's `timeline` array.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRange {
    pub id: String,
    pub event_id: String,
    pub from: u32,
    pub to: u32,
    pub anchor: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_chronology_written_by_the_page_reads_back() {
        let raw = json!({
            "version": 1,
            "events": [{
                "id": "e1", "title": "The siege", "summary": "", "color": null, "laneId": "l1",
                "tagIds": [], "order": "V", "start": 12.5, "end": null,
                "participants": ["Characters/Kira"], "place": { "map": "World.map", "pin": "p1" },
                "links": [{ "kind": "text", "doc": "Chapters/One" }, { "kind": "mapLeg", "map": "World.map", "traveler": "t", "leg": "g" }],
                "notes": [{ "id": "n", "text": "dawn", "at": 12.6 }],
            }, {
                "id": "e2", "title": "Undated", "summary": "", "color": null, "laneId": null,
                "tagIds": [], "order": "W", "start": null, "end": null,
                "participants": [], "place": null, "links": [], "notes": [],
            }],
            "lanes": [{ "id": "l1", "name": "Kira", "color": "#4f7cac" }],
            "eras": [], "tags": [],
        });
        let timeline: StoryTimeline = serde_json::from_value(raw).unwrap();
        assert_eq!(timeline.events[0].links[1].kind, TimelineLinkKind::MapLeg);
        assert_eq!(timeline.events[1].start, None);
    }

    #[test]
    fn a_view_names_its_scale_and_type() {
        let view: TimelineViewFile = serde_json::from_value(json!({
            "type": "timeline-view", "version": 1, "scale": "manuscript", "manuscriptFolder": "Book",
            "range": null, "filter": { "lanes": [], "tags": [], "participants": [], "text": "" },
            "collapsedLanes": [], "showJourneys": true,
        }))
        .unwrap();
        assert_eq!(view.scale, TimelineScale::Manuscript);
        assert_eq!(view.kind, "timeline-view");
    }
}
