//! Notes, their attached images, and their voice memos.
//!
//! Notes come in two kinds: `quote` notes anchored to a text range in a document
//! (`from`/`to`/`anchor`) and `free` notes with no anchor. They nest via
//! `parent_note_id`, carry images and voice memos, and remember their hover-preview
//! layout and size.
//!
//! **Images and audio take different paths on disk.** A note image is a thumbnail and
//! is base64-inlined into the document JSON; a voice memo is a minute of audio and is
//! content-addressed in the project's `.assets/` folder, referenced by path. Inlining
//! a memo would put ~700KB of base64 inside a document that is re-parsed on every load
//! and copied into every version-history entry.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::json::JsonMap;

pub const DEFAULT_NOTE_COLOR: &str = "#ffd54f";

/// `NOTE_COLOR_OPTIONS` in noteUtils.js.
pub const NOTE_COLOR_OPTIONS: [&str; 6] =
    ["#ffd54f", "#ff9aa2", "#9ad0f5", "#9ee493", "#c7a8ff", "#ffb86b"];

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteType {
    /// Anchored to a text range in the document.
    Quote,
    /// No anchor.
    Free,
}

/// A base64 data-URI image attached to a note.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteImage {
    pub id: String,
    /// A `data:` URI, not a path — note images are inlined in the document JSON.
    pub src: String,
    pub mime_type: String,
}

/// A voice memo attached to a note.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub id: String,
    /// A project-relative asset path, e.g. `.assets/fnv1a2b3c4.webm`.
    pub src: String,
    pub mime_type: String,
    pub duration_ms: f64,
    pub created_at: String,
}

/// Where the hover preview card sits relative to its anchor.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePreviewLayout {
    pub offset_x: f64,
    pub offset_y: f64,
}

/// Hover preview card size. Floors of 220×64 are applied on normalize.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NotePreviewSize {
    pub width: f64,
    pub height: f64,
}

impl Default for NotePreviewSize {
    fn default() -> Self {
        Self { width: 260.0, height: 88.0 }
    }
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    pub content: String,
    /// The anchor text, kept so a note can be re-resolved after an edit invalidates
    /// its ProseMirror positions.
    pub anchor: String,
    /// ProseMirror positions. Null on a `free` note, and on a `quote` note whose
    /// anchor has not been resolved against the current document.
    #[typeshare(typescript(type = "number | null"))]
    pub from: Option<f64>,
    #[typeshare(typescript(type = "number | null"))]
    pub to: Option<f64>,
    pub color: String,
    pub pinned: bool,
    #[typeshare(typescript(type = "string | null"))]
    pub parent_note_id: Option<String>,
    pub collapsed_children: bool,
    pub preview_layout: NotePreviewLayout,
    pub preview_size: NotePreviewSize,
    pub images: Vec<NoteImage>,
    pub audio: Vec<AudioClip>,
    pub created_at: String,
    pub updated_at: String,
    /// A *derived, display-only* short local time ("5:32 PM") that `normalizeNote`
    /// computes from `updated_at` and that then gets persisted with the note. It is
    /// locale-dependent, so nothing may read it back as data — recompute it instead.
    pub timestamp: String,
    /// **Unknown keys are preserved, not dropped.** `normalizeNote` spreads the
    /// original note before overriding the fields above (noteUtils.js:107), so a key
    /// written by a newer build survives a round-trip through an older one. This
    /// field is what keeps that true here.
    #[typeshare(skip)]
    #[serde(flatten)]
    pub extra: JsonMap,
}
