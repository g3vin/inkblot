//! `session.json`: written at launch, removed on a clean exit.
//!
//! Still there at the next launch means the app was killed, aborted or force-quit
//! while hung. It carries the page's last breadcrumbs, refreshed by each heartbeat,
//! so the report can say what the writer was doing.

use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use super::{AppInfo, SCHEMA};
use crate::store::clock::{iso8601_from_millis, now_millis};

const FILE: &str = "session.json";

pub(super) fn start(root: &Path, app: &AppInfo) {
    let session = json!({
        "pid": std::process::id(),
        "startedAt": iso8601_from_millis(now_millis()),
        "version": app.version,
        "heartbeatAt": Value::Null,
        "breadcrumbs": [],
    });
    write(root, &session);
}

pub(super) fn heartbeat(root: &Path, breadcrumbs: &Value) {
    let Some(mut session) = read(root) else {
        return;
    };
    session["heartbeatAt"] = json!(iso8601_from_millis(now_millis()));
    session["breadcrumbs"] = breadcrumbs.clone();
    write(root, &session);
}

pub(super) fn clear(root: &Path) {
    let _ = fs::remove_file(root.join(FILE));
}

/// The unclean-exit report for a session that never cleared, if there was one.
pub(super) fn check_previous(root: &Path, app: &AppInfo) -> Option<Value> {
    let previous = read(root)?;
    clear(root);
    Some(json!({
        "schema": SCHEMA,
        "kind": "unclean-exit",
        "createdAt": iso8601_from_millis(now_millis()),
        "app": {
            "version": app.version,
            "os": app.os,
            "debugBuild": app.debug_build,
        },
        "previousSession": {
            "pid": previous["pid"],
            "version": previous["version"],
            "startedAt": previous["startedAt"],
            "heartbeatAt": previous["heartbeatAt"],
        },
        "breadcrumbs": previous["breadcrumbs"],
    }))
}

fn read(root: &Path) -> Option<Value> {
    let text = fs::read_to_string(root.join(FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write(root: &Path, session: &Value) {
    let path = root.join(FILE);
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, session.to_string()).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}
