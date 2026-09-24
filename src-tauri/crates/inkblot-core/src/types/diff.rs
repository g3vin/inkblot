//! What the diff engine produces: token runs, aligned block chunks, and the card-level
//! shape of two canvases' differences.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::canvas::{CanvasEdge, CanvasNode};

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffOpType {
    Equal,
    Added,
    Removed,
}

/// A run of tokens that were all kept, all added, or all removed.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiffOp {
    #[serde(rename = "type")]
    pub op_type: DiffOpType,
    pub tokens: Vec<String>,
}

/// How many words a change added and removed.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WordDelta {
    pub added: u32,
    pub removed: u32,
}

/// One top-level block of rendered HTML: its exact markup, so a merge preserves
/// formatting, plus a normalized text key for matching.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtmlBlock {
    pub html: String,
    pub text: String,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffChunkType {
    /// An identical run, carried by `blocks`.
    Equal,
    /// The left run was replaced by the right one, carried by `left` and `right`.
    Changed,
}

/// One row of a two-column compare view.
///
/// This wants to be an enum, and cannot be one: the wire format is internally tagged
/// (`{ type: 'equal', blocks }`), typeshare only generates algebraic enums that are
/// adjacently tagged (`{ type, content }`), and changing the shape would mean changing
/// the compare panel that reads it. So the variants are optional fields, with
/// constructors that make only the valid combinations reachable.
///
/// `left` or `right` may be present and *empty* on a `changed` chunk: that is a pure
/// deletion or a pure insertion, and it is not the same as being absent.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffChunk {
    #[serde(rename = "type")]
    pub chunk_type: DiffChunkType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<HtmlBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<Vec<HtmlBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<Vec<HtmlBlock>>,
}

impl DiffChunk {
    pub fn equal(blocks: Vec<HtmlBlock>) -> Self {
        Self { chunk_type: DiffChunkType::Equal, blocks: Some(blocks), left: None, right: None }
    }

    pub fn changed(left: Vec<HtmlBlock>, right: Vec<HtmlBlock>) -> Self {
        Self {
            chunk_type: DiffChunkType::Changed,
            blocks: None,
            left: Some(left),
            right: Some(right),
        }
    }
}

/// Which side of a chunk or a card-level change the user kept.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeChoice {
    Left,
    Right,
    Both,
}

/// A card that exists on both sides, before and after.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CanvasNodeChange {
    pub before: CanvasNode,
    pub after: CanvasNode,
}

/// Card-level diff of two serialized canvases.
///
/// Geometry-only changes are kept apart from edits so the panel can say "3 cards
/// moved" without burying real writing changes.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDiff {
    /// Cards present only on the right.
    pub added: Vec<CanvasNode>,
    /// Cards present only on the left.
    pub removed: Vec<CanvasNode>,
    /// Same card, different content — text, color, target.
    pub edited: Vec<CanvasNodeChange>,
    /// Same card, same content, different geometry.
    pub moved: Vec<CanvasNodeChange>,
    pub edges_added: Vec<CanvasEdge>,
    pub edges_removed: Vec<CanvasEdge>,
}

/// One row of the History timeline, everything but the grouping — which is by local
/// day and so belongs to whoever is drawing the timeline.
///
/// Computed from the whole history rather than per entry because each row describes
/// the change *from the entry before it*, which a filtered list may be hiding.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRow {
    pub id: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub auto: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// `hsl(…)`, the same hue the page's timeline gives this session.
    pub session_color: String,
    pub delta: WordDelta,
    /// A text version's change against its predecessor, trimmed to a readable snippet:
    /// a little context, then what changed. Empty for a canvas.
    pub snippet: Vec<DiffOp>,
    /// A canvas version's change in words ("2 cards added"); absent for text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
