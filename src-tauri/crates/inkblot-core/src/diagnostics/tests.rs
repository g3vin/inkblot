use std::fs;
use std::path::PathBuf;

use log::Level;
use serde_json::json;

use super::*;

/// The store's temp-directory helper; see the search tests for why each suite has one.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "inkblot-diagnostics-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn app() -> AppInfo {
    AppInfo {
        version: "9.9.9".into(),
        os: "test".into(),
        debug_build: false,
    }
}

#[test]
fn file_stems_sort_and_stay_safe() {
    assert_eq!(
        file_stem(1_773_531_000_123, "bug"),
        "2026-03-14T23-30-00-123Z-bug"
    );
    assert_eq!(file_stem(0, "../etc/x"), "1970-01-01T00-00-00-000Z-etcx");
}

#[test]
fn bug_reports_and_crashes_go_to_their_folders() {
    let dir = TempDir::new();
    let diagnostics = Diagnostics::detached(dir.0.clone());
    let bug = diagnostics.write_report("bug", &json!({"a": 1})).unwrap();
    let crash = diagnostics.write_report("js", &json!({"b": 2})).unwrap();
    let again = diagnostics.write_report("js", &json!({"b": 3})).unwrap();

    assert!(bug.starts_with(dir.0.join("reports")));
    assert!(crash.starts_with(dir.0.join("crashes")));
    assert_ne!(crash, again, "two reports in one millisecond both survive");
    assert_eq!(fs::read_to_string(&bug).unwrap(), "{\n  \"a\": 1\n}");
    assert_eq!(diagnostics.counts()["reports"], 1);
    assert_eq!(diagnostics.counts()["crashes"], 2);
    assert!(fs::read_dir(dir.0.join("crashes"))
        .unwrap()
        .all(|entry| !entry.unwrap().path().to_string_lossy().ends_with(".tmp")));

    diagnostics.delete_all().unwrap();
    assert_eq!(diagnostics.counts()["crashes"], 0);
}

#[test]
fn prune_keeps_the_newest() {
    let dir = TempDir::new();
    for n in 0..5 {
        fs::write(dir.0.join(format!("{n}.json")), "{}").unwrap();
    }
    fs::write(dir.0.join("keep.txt"), "").unwrap();
    prune(&dir.0, 3, 0);
    assert_eq!(files_newest_first(&dir.0).len(), 3);
    assert!(dir.0.join("keep.txt").exists(), "only reports are pruned");

    prune(&dir.0, 100, i64::MAX);
    assert!(files_newest_first(&dir.0).is_empty(), "old files go");
}

#[test]
fn an_uncleared_session_is_an_unclean_exit() {
    let dir = TempDir::new();
    let diagnostics = Diagnostics::detached(dir.0.clone());
    assert!(session::check_previous(&dir.0, &app()).is_none());

    session::start(&dir.0, &app());
    diagnostics.heartbeat(json!([{"type": "command", "id": "app.settings"}]));
    let report = session::check_previous(&dir.0, &app()).expect("an unclean exit");
    assert_eq!(report["kind"], "unclean-exit");
    assert_eq!(report["breadcrumbs"][0]["id"], "app.settings");
    assert!(report["previousSession"]["heartbeatAt"].is_string());
    assert!(
        session::check_previous(&dir.0, &app()).is_none(),
        "reported once"
    );

    session::start(&dir.0, &app());
    diagnostics.clean_exit();
    assert!(session::check_previous(&dir.0, &app()).is_none());
}

#[test]
fn notices_are_the_previous_runs_crashes_once() {
    let dir = TempDir::new();
    let first = Diagnostics::detached(dir.0.clone());
    first.start();
    assert!(
        first.take_notices().is_empty(),
        "nothing before the first launch"
    );
    first.write_report("js", &json!({})).unwrap();

    // The first run never cleared its session: the second finds its crash and an
    // unclean exit.
    let second = Diagnostics::detached(dir.0.clone());
    second.start();
    assert_eq!(second.take_notices().len(), 2);
    assert!(second.take_notices().is_empty());
}

#[test]
fn a_second_page_start_is_a_crash_unless_expected() {
    let dir = TempDir::new();
    let diagnostics = Diagnostics::detached(dir.0.clone());
    diagnostics.heartbeat(json!(["before"]));
    assert!(diagnostics.page_started().is_none());

    diagnostics.expect_reload();
    assert!(diagnostics.page_started().is_none(), "an asked-for reload");

    let path = diagnostics.page_started().expect("an unasked-for reload");
    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(report["kind"], "page-reload");
    assert_eq!(report["breadcrumbs"][0], "before");
    assert_eq!(diagnostics.take_notices(), vec![path]);
}

#[test]
fn the_logger_keeps_only_inkblot_and_tauri() {
    assert!(logger::accepts("inkblot_models::dictation", Level::Warn));
    assert!(logger::accepts("tauri::app", Level::Info));
    assert!(!logger::accepts("inkblot_models::scrape", Level::Debug));
    assert!(!logger::accepts("reqwest::connect", Level::Error));
}

#[test]
fn a_panic_report_names_the_panic() {
    let dir = TempDir::new();
    let diagnostics = Diagnostics::detached(dir.0.clone());
    diagnostics.heartbeat(json!(["crumb"]));
    let report = panic::report(&diagnostics, "boom", Some("src/x.rs:1:2"));
    assert_eq!(report["kind"], "panic");
    assert_eq!(report["panic"]["message"], "boom");
    assert_eq!(report["panic"]["location"], "src/x.rs:1:2");
    assert_eq!(report["breadcrumbs"][0], "crumb");
    assert!(report["panic"]["backtrace"].is_string());
}

#[test]
fn the_os_is_described() {
    assert!(os_description().contains(std::env::consts::ARCH));
    assert!(process_usage().is_object() || cfg!(not(unix)));
}
