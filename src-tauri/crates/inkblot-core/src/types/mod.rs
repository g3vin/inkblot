//! The domain types, defined once here and generated into TypeScript and Swift by
//! `typeshare` (see `scripts/generate-types.sh`). Nothing hand-writes the generated
//! files — they are the mechanism that stops three languages drifting apart.
//!
//! Declared in dependency order:
//!
//! ```text
//! Viewport, Rect, Point, EdgeSide
//!   -> CanvasNode, CanvasEdge, CanvasState, CanvasFile
//!   -> NoteImage, AudioClip, Note
//!   -> VersionEntry -> TreeNode -> TextDocument
//! ```

pub mod canvas;
pub mod document;
pub mod geometry;
pub mod json;
pub mod note;

pub use canvas::{
    CanvasEdge, CanvasFile, CanvasFileMeta, CanvasNode, CanvasNodeType, CanvasState,
};
pub use document::{TextDocument, TreeNode, TreeNodeType, VersionEntry, VersionKind, VERSION_CAP};
pub use geometry::{EdgeSide, Point, Rect, Viewport};
pub use json::{JsonMap, JsonValue};
pub use note::{
    AudioClip, Note, NoteImage, NotePreviewLayout, NotePreviewSize, NoteType,
    DEFAULT_NOTE_COLOR, NOTE_COLOR_OPTIONS,
};
