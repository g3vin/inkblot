//! The archive: things put away out of a document without being destroyed.
//!
//! Archiving hides something; it is kept, in the document's own file (`archive`, beside
//! `versions`), and can be looked at, restored or deleted from the History panel's
//! archive. Every item has a kind. For now there is one — a bubble session archived
//! from its sentence — but the archive is meant for anything a writer puts aside, so a
//! kind brings its own payload field rather than the archive knowing about bubbles.
//!
//! The page owns the file, as it owns the document: it publishes a document's archive
//! (`archiveChanged`) and performs what the shell asks (`archiveAction`).

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

/// A document's archive, newest first — the whole list, sent when the document the
/// writer is in changes and whenever its archive does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveChanged {
    pub doc_path: String,
    pub items: Vec<ArchivedItem>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveAction {
    /// Put it back. A bubble goes back on its sentence, if the sentence is still in the
    /// document as it was archived; otherwise it stays in the archive.
    Restore,
    /// Delete it for good. Version history still has the document from before it was
    /// archived.
    Delete,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveActionCommand {
    pub doc_path: String,
    pub item_id: String,
    pub action: ArchiveAction,
}
