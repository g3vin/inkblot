//! The panic hook: a crash report is written before the default hook runs.
//!
//! It runs on the panicking thread with the app in an unknown state, so it only
//! `try_lock`s: a panic while a diagnostics lock is held still gets a report, just
//! without that part.

use std::backtrace::Backtrace;
use std::panic;
use std::sync::Once;

use serde_json::{json, Value};

use super::logger::log_tail;

pub(super) fn install() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if let Some(diagnostics) = super::get() {
                let payload = info.payload();
                let message = payload
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "<non-string panic payload>".to_owned());
                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
                let report = report(diagnostics, &message, location.as_deref());
                let _ = diagnostics.write_report("panic", &report);
            }
            previous(info);
        }));
    });
}

pub(super) fn report(
    diagnostics: &super::Diagnostics,
    message: &str,
    location: Option<&str>,
) -> Value {
    let breadcrumbs = diagnostics
        .breadcrumbs
        .try_lock()
        .map(|crumbs| crumbs.clone())
        .unwrap_or(Value::Null);

    let mut report = diagnostics.header("panic");
    report["panic"] = json!({
        "message": message,
        "location": location,
        "thread": std::thread::current().name().unwrap_or("<unnamed>"),
        "backtrace": Backtrace::force_capture().to_string(),
    });
    report["breadcrumbs"] = breadcrumbs;
    report["rustLog"] = json!(log_tail());
    report
}
