//! The preference store, reachable from the webview.
//!
//! The store itself is `inkblot_core::store::preferences`; this is the Tauri shim over
//! it, plus the one thing the core cannot know — where AppData is. Tauri's path
//! resolver answers that, and a Swift shell would answer it from its own container.
//!
//! `preferences_load` returns everything at once, because the webview's facade is
//! synchronous: it hydrates the whole cache before React mounts, then answers
//! `getItem` from memory the way `localStorage` did.

use std::sync::OnceLock;

use inkblot_core::store::preferences::{PreferenceMap, PreferenceScope, PreferenceStore};
use tauri::{AppHandle, Manager};

static STORE: OnceLock<PreferenceStore> = OnceLock::new();

fn store(app_handle: &AppHandle) -> Result<&'static PreferenceStore, String> {
    if let Some(store) = STORE.get() {
        return Ok(store);
    }

    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("No AppData directory: {error}"))?;
    let root = app_data.to_str().ok_or("AppData path is not valid UTF-8")?;

    // A second caller racing us just gets the store the first one built; both were
    // built from the same path.
    Ok(STORE.get_or_init(|| PreferenceStore::new(root)))
}

fn scope_of(name: &str) -> Result<PreferenceScope, String> {
    PreferenceScope::parse(name).ok_or_else(|| format!("Unknown preference scope: {name}"))
}

#[tauri::command]
pub async fn preferences_load(
    app_handle: AppHandle,
) -> Result<std::collections::BTreeMap<&'static str, PreferenceMap>, String> {
    Ok(store(&app_handle)?.load_all())
}

#[tauri::command]
pub async fn preferences_set(
    app_handle: AppHandle,
    scope: String,
    key: String,
    value: String,
) -> Result<(), String> {
    store(&app_handle)?
        .set(scope_of(&scope)?, &key, &value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preferences_remove(
    app_handle: AppHandle,
    scope: String,
    key: String,
) -> Result<(), String> {
    store(&app_handle)?.remove(scope_of(&scope)?, &key).map_err(|error| error.to_string())
}

/// Move every key under one prefix to another — what a project rename does to the file
/// tree's stored order and expansion.
#[tauri::command]
pub async fn preferences_rename_prefix(
    app_handle: AppHandle,
    scope: String,
    from_prefix: String,
    to_prefix: String,
) -> Result<(), String> {
    store(&app_handle)?
        .rename_prefix(scope_of(&scope)?, &from_prefix, &to_prefix)
        .map_err(|error| error.to_string())
}
