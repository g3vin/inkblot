//! What Read Aloud speaks, and what it highlights while speaking it.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// One word of readable text, with where it sits in the readable string and where it
/// sits in the document.
///
/// `start_offset`/`end_offset` are offsets into the readable text, in UTF-16 code
/// units. `from`/`to` are ProseMirror positions — what the highlight scheduler resolves
/// against as the audio plays. Both are absent on a word that came from plain text with
/// no document behind it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAloudWord {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<u32>,
}

/// The readable text of a document, and the words resolved out of it.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ReadAloudPayload {
    pub text: String,
    pub words: Vec<ReadAloudWord>,
}

/// One call to the speech engine.
///
/// `text` is what is spoken — normalized, with line breaks closed up into spaces.
/// `words` is what it was built from, kept so the scheduler can map audio time back to
/// document positions.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadAloudChunk {
    pub text: String,
    pub words: Vec<ReadAloudWord>,
}
