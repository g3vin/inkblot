//! Writing statistics, reachable from the webview.
//!
//! The store is `inkblot_core::store::stats`; this is its Tauri shim, the same calls
//! `inkblot-ffi` made for the Swift app, under the same names. The page records its
//! sessions and timer runs here (`useStatsTracker`, `writingTimer`) and the Stats panel
//! reads them back rolled up by day.

use std::sync::OnceLock;

use inkblot_core::store::stats::StatsStore;
use inkblot_core::store::ProjectStore;
use inkblot_core::types::{DayStat, DocWordCount, StatsScope, StatsTotals, TimerRun, WritingSession};
use tauri::AppHandle;

static STATS: OnceLock<StatsStore> = OnceLock::new();
static PROJECTS: OnceLock<ProjectStore> = OnceLock::new();

fn root(app_handle: &AppHandle) -> Result<String, String> {
    let app_data = crate::app_data_dir(app_handle)?;
    app_data.to_str().map(str::to_string).ok_or_else(|| "AppData path is not valid UTF-8".to_string())
}

fn stats(app_handle: &AppHandle) -> Result<&'static StatsStore, String> {
    if let Some(store) = STATS.get() {
        return Ok(store);
    }
    let root = root(app_handle)?;
    Ok(STATS.get_or_init(|| StatsStore::new(&root)))
}

/// For counting a project's words from disk: read only, so its session id locks nothing.
fn projects(app_handle: &AppHandle) -> Result<&'static ProjectStore, String> {
    if let Some(store) = PROJECTS.get() {
        return Ok(store);
    }
    let root = root(app_handle)?;
    Ok(PROJECTS.get_or_init(|| ProjectStore::new(&root, "stats")))
}

/// A document without its project names nothing: paths repeat across projects.
pub(crate) fn scope(project: Option<String>, doc_path: Option<String>) -> StatsScope {
    let doc_path = if project.is_some() { doc_path } else { None };
    StatsScope { project, doc_path }
}

fn failed(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Record a session, new or a later checkpoint of one.
#[tauri::command]
pub async fn stats_record_session(app_handle: AppHandle, session: WritingSession) -> Result<(), String> {
    stats(&app_handle)?.record_session(&session).map_err(failed)
}

/// Sessions that began in the range (local `YYYY-MM-DD`, inclusive).
#[tauri::command]
pub async fn stats_sessions(
    app_handle: AppHandle,
    project: Option<String>,
    doc_path: Option<String>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<WritingSession>, String> {
    Ok(stats(&app_handle)?.sessions(&scope(project, doc_path), from_day.as_deref(), to_day.as_deref()))
}

/// The days in the range that have anything, oldest first.
#[tauri::command]
pub async fn stats_daily(
    app_handle: AppHandle,
    project: Option<String>,
    doc_path: Option<String>,
    from_day: String,
    to_day: String,
) -> Result<Vec<DayStat>, String> {
    Ok(stats(&app_handle)?.daily(&scope(project, doc_path), &from_day, &to_day))
}

#[tauri::command]
pub async fn stats_totals(app_handle: AppHandle, project: Option<String>, doc_path: Option<String>) -> Result<StatsTotals, String> {
    Ok(stats(&app_handle)?.totals(&scope(project, doc_path)))
}

/// Re-key an entry's history when it is renamed: `new_path` as the page computed it.
#[tauri::command]
pub async fn stats_rename_entry(
    app_handle: AppHandle,
    project: String,
    path: String,
    new_path: String,
    is_folder: bool,
) -> Result<(), String> {
    stats(&app_handle)?.rename_entry(&project, &path, &new_path, is_folder).map_err(failed)
}

/// Re-key an entry's history when it moves: the same name, in `target_folder`.
#[tauri::command]
pub async fn stats_move_entry(
    app_handle: AppHandle,
    project: String,
    path: String,
    target_folder: String,
    is_folder: bool,
) -> Result<(), String> {
    let name = path.trim_matches('/').rsplit('/').next().unwrap_or("").to_string();
    let folder = target_folder.trim_matches('/');
    let new_path = if folder.is_empty() { name } else { format!("{folder}/{name}") };
    stats(&app_handle)?.rename_entry(&project, &path, &new_path, is_folder).map_err(failed)
}

#[tauri::command]
pub async fn stats_rename_project(app_handle: AppHandle, old_name: String, new_name: String) -> Result<(), String> {
    stats(&app_handle)?.rename_project(&old_name, &new_name).map_err(failed)
}

/// Forget the history in scope — all of it when `project` is absent.
#[tauri::command]
pub async fn stats_reset(app_handle: AppHandle, project: Option<String>, doc_path: Option<String>) -> Result<(), String> {
    stats(&app_handle)?.reset(&scope(project, doc_path)).map_err(failed)
}

/// Record a timer run, new or a later record of one in progress.
#[tauri::command]
pub async fn stats_record_timer_run(app_handle: AppHandle, run: TimerRun) -> Result<(), String> {
    stats(&app_handle)?.record_timer_run(&run).map_err(failed)
}

#[tauri::command]
pub async fn stats_timer_runs(
    app_handle: AppHandle,
    project: Option<String>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<TimerRun>, String> {
    Ok(stats(&app_handle)?.timer_runs(project.as_deref(), from_day.as_deref(), to_day.as_deref()))
}

/// The goals, routines and reminders, as the JSON they were saved as — or none yet.
#[tauri::command]
pub async fn stats_config(app_handle: AppHandle) -> Result<Option<String>, String> {
    Ok(stats(&app_handle)?.config())
}

#[tauri::command]
pub async fn stats_set_config(app_handle: AppHandle, json: String) -> Result<(), String> {
    stats(&app_handle)?.set_config(&json).map_err(failed)
}

/// Every document's words in the project, read from disk — so a project's length
/// includes the chapters nobody has opened this week.
#[tauri::command]
pub async fn project_word_counts(app_handle: AppHandle, project_name: String) -> Result<Vec<DocWordCount>, String> {
    let store = projects(&app_handle)?;
    let tree = store.list_project_tree(&project_name);
    let mut counts = Vec::new();
    for file in inkblot_core::search::flatten_project_files(&tree) {
        if let Some(raw) = store.load_document(&project_name, &file.path).map_err(failed)? {
            counts.push(inkblot_core::store::stats::count_document(&file.path, &raw));
        }
    }
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::scope;

    #[test]
    fn a_document_without_its_project_names_nothing() {
        let s = scope(None, Some("Novel/One".into()));
        assert!(s.project.is_none() && s.doc_path.is_none());
        let s = scope(Some("P".into()), Some("Novel/One".into()));
        assert_eq!(s.doc_path.as_deref(), Some("Novel/One"));
    }
}
