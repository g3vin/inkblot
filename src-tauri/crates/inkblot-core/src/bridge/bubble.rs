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
//! The page draws the bubbles and finds the sentence again by the session's id when it
//! writes the arrangement back.

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
