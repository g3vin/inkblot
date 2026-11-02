//! Bug and crash reports, reachable from the webview.
//!
//! The folder, the session file and the panic hook are `inkblot_core::diagnostics`;
//! this resolves where the folder is and sets it up before the main window exists.

use std::path::PathBuf;

use inkblot_core::diagnostics::{self, AppInfo, Diagnostics};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Set up reports for this process. Runs first in `setup`, so a panic while the
/// window is built is still recorded.
pub fn init(app: &AppHandle) {
    let Some(root) = reports_dir(app) else {
        return;
    };
    let debug_build = cfg!(debug_assertions);
    let info = AppInfo {
        version: app.package_info().version.to_string(),
        os: diagnostics::os_description(),
        debug_build,
    };
    // A debug build is killed with the dev server, so each launch would report an
    // unclean exit. INKBLOT_DIAGNOSTICS_SESSIONS=1 turns tracking on to test it.
    let track = !debug_build || std::env::var_os("INKBLOT_DIAGNOSTICS_SESSIONS").is_some();
    diagnostics::init(root, info, track);
    log::info!(target: "inkblot", "launched");
}

/// `~/Library/Logs/Inkblot` on macOS, beside other apps' logs and apart from app data,
/// so a report can be opened and shared without going near the writer's projects.
/// Named for the app rather than its bundle id: tooling that fences off everything
/// under the id (scripts/claude/private-writing.mjs) must still be able to read it.
fn reports_dir(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        return app
            .path()
            .home_dir()
            .ok()
            .map(|home| home.join("Library/Logs/Inkblot"));
    }
    app.path().app_log_dir().ok()
}

/// The app exited cleanly: the next launch has nothing to report.
pub fn clean_exit() {
    if let Some(diagnostics) = diagnostics::get() {
        diagnostics.clean_exit();
    }
}

fn get() -> Result<&'static Diagnostics, String> {
    diagnostics::get().ok_or_else(|| "diagnostics are not set up".to_owned())
}

/// What a report says about the native side: the OS, memory and CPU, and the folder.
#[tauri::command]
pub fn diagnostics_info() -> Result<Value, String> {
    let diagnostics = get()?;
    Ok(json!({
        "dir": diagnostics.root(),
        "os": diagnostics::os_description(),
        "process": diagnostics::process_usage(),
        "debugBuild": cfg!(debug_assertions),
    }))
}

#[tauri::command]
pub fn diagnostics_write_report(kind: String, report: Value) -> Result<String, String> {
    let path = get()?
        .write_report(&kind, &report)
        .map_err(|e| format!("could not save the report: {e}"))?;
    log::info!(target: "inkblot", "saved a {kind} report");
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn diagnostics_heartbeat(breadcrumbs: Value) -> Result<(), String> {
    get()?.heartbeat(breadcrumbs);
    Ok(())
}

#[tauri::command]
pub fn diagnostics_rust_log() -> Vec<String> {
    diagnostics::log_tail()
}

/// The page has loaded. Returns the crash report's path when it had loaded before in
/// this process without asking to (its web content crashed).
#[tauri::command]
pub fn diagnostics_page_started() -> Result<Option<String>, String> {
    Ok(get()?
        .page_started()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn diagnostics_expect_reload() -> Result<(), String> {
    get()?.expect_reload();
    Ok(())
}

/// Crash reports from the previous run, once, for the page to mention.
#[tauri::command]
pub fn diagnostics_take_notices() -> Result<Vec<String>, String> {
    Ok(get()?
        .take_notices()
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub fn diagnostics_counts() -> Result<Value, String> {
    Ok(get()?.counts())
}

#[tauri::command]
pub fn diagnostics_delete_all() -> Result<(), String> {
    get()?
        .delete_all()
        .map_err(|e| format!("could not delete the reports: {e}"))
}

/// Show a report, or the folder, in Finder. Only paths inside the folder: the page
/// must not be able to reveal anything else through this.
#[tauri::command]
pub fn diagnostics_reveal(path: Option<String>) -> Result<(), String> {
    let root = get()?.root().to_path_buf();
    let target = match path {
        Some(path) => {
            let path = PathBuf::from(path);
            let inside = path
                .canonicalize()
                .ok()
                .zip(root.canonicalize().ok())
                .is_some_and(|(path, root)| path.starts_with(root));
            if !inside {
                return Err("not a report".to_owned());
            }
            path
        }
        None => root,
    };
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
}

/// Debug builds only: panic on purpose, to check the panic report end to end.
#[tauri::command]
pub fn diagnostics_test_panic() {
    if cfg!(debug_assertions) {
        panic!("diagnostics_test_panic: a test panic");
    }
}
