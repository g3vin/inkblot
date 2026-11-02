//! Bug reports and crash reports, kept on this device.
//!
//! Everything lives in one folder the shell chooses (`~/Library/Logs/Inkblot` on
//! macOS), apart from app data and projects, so it can be read and shared without
//! going near anyone's writing:
//!
//! ```text
//! reports/<time>-bug.json      a report the writer asked for
//! crashes/<time>-<kind>.json   a panic, a page crash, an unclean exit
//! session.json                 present while the app runs; the last breadcrumbs
//! last-launch                  when the app last started, to find new crash files
//! inkblot.log                  the Rust log (see `logger`)
//! ```
//!
//! The page builds bug reports and page crash reports itself and only hands the JSON
//! here to write. Nothing here reads a document: the report's privacy rules (an
//! allowlist and a leak guard) are in `src/lib/diagnostics/`.

mod logger;
mod panic;
mod process;
mod session;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use once_cell::sync::OnceCell;
use serde_json::{json, Value};

use crate::store::clock::{iso8601_from_millis, now_millis};

pub use logger::log_tail;
pub use process::{os_description, process_usage};

/// The report schema version; the page writes the same number.
pub const SCHEMA: u32 = 1;

/// Each folder keeps this many files, newest first.
const KEEP_FILES: usize = 100;
/// Files older than this are pruned at startup.
const MAX_AGE_MILLIS: i64 = 60 * 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Folder {
    Reports,
    Crashes,
}

impl Folder {
    fn name(self) -> &'static str {
        match self {
            Folder::Reports => "reports",
            Folder::Crashes => "crashes",
        }
    }

    /// A bug report is the writer's; everything else is a crash.
    pub fn for_kind(kind: &str) -> Self {
        if kind == "bug" {
            Folder::Reports
        } else {
            Folder::Crashes
        }
    }
}

/// What the app knows about itself, stamped on reports written from Rust.
#[derive(Clone, Debug)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub debug_build: bool,
}

/// The folder and the state a crash needs at hand, set up once per process.
pub struct Diagnostics {
    root: PathBuf,
    app: AppInfo,
    /// The page's latest breadcrumbs, so a panic or an unclean exit can say what the
    /// writer was doing.
    breadcrumbs: Mutex<Value>,
    page_started: AtomicBool,
    /// Whether unclean exits and page reloads are reported (`init`).
    track_sessions: AtomicBool,
    /// Crash files from the previous run, for the page to mention once.
    notices: Mutex<Vec<PathBuf>>,
}

static DIAGNOSTICS: OnceCell<Diagnostics> = OnceCell::new();

/// The process's diagnostics, once `init` has run.
pub fn get() -> Option<&'static Diagnostics> {
    DIAGNOSTICS.get()
}

/// Set up the folder, the logger and the panic hook, and look at how the last run
/// ended. Call it as early as possible: a panic before this is not recorded.
///
/// `track_sessions` is off in debug builds, where stopping the dev server kills the
/// app every time and every launch would report an unclean exit.
pub fn init(root: PathBuf, app: AppInfo, track_sessions: bool) -> &'static Diagnostics {
    DIAGNOSTICS.get_or_init(|| {
        let _ = fs::create_dir_all(&root);
        logger::install(&root);
        let diagnostics = Diagnostics {
            root,
            app,
            breadcrumbs: Mutex::new(Value::Array(Vec::new())),
            page_started: AtomicBool::new(false),
            track_sessions: AtomicBool::new(track_sessions),
            notices: Mutex::new(Vec::new()),
        };
        diagnostics.start();
        diagnostics
    });
    panic::install();
    DIAGNOSTICS.get().expect("initialised above")
}

impl Diagnostics {
    /// Build without installing anything process-wide, for tests.
    #[cfg(test)]
    fn detached(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(&root);
        Diagnostics {
            root,
            app: AppInfo {
                version: "0.0.0".into(),
                os: "test".into(),
                debug_build: true,
            },
            breadcrumbs: Mutex::new(Value::Array(Vec::new())),
            page_started: AtomicBool::new(false),
            track_sessions: AtomicBool::new(true),
            notices: Mutex::new(Vec::new()),
        }
    }

    fn start(&self) {
        let last_launch = self.swap_last_launch();
        if self.track_sessions.load(Ordering::SeqCst) {
            if let Some(report) = session::check_previous(&self.root, &self.app) {
                let _ = self.write_report("unclean-exit", &report);
            }
            session::start(&self.root, &self.app);
        }
        for folder in [Folder::Reports, Folder::Crashes] {
            prune(&self.dir(folder), KEEP_FILES, now_millis() - MAX_AGE_MILLIS);
        }
        let new_crashes = files_newest_first(&self.dir(Folder::Crashes))
            .into_iter()
            .filter(|(_, modified)| last_launch.is_some_and(|launch| *modified >= launch))
            .map(|(path, _)| path)
            .collect();
        *self.notices.lock().unwrap_or_else(PoisonError::into_inner) = new_crashes;
    }

    /// Record this launch and return the one before it.
    fn swap_last_launch(&self) -> Option<i64> {
        let path = self.root.join("last-launch");
        let previous = fs::read_to_string(&path)
            .ok()
            .and_then(|text| text.trim().parse().ok());
        let _ = fs::write(&path, now_millis().to_string());
        previous
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn dir(&self, folder: Folder) -> PathBuf {
        self.root.join(folder.name())
    }

    /// Write one report atomically and return its path. A half-written file would be
    /// worse than none: it is what a crash during the write leaves behind.
    pub fn write_report(&self, kind: &str, report: &Value) -> std::io::Result<PathBuf> {
        let dir = self.dir(Folder::for_kind(kind));
        fs::create_dir_all(&dir)?;
        let path = unique_path(&dir, &file_stem(now_millis(), kind));
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(report).map_err(std::io::Error::other)?;
        fs::write(&tmp, text)?;
        fs::rename(&tmp, &path)?;
        Ok(path)
    }

    /// The page's latest breadcrumbs; also kept in the session file for an unclean exit.
    pub fn heartbeat(&self, breadcrumbs: Value) {
        session::heartbeat(&self.root, &breadcrumbs);
        *self
            .breadcrumbs
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = breadcrumbs;
    }

    /// The page has loaded. If it had already loaded in this process, unasked, its web
    /// content process died and the page started again: write a `page-reload` report
    /// with the breadcrumbs from before, which the new page no longer has.
    pub fn page_started(&self) -> Option<PathBuf> {
        let reloaded = self.page_started.swap(true, Ordering::SeqCst);
        if !reloaded || !self.track_sessions.load(Ordering::SeqCst) {
            return None;
        }
        let mut report = self.header("page-reload");
        report["breadcrumbs"] = self
            .breadcrumbs
            .lock()
            .map(|b| b.clone())
            .unwrap_or_default();
        report["rustLog"] = json!(log_tail());
        let path = self.write_report("page-reload", &report).ok()?;
        self.notices
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(path.clone());
        Some(path)
    }

    /// The page is about to reload on purpose (the crash screen's Reload): the next
    /// start is not a crash.
    pub fn expect_reload(&self) {
        self.page_started.store(false, Ordering::SeqCst);
    }

    /// Crash files from the previous run, once.
    pub fn take_notices(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.notices.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub fn counts(&self) -> Value {
        json!({
            "dir": self.root,
            "reports": files_newest_first(&self.dir(Folder::Reports)).len(),
            "crashes": files_newest_first(&self.dir(Folder::Crashes)).len(),
        })
    }

    /// Delete every report and crash report. The log and the session file stay.
    pub fn delete_all(&self) -> std::io::Result<()> {
        for folder in [Folder::Reports, Folder::Crashes] {
            for (path, _) in files_newest_first(&self.dir(folder)) {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    /// Mark a clean exit, so the next launch reports nothing.
    pub fn clean_exit(&self) {
        session::clear(&self.root);
    }

    /// The header every report written from Rust starts with.
    fn header(&self, kind: &str) -> Value {
        json!({
            "schema": SCHEMA,
            "kind": kind,
            "createdAt": iso8601_from_millis(now_millis()),
            "app": {
                "version": self.app.version,
                "os": self.app.os,
                "debugBuild": self.app.debug_build,
            },
        })
    }
}

/// `2026-11-02T14-03-12-345Z-bug`: sortable, and legal in every file system.
fn file_stem(millis: i64, kind: &str) -> String {
    let stamp = iso8601_from_millis(millis).replace([':', '.'], "-");
    let kind: String = kind
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    format!("{stamp}-{kind}")
}

fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.json"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.json"));
        n += 1;
    }
    path
}

/// The `.json` files in `dir` with their modified time in Unix milliseconds.
fn files_newest_first(dir: &Path) -> Vec<(PathBuf, i64)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(PathBuf, i64)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .map(|path| {
            let modified = fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_millis() as i64);
            (path, modified)
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    files
}

/// Keep the newest `keep` files modified at or after `oldest`.
fn prune(dir: &Path, keep: usize, oldest: i64) {
    for (index, (path, modified)) in files_newest_first(dir).into_iter().enumerate() {
        if index >= keep || modified < oldest {
            let _ = fs::remove_file(path);
        }
    }
}
