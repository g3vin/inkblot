//! The OS version and this process's resource use, for report headers.

use serde_json::{json, Value};

/// `macOS 26.1 (arm64)`, or the OS family where the version can't be read.
pub fn os_description() -> String {
    let arch = std::env::consts::ARCH;
    match product_version() {
        Some(version) => format!("macOS {version} ({arch})"),
        None => format!("{} ({arch})", std::env::consts::OS),
    }
}

#[cfg(target_os = "macos")]
fn product_version() -> Option<String> {
    let plist = std::fs::read_to_string("/System/Library/CoreServices/SystemVersion.plist").ok()?;
    let after_key = plist.split("<key>ProductVersion</key>").nth(1)?;
    let start = after_key.find("<string>")? + "<string>".len();
    let end = after_key[start..].find("</string>")? + start;
    Some(after_key[start..end].trim().to_owned())
}

#[cfg(not(target_os = "macos"))]
fn product_version() -> Option<String> {
    None
}

/// Peak resident memory and CPU time so far, from `getrusage`.
#[cfg(unix)]
pub fn process_usage() -> Value {
    // SAFETY: getrusage only writes the struct it is handed.
    let usage = unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut usage) != 0 {
            return Value::Null;
        }
        usage
    };
    let seconds = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
    // macOS reports ru_maxrss in bytes; Linux in kilobytes.
    let peak_rss_bytes = if cfg!(target_os = "macos") {
        usage.ru_maxrss as i64
    } else {
        usage.ru_maxrss as i64 * 1024
    };
    json!({
        "peakRssBytes": peak_rss_bytes,
        "userCpuSeconds": seconds(usage.ru_utime),
        "systemCpuSeconds": seconds(usage.ru_stime),
    })
}

#[cfg(not(unix))]
pub fn process_usage() -> Value {
    Value::Null
}
