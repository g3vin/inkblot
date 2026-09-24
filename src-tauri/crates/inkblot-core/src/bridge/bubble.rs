//! Bubble: rearranging a sentence as a row of word bubbles.
//!
//! The writer selects a sentence and it comes apart into bubbles, one per word (or per
//! clause). They are dragged to reorder, dropped onto each other to join, thrown to the
//! edges of the screen to keep for later, and trashed. Leaving writes the arranged
//! sentence back into the document.
//!
//! **A session outlives the editor that shows it.** Closing without resolving leaves
//! the session in the document: the sentence carries a `bubbleSession` mark whose
//! attributes are the whole `BubbleSession` below, set-aside words included, so the
//! next open picks up exactly where the last one stopped. Keeping it in the document
//! rather than beside it is what makes version history bring an archived session back.
//!
//! **Why the page owns positions and the shell owns none.** The shell draws the bubbles
//! (as Liquid Glass — which only a view above the page can be) and hands back the
//! arrangement; the page finds the sentence by the session's id and rewrites it. No
//! message here addresses the document.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// One bubble in the sentence: a word, or several joined into one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleWord {
    pub id: String,
    /// What the bubble says. Joined words are separated by a single space.
    pub text: String,
}

/// A bubble thrown to the side, out of the sentence.
///
/// Where it rests is a fraction of the editor's area rather than points, so it is
/// still on its edge when the session is reopened in a window of another size.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleAside {
    pub id: String,
    pub text: String,
    /// The bubble's centre, 0 at the left edge and 1 at the right.
    pub x: f64,
    /// The bubble's centre, 0 at the top edge and 1 at the bottom.
    pub y: f64,
}

/// What the bubbles are: one per word (and punctuation mark), per clause, or per
/// sentence — the last is for reordering a paragraph.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BubbleMode {
    Words,
    Clauses,
    Sentences,
}

/// A saved version of the arrangement — a "form" the writer can come back to.
///
/// A session keeps as many as the writer saves. Showing one puts its bubbles back
/// exactly as they were, ids included, so the shell can tell which form (if any) the
/// bubbles on screen are: the one they equal.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleForm {
    pub id: String,
    pub words: Vec<BubbleWord>,
    #[serde(default)]
    pub aside: Vec<BubbleAside>,
    /// How its bubbles were grouped. Absent means words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<BubbleMode>,
}

/// Everything a bubble session is.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleSession {
    pub id: String,
    /// The sentence, in order. The text written back is these joined by spaces.
    pub words: Vec<BubbleWord>,
    #[serde(default)]
    pub aside: Vec<BubbleAside>,
    /// The sentence as it was when the session began, shown for reference.
    pub original: String,
    /// How the bubbles were last grouped. Absent means words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<BubbleMode>,
    /// The saved forms, in the order they were saved. The arrangement above is what is
    /// written into the document; it may equal one of these, or none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub forms: Vec<BubbleForm>,
    /// The unsaved arrangement, kept while one of the forms is showing in its place — in
    /// the bubble editor, or in the document, where a sentence can be switched between
    /// its forms without opening the editor. Its id means nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsaved: Option<BubbleForm>,
}

/// Open the bubble editor on a session — new, or reopened from its mark.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleSessionOpened {
    pub doc_path: String,
    pub session: BubbleSession,
}

/// The writer left the bubble editor: write the sentence back.
///
/// `archive` decides what stays behind. False keeps the session on the sentence, so it
/// can be reopened; true takes it off and puts it in the document's archive
/// (`archive.rs`), from where it can be restored.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseBubbleSessionCommand {
    pub session: BubbleSession,
    pub archive: bool,
}

/// Where one open session's chip is in the document, for a shell that draws the chips
/// itself. Client coordinates inside the webview, as `NoteMarkerRect`'s.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleChipRect {
    pub session_id: String,
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    /// Which of the session's pages is showing — its forms, then the unsaved arrangement
    /// if there is one — and how many there are. Zero pages: it has no forms.
    #[serde(default)]
    pub form_page: u32,
    #[serde(default)]
    pub form_pages: u32,
}

/// Every session chip the user can see, and where — the whole list, so it is safe to
/// coalesce. The page's chips stay where they are, invisible, and go on taking the click
/// that reopens a session; the shell draws them as Liquid Glass, which only a view above
/// the page can be.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BubbleChipsChanged {
    pub chips: Vec<BubbleChipRect>,
}
