//! The right sidebar's half of the protocol: notes, the clipboard history, workbench
//! tiles, version history and search.
//!
//! **Why most of this is "ask the page".** All five panels show state the page owns —
//! `notesByDoc`, `clipboardHistory`, `tiles` live in React, and versions live in the
//! document file the page's autosave rewrites under its own per-document lock. A
//! panel outside the page that wrote any of it directly would race the page: a note
//! edited there and autosaved from the page's stale copy a moment later is a lost
//! edit, and a version renamed through the core's lock while the page's lock is
//! mid-write is a lost version.
//! So the shell edits by command, and the page applies each edit with the same
//! helpers its own panel uses.
//!
//! **Why notes are edited by patch.** `Note` carries a flattened map of keys this build
//! does not know about, which typeshare cannot express, so the shell's copy of a note
//! is missing them. Sending whole notes back would drop them on every edit; a patch
//! names only what changed and the page merges it into the note it has.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::common::{EditorTarget, TextAnchor};
use crate::types::note::{AudioClip, NoteImage, NotePreviewLayout, NotePreviewSize};

/* ---------------- notes ---------------- */

/// The fields of a note the shell can change. `None` leaves a field alone.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed_children: Option<bool>,
    /// The whole list — images are added and removed, not edited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<NoteImage>>,
    /// The whole list, as for images.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<Vec<AudioClip>>,
    /// Where the hover card was dragged to — for a root card, relative to its default
    /// place beside the anchor; for a reply, relative to its parent's card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_layout: Option<NotePreviewLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_size: Option<NotePreviewSize>,
}

/// Add an empty reply beneath a note, as the hover card's "reply" button does. The
/// page makes the note (it owns ids, timestamps and the default layout for a new reply).
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReplyCommand {
    pub doc_path: String,
    pub parent_note_id: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteCommand {
    pub doc_path: String,
    pub note_id: String,
    pub patch: NotePatch,
}

/// Remove a note and every reply beneath it, as the page's panel does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub doc_path: String,
    pub note_id: String,
}

/* ---------------- clipboard ---------------- */

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    /// The document it was copied from, if any.
    #[serde(default)]
    pub doc_name: String,
    #[serde(default)]
    pub timestamp: String,
}

/// Text dropped on the shell's clipboard panel.
///
/// If it is the selection the user is dragging out of an editor, the page removes it
/// from the document — dropping a selection on the clipboard is a move. The page decides that, because only the page knows what is being dragged.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardDropCommand {
    pub text: String,
}

/// Remove entries from the history. `None` clears it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveClipboardEntriesCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

/// Insert an entry at the caret of an editor, and take it off the history, as dragging a
/// tile into the editor does.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertClipboardEntryCommand {
    pub id: String,
    pub target: EditorTarget,
}

/* ---------------- workbench ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TileKind {
    Pos,
    Synonym,
    Definition,
    Rhyme,
}

/// A language-tool tile, made from a selection by the editor's context menu.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchTile {
    /// Always a string on the wire; the page's ids are timestamps.
    pub id: String,
    #[serde(rename = "type")]
    pub kind: TileKind,
    /// The word or sentence the tile is about.
    pub text: String,
    /// The document it was made in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

/// Remove tiles. `None` clears the workbench.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveTilesCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

/// Replace the tile's word in its document (a synonym chosen, say), and retarget the
/// tile at the new word. The page finds the word by its anchor, not by position.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTileWordCommand {
    pub id: String,
    pub word: String,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileRef {
    pub id: String,
}

/* ---------------- version history ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionAction {
    /// Save the current state as a version now. No `version_id`.
    Snapshot,
    /// Restore a version, after a safety checkpoint of the current state.
    Restore,
    /// Open the side-by-side comparison of a version against the current state.
    Compare,
    /// Materialize a version as a new document beside this one, and open it.
    MakeCopy,
    Delete,
}

/// Something done to a document's history. The page does it, under the same lock its
/// autosave writes the history with.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionActionCommand {
    pub doc_path: String,
    pub action: VersionAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
}

/// Name a version, or clear its name with `None`.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameVersionCommand {
    pub doc_path: String,
    pub version_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/* ---------------- search ---------------- */

/// Open a search result: switch to its document if needed, then select the match (or
/// reveal the canvas node, or jump to the note).
///
/// Not the `SearchResult` itself: that carries bare offsets, and nothing on this wire
/// does (see `only_set_caret_addresses_a_document_by_bare_position`, which is what
/// caught it). A result found on disk may be a few hundred milliseconds stale against
/// the open editor, so the match goes as an anchor — positions *and* the text they
/// covered — and the page resolves it by the text if the positions have moved on.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealSearchResultCommand {
    pub doc_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<TextAnchor>,
    /// A canvas match names the node rather than a place in text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    /// A notes-scope match names the note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<String>,
}

/* ---------------- the sidebar itself ---------------- */

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SidebarTab {
    Clipboard,
    Workbench,
    Notes,
    History,
    References,
    Timeline,
}

/// The page wants a sidebar tab shown — "Add note", "Open Version History", a new
/// workbench tile. When the shell draws the sidebar, the page asks rather than opens.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowSidebarTab {
    pub tab: SidebarTab,
}
