//! Timestamps and ids, spelled the way the JS spells them.
//!
//! Version entries are compared, sorted and grouped by their `timestamp` string, and
//! entries written by the webview and by native code land in the same list — so the
//! format has to be `new Date().toISOString()` exactly: `YYYY-MM-DDTHH:MM:SS.sssZ`,
//! UTC, three decimal places, always.

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, as `Date.now()` reports them.
pub fn now_millis() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_millis() as i64,
        // A clock set before 1970 counts backwards rather than panicking.
        Err(error) => -(error.duration().as_millis() as i64),
    }
}

/// `new Date().toISOString()`.
pub fn now_iso8601() -> String {
    iso8601_from_millis(now_millis())
}

/// The civil date for a Unix millisecond count, formatted as ISO-8601 UTC.
///
/// Howard Hinnant's `civil_from_days`, which is exact for the whole proleptic
/// Gregorian range and needs no calendar library.
pub fn iso8601_from_millis(millis: i64) -> String {
    let (days, millis_of_day) = (millis.div_euclid(86_400_000), millis.rem_euclid(86_400_000));

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = if month <= 2 { year + 1 } else { year };

    let (hour, minute, second, milli) = (
        millis_of_day / 3_600_000,
        (millis_of_day / 60_000) % 60,
        (millis_of_day / 1000) % 60,
        millis_of_day % 1000,
    );

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` — a sortable prefix and
/// six characters of tie-break.
///
/// The tie-break comes from the nanosecond remainder rather than a PRNG: the core has
/// no random source and does not want a dependency for one, and two entries written in
/// the same millisecond are exactly the case the nanoseconds distinguish.
pub fn new_version_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.subsec_nanos() as u64)
        .unwrap_or(0);

    let mut suffix = String::new();
    let mut remaining = nanos;
    for _ in 0..6 {
        let digit = (remaining % 36) as u32;
        suffix.push(char::from_digit(digit, 36).unwrap_or('0'));
        remaining /= 36;
    }

    format!("{}-{suffix}", now_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_what_to_iso_string_produces() {
        assert_eq!(iso8601_from_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601_from_millis(1), "1970-01-01T00:00:00.001Z");
        // Node: new Date(1772668800000).toISOString()
        assert_eq!(
            iso8601_from_millis(1_772_668_800_000),
            "2026-03-05T00:00:00.000Z"
        );
        // A leap day, and the last millisecond of a year.
        assert_eq!(
            iso8601_from_millis(1_709_164_800_000),
            "2024-02-29T00:00:00.000Z"
        );
        assert_eq!(
            iso8601_from_millis(1_767_225_599_999),
            "2025-12-31T23:59:59.999Z"
        );
        // Before the epoch, where truncating division would give the wrong day.
        assert_eq!(iso8601_from_millis(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn a_version_id_sorts_by_its_millisecond_prefix() {
        let id = new_version_id();
        let (millis, suffix) = id.split_once('-').expect("id has a suffix");
        assert!(millis.parse::<i64>().unwrap() > 1_700_000_000_000);
        assert_eq!(suffix.len(), 6);
    }
}
