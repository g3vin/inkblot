//! Thin commands over `inkblot-core` functions that hold no state of their own.

use inkblot_core::pinterest::ScrapeResult;
use inkblot_core::store::LockedEntries;
use tauri::AppHandle;

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    inkblot_core::fonts::list_system_fonts()
}

/// Fetch a public Pinterest board page and read its pins out of the HTML.
#[tauri::command]
pub async fn scrape_pinterest_html(
    url: String,
    max_pins: Option<usize>,
) -> Result<ScrapeResult, String> {
    inkblot_core::pinterest::scrape_pinterest_html(url, max_pins).await
}

/// What the writer has locked in a project (`src/lib/docLocks.ts`).
#[tauri::command]
pub async fn project_locks(
    app_handle: AppHandle,
    project_name: String,
) -> Result<LockedEntries, String> {
    Ok(crate::stats_commands::projects(&app_handle)?.locked_entries(&project_name))
}
