//! Compiling a query into a matcher.
//!
//! Everything downstream — document, notes, files, canvases — matches through this one
//! object, so the case / whole-word / regex switches behave identically in every scope.
//!
//! ## The regex question
//!
//! Rust's `regex` crate has no backreferences and no lookaround, and it rejects a
//! pattern using them outright. In this app that would surface as "Invalid pattern" on
//! a search the user has every reason to expect to work, so the engine here is
//! **`fancy-regex`**, which supports both by falling back to backtracking.
//!
//! That leaves the dialect. JavaScript's character classes are ASCII and Rust's are
//! Unicode: `\w` is `[A-Za-z0-9_]` in JS and any Unicode word character in Rust, `\d`
//! is `[0-9]` against any Unicode digit, `\s` differs over U+FEFF, and `\b` follows
//! `\w`. Left alone, `\bcafé\b` would match in Rust and never match in JS, because JS
//! does not consider `é` a word character.
//!
//! So the pattern is **translated** before it is compiled: the eight JS class escapes
//! are rewritten to the explicit sets JS means by them ([`translate_js_classes`]).
//! What that does not cover is documented on that function, and `npm run parity`
//! checks the whole matcher against the real `RegExp` over several hundred patterns.
//!
//! ## The one thing that cannot be made to agree
//!
//! A JavaScript regex without the `u` flag matches **UTF-16 code units**, so an astral
//! character is two addressable halves: `\W` against "🎨" finds two matches of one unit
//! each, and each of them is half of a surrogate pair. A Rust `&str` cannot hold half
//! of one, so the same search finds a single two-unit match here.
//!
//! Offsets stay consistent either way — both count UTF-16 units, so a hit still
//! resolves to the right place in the document. What differs is how many hits a
//! single-character class reports over an emoji, and what `match_text` holds. The
//! parity harness labels these cases unrepresentable rather than hiding them.

use fancy_regex::Regex;

use crate::js_string::{byte_to_utf16, js_trim, JS_WHITESPACE_CLASS};

/// JavaScript's `\w`, which is ASCII where Rust's is Unicode.
const JS_WORD: &str = "A-Za-z0-9_";

/// JavaScript's `\b`, spelled out.
///
/// It cannot be `(?-u:\b)` — fancy-regex rejects disabling Unicode outright — so it is
/// written as what JS defines it to be: the boundary between a `\w` and a non-`\w`,
/// in either direction, with the ends of the string counting as non-`\w`. Lookbehind
/// puts the whole pattern on fancy-regex's backtracking path, which is the cost of
/// agreeing with the webview about where a word ends.
const JS_WORD_BOUNDARY: &str =
    "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))";

/// JavaScript's `\B`: both sides the same, either both word or both not.
const JS_NOT_WORD_BOUNDARY: &str =
    "(?:(?<=[A-Za-z0-9_])(?=[A-Za-z0-9_])|(?<![A-Za-z0-9_])(?![A-Za-z0-9_]))";

/// One hit, with offsets in UTF-16 code units — what a JS string index and a
/// ProseMirror position both count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub index: usize,
    pub length: usize,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MatcherOptions {
    pub match_case: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

pub struct Matcher {
    regex: Option<Regex>,
    /// True for a blank or whitespace-only query. Nothing matches, and nothing is
    /// wrong: it is the bar's resting state.
    pub is_empty: bool,
    /// False for a pattern that would not compile. Reported rather than thrown — the
    /// user is typing, and `foo(` is a normal intermediate state, not an error worth
    /// breaking the panel over.
    pub valid: bool,
    pub error: String,
}

impl Matcher {
    pub fn new(query: &str, options: MatcherOptions) -> Self {
        // `js_trim`, not `str::trim`: a query of nothing but a byte order mark is an
        // empty query to JS and a one-character search to Rust.
        if js_trim(query).is_empty() {
            return Self { regex: None, is_empty: true, valid: true, error: String::new() };
        }

        let mut source = if options.use_regex {
            translate_js_classes(query)
        } else {
            escape_regexp(query)
        };
        if options.whole_word {
            source = format!("{JS_WORD_BOUNDARY}(?:{source}){JS_WORD_BOUNDARY}");
        }
        if !options.match_case {
            source = format!("(?i){source}");
        }

        match Regex::new(&source) {
            Ok(regex) => {
                Self { regex: Some(regex), is_empty: false, valid: true, error: String::new() }
            }
            Err(error) => {
                Self { regex: None, is_empty: false, valid: false, error: error.to_string() }
            }
        }
    }

    /// Every match in `value`, up to `limit`.
    pub fn find_all(&self, value: &str, limit: usize) -> Vec<Hit> {
        let Some(regex) = &self.regex else { return Vec::new() };
        if value.is_empty() || limit == 0 {
            return Vec::new();
        }

        let mut found = Vec::new();
        let mut cursor = 0;

        while cursor <= value.len() && found.len() < limit {
            let Ok(Some(matched)) = regex.find_from_pos(value, cursor) else { break };

            if matched.start() == matched.end() {
                // A pattern that can match nothing (`a*`, `^`) would never advance on
                // its own and would spin here forever. JS steps one UTF-16 unit; this
                // steps one character, the same step except beside an astral character,
                // where JS would land between its two halves.
                let step = value[matched.start()..].chars().next().map_or(1, char::len_utf8);
                cursor = matched.start() + step;
                continue;
            }

            let start = byte_to_utf16(value, matched.start());
            found.push(Hit {
                index: start,
                length: byte_to_utf16(value, matched.end()) - start,
                text: matched.as_str().to_string(),
            });
            cursor = matched.end();
        }

        found
    }

    pub fn test(&self, value: &str) -> bool {
        !self.find_all(value, 1).is_empty()
    }
}

/// `escapeRegExp` — the characters JS's own escaping covers, and only those.
fn escape_regexp(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if ".*+?^${}()|[]\\".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// Rewrite JavaScript's class escapes into the sets JS means by them.
///
/// Outside a character class, `\d \D \w \W \s \S` become explicit groups and `\b \B`
/// become the lookaround pairs JS defines them as. Inside one, `\d \w \s` splice their
/// ranges in directly, which is the only form a nested class can take.
///
/// **Not covered**, and left to behave as Rust: `\D \W \S` *inside* a character class,
/// which have no range form and would need a set-difference the JS user did not write;
/// and case-insensitive matching, where both engines fold Unicode but not identically.
/// Both are noted here rather than being silently different.
fn translate_js_classes(pattern: &str) -> String {
    const DIGIT: &str = "0-9";
    const WORD: &str = JS_WORD;

    let mut out = String::with_capacity(pattern.len());
    let mut chars = pattern.chars().peekable();
    let mut in_class = false;

    while let Some(character) = chars.next() {
        if character != '\\' {
            if character == '[' {
                in_class = true;
            } else if character == ']' {
                in_class = false;
            }
            out.push(character);
            continue;
        }

        let Some(escaped) = chars.next() else {
            // A trailing backslash: leave it, and let the engine reject it as JS does.
            out.push('\\');
            break;
        };

        let replacement = match (escaped, in_class) {
            ('d', false) => format!("[{DIGIT}]"),
            ('D', false) => format!("[^{DIGIT}]"),
            ('w', false) => format!("[{WORD}]"),
            ('W', false) => format!("[^{WORD}]"),
            ('s', false) => format!("[{JS_WHITESPACE_CLASS}]"),
            ('S', false) => format!("[^{JS_WHITESPACE_CLASS}]"),
            ('b', false) => JS_WORD_BOUNDARY.to_string(),
            ('B', false) => JS_NOT_WORD_BOUNDARY.to_string(),
            ('d', true) => DIGIT.to_string(),
            ('w', true) => WORD.to_string(),
            ('s', true) => JS_WHITESPACE_CLASS.to_string(),
            _ => {
                out.push('\\');
                out.push(escaped);
                continue;
            }
        };
        out.push_str(&replacement);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(query: &str, options: MatcherOptions, text: &str) -> Vec<Hit> {
        Matcher::new(query, options).find_all(text, usize::MAX)
    }

    #[test]
    fn a_blank_query_matches_nothing_and_is_not_an_error() {
        let matcher = Matcher::new("   ", MatcherOptions::default());
        assert!(matcher.is_empty && matcher.valid);
        assert!(!matcher.test("anything"));
    }

    #[test]
    fn a_half_written_pattern_is_reported_not_thrown() {
        let matcher = Matcher::new("foo(", MatcherOptions { use_regex: true, ..Default::default() });
        assert!(!matcher.valid);
        assert!(!matcher.error.is_empty());
        assert!(!matcher.test("foo("));
    }

    #[test]
    fn a_literal_query_is_escaped() {
        let found = hits("a.c", MatcherOptions::default(), "abc a.c");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].index, 4);
    }

    #[test]
    fn offsets_are_utf16_units() {
        // The emoji is two units, so "art" starts at 3 rather than 2.
        let found = hits("art", MatcherOptions::default(), "🎨 art");
        assert_eq!(found[0].index, 3);
        assert_eq!(found[0].length, 3);
    }

    #[test]
    fn whole_word_uses_ascii_boundaries_like_javascript() {
        // JS: `\bcafé\b` never matches, because é is not a word character and the
        // trailing boundary cannot be satisfied.
        let options = MatcherOptions { whole_word: true, ..Default::default() };
        assert!(hits("café", options, "a café here").is_empty());
        assert_eq!(hits("cafe", options, "a cafe here").len(), 1);
        assert!(hits("cafe", options, "a cafeteria here").is_empty());
    }

    #[test]
    fn lookaround_and_backreferences_compile() {
        let options = MatcherOptions { use_regex: true, ..Default::default() };
        assert_eq!(hits(r"foo(?=bar)", options, "foobar foobaz").len(), 1);
        assert_eq!(hits(r"(\w)\1", options, "letter").len(), 1);
    }

    #[test]
    fn class_escapes_follow_javascript_rather_than_unicode() {
        let options = MatcherOptions { use_regex: true, ..Default::default() };
        // Arabic-Indic five is a digit to Rust and not to JS.
        assert!(hits(r"\d", options, "٥").is_empty());
        assert_eq!(hits(r"\d", options, "5").len(), 1);
        // é is a word character to Rust and not to JS.
        assert!(hits(r"\w", options, "é").is_empty());
        // Inside a class, the ranges splice in.
        assert_eq!(hits(r"[\d\w]+", options, "ab12").len(), 1);
    }

    #[test]
    fn an_astral_character_is_one_match_here_and_two_in_the_webview() {
        // Pinned, not fixed: JS matches UTF-16 units and finds the two surrogate
        // halves separately. The offsets agree — the emoji occupies units 0 and 1 —
        // but the hit count and the matched text cannot.
        let options = MatcherOptions { use_regex: true, ..Default::default() };
        let found = hits(r"\W", options, "🎨 art");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], Hit { index: 0, length: 2, text: "🎨".to_string() });
        assert_eq!(found[1], Hit { index: 2, length: 1, text: " ".to_string() });
    }

    #[test]
    fn an_empty_match_advances_instead_of_spinning() {
        let options = MatcherOptions { use_regex: true, ..Default::default() };
        assert!(hits("a*", options, "bbb").is_empty());
        assert_eq!(hits("b*", options, "bbb").len(), 1);
    }
}
