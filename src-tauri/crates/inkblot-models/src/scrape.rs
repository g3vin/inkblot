//! The Pinterest scrape's return channel.
//!
//! `eval_webview` throws its result away — `WebviewWindow::eval` returns
//! `Result<(), String>` — so the script injected into the Pinterest page answers by
//! calling `pinterest_report_scrape` itself, and the app receives a typed
//! `ScrapeReport`.
//!
//! ## Why a remote page can make that call
//!
//! Tauri injects `__TAURI_INTERNALS__` into the main frame of every webview it creates,
//! including one showing pinterest.com, and app commands are not ACL-gated unless the
//! app ships its own permission manifest — which this one does not
//! (`gen/schemas/acl-manifests.json` has no `__app__` key). **If a `permissions/`
//! directory is ever added to `src-tauri`, this stops working** and the command must be
//! granted to that webview explicitly. The Swift app injects `scrape-bridge.js` into
//! the Pinterest page instead, which exposes this one call and nothing else.
//!
//! ## Why it is two commands and not one
//!
//! The report arrives on the Pinterest webview's IPC and the result is wanted on the
//! app's, so they cannot be the same call. [`ScrapeChannels::begin`] registers a slot
//! **before** the script is injected — which is what makes the race impossible — and
//! [`ScrapeChannels::await_report`] waits on it. A report for an id nobody is waiting
//! for is dropped, which is the correct handling for a script left running by an
//! abandoned scrape.
//!
//! The Swift shell has the same two calls — the shim gives the Pinterest web view the
//! same `invoke` — and answers them with this same channel, through `inkblot-ffi`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use inkblot_core::pinterest::ScrapeReport;
use tokio::sync::Notify;

/// One in-flight scrape.
#[derive(Default)]
struct ScrapeSlot {
    /// The last terminal report, if one has arrived.
    report: Mutex<Option<ScrapeReport>>,
    notify: Notify,
}

#[derive(Default)]
pub struct ScrapeChannels {
    slots: Mutex<HashMap<String, Arc<ScrapeSlot>>>,
}

impl ScrapeChannels {
    fn slot(&self, request_id: &str) -> Option<Arc<ScrapeSlot>> {
        self.slots.lock().ok()?.get(request_id).cloned()
    }

    /// Open a slot for `request_id`. Must happen before the script is injected.
    pub fn begin(&self, request_id: String) {
        let mut slots = self
            .slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        slots.insert(request_id, Arc::new(ScrapeSlot::default()));
    }

    /// Take a report from the page.
    ///
    /// Progress reports are dropped rather than stored: with a push channel there is no
    /// poller for them to keep alive, and the script's own timeout is what bounds the
    /// run. They stay in the protocol because they cost nothing and a scrape that finds
    /// no pins is much easier to explain with them than without.
    pub fn report(&self, report: ScrapeReport) {
        if report.progress {
            log::debug!(
                "[pinterest] {} progress: {}",
                report.request_id,
                report.stage
            );
            return;
        }

        let Some(slot) = self.slot(&report.request_id) else {
            // Nobody is waiting: an abandoned scrape's script is still running.
            log::debug!("[pinterest] dropped a report for {}", report.request_id);
            return;
        };

        *slot
            .report
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(report);
        slot.notify.notify_waiters();
    }

    /// Wait for the scrape to report. `None` means it never did.
    ///
    /// The slot is removed on the way out either way, so a timed-out scrape does not
    /// leak one for the rest of the session.
    pub async fn await_report(
        &self,
        request_id: &str,
        timeout_ms: u64,
    ) -> Result<Option<ScrapeReport>, String> {
        let Some(slot) = self.slot(request_id) else {
            return Err(format!("No scrape is open for {request_id}"));
        };

        let waited = tokio::time::timeout(Duration::from_millis(timeout_ms.max(1)), async {
            loop {
                // Registering the waiter before checking closes the gap where a report
                // lands between the check and the wait.
                let notified = slot.notify.notified();
                if let Some(report) = slot
                    .report
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    return report;
                }
                notified.await;
            }
        })
        .await;

        if let Ok(mut slots) = self.slots.lock() {
            slots.remove(request_id);
        }

        Ok(waited.ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(request_id: &str, reason: &str, progress: bool) -> ScrapeReport {
        ScrapeReport {
            request_id: request_id.to_string(),
            url: "https://pinterest.com/board".to_string(),
            pins: vec![inkblot_core::pinterest::ScrapedPin {
                pin_href: "https://pin.it/a".to_string(),
                image_url: "https://i.pinimg.com/a.jpg".to_string(),
            }],
            reason: reason.to_string(),
            stage: String::new(),
            progress,
        }
    }

    #[tokio::test]
    async fn a_report_that_arrives_before_the_wait_is_not_lost() {
        let channels = ScrapeChannels::default();
        channels.begin("r1".into());
        // The page can answer faster than the caller gets round to waiting.
        channels.report(report("r1", "session_api", false));

        let waited = channels.await_report("r1", 50).await.unwrap().unwrap();
        assert_eq!(waited.reason, "session_api");
        assert_eq!(waited.pins.len(), 1);
    }

    #[tokio::test]
    async fn a_report_that_arrives_during_the_wait_wakes_it() {
        let channels = Arc::new(ScrapeChannels::default());
        channels.begin("r2".into());

        let writer = Arc::clone(&channels);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            writer.report(report("r2", "stable", false));
        });

        let waited = channels.await_report("r2", 2000).await.unwrap();
        assert_eq!(waited.unwrap().reason, "stable");
    }

    #[tokio::test]
    async fn progress_never_ends_the_wait() {
        let channels = Arc::new(ScrapeChannels::default());
        channels.begin("r3".into());

        let writer = Arc::clone(&channels);
        tokio::spawn(async move {
            for stage in ["script-start", "session-api-start", "dom-fallback-start"] {
                tokio::time::sleep(Duration::from_millis(5)).await;
                let mut progress = report("r3", "progress", true);
                progress.stage = stage.to_string();
                writer.report(progress);
            }
        });

        // Only the progress reports arrive, so this has to run out rather than return
        // one of them as the answer.
        assert!(channels.await_report("r3", 60).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_scrape_that_never_reports_times_out_and_frees_its_slot() {
        let channels = ScrapeChannels::default();
        channels.begin("r4".into());
        assert!(channels.await_report("r4", 20).await.unwrap().is_none());

        // The slot is gone, so a second wait is an error rather than another 20ms.
        assert!(channels.await_report("r4", 20).await.is_err());
    }

    #[tokio::test]
    async fn a_report_nobody_opened_a_slot_for_is_dropped() {
        let channels = ScrapeChannels::default();
        // An abandoned scrape's script is still running somewhere; it must not panic
        // or resurrect a slot.
        channels.report(report("gone", "stable", false));
        assert!(channels.await_report("gone", 20).await.is_err());
    }
}
