//! inkblot-models — the on-device models, with no shell attached.
//!
//! Each of these (rhymes aside, which are new) was a Tauri command module in the app
//! crate, reachable by one shell.
//! The logic is unchanged; what moved is the edge of it. Where a module took an
//! `AppHandle`, it takes the directory the handle was asked for. Where it called
//! `emit`, it calls a closure. Where Tauri managed its state, the caller holds the
//! engine. `src-tauri/src/*_commands.rs` wraps these for the webview's `invoke`, and
//! `inkblot-ffi` wraps the same ones for Swift.

mod download;

#[cfg(feature = "dictation")]
pub mod dictation;
pub mod kokoro_speech;
pub mod rhymes;
pub mod scrape;
pub mod synonyms;

/// The sentinel the webview matches on to offer a model download. Prose here would be
/// shown to the user as an error instead.
pub const MODEL_NOT_INSTALLED: &str = "MODEL_NOT_INSTALLED";
