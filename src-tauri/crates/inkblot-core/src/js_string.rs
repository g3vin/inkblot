//! The JavaScript string semantics the core has to match.
//!
//! Two of them, and both decide where things land on screen:
//!
//! **Offsets are UTF-16 code units.** A JS string index, `String.length`, and a
//! ProseMirror position are all counts of UTF-16 units. A Rust byte offset is neither.
//! An emoji is one `char`, four bytes and **two** units — so a match reported in bytes
//! or chars puts the editor's caret in the wrong place in any document containing one.
//!
//! **`\s` and `trim()` include U+FEFF.** Unicode's `White_Space` does not, so
//! `str::trim` and `regex`'s `\s` both leave it behind where JS strips it.

/// The characters JavaScript's `\s` matches, as a regex character-class body.
pub const JS_WHITESPACE_CLASS: &str =
    "\t\n\u{b}\u{c}\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

/// The same set, as characters, for trimming.
const JS_WHITESPACE: [char; 25] = [
    '\t', '\n', '\u{b}', '\u{c}', '\r', ' ', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
    '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}',
    '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}',
];

/// `String.prototype.trim()`.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(|c| JS_WHITESPACE.contains(&c))
}

/// `String.length` — the number of UTF-16 code units.
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// A byte offset into `text`, as the UTF-16 offset JS would report.
pub fn byte_to_utf16(text: &str, byte_offset: usize) -> usize {
    utf16_len(&text[..byte_offset.min(text.len())])
}

/// A UTF-16 offset, as a byte offset for slicing.
///
/// An offset landing inside a surrogate pair rounds up to the end of that character —
/// Rust cannot slice half of one, and the alternative is a panic.
pub fn utf16_to_byte(text: &str, utf16_offset: usize) -> usize {
    let mut units = 0;
    for (byte_offset, character) in text.char_indices() {
        if units >= utf16_offset {
            return byte_offset;
        }
        units += character.len_utf16();
    }
    text.len()
}

/// `text.slice(start, end)` with UTF-16 offsets, clamped rather than throwing.
pub fn utf16_slice(text: &str, start: usize, end: usize) -> &str {
    let start_byte = utf16_to_byte(text, start);
    let end_byte = utf16_to_byte(text, end.max(start));
    &text[start_byte..end_byte.max(start_byte)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_emoji_is_one_char_four_bytes_and_two_units() {
        let text = "a🎨b";
        assert_eq!(text.chars().count(), 3);
        assert_eq!(text.len(), 6);
        assert_eq!(utf16_len(text), 4);
        // The 'b' is at byte 5, char 2, and UTF-16 offset 3 — which is the one a
        // ProseMirror position and a JS string index agree on.
        assert_eq!(byte_to_utf16(text, 5), 3);
        assert_eq!(utf16_to_byte(text, 3), 5);
        assert_eq!(utf16_slice(text, 1, 3), "🎨");
    }

    #[test]
    fn trim_takes_the_byte_order_mark_with_it() {
        assert_eq!(js_trim("\u{feff} hello \u{feff}"), "hello");
        // Which `str::trim` does not.
        assert_eq!("\u{feff}hello".trim(), "\u{feff}hello");
    }
}
