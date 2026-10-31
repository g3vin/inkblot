use super::*;

fn words(text: &str) -> Vec<String> {
    text_words(text)
}

fn text_version(id: &str, html: &str, session: &str) -> VersionEntry {
    VersionEntry {
        id: id.into(),
        timestamp: "2026-09-22T12:00:00.000Z".into(),
        kind: crate::types::VersionKind::Text,
        name: None,
        auto: true,
        session_id: Some(session.into()),
        words: None,
        content_html: Some(html.into()),
        content_json: None,
        canvas: None,
        map: None,
    }
}

#[test]
fn a_row_describes_the_change_from_the_entry_before_it() {
    // Newest first, as stored.
    let versions = vec![
        text_version("v3", "<p>she hesitated at the red door</p>", "s2"),
        text_version("v2", "<p>she hesitated at the door</p>", "s1"),
        text_version("v1", "<p>she stood</p>", "s1"),
    ];
    let rows = version_rows(&versions);
    assert_eq!(
        rows[0].delta,
        WordDelta {
            added: 1,
            removed: 0
        }
    );
    assert_eq!(
        rows[0]
            .snippet
            .iter()
            .map(|op| (op.op_type, op.tokens.join(" ")))
            .collect::<Vec<_>>(),
        vec![
            (DiffOpType::Equal, "hesitated at the".to_string()),
            (DiffOpType::Added, "red".to_string()),
            (DiffOpType::Equal, "door".to_string()),
        ]
    );
    // The oldest has nothing before it, so all of it is new.
    assert_eq!(
        rows[2].delta,
        WordDelta {
            added: 2,
            removed: 0
        }
    );
    assert_eq!(rows[0].session_color, session_color("s2"));
    assert!(rows[0].summary.is_none());
}

fn map_version(id: &str, map: crate::types::JsonValue) -> VersionEntry {
    crate::store::versions::build_map_version_entry(
        id.into(),
        "2026-09-22T12:00:00.000Z".into(),
        "s".into(),
        map,
        None,
        true,
    )
}

#[test]
fn a_map_row_summarises_what_changed_on_the_map() {
    let versions = vec![
        map_version(
            "v2",
            serde_json::json!({ "type": "map", "pins": [
                { "id": "a", "name": "Old Harbour", "at": [9, 9] },
                { "id": "b", "name": "Keep", "at": [1, 1] },
            ] }),
        ),
        map_version(
            "v1",
            serde_json::json!({ "type": "map", "pins": [{ "id": "a", "name": "Harbour", "at": [0, 0] }] }),
        ),
    ];
    let rows = version_rows(&versions);
    assert_eq!(rows[0].summary.as_deref(), Some("+1 place · 1 edited"));
    assert_eq!(rows[1].summary.as_deref(), Some("Snapshot · 1 place"));
    // "Old Harbour" + "Keep" against "Harbour".
    assert_eq!(
        rows[0].delta,
        WordDelta {
            added: 2,
            removed: 0
        }
    );
    assert!(rows[0].snippet.is_empty());
    assert_eq!(
        span_delta(&versions, 0, 1),
        WordDelta {
            added: 3,
            removed: 0
        }
    );
}

#[test]
fn a_burst_is_measured_from_before_its_oldest_entry() {
    let versions = vec![
        text_version("v3", "<p>one two three four</p>", "s"),
        text_version("v2", "<p>one two three</p>", "s"),
        text_version("v1", "<p>one</p>", "s"),
    ];
    // The burst v3..v2 is measured against v1.
    assert_eq!(
        span_delta(&versions, 0, 1),
        WordDelta {
            added: 3,
            removed: 0
        }
    );
    assert_eq!(span_delta(&versions, 9, 9), WordDelta::default());
}

#[test]
fn a_snippet_stops_at_a_long_unchanged_run() {
    let long_tail = "a b c d e f g h";
    let ops = diff_words("start old", &format!("start new {long_tail} changed"));
    let snippet = change_snippet(&ops);
    assert!(snippet.iter().all(|op| op.tokens.join(" ") != long_tail));
    assert_eq!(change_snippet(&[]).len(), 1);
}

#[test]
fn the_word_splitter_matches_javascripts_whitespace() {
    // U+FEFF is whitespace to JS and not to Unicode, so `regex`'s \s would call
    // this one word.
    assert_eq!(words("one\u{feff}two"), ["one", "two"]);
    assert_eq!(
        words("  leading and trailing  "),
        ["leading", "and", "trailing"]
    );
    assert_eq!(words("\u{a0}\u{2009}nbsp\u{3000}"), ["nbsp"]);
    assert!(words("   ").is_empty());
}

#[test]
fn entities_and_block_tags() {
    // The opening tags become spaces, which is why the leading space is there.
    assert_eq!(html_to_text("<p>one</P><p>two</p>"), " one\n two\n");
    assert_eq!(html_to_text("a<BR/>b<br >c"), "a\nb\nc");
    assert_eq!(html_to_text("&AMP;&nbsp;&#39;"), "& '");
}

#[test]
fn the_diff_trims_prefix_and_suffix_before_the_lcs() {
    let ops = diff_words("the quick brown fox", "the slow brown fox");
    let shape: Vec<(DiffOpType, usize)> =
        ops.iter().map(|op| (op.op_type, op.tokens.len())).collect();
    assert_eq!(
        shape,
        [
            (DiffOpType::Equal, 1),
            (DiffOpType::Removed, 1),
            (DiffOpType::Added, 1),
            (DiffOpType::Equal, 2)
        ]
    );
}

#[test]
fn an_identical_pair_is_one_equal_run() {
    let ops = diff_words("same words here", "same words here");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].op_type, DiffOpType::Equal);
    assert_eq!(ops[0].tokens.len(), 3);
}

#[test]
fn session_color_hashes_utf16_code_units() {
    assert_eq!(session_color(""), "var(--text-subtle)");
    // An astral character is two code units; hashing chars would give another hue.
    assert!(session_color("🎨").starts_with("var(--ink-"));
    assert_eq!(session_color("abc"), session_color("abc"));
}

#[test]
fn word_delta_counts_both_directions() {
    let delta = word_delta("one two three", "one four five six");
    assert_eq!(
        delta,
        WordDelta {
            added: 3,
            removed: 2
        }
    );
}
