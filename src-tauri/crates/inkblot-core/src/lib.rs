//! inkblot-core — Inkblot's domain logic, independent of any shell.
//!
//! Nothing here knows about Tauri, WebViews, React or Swift. That is the point: the
//! Tauri app links it today, and a native Swift shell links the same crate as a
//! static library tomorrow, so neither shell needs its own copy of the logic.
//!
//! Phase 2 of the migration moves the remaining JS domain modules down here —
//! documents, projects, version history and its diff engine, search, the canvas
//! model, notes. Today it holds the pieces that were already shell-agnostic.

pub mod canvas_geometry;
pub mod canvas_model;
pub mod doc_kind;
pub mod fonts;
pub mod js_number;
pub mod js_string;
pub mod notes;
pub mod pinterest;
pub mod read_aloud;
pub mod search;
pub mod store;
pub mod story_structure;
pub mod types;
pub mod version_history;
