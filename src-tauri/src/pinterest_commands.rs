//! The Pinterest scrape's return channel, for the webview's `invoke`. The channel is
//! `inkblot_models::scrape`, which explains why it is two commands and not one.

use inkblot_core::pinterest::ScrapeReport;
use inkblot_models::scrape::ScrapeChannels;
use tauri::State;

#[tauri::command]
pub fn pinterest_begin_scrape(state: State<'_, ScrapeChannels>, request_id: String) {
    state.begin(request_id);
}

/// Called by the script inside the Pinterest page.
#[tauri::command]
pub fn pinterest_report_scrape(state: State<'_, ScrapeChannels>, report: ScrapeReport) {
    state.report(report);
}

#[tauri::command]
pub async fn pinterest_await_scrape(
    state: State<'_, ScrapeChannels>,
    request_id: String,
    timeout_ms: u64,
) -> Result<Option<ScrapeReport>, String> {
    state.await_report(&request_id, timeout_ms).await
}
