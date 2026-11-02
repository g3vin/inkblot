//! inkblot-models — the on-device models, independent of any shell.
//!
//! Synonyms (an ONNX model), rhymes (a pronouncing-dictionary lookup), Pocket TTS
//! speech (ONNX), whisper dictation, and the Pinterest scrape's return channel. Nothing here
//! knows about Tauri: an engine takes the directory to keep its files in, reports
//! progress through a callback, and is owned by the caller. `src-tauri/src/*_commands.rs`
//! wraps these for the page's `invoke`.
//!
//! ## Adding a model
//!
//! 1. An engine struct holding its directory and a lazily loaded session
//!    (`Mutex<Option<…>>`), with `status()`, `download(progress)` and the inference
//!    call. Inference on a missing model returns [`MODEL_NOT_INSTALLED`], which the
//!    page matches to offer the download.
//! 2. Downloads go through `download::fetch_to`, which writes beside the destination
//!    and renames into place, so an interrupted download is never mistaken for a model.
//! 3. A `src-tauri/src/<name>_commands.rs` wrapper: a `*State` holding the engine in a
//!    `OnceLock`, registered with `.manage` and `generate_handler!` in `lib.rs`.

mod download;

#[cfg(feature = "dictation")]
pub mod dictation;
pub mod pocket_speech;
pub mod rhymes;
pub mod scrape;
pub mod synonyms;

/// The sentinel the webview matches on to offer a model download. Prose here would be
/// shown to the user as an error instead.
pub const MODEL_NOT_INSTALLED: &str = "MODEL_NOT_INSTALLED";
