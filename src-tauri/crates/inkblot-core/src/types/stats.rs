//! Writing statistics: what a sitting at a document was, and what they add up to.
//!
//! Recorded by the page's tracker (`src/stats/tracker.js`), stored by
//! [`crate::store::stats`], and read back rolled up by day. A session is kept as it
//! happened, minute by minute, so that every figure a stats view shows — a day, an
//! hour of the week, a streak — is derived from the same record and cannot disagree
//! with another.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// One minute of a session. `minute` counts from the session's start, so a session
/// that runs past midnight lands its later minutes on the next day.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsMinute {
    pub minute: u32,
    /// Seconds in this minute the document was in front of the writer.
    #[serde(default)]
    pub open_secs: u32,
    /// Seconds in this minute the writer was typing — see `WritingSession::active_secs`.
    #[serde(default)]
    pub active_secs: u32,
    #[serde(default)]
    pub words_added: u32,
    #[serde(default)]
    pub words_deleted: u32,
    #[serde(default)]
    pub words_pasted: u32,
}

/// One sitting at one document.
///
/// A session ends when the writer moves to another document or project, or has been
/// away longer than the idle cutoff. A shell records the same session repeatedly as it
/// goes — a checkpoint, so a crash loses a minute rather than an evening — and the
/// store keeps the latest record for each `id`.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSession {
    pub id: String,
    pub project: String,
    pub doc_path: String,
    /// Unix milliseconds.
    pub start: f64,
    pub end: f64,
    /// The writer's UTC offset when the session began, in minutes east of UTC. Days
    /// and hours are the writer's local ones, and the offset travels with the record
    /// rather than being looked up later, so a trip or a DST change does not move
    /// last week's words onto a different day.
    pub utc_offset_minutes: i32,
    /// Time the document was frontmost with the writer present.
    #[serde(default)]
    pub open_secs: u32,
    /// Time spent typing: the gaps between edits that were short enough to be one
    /// run of writing, as the shell's "active gap" setting decides.
    #[serde(default)]
    pub active_secs: u32,
    /// Words that appeared by typing. Pasted words are counted apart.
    #[serde(default)]
    pub words_added: u32,
    #[serde(default)]
    pub words_deleted: u32,
    #[serde(default)]
    pub words_pasted: u32,
    #[serde(default)]
    pub chars_added: u32,
    #[serde(default)]
    pub chars_deleted: u32,
    /// The document's length when the session began and when it last changed.
    #[serde(default)]
    pub start_words: u32,
    #[serde(default)]
    pub end_words: u32,
    #[serde(default)]
    pub minutes: Vec<StatsMinute>,
    /// The writing timer run this session was part of, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_run_id: Option<String>,
}

/// Which sessions a query is about. No project is everything; a project with no
/// document is the whole project.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsScope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_path: Option<String>,
}

/// One local day, summed.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    /// `YYYY-MM-DD`, the writer's local date.
    pub day: String,
    pub open_secs: u32,
    pub active_secs: u32,
    pub words_added: u32,
    pub words_deleted: u32,
    pub words_pasted: u32,
    /// Sessions that began on this day.
    pub sessions: u32,
    /// Active seconds in each of the day's 24 local hours.
    pub hours: Vec<u32>,
}

/// Everything in a scope, summed.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsTotals {
    pub sessions: u32,
    pub open_secs: u32,
    pub active_secs: u32,
    pub words_added: u32,
    pub words_deleted: u32,
    pub words_pasted: u32,
    pub longest_session_secs: u32,
    /// Local days with any words written.
    pub days_written: u32,
    /// Unix milliseconds of the first and latest session, when there are any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_session: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_session: Option<f64>,
}

/// A saved document's length, read from disk.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocWordCount {
    pub doc_path: String,
    pub words: u32,
    /// UTF-16 code units of text, as the page's `textContent.length` counts them.
    pub chars: u32,
}

/// One run of the writing timer: a routine from its start to its end, or to where the
/// writer stopped it. Recorded as it goes, like a session, and kept by `id`.
#[typeshare]
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerRun {
    pub id: String,
    pub routine_name: String,
    /// The project open when the run began.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Unix milliseconds.
    pub start: f64,
    pub end: f64,
    pub utc_offset_minutes: i32,
    /// Time in writing segments and in breaks, paused time excluded.
    #[serde(default)]
    pub write_secs: u32,
    #[serde(default)]
    pub break_secs: u32,
    #[serde(default)]
    pub words_written: u32,
    /// Writing segments that ran to their end — a sprint finished, not skipped.
    #[serde(default)]
    pub sprints_completed: u32,
    #[serde(default)]
    pub sprints_skipped: u32,
    /// The routine ran to its last segment, rather than being stopped.
    #[serde(default)]
    pub completed: bool,
}
