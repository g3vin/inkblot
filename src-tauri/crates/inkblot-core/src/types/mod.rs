//! The domain types, defined once here and generated into TypeScript and Swift by
//! `typeshare` (see `scripts/generate-types.sh`). Nothing hand-writes the generated
//! files — they are the mechanism that stops three languages drifting apart.
//!
//! | Module | Types |
//! |---|---|
//! | `geometry` | `Viewport`, `Rect`, `Point`, `EdgeSide` |
//! | `canvas` | `CanvasNode`, `CanvasEdge`, `CanvasState`, `CanvasFile` |
//! | `note` | `NoteImage`, `AudioClip`, `Note` |
//! | `document` | `VersionEntry`, `TreeNode`, `TextDocument` |
//! | `diff` | The version diff engine's results: `DiffOp`, `HtmlBlock`, `DiffChunk`, `CanvasDiff` |
//! | `read_aloud`, `search`, `story` | Read Aloud payloads, search results, story presets |
//! | `json` | `JsonValue`, the escape hatch for JSON we carry but never interpret |
//!
//! Three typeshare limits shape these definitions:
//!
//! - It rejects `#[serde(flatten)]`, so the unknown-key maps that preserve data we do
//!   not model are `#[typeshare(skip)]`; the TypeScript façade (`src/types/index.ts`)
//!   adds them back as the `Stored*` types.
//! - It only emits adjacently tagged enums (`{ type, content }`). `DiffChunk` is
//!   internally tagged on the wire, so it is a struct with optional fields, not an enum.
//! - It does not map `BTreeMap`; use `HashMap`. Those maps are therefore unordered, and
//!   only an explicit order field (`nodeOrder`, `edgeOrder`) may decide sequence.

pub mod canvas;
pub mod diff;
pub mod document;
pub mod geometry;
pub mod json;
pub mod note;
pub mod read_aloud;
pub mod search;
pub mod story;

pub use diff::{
    CanvasDiff, CanvasNodeChange, DiffChunk, DiffChunkType, DiffOp, DiffOpType, HtmlBlock, MergeChoice, WordDelta, VersionRow,
};
pub use canvas::{
    CanvasEdge, CanvasFile, CanvasFileMeta, CanvasNode, CanvasNodeType, CanvasState,
};
pub use document::{DocKind, TextDocument, TreeNode, TreeNodeType, VersionEntry, VersionKind, VERSION_CAP};
pub use geometry::{BezierPath, EdgeSide, Point, Rect, Viewport};
pub use json::{JsonMap, JsonValue};
pub use read_aloud::{ReadAloudChunk, ReadAloudPayload, ReadAloudWord};
pub use search::{SearchResult, SearchResultType, SearchScope, SearchScopeInfo};
pub use story::{StoryFolderAncestor, StoryFolderPreset};
pub use note::{
    AudioClip, Note, NoteImage, NotePreviewLayout, NotePreviewSize, NoteType,
    DEFAULT_NOTE_COLOR, NOTE_COLOR_OPTIONS,
};
