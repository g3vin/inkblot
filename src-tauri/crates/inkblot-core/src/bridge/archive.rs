//! The archive: things put away out of a document without being destroyed.
//!
//! Archiving hides something; it is kept, in the document's own file (`archive`, beside
//! `versions`), and can be looked at, restored or deleted from the History panel's
//! archive. Every item has a kind. For now there is one — a bubble session archived
//! from its sentence — but the archive is meant for anything a writer puts aside, so a
//! kind brings its own payload field rather than the archive knowing about bubbles.
//!
//! The page owns the file, as it owns the document, and the History panel reads and
//! edits it there; these types are the file's shape.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::bubble::BubbleSession;

/// What an archived item is.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchivedKind {
    /// A bubble session, taken off its sentence. The sentence stays in the document as
    /// it was written; the session, forms and set-aside words and all, is in `bubble`.
    Bubble,
}

/// One thing in a document's archive.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedItem {
    pub id: String,
    /// When it was archived, as an ISO 8601 timestamp.
    pub archived_at: String,
    pub kind: ArchivedKind,
    /// What to call it in a list: for a bubble, its sentence.
    pub title: String,
    /// The session, for a `Bubble`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bubble: Option<BubbleSession>,
}
