//! Writing statistics on disk.
//!
//! ```text
//!   <AppData>/stats/sessions/YYYY-MM.jsonl   one WritingSession per line, by local start month
//!   <AppData>/stats/timer-runs/YYYY-MM.jsonl one TimerRun per line, the same way
//!   <AppData>/stats/config.json              the shell's settings: goals, timers, reminders
//! ```
//!
//! Machine-local, like the preferences: stats describe this writer's sittings at this
//! machine, and are kept out of the project so they do not travel with it.
//!
//! ## Append, then keep the last
//!
//! A shell records the session it is in every minute or so, so a crash costs a minute.
//! Rewriting a month's file for each of those would be the only write that grows with
//! history, so a record is *appended*, and a reader keeps the last line for each id.
//! When superseded lines outnumber live ones the file is compacted on read. A line that
//! does not parse — a write cut off by a crash — is skipped, not fatal: losing one
//! checkpoint is the whole point of having the next.
//!
//! ## Days are the writer's
//!
//! Every session carries the UTC offset it began under, and each minute is placed on a
//! local day and hour from that. No calendar library, no time zone database: the shell
//! knew the offset when it mattered and wrote it down.
//!
//! ## Identity
//!
//! A document is `(project, docPath)`, the same pair every other store call uses. A
//! rename or a move changes it, so the shell re-keys the history when it asks the page
//! for one ([`StatsStore::rename_entry`], [`StatsStore::rename_project`]).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use super::clock::iso8601_from_millis;
use super::StoreError;
use crate::types::{DayStat, DocWordCount, StatsScope, StatsTotals, TimerRun, WritingSession};

type Result<T> = std::result::Result<T, StoreError>;

/// Compact a month file once it holds this many lines per live session.
const COMPACT_RATIO: usize = 3;

pub struct StatsStore {
    root: PathBuf,
    /// Appends and rewrites of one month file must not interleave.
    write_lock: Mutex<()>,
}

impl StatsStore {
    pub fn new(app_data_root: &str) -> Self {
        Self {
            root: Path::new(app_data_root).join("stats"),
            write_lock: Mutex::new(()),
        }
    }

    fn log_dir<T: Logged>(&self) -> PathBuf {
        self.root.join(T::DIR)
    }

    fn month_path<T: Logged>(&self, month: &str) -> PathBuf {
        self.log_dir::<T>().join(format!("{month}.jsonl"))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /* ---------------- the logs ---------------- */

    /// Append a record, new or a later checkpoint of one already there.
    fn append<T: Logged>(&self, record: &T) -> Result<()> {
        let _guard = self.lock();
        std::fs::create_dir_all(self.log_dir::<T>())?;
        let month = &local_iso(record.start(), record.utc_offset_minutes())[..7];
        let path = self.month_path::<T>(month);
        let mut line = serde_json::to_string(record)?;
        line.push('\n');
        // A write cut off by a crash leaves no newline, and this line would be glued to
        // it and lost with it.
        if !ends_with_newline(&path) {
            line.insert(0, '\n');
        }
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(line.as_bytes())?;
        Ok(())
    }

    /// The months on disk, oldest first, as `YYYY-MM`.
    fn months<T: Logged>(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.log_dir::<T>()) else {
            return Vec::new();
        };
        let mut months: Vec<String> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.strip_suffix(".jsonl").map(str::to_string)
            })
            .filter(|month| month.len() == 7)
            .collect();
        months.sort();
        months
    }

    /// One month's records, the latest of each, in the order they began.
    fn read_month<T: Logged>(&self, month: &str) -> Vec<T> {
        let path = self.month_path::<T>(month);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Vec::new();
        };
        let mut lines = 0usize;
        let mut latest: HashMap<String, T> = HashMap::new();
        for line in text.lines().filter(|line| !line.trim().is_empty()) {
            lines += 1;
            if let Ok(record) = serde_json::from_str::<T>(line) {
                latest.insert(record.id().to_string(), record);
            }
        }
        let mut records: Vec<T> = latest.into_values().collect();
        records.sort_by(|a, b| a.start().total_cmp(&b.start()).then_with(|| a.id().cmp(b.id())));

        if !records.is_empty() && lines > records.len() * COMPACT_RATIO {
            let _guard = self.lock();
            // Best effort: a failed compaction leaves a longer file, not a wrong one.
            let _ = write_month(&path, &records);
        }
        records
    }

    /// Records that began in `[from_day, to_day]` (local, inclusive, `YYYY-MM-DD`;
    /// either may be omitted).
    fn read_range<T: Logged>(&self, from_day: Option<&str>, to_day: Option<&str>) -> Vec<T> {
        self.months_between::<T>(from_day, to_day)
            .iter()
            .flat_map(|month| self.read_month::<T>(month))
            .filter(|record| {
                let day = &local_iso(record.start(), record.utc_offset_minutes())[..10];
                from_day.map_or(true, |from| day >= from) && to_day.map_or(true, |to| day <= to)
            })
            .collect()
    }

    /* ---------------- sessions ---------------- */

    /// Record a session, new or a later checkpoint of one already recorded.
    pub fn record_session(&self, session: &WritingSession) -> Result<()> {
        self.append(session)
    }

    /// Every session in scope that began in `[from_day, to_day]` (local, inclusive,
    /// `YYYY-MM-DD`; either may be omitted).
    pub fn sessions(
        &self,
        scope: &StatsScope,
        from_day: Option<&str>,
        to_day: Option<&str>,
    ) -> Vec<WritingSession> {
        self.read_range::<WritingSession>(from_day, to_day)
            .into_iter()
            .filter(|session| in_scope(session, scope))
            .collect()
    }

    /// Months that can hold a session touching the range. One month earlier than the
    /// range starts, because a session that began on the last evening of a month runs
    /// its minutes into the next.
    fn months_between<T: Logged>(&self, from_day: Option<&str>, to_day: Option<&str>) -> Vec<String> {
        let from_month = from_day.map(|day| previous_month(&day[..7.min(day.len())]));
        let to_month = to_day.map(|day| day[..7.min(day.len())].to_string());
        self.months::<T>()
            .into_iter()
            .filter(|month| from_month.as_deref().map_or(true, |from| month.as_str() >= from))
            .filter(|month| to_month.as_deref().map_or(true, |to| month.as_str() <= to))
            .collect()
    }

    /// The range's days, each summed from the minutes that fell on it. Days with
    /// nothing are left out; a chart fills its own gaps.
    pub fn daily(&self, scope: &StatsScope, from_day: &str, to_day: &str) -> Vec<DayStat> {
        let mut days: BTreeMap<String, DayStat> = BTreeMap::new();

        // Sessions are read from the month before as well, for the minutes that cross.
        let sessions = self
            .months_between::<WritingSession>(Some(from_day), Some(to_day))
            .iter()
            .flat_map(|month| self.read_month::<WritingSession>(month))
            .filter(|session| in_scope(session, scope))
            .collect::<Vec<_>>();

        for session in &sessions {
            let start_day = local_iso(session.start, session.utc_offset_minutes)[..10].to_string();
            if start_day.as_str() >= from_day && start_day.as_str() <= to_day {
                day_entry(&mut days, &start_day).sessions += 1;
            }
            for minute in &session.minutes {
                let at = session.start + f64::from(minute.minute) * 60_000.0;
                let iso = local_iso(at, session.utc_offset_minutes);
                let (day_key, hour) = (&iso[..10], iso[11..13].parse::<usize>().unwrap_or(0));
                if day_key < from_day || day_key > to_day {
                    continue;
                }
                let day = day_entry(&mut days, day_key);
                day.open_secs += minute.open_secs;
                day.active_secs += minute.active_secs;
                day.words_added += minute.words_added;
                day.words_deleted += minute.words_deleted;
                day.words_pasted += minute.words_pasted;
                if let Some(slot) = day.hours.get_mut(hour) {
                    *slot += minute.active_secs;
                }
            }
        }
        days.into_values().collect()
    }

    /// Everything in scope, over all time.
    pub fn totals(&self, scope: &StatsScope) -> StatsTotals {
        let mut totals = StatsTotals::default();
        let mut written_days: HashSet<String> = HashSet::new();
        for session in self.sessions(scope, None, None) {
            totals.sessions += 1;
            totals.open_secs += session.open_secs;
            totals.active_secs += session.active_secs;
            totals.words_added += session.words_added;
            totals.words_deleted += session.words_deleted;
            totals.words_pasted += session.words_pasted;
            totals.longest_session_secs = totals.longest_session_secs.max(session.open_secs);
            totals.first_session = Some(totals.first_session.map_or(session.start, |at| at.min(session.start)));
            totals.last_session = Some(totals.last_session.map_or(session.start, |at| at.max(session.start)));
            for minute in session.minutes.iter().filter(|minute| minute.words_added > 0) {
                let at = session.start + f64::from(minute.minute) * 60_000.0;
                written_days.insert(local_iso(at, session.utc_offset_minutes)[..10].to_string());
            }
        }
        totals.days_written = written_days.len() as u32;
        totals
    }

    /* ---------------- identity ---------------- */

    /// A document or folder was renamed or moved: its sessions follow it. A folder
    /// takes every document under it.
    pub fn rename_entry(&self, project: &str, old_path: &str, new_path: &str, is_folder: bool) -> Result<()> {
        let (old_path, new_path) = (old_path.trim_matches('/'), new_path.trim_matches('/'));
        self.rewrite(|session| {
            if session.project != project {
                return false;
            }
            let renamed = if is_folder {
                session
                    .doc_path
                    .strip_prefix(old_path)
                    .filter(|rest| rest.starts_with('/'))
                    .map(|rest| format!("{new_path}{rest}"))
            } else {
                (session.doc_path == old_path).then(|| new_path.to_string())
            };
            match renamed {
                Some(path) => {
                    session.doc_path = path;
                    true
                }
                None => false,
            }
        })
    }

    pub fn rename_project(&self, old_name: &str, new_name: &str) -> Result<()> {
        self.rewrite(|session| {
            if session.project != old_name {
                return false;
            }
            session.project = new_name.to_string();
            true
        })?;
        for month in self.months::<TimerRun>() {
            let mut runs = self.read_month::<TimerRun>(&month);
            let mut changed = false;
            for run in runs.iter_mut().filter(|run| run.project.as_deref() == Some(old_name)) {
                run.project = Some(new_name.to_string());
                changed = true;
            }
            if changed {
                let _guard = self.lock();
                write_month(&self.month_path::<TimerRun>(&month), &runs)?;
            }
        }
        Ok(())
    }

    /// Apply `change` to every session, rewriting only the months it touched.
    fn rewrite(&self, mut change: impl FnMut(&mut WritingSession) -> bool) -> Result<()> {
        for month in self.months::<WritingSession>() {
            let mut sessions = self.read_month::<WritingSession>(&month);
            let mut changed = false;
            for session in &mut sessions {
                changed |= change(session);
            }
            if changed {
                let _guard = self.lock();
                write_month(&self.month_path::<WritingSession>(&month), &sessions)?;
            }
        }
        Ok(())
    }

    /// Forget every session and timer run in scope. The whole history when the scope is
    /// empty.
    pub fn reset(&self, scope: &StatsScope) -> Result<()> {
        self.reset_log::<WritingSession>(|session| in_scope(session, scope), scope.project.is_none())?;
        // A run belongs to a project, not a document: a document's reset leaves it.
        if scope.doc_path.is_none() {
            let project = scope.project.clone();
            self.reset_log::<TimerRun>(
                |run| project.as_ref().map_or(true, |project| run.project.as_ref() == Some(project)),
                scope.project.is_none(),
            )?;
        }
        Ok(())
    }

    fn reset_log<T: Logged>(&self, doomed: impl Fn(&T) -> bool, everything: bool) -> Result<()> {
        if everything {
            let _guard = self.lock();
            return match std::fs::remove_dir_all(self.log_dir::<T>()) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
                _ => Ok(()),
            };
        }
        for month in self.months::<T>() {
            let records = self.read_month::<T>(&month);
            let kept: Vec<T> = records.iter().filter(|record| !doomed(record)).cloned().collect();
            if kept.len() != records.len() {
                let _guard = self.lock();
                write_month(&self.month_path::<T>(&month), &kept)?;
            }
        }
        Ok(())
    }

    /* ---------------- timer runs ---------------- */

    /// Record a run of the writing timer, new or a later record of one in progress.
    pub fn record_timer_run(&self, run: &TimerRun) -> Result<()> {
        self.append(run)
    }

    /// Runs that began in the range, for one project or all of them.
    pub fn timer_runs(&self, project: Option<&str>, from_day: Option<&str>, to_day: Option<&str>) -> Vec<TimerRun> {
        self.read_range::<TimerRun>(from_day, to_day)
            .into_iter()
            .filter(|run| project.map_or(true, |project| run.project.as_deref() == Some(project)))
            .collect()
    }

    /* ---------------- config ---------------- */

    /// The shell's stats settings, as the JSON it last stored, or `None`. Opaque here:
    /// goals and timers are the shell's to define, and it versions them itself.
    pub fn config(&self) -> Option<String> {
        std::fs::read_to_string(self.root.join("config.json")).ok()
    }

    pub fn set_config(&self, json: &str) -> Result<()> {
        serde_json::from_str::<Value>(json)?;
        let _guard = self.lock();
        std::fs::create_dir_all(&self.root)?;
        write_atomic(&self.root.join("config.json"), json.as_bytes())
    }
}

/// A kind of record kept as month logs: an id to keep the latest by, and a start and
/// offset to file it under the writer's month.
trait Logged: Serialize + DeserializeOwned + Clone {
    const DIR: &'static str;
    fn id(&self) -> &str;
    fn start(&self) -> f64;
    fn utc_offset_minutes(&self) -> i32;
}

impl Logged for WritingSession {
    const DIR: &'static str = "sessions";
    fn id(&self) -> &str { &self.id }
    fn start(&self) -> f64 { self.start }
    fn utc_offset_minutes(&self) -> i32 { self.utc_offset_minutes }
}

impl Logged for TimerRun {
    const DIR: &'static str = "timer-runs";
    fn id(&self) -> &str { &self.id }
    fn start(&self) -> f64 { self.start }
    fn utc_offset_minutes(&self) -> i32 { self.utc_offset_minutes }
}

fn day_entry<'a>(days: &'a mut BTreeMap<String, DayStat>, day: &str) -> &'a mut DayStat {
    days.entry(day.to_string()).or_insert_with(|| DayStat {
        day: day.to_string(),
        hours: vec![0; 24],
        ..DayStat::default()
    })
}

fn in_scope(session: &WritingSession, scope: &StatsScope) -> bool {
    scope.project.as_deref().map_or(true, |project| session.project == project)
        && scope.doc_path.as_deref().map_or(true, |doc| session.doc_path == doc)
}

/// `YYYY-MM-DDTHH:MM:SS.sssZ` for the local wall clock at `millis` — the `Z` is a lie
/// the callers never read past the hour.
fn local_iso(millis: f64, utc_offset_minutes: i32) -> String {
    iso8601_from_millis(millis as i64 + i64::from(utc_offset_minutes) * 60_000)
}

fn previous_month(month: &str) -> String {
    let (Some(year), Some(number)) = (
        month.get(..4).and_then(|y| y.parse::<i32>().ok()),
        month.get(5..7).and_then(|m| m.parse::<u32>().ok()),
    ) else {
        return month.to_string();
    };
    if number <= 1 {
        format!("{:04}-12", year - 1)
    } else {
        format!("{year:04}-{:02}", number - 1)
    }
}

/// True for a missing or empty file too: there is nothing to be glued to.
fn ends_with_newline(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(path) else { return true };
    if file.seek(SeekFrom::End(-1)).is_err() {
        return true;
    }
    let mut last = [0u8; 1];
    file.read_exact(&mut last).is_err() || last[0] == b'\n'
}

fn write_month<T: Serialize>(path: &Path, records: &[T]) -> Result<()> {
    let mut text = String::new();
    for record in records {
        text.push_str(&serde_json::to_string(record)?);
        text.push('\n');
    }
    write_atomic(path, text.as_bytes())
}

/// Write beside, then rename over: a rewrite that is cut off leaves the old file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/* ---------------- document lengths ---------------- */

/// A saved document's words and characters, counted the way the page counts them:
/// `countWords(editor.getText())` and `doc.textContent.length`.
///
/// `getText` puts a separator between blocks and a newline for a hard break, and
/// words are split on whitespace, so a boundary between blocks or at a leaf node is a
/// boundary between words. `textContent` has no separators, so characters are only
/// the text.
pub fn count_document(doc_path: &str, raw: &Value) -> DocWordCount {
    let (words, chars) = if crate::doc_kind::is_canvas_doc(doc_path) {
        count_canvas(raw)
    } else if crate::doc_kind::is_map_doc(doc_path) {
        (crate::map::model::count_map_words(raw), 0)
    } else {
        let mut text = String::new();
        let mut chars = 0u32;
        walk_text(&raw["content"], &mut text, &mut chars);
        (crate::version_history::text_words(&text).len() as u32, chars)
    };
    DocWordCount { doc_path: doc_path.to_string(), words, chars }
}

fn walk_text(node: &Value, text: &mut String, chars: &mut u32) {
    if node["type"] == "text" {
        if let Some(value) = node["text"].as_str() {
            text.push_str(value);
            *chars += value.encode_utf16().count() as u32;
        }
        return;
    }
    // Every other node is a word boundary on both sides: a block, a hard break, an
    // image. The page's getText agrees for the first two and would run a word into an
    // image's neighbour, which no writer means.
    text.push(' ');
    for child in node["content"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        walk_text(child, text, chars);
    }
    text.push(' ');
}

fn count_canvas(raw: &Value) -> (u32, u32) {
    let (mut words, mut chars) = (0u32, 0u32);
    let mut count = |value: &Value| {
        if let Some(text) = value.as_str() {
            words += crate::version_history::text_words(text).len() as u32;
            chars += text.encode_utf16().count() as u32;
        }
    };
    for node in raw["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        count(&node["text"]);
        count(&node["label"]);
    }
    for edge in raw["edges"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        count(&edge["label"]);
    }
    (words, chars)
}

#[cfg(test)]
mod tests {
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

    fn session(id: &str, project: &str, doc: &str, start: f64, minutes: &[(u32, u32)]) -> WritingSession {
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
        store.record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, 10)])).unwrap();
        store.record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, 10), (1, 20)])).unwrap();

        let sessions = store.sessions(&StatsScope::default(), None, None);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].words_added, 30);
    }

    #[test]
    fn a_line_cut_off_by_a_crash_is_skipped_and_the_rest_survive() {
        let dir = TempDir::new();
        let store = dir.store();
        store.record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, 10)])).unwrap();
        let path = store.month_path::<WritingSession>("2026-03");
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"id\":\"s2\",\"proj");
        std::fs::write(&path, text).unwrap();
        store.record_session(&session("s3", "Novel", "two", LATE_MARCH_14, &[(0, 5)])).unwrap();

        assert_eq!(store.sessions(&StatsScope::default(), None, None).len(), 2);
    }

    #[test]
    fn a_month_of_checkpoints_is_compacted_when_it_is_read() {
        let dir = TempDir::new();
        let store = dir.store();
        for words in 0..10 {
            store.record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &[(0, words)])).unwrap();
        }
        store.sessions(&StatsScope::default(), None, None);
        let lines = std::fs::read_to_string(store.month_path::<WritingSession>("2026-03")).unwrap().lines().count();
        assert_eq!(lines, 1);
    }

    #[test]
    fn minutes_after_midnight_land_on_the_next_day() {
        let dir = TempDir::new();
        let store = dir.store();
        // 23:30 UTC for an hour: thirty minutes on the 14th, thirty on the 15th.
        let minutes: Vec<(u32, u32)> = (0..60).map(|minute| (minute, 1)).collect();
        store.record_session(&session("s1", "Novel", "one", LATE_MARCH_14, &minutes)).unwrap();

        let days = store.daily(&StatsScope::default(), "2026-03-14", "2026-03-15");
        assert_eq!(days.len(), 2);
        assert_eq!((days[0].day.as_str(), days[0].words_added, days[0].sessions), ("2026-03-14", 30, 1));
        assert_eq!((days[1].day.as_str(), days[1].words_added, days[1].sessions), ("2026-03-15", 30, 0));
        assert_eq!(days[0].hours[23], 30 * 30);
        assert_eq!(days[1].hours[0], 30 * 30);
    }

    #[test]
    fn the_day_is_the_writers_local_day_and_crosses_a_month() {
        let dir = TempDir::new();
        let store = dir.store();
        // 2026-03-31T23:30Z is 01:30 on April 1st two hours east — an April day, filed
        // under April, and still found from March's side of the range.
        let start = 1_775_000_000_000.0 - (1_775_000_000_000.0 % 86_400_000.0) + 86_400_000.0 - 1_800_000.0;
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
        store.record_session(&session("a", "Novel", "one", LATE_MARCH_14, &[(0, 10)])).unwrap();
        store.record_session(&session("b", "Novel", "two", LATE_MARCH_14, &[(0, 20)])).unwrap();
        store.record_session(&session("c", "Essays", "one", LATE_MARCH_14, &[(0, 40)])).unwrap();

        let everything = store.totals(&StatsScope::default());
        let novel = store.totals(&StatsScope { project: Some("Novel".into()), doc_path: None });
        let chapter = store.totals(&StatsScope { project: Some("Novel".into()), doc_path: Some("one".into()) });
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
        store.record_session(&session("a", "Novel", "drafts/one", LATE_MARCH_14, &[(0, 1)])).unwrap();
        store.record_session(&session("b", "Novel", "drafts-old/two", LATE_MARCH_14, &[(0, 1)])).unwrap();
        store.record_session(&session("c", "Essays", "drafts/one", LATE_MARCH_14, &[(0, 1)])).unwrap();

        store.rename_entry("Novel", "drafts", "chapters", true).unwrap();
        store.rename_entry("Novel", "chapters/one", "chapters/prologue", false).unwrap();
        store.rename_project("Novel", "The Novel").unwrap();

        let paths: Vec<(String, String)> = store
            .sessions(&StatsScope::default(), None, None)
            .into_iter()
            .map(|session| (session.project, session.doc_path))
            .collect();
        assert!(paths.contains(&("The Novel".into(), "chapters/prologue".into())));
        assert!(paths.contains(&("The Novel".into(), "drafts-old/two".into())), "a sibling that shares a prefix is not inside the folder");
        assert!(paths.contains(&("Essays".into(), "drafts/one".into())), "another project's document of the same name stays");
    }

    #[test]
    fn a_reset_forgets_only_its_scope() {
        let dir = TempDir::new();
        let store = dir.store();
        store.record_session(&session("a", "Novel", "one", LATE_MARCH_14, &[(0, 1)])).unwrap();
        store.record_session(&session("b", "Essays", "one", LATE_MARCH_14, &[(0, 1)])).unwrap();

        store.reset(&StatsScope { project: Some("Novel".into()), doc_path: None }).unwrap();
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
        store.record_timer_run(&run("r1", Some("Novel"), 1)).unwrap();
        store.record_timer_run(&run("r1", Some("Novel"), 2)).unwrap();
        store.record_timer_run(&run("r2", Some("Essays"), 1)).unwrap();

        let novel = store.timer_runs(Some("Novel"), None, None);
        assert_eq!(novel.len(), 1);
        assert_eq!(novel[0].sprints_completed, 2);
        assert_eq!(store.timer_runs(None, Some("2026-03-14"), Some("2026-03-14")).len(), 2);
        assert!(store.timer_runs(None, Some("2026-03-15"), None).is_empty());

        store.rename_project("Novel", "The Novel").unwrap();
        assert_eq!(store.timer_runs(Some("The Novel"), None, None).len(), 1);

        // A document's reset leaves the project's runs; the project's takes them.
        store.reset(&StatsScope { project: Some("The Novel".into()), doc_path: Some("one".into()) }).unwrap();
        assert_eq!(store.timer_runs(Some("The Novel"), None, None).len(), 1);
        store.reset(&StatsScope { project: Some("The Novel".into()), doc_path: None }).unwrap();
        assert!(store.timer_runs(Some("The Novel"), None, None).is_empty());
        assert_eq!(store.timer_runs(None, None, None).len(), 1);
    }
}
