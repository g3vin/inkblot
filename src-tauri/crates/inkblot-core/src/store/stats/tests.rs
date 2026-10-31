use serde_json::json;

use super::*;
use crate::types::StatsMinute;

/// A third copy of the store's temp-directory helper; see the search tests for why.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "inkblot-stats-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }

    fn store(&self) -> StatsStore {
        StatsStore::new(self.0.to_str().unwrap())
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 2026-03-14T23:30:00Z.
const LATE_MARCH_14: f64 = 1_773_531_000_000.0;

fn session(
    id: &str,
    project: &str,
    doc: &str,
    start: f64,
    minutes: &[(u32, u32)],
) -> WritingSession {
    WritingSession {
        id: id.into(),
        project: project.into(),
        doc_path: doc.into(),
        start,
        end: start + minutes.len() as f64 * 60_000.0,
        utc_offset_minutes: 0,
        open_secs: minutes.len() as u32 * 60,
        active_secs: minutes.len() as u32 * 30,
        words_added: minutes.iter().map(|(_, words)| words).sum(),
        minutes: minutes
            .iter()
            .map(|&(minute, words)| StatsMinute {
                minute,
                open_secs: 60,
                active_secs: 30,
                words_added: words,
                ..StatsMinute::default()
            })
            .collect(),
        ..WritingSession::default()
    }
}

#[test]
fn a_checkpointed_session_is_read_back_once_as_its_latest_record() {
    let dir = TempDir::new();
    let store = dir.store();
    store
        .record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, 10)]))
        .unwrap();
    store
        .record_session(&session(
            "s1",
            "Novel",
            "one",
            LATE_MARCH_14,
            &[(0, 10), (1, 20)],
        ))
        .unwrap();

    let sessions = store.sessions(&StatsScope::default(), None, None);
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].words_added, 30);
}

#[test]
fn a_line_cut_off_by_a_crash_is_skipped_and_the_rest_survive() {
    let dir = TempDir::new();
    let store = dir.store();
    store
        .record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, 10)]))
        .unwrap();
    let path = store.month_path::<WritingSession>("2026-03");
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str("{\"id\":\"s2\",\"proj");
    std::fs::write(&path, text).unwrap();
    store
        .record_session(&session("s3", "Novel", "two", LATE_MARCH_14, &[(0, 5)]))
        .unwrap();

    assert_eq!(store.sessions(&StatsScope::default(), None, None).len(), 2);
}

#[test]
fn a_month_of_checkpoints_is_compacted_when_it_is_read() {
    let dir = TempDir::new();
    let store = dir.store();
    for words in 0..10 {
        store
            .record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, words)]))
            .unwrap();
    }
    store.sessions(&StatsScope::default(), None, None);
    let lines = std::fs::read_to_string(store.month_path::<WritingSession>("2026-03"))
        .unwrap()
        .lines()
        .count();
    assert_eq!(lines, 1);
}

#[test]
fn minutes_after_midnight_land_on_the_next_day() {
    let dir = TempDir::new();
    let store = dir.store();
    // 23:30 UTC for an hour: thirty minutes on the 14th, thirty on the 15th.
    let minutes: Vec<(u32, u32)> = (0..60).map(|minute| (minute, 1)).collect();
    store
        .record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &minutes))
        .unwrap();

    let days = store.daily(&StatsScope::default(), "2026-03-14", "2026-03-15");
    assert_eq!(days.len(), 2);
    assert_eq!(
        (days[0].day.as_str(), days[0].words_added, days[0].sessions),
        ("2026-03-14", 30, 1)
    );
    assert_eq!(
        (days[1].day.as_str(), days[1].words_added, days[1].sessions),
        ("2026-03-15", 30, 0)
    );
    assert_eq!(days[0].hours[23], 30 * 30);
    assert_eq!(days[1].hours[0], 30 * 30);
}

#[test]
fn the_day_is_the_writers_local_day_and_crosses_a_month() {
    let dir = TempDir::new();
    let store = dir.store();
    // 2026-03-31T23:30Z is 01:30 on April 1st two hours east — an April day, filed
    // under April, and still found from March's side of the range.
    let start =
        1_775_000_000_000.0 - (1_775_000_000_000.0 % 86_400_000.0) + 86_400_000.0 - 1_800_000.0;
    let mut east = session("s1", "Novel", "one", start, &[(0, 7)]);
    east.utc_offset_minutes = 120;
    store.record_session(&east).unwrap();

    let days = store.daily(&StatsScope::default(), "2026-03-01", "2026-04-30");
    assert_eq!(days.len(), 1);
    assert!(days[0].day.starts_with("2026-04"), "{}", days[0].day);
}

#[test]
fn a_scope_narrows_to_a_project_and_then_to_a_document() {
    let dir = TempDir::new();
    let store = dir.store();
    store
        .record_session(&session("a", "Novel", "one", LATE_MARCH_14, &[(0, 10)]))
        .unwrap();
    store
        .record_session(&session("b", "Novel", "two", LATE_MARCH_14, &[(0, 20)]))
        .unwrap();
    store
        .record_session(&session("c", "Essays", "one", LATE_MARCH_14, &[(0, 40)]))
        .unwrap();

    let everything = store.totals(&StatsScope::default());
    let novel = store.totals(&StatsScope {
        project: Some("Novel".into()),
        doc_path: None,
    });
    let chapter = store.totals(&StatsScope {
        project: Some("Novel".into()),
        doc_path: Some("one".into()),
    });
    assert_eq!((everything.words_added, everything.sessions), (70, 3));
    assert_eq!(novel.words_added, 30);
    assert_eq!(chapter.words_added, 10);
    assert_eq!(everything.days_written, 1);
    assert_eq!(everything.first_session, Some(LATE_MARCH_14));
}

#[test]
fn a_rename_takes_the_history_with_it_and_a_folder_takes_everything_under_it() {
    let dir = TempDir::new();
    let store = dir.store();
    store
        .record_session(&session(
            "a",
            "Novel",
            "drafts/one",
            LATE_MARCH_14,
            &[(0, 1)],
        ))
        .unwrap();
    store
        .record_session(&session(
            "b",
            "Novel",
            "drafts-old/two",
            LATE_MARCH_14,
            &[(0, 1)],
        ))
        .unwrap();
    store
        .record_session(&session(
            "c",
            "Essays",
            "drafts/one",
            LATE_MARCH_14,
            &[(0, 1)],
        ))
        .unwrap();

    store
        .rename_entry("Novel", "drafts", "chapters", true)
        .unwrap();
    store
        .rename_entry("Novel", "chapters/one", "chapters/prologue", false)
        .unwrap();
    store.rename_project("Novel", "The Novel").unwrap();

    let paths: Vec<(String, String)> = store
        .sessions(&StatsScope::default(), None, None)
        .into_iter()
        .map(|session| (session.project, session.doc_path))
        .collect();
    assert!(paths.contains(&("The Novel".into(), "chapters/prologue".into())));
    assert!(
        paths.contains(&("The Novel".into(), "drafts-old/two".into())),
        "a sibling that shares a prefix is not inside the folder"
    );
    assert!(
        paths.contains(&("Essays".into(), "drafts/one".into())),
        "another project's document of the same name stays"
    );
}

#[test]
fn a_reset_forgets_only_its_scope() {
    let dir = TempDir::new();
    let store = dir.store();
    store
        .record_session(&session("a", "Novel", "one", LATE_MARCH_14, &[(0, 1)]))
        .unwrap();
    store
        .record_session(&session("b", "Essays", "one", LATE_MARCH_14, &[(0, 1)]))
        .unwrap();

    store
        .reset(&StatsScope {
            project: Some("Novel".into()),
            doc_path: None,
        })
        .unwrap();
    assert_eq!(store.totals(&StatsScope::default()).sessions, 1);
    store.reset(&StatsScope::default()).unwrap();
    assert_eq!(store.totals(&StatsScope::default()).sessions, 0);
}

#[test]
fn config_is_kept_as_given_and_refused_when_it_is_not_json() {
    let dir = TempDir::new();
    let store = dir.store();
    assert_eq!(store.config(), None);
    store.set_config(r#"{"version":1}"#).unwrap();
    assert_eq!(store.config().as_deref(), Some(r#"{"version":1}"#));
    assert!(store.set_config("not json").is_err());
}

#[test]
fn a_document_is_counted_the_way_the_page_counts_it() {
    let raw = json!({ "content": { "type": "doc", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "She hesitated" }] },
        { "type": "paragraph", "content": [
            { "type": "text", "text": "at the" },
            { "type": "hardBreak" },
            { "type": "text", "text": "door." },
        ] },
    ] } });
    let counted = count_document("chapters/one", &raw);
    assert_eq!(counted.words, 5);
    assert_eq!(counted.chars, "She hesitatedat thedoor.".len() as u32);

    let canvas = json!({ "nodes": [{ "text": "a card here" }, { "label": "group" }], "edges": [{ "label": "leads to" }] });
    assert_eq!(count_document("board.canvas", &canvas).words, 6);
}

#[test]
fn timer_runs_are_kept_by_id_filtered_by_project_and_reset_with_it() {
    let dir = TempDir::new();
    let store = dir.store();
    let run = |id: &str, project: Option<&str>, sprints: u32| TimerRun {
        id: id.into(),
        routine_name: "Pomodoro".into(),
        project: project.map(str::to_string),
        start: LATE_MARCH_14,
        end: LATE_MARCH_14 + 60_000.0,
        sprints_completed: sprints,
        ..TimerRun::default()
    };
    store
        .record_timer_run(&run("r1", Some("Novel"), 1))
        .unwrap();
    store
        .record_timer_run(&run("r1", Some("Novel"), 2))
        .unwrap();
    store
        .record_timer_run(&run("r2", Some("Essays"), 1))
        .unwrap();

    let novel = store.timer_runs(Some("Novel"), None, None);
    assert_eq!(novel.len(), 1);
    assert_eq!(novel[0].sprints_completed, 2);
    assert_eq!(
        store
            .timer_runs(None, Some("2026-03-14"), Some("2026-03-14"))
            .len(),
        2
    );
    assert!(store.timer_runs(None, Some("2026-03-15"), None).is_empty());

    store.rename_project("Novel", "The Novel").unwrap();
    assert_eq!(store.timer_runs(Some("The Novel"), None, None).len(), 1);

    // A document's reset leaves the project's runs; the project's takes them.
    store
        .reset(&StatsScope {
            project: Some("The Novel".into()),
            doc_path: Some("one".into()),
        })
        .unwrap();
    assert_eq!(store.timer_runs(Some("The Novel"), None, None).len(), 1);
    store
        .reset(&StatsScope {
            project: Some("The Novel".into()),
            doc_path: None,
        })
        .unwrap();
    assert!(store.timer_runs(Some("The Novel"), None, None).is_empty());
    assert_eq!(store.timer_runs(None, None, None).len(), 1);
}
