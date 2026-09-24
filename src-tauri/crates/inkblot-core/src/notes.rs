//! The note data model, and the voice memos attached to notes.
//!
//! Everything entering app state passes through [`normalize_note`], so downstream code
//! can rely on the shape. It is safe to call on untrusted or legacy data: every field
//! is coerced or defaulted, and nothing fails.
//!
//! Mirrors `src/lib/noteUtils.js` and the pure half of `src/lib/audioNotes.js`;
//! `npm run parity` asserts the two agree.
//!
//! **Two things the shell supplies**, because neither is ours to decide:
//!
//! - **New ids and the current time.** Passed in through [`NoteDefaults`], so the same
//!   input normalizes to the same output and the parity harness has something to
//!   compare.
//! - **The `timestamp` display string.** `normalizeNote` fills it with
//!   `Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })`, which is
//!   locale-dependent by definition. It is derived and display-only — nothing may read
//!   it back as data — so the formatter is a closure the shell provides.

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;

use crate::types::{
    AudioClip, JsonMap, Note, NoteImage, NotePreviewLayout, NotePreviewSize, NoteType,
    DEFAULT_NOTE_COLOR,
};

/// `#rgb` or `#rrggbb`, case-insensitive. Anything else falls back to the default.
static HEX_COLOR: Lazy<Regex> =
    Lazy::new(|| Regex::new("(?i)^#([0-9a-f]{3}|[0-9a-f]{6})$").unwrap());

/// What the shell has to supply for a normalize that would otherwise reach for a clock
/// or a random number.
pub struct NoteDefaults<'a> {
    /// `crypto.randomUUID()`.
    pub new_id: &'a dyn Fn() -> String,
    /// `new Date().toISOString()`.
    pub now_iso: &'a dyn Fn() -> String,
    /// `formatNoteTimestamp` — locale-dependent, so the shell owns it.
    pub format_time: &'a dyn Fn(&str) -> String,
}

/// JavaScript truthiness. `Boolean(x)` is false only for `false`, `0`, `""`, `null`
/// and `undefined` — so `pinned: "yes"` and `collapsedChildren: 1` are both true, and
/// `as_bool()` alone would silently read them as false.
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        // An array or an object is always truthy, empty or not.
        _ => true,
    }
}

fn string_field(raw: &Value, key: &str) -> Option<String> {
    raw.get(key)?.as_str().map(str::to_string)
}

/// A date string that parses, normalized to ISO-8601; otherwise the fallback.
///
/// The JS round-trips through `new Date(...)`, which accepts far more than ISO — but
/// every value the app itself writes is already ISO, and re-emitting one unchanged is
/// what that round-trip does. A string that does not parse as ISO is treated as
/// unparseable here, where JS might have salvaged it; see the module docs on
/// `store::clock` for the format both sides write.
fn normalize_date(raw: &Value, key: &str, fallback: &str) -> String {
    match raw.get(key).and_then(Value::as_str) {
        Some(text) if is_iso8601(text) => text.to_string(),
        _ => fallback.to_string(),
    }
}

/// `YYYY-MM-DDTHH:MM:SS.sssZ`, which is what `toISOString` emits and what the store
/// writes.
fn is_iso8601(text: &str) -> bool {
    static ISO: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$").unwrap()
    });
    ISO.is_match(text)
}

fn normalize_color(raw: &Value) -> String {
    match raw.get("color").and_then(Value::as_str) {
        Some(text) if HEX_COLOR.is_match(text.trim()) => text.trim().to_string(),
        _ => DEFAULT_NOTE_COLOR.to_string(),
    }
}

/// A ProseMirror position, or null. `Number.isFinite`, so a numeric string is not one.
fn normalize_range_value(raw: &Value, key: &str) -> Option<f64> {
    raw.get(key)?.as_f64().filter(|value| value.is_finite())
}

/// A non-empty trimmed string, or null.
fn normalize_optional_id(raw: &Value, key: &str) -> Option<String> {
    let text = raw.get(key)?.as_str()?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn normalize_preview_layout(raw: &Value) -> NotePreviewLayout {
    let value = &raw["previewLayout"];
    NotePreviewLayout {
        offset_x: value["offsetX"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0),
        offset_y: value["offsetY"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0),
    }
}

/// Floors of 220x64: a preview smaller than that cannot show a quote and a body.
fn normalize_preview_size(raw: &Value) -> NotePreviewSize {
    let value = &raw["previewSize"];
    if !value.is_object() {
        return NotePreviewSize::default();
    }
    NotePreviewSize {
        width: value["width"].as_f64().filter(|n| n.is_finite()).map_or(260.0, |n| n.max(220.0)),
        height: value["height"].as_f64().filter(|n| n.is_finite()).map_or(88.0, |n| n.max(64.0)),
    }
}

/// An attached image, or `None` when it has no source to show.
pub fn normalize_note_image(raw: &Value, new_id: &dyn Fn() -> String) -> Option<NoteImage> {
    let src = raw.get("src")?.as_str()?;
    if src.trim().is_empty() {
        return None;
    }
    Some(NoteImage {
        id: string_field(raw, "id").filter(|id| !id.trim().is_empty()).unwrap_or_else(new_id),
        src: src.to_string(),
        mime_type: string_field(raw, "mimeType").unwrap_or_else(|| "image/png".to_string()),
    })
}

/// A voice memo, or `None` when it has no asset to play.
pub fn normalize_audio_clip(
    raw: &Value,
    new_id: &dyn Fn() -> String,
    now_iso: &dyn Fn() -> String,
) -> Option<AudioClip> {
    let src = raw.get("src")?.as_str()?;
    if src.trim().is_empty() {
        return None;
    }
    Some(AudioClip {
        id: string_field(raw, "id").filter(|id| !id.trim().is_empty()).unwrap_or_else(new_id),
        src: src.to_string(),
        mime_type: string_field(raw, "mimeType").unwrap_or_else(|| "audio/webm".to_string()),
        duration_ms: raw["durationMs"]
            .as_f64()
            .filter(|n| n.is_finite())
            .map_or(0.0, |n| n.max(0.0)),
        created_at: string_field(raw, "createdAt").unwrap_or_else(now_iso),
    })
}

pub fn normalize_note_audio(
    raw: &Value,
    new_id: &dyn Fn() -> String,
    now_iso: &dyn Fn() -> String,
) -> Vec<AudioClip> {
    raw.as_array()
        .map(|clips| {
            clips.iter().filter_map(|clip| normalize_audio_clip(clip, new_id, now_iso)).collect()
        })
        .unwrap_or_default()
}

/// Every key we did not consume into a modeled field.
///
/// **Unknown keys are preserved**, because `normalizeNote` spreads the original note
/// before overriding the fields it owns — so a key written by a newer build survives a
/// round-trip through an older one.
const MODELED_KEYS: [&str; 17] = [
    "id", "type", "content", "anchor", "from", "to", "color", "pinned", "parentNoteId",
    "collapsedChildren", "previewLayout", "previewSize", "images", "audio", "createdAt",
    "updatedAt", "timestamp",
];

/// Fill in defaults and coerce every field. Safe on untrusted or legacy data.
pub fn normalize_note(raw: &Value, defaults: &NoteDefaults) -> Note {
    let fallback_date = (defaults.now_iso)();
    let updated_fallback = normalize_date(raw, "updatedAt", &fallback_date);
    let created_at = normalize_date(raw, "createdAt", &updated_fallback);
    let updated_at = normalize_date(raw, "updatedAt", &created_at);

    let extra: JsonMap = raw
        .as_object()
        .map(|fields| {
            fields
                .iter()
                .filter(|(key, _)| !MODELED_KEYS.contains(&key.as_str()))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();

    Note {
        id: string_field(raw, "id").filter(|id| !id.is_empty()).unwrap_or_else(defaults.new_id),
        note_type: if raw["type"] == "quote" { NoteType::Quote } else { NoteType::Free },
        content: string_field(raw, "content").unwrap_or_default(),
        anchor: string_field(raw, "anchor").unwrap_or_default(),
        from: normalize_range_value(raw, "from"),
        to: normalize_range_value(raw, "to"),
        color: normalize_color(raw),
        pinned: js_truthy(&raw["pinned"]),
        parent_note_id: normalize_optional_id(raw, "parentNoteId"),
        collapsed_children: js_truthy(&raw["collapsedChildren"]),
        preview_layout: normalize_preview_layout(raw),
        preview_size: normalize_preview_size(raw),
        images: raw["images"]
            .as_array()
            .map(|images| {
                images.iter().filter_map(|image| normalize_note_image(image, defaults.new_id)).collect()
            })
            .unwrap_or_default(),
        audio: normalize_note_audio(&raw["audio"], defaults.new_id, defaults.now_iso),
        timestamp: (defaults.format_time)(&updated_at),
        created_at,
        updated_at,
        extra,
    }
}

pub fn normalize_notes(raw: &Value, defaults: &NoteDefaults) -> Vec<Note> {
    raw.as_array()
        .map(|notes| notes.iter().map(|note| normalize_note(note, defaults)).collect())
        .unwrap_or_default()
}

/// `92000` -> `1:32`. Always m:ss, so a list of clips lines up.
///
/// `Number(ms) || 0` in the JS, so a NaN duration reads as `0:00` rather than `NaN:NaN`
/// — but an INFINITE one does not, and comes out as `Infinity:NaN`, because `Infinity`
/// is truthy and `Infinity % 60` is NaN. Reproduced rather than tidied: a normalized
/// clip's duration is always finite (see [`normalize_audio_clip`]), so the only way to
/// reach it is to call this directly with a broken value, and a shell that rendered
/// `0:00` where the webview renders `Infinity:NaN` would be the more confusing pair.
pub fn format_duration(millis: f64) -> String {
    let millis = if millis.is_nan() { 0.0 } else { millis };
    let total = (js_round(millis) / 1000.0).max(0.0);
    if total.is_infinite() {
        return "Infinity:NaN".to_string();
    }
    let minutes = (total / 60.0).floor() as i64;
    let seconds = (total % 60.0).floor() as i64;
    format!("{minutes}:{seconds:02}")
}

/// `Math.round`, which breaks ties toward +Infinity. Rust's breaks them away from
/// zero, so the two disagree on -0.5 and every negative half after it.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// A note's id plus every descendant's, following `parent_note_id`.
///
/// Walked with a stack rather than recursion, and guarded against a note listed as its
/// own ancestor — a cycle in this data would otherwise hang the panel.
pub fn collect_note_branch_ids(notes: &[Note], root_id: &str) -> Vec<String> {
    if root_id.is_empty() {
        return Vec::new();
    }

    let mut children_by_parent: std::collections::HashMap<&str, Vec<&str>> = Default::default();
    for note in notes {
        if let Some(parent) = note.parent_note_id.as_deref() {
            children_by_parent.entry(parent).or_default().push(&note.id);
        }
    }

    let mut ids: Vec<String> = Vec::new();
    let mut stack = vec![root_id];

    while let Some(next_id) = stack.pop() {
        if next_id.is_empty() || ids.iter().any(|seen| seen == next_id) {
            continue;
        }
        ids.push(next_id.to_string());
        for child in children_by_parent.get(next_id).into_iter().flatten() {
            stack.push(child);
        }
    }

    ids
}

/// Sort order for the notes panel: pinned first, then anchored notes by position, then
/// free notes by recency.
pub fn compare_notes(a: &Note, b: &Note) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    if a.pinned != b.pinned {
        return if a.pinned { Ordering::Less } else { Ordering::Greater };
    }

    let a_is_free = a.note_type == NoteType::Free;
    let b_is_free = b.note_type == NoteType::Free;
    if a_is_free != b_is_free {
        return if a_is_free { Ordering::Greater } else { Ordering::Less };
    }

    if !a_is_free && !b_is_free {
        // An unresolved anchor sorts last rather than first.
        const UNRESOLVED: f64 = 9_007_199_254_740_991.0;
        let a_from = a.from.filter(|n| n.is_finite()).unwrap_or(UNRESOLVED);
        let b_from = b.from.filter(|n| n.is_finite()).unwrap_or(UNRESOLVED);
        if a_from != b_from {
            return a_from.partial_cmp(&b_from).unwrap_or(Ordering::Equal);
        }
    }

    // Newest first.
    b.updated_at.cmp(&a.updated_at)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn defaults<'a>() -> NoteDefaults<'a> {
        NoteDefaults {
            new_id: &|| "generated".to_string(),
            now_iso: &|| "2026-01-01T00:00:00.000Z".to_string(),
            format_time: &|_| "12:00 AM".to_string(),
        }
    }

    #[test]
    fn a_note_from_nothing_is_still_a_valid_note() {
        let note = normalize_note(&json!({}), &defaults());
        assert_eq!(note.id, "generated");
        assert_eq!(note.note_type, NoteType::Free);
        assert_eq!(note.color, DEFAULT_NOTE_COLOR);
        assert_eq!(note.preview_size, NotePreviewSize::default());
        assert!(note.images.is_empty() && note.audio.is_empty());
    }

    #[test]
    fn a_note_that_is_not_an_object_is_still_a_note() {
        // JS throws here. `normalizeNote(note = {})` defaults on `undefined` and not on
        // `null`, so a document whose `notes` array holds a null crashes on load,
        // despite the function being documented as safe for untrusted data. Nothing is
        // gained by reproducing that, so this returns the same note `{}` would.
        for raw in [json!(null), json!("not a note"), json!(7), json!([])] {
            let note = normalize_note(&raw, &defaults());
            assert_eq!(note.id, "generated");
            assert_eq!(note.note_type, NoteType::Free);
        }
    }

    #[test]
    fn unknown_keys_survive() {
        let note = normalize_note(&json!({ "id": "n1", "futureField": [1, 2] }), &defaults());
        assert_eq!(note.extra["futureField"], json!([1, 2]));
    }

    #[test]
    fn javascript_truthiness_decides_the_flags() {
        let note = normalize_note(&json!({ "pinned": "yes", "collapsedChildren": 1 }), &defaults());
        assert!(note.pinned && note.collapsed_children);
        let note = normalize_note(&json!({ "pinned": "", "collapsedChildren": 0 }), &defaults());
        assert!(!note.pinned && !note.collapsed_children);
    }

    #[test]
    fn a_preview_cannot_be_smaller_than_it_can_show() {
        let note =
            normalize_note(&json!({ "previewSize": { "width": 10, "height": 10 } }), &defaults());
        assert_eq!(note.preview_size, NotePreviewSize { width: 220.0, height: 64.0 });
    }

    #[test]
    fn an_image_or_clip_with_no_source_is_dropped() {
        let note = normalize_note(
            &json!({
                "images": [{ "src": "data:image/png;base64,AAA" }, { "src": "  " }, {}, 7],
                "audio": [{ "src": ".assets/a.webm", "durationMs": -5 }, { "mimeType": "audio/mp4" }],
            }),
            &defaults(),
        );
        assert_eq!(note.images.len(), 1);
        assert_eq!(note.audio.len(), 1);
        assert_eq!(note.audio[0].duration_ms, 0.0);
    }

    #[test]
    fn a_cycle_in_the_note_tree_terminates() {
        let make = |id: &str, parent: &str| {
            let mut note = normalize_note(&json!({ "id": id }), &defaults());
            note.parent_note_id = Some(parent.to_string());
            note
        };
        let notes = vec![make("a", "b"), make("b", "a")];
        assert_eq!(collect_note_branch_ids(&notes, "a").len(), 2);
    }

    #[test]
    fn durations_are_always_m_ss() {
        assert_eq!(format_duration(92_000.0), "1:32");
        assert_eq!(format_duration(0.0), "0:00");
        assert_eq!(format_duration(-1.0), "0:00");
        assert_eq!(format_duration(9_000.0), "0:09");
        assert_eq!(format_duration(3_600_000.0), "60:00");
        assert_eq!(format_duration(f64::NAN), "0:00");
        assert_eq!(format_duration(f64::INFINITY), "Infinity:NaN");
    }
}
