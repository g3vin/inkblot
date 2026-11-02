//! The Rust log: the last lines in memory for reports, and `inkblot.log` on disk.
//!
//! Only Inkblot's own crates and Tauri are recorded, at `info` and above: other
//! crates' debug output is noise in a report and could quote what they were handed.
//! Nothing may log a writer's words; CONTRIBUTING.md → Logging.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use log::{Level, LevelFilter, Log, Metadata, Record};
use once_cell::sync::OnceCell;

use crate::store::clock::{iso8601_from_millis, now_millis};

const TAIL_LINES: usize = 500;
const ROTATE_BYTES: u64 = 1024 * 1024;

struct Logger {
    tail: Mutex<VecDeque<String>>,
    file: Mutex<Option<(File, PathBuf)>>,
}

static LOGGER: OnceCell<Logger> = OnceCell::new();

pub(super) fn install(root: &Path) {
    let path = root.join("inkblot.log");
    let logger = LOGGER.get_or_init(|| Logger {
        tail: Mutex::new(VecDeque::with_capacity(TAIL_LINES)),
        file: Mutex::new(open(&path).map(|file| (file, path.clone()))),
    });
    // Fails only when another logger is already installed, which then keeps the records.
    if log::set_logger(logger).is_ok() {
        log::set_max_level(LevelFilter::Info);
    }
}

/// The last lines logged in this process, oldest first.
pub fn log_tail() -> Vec<String> {
    LOGGER
        .get()
        .and_then(|logger| logger.tail.try_lock().ok())
        .map(|tail| tail.iter().cloned().collect())
        .unwrap_or_default()
}

pub(super) fn accepts(target: &str, level: Level) -> bool {
    level <= Level::Info && (target.starts_with("inkblot") || target.starts_with("tauri"))
}

fn open(path: &Path) -> Option<File> {
    OpenOptions::new().create(true).append(true).open(path).ok()
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        accepts(metadata.target(), metadata.level())
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} {:<5} {}: {}",
            iso8601_from_millis(now_millis()),
            record.level(),
            record.target(),
            record.args()
        );
        if let Ok(mut tail) = self.tail.lock() {
            if tail.len() == TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.clone());
        }
        if let Ok(mut slot) = self.file.lock() {
            if let Some((file, path)) = slot.as_mut() {
                let _ = writeln!(file, "{line}");
                if file.metadata().is_ok_and(|meta| meta.len() > ROTATE_BYTES) {
                    let path = path.clone();
                    let _ = fs::rename(&path, path.with_extension("log.1"));
                    *slot = open(&path).map(|file| (file, path));
                }
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut slot) = self.file.lock() {
            if let Some((file, _)) = slot.as_mut() {
                let _ = file.flush();
            }
        }
    }
}
