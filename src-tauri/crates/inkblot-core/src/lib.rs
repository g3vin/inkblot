//! inkblot-core — Inkblot's domain logic, independent of any shell.
//!
//! Nothing here knows about Tauri, web views or React. The Tauri app links it directly
//! (`src-tauri/src/*_commands.rs`), and the page reaches it through them.
//!
//! ## Modules
//!
//! | Module | Role |
//! |---|---|
//! | `types` | Domain types, generated into TypeScript by typeshare |
//! | `bridge` | The chrome ↔ document-surface protocol, generated the same way |
//! | `store` | All persistence: projects, documents, versions, preferences |
//! | `search` | The sidebar search engine |
//! | `version_history` | The version diff engine and history grouping |
//! | `doc_kind` | Which kind of document a path is |
//! | `canvas_model`, `canvas_geometry`, `story_structure`, `notes`, `read_aloud` | Mirrors of the webview's JS (see below) |
//! | `js_number`, `js_string` | JavaScript number formatting and string semantics |
//! | `kokoro` | Kokoro's vocabulary and voice-style arithmetic (the model is in `inkblot-models`) |
//! | `fonts`, `pinterest` | System font listing; public Pinterest board scraping |
//!
//! ## Generated types
//!
//! Anything annotated `#[typeshare]` in `types/` or `bridge/` is the one definition of
//! that type: `npm run types` (`scripts/generate-types.sh`) writes
//! `src/types/inkblot-core.ts`, and `npm run types:check` fails when it is stale. Doc
//! comments are copied across, so they are read in both languages. Never edit the
//! generated file.
//!
//! ## JS parity
//!
//! Several modules implement logic the webview also implements in JavaScript
//! (`src/lib/`). Each says "Mirrors `src/lib/X`" at its top; `npm run parity` runs one
//! corpus through both and fails on any difference. Adding a mirrored function means
//! a case module in `tests/parity/cases/` and an arm in `bin/parity.rs`. Numbers
//! and strings must follow JavaScript's rules, not Rust's — `js_number`, `js_string`
//! and `canvas_geometry`'s `js_*` helpers exist for that.

pub mod bridge;
pub mod canvas_geometry;
pub mod canvas_model;
pub mod doc_kind;
pub mod fonts;
pub mod js_number;
pub mod js_string;
pub mod map;
pub mod kokoro;
pub mod notes;
pub mod pinterest;
pub mod read_aloud;
pub mod search;
pub mod store;
pub mod story_structure;
pub mod types;
pub mod version_history;
