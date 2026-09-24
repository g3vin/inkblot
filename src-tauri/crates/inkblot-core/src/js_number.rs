//! Formatting an `f64` the way JavaScript does.
//!
//! Two things this crate produces are *strings containing numbers* that the webview
//! consumes verbatim: the world layer's CSS transform and an edge's SVG path. If Rust
//! and JS disagree about how to spell a number, the two implementations produce
//! different strings for the same geometry and the parity harness cannot tell a
//! formatting difference from a math error.
//!
//! Rust's `Display for f64` very nearly picks the same digits as JS — both emit the
//! shortest decimal that round-trips — and differs in two ways this module repairs:
//!
//!   - **The envelope.** Rust always writes positional notation; ECMAScript switches
//!     to exponential outside `1e-7 .. 1e21`. So `1e21` prints as
//!     `1000000000000000000000` in Rust and `1e+21` in JS.
//!   - **Exact ties.** Where the true value sits exactly halfway between the two
//!     shortest candidates, ECMA-262 §6.1.6.1.20 step 5 takes the **even** last digit
//!     and Rust takes the larger. `2083078717175940.25` is one: JS spells it
//!     `2083078717175940.2`, Rust `…40.3`. The parity corpus hits this about once in
//!     700 random doubles, all of them past 1e13 — nowhere near a canvas coordinate,
//!     but a gate that fails one run in a thousand is not a gate.

/// `f64` → the string JavaScript's `String(x)` would produce.
pub fn format_js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    // JS prints both zeroes as "0"; `format!` would give "-0" for the negative one.
    if value == 0.0 {
        return "0".to_string();
    }

    let sign = if value < 0.0 { "-" } else { "" };

    // `{:e}` gives the shortest round-tripping mantissa and its exponent: the value
    // is `m × 10^exp` with `1 <= |m| < 10`. ECMA works in terms of `0.d1d2… × 10^n`,
    // so `n = exp + 1` and `digits` is the mantissa with its point removed.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("{:e} always emits an exponent");
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let mut n = exponent.parse::<i32>().expect("{:e} emits a decimal exponent") + 1;

    if let Some((tied_digits, tied_n)) = round_half_to_even(value.abs(), &digits, n) {
        digits = tied_digits;
        n = tied_n;
    }
    let digits = digits;
    let k = digits.len() as i32;

    if k <= n && n <= 21 {
        // Integral, short enough to spell out: digits then trailing zeros.
        return format!("{sign}{digits}{}", "0".repeat((n - k) as usize));
    }
    if 0 < n && n <= 21 {
        // A decimal point somewhere inside the digits.
        return format!("{sign}{}.{}", &digits[..n as usize], &digits[n as usize..]);
    }
    if -6 < n && n <= 0 {
        // Small enough to write in full: "0." then the leading zeros.
        return format!("{sign}0.{}{digits}", "0".repeat((-n) as usize));
    }

    // Outside the positional window, JS goes exponential — always with a signed,
    // unpadded exponent ("1e+21", "1e-7").
    let power = n - 1;
    let sign_of_power = if power >= 0 { "+" } else { "-" };
    if k == 1 {
        format!("{sign}{digits}e{sign_of_power}{}", power.abs())
    } else {
        format!(
            "{sign}{}.{}e{sign_of_power}{}",
            &digits[..1],
            &digits[1..],
            power.abs()
        )
    }
}

/// The even-last-digit candidate, when `digits` is one side of an exact tie.
///
/// Returns `None` — the overwhelmingly common case — as soon as the value is not
/// exactly halfway between two k-digit decimals. The cheap rejection is the first
/// `format!`: rounding the value to k+1 significant digits can only end in `5` if the
/// exact expansion does, so any other last digit means there is nothing to decide.
/// Only then does it pay for the exact expansion, which for an `f64` is finite and
/// never longer than 767 significant digits.
fn round_half_to_even(magnitude: f64, digits: &str, n: i32) -> Option<(String, i32)> {
    let k = digits.len();

    let one_more = format!("{:.*e}", k, magnitude);
    let (mantissa, _) = one_more.split_once('e')?;
    let rounded: String = mantissa.chars().filter(|c| *c != '.').collect();
    if !rounded.ends_with('5') {
        return None;
    }

    // Confirm it is a real tie and not a 5 produced by rounding something longer.
    let exact = format!("{:.*e}", 780, magnitude);
    let (exact_mantissa, _) = exact.split_once('e')?;
    let exact_digits: String = exact_mantissa.chars().filter(|c| *c != '.').collect();
    if exact_digits.len() > k + 1 && exact_digits[k + 1..].bytes().any(|b| b != b'0') {
        return None;
    }

    // The two candidates: the first k digits, and that value plus one.
    let low = &rounded[..k];
    let picked = if low.as_bytes()[k - 1] % 2 == 0 { low.to_string() } else { increment_digits(low) };

    // A carry lengthens the digit string and shifts the exponent; trailing zeros are
    // not significant, and JS would never print them.
    let shifted = if picked.len() > k { n + 1 } else { n };
    let trimmed = picked.trim_end_matches('0');
    let trimmed = if trimmed.is_empty() { "0" } else { trimmed };

    // A candidate must still round-trip to be a candidate at all. If the even one
    // does not, the odd one was the only possibility and Rust already had it.
    let candidate = format!("0.{trimmed}e{shifted}");
    if candidate.parse::<f64>().ok()? != magnitude {
        return None;
    }

    Some((trimmed.to_string(), shifted))
}

/// Decimal string + 1. "1999" -> "2000", "999" -> "1000" (one digit longer, which is
/// what the caller reads as a carry).
fn increment_digits(digits: &str) -> String {
    let mut bytes = digits.as_bytes().to_vec();
    for index in (0..bytes.len()).rev() {
        if bytes[index] == b'9' {
            bytes[index] = b'0';
        } else {
            bytes[index] += 1;
            return String::from_utf8(bytes).expect("ascii digits");
        }
    }
    let mut carried = vec![b'1'];
    carried.extend_from_slice(&bytes);
    String::from_utf8(carried).expect("ascii digits")
}

#[cfg(test)]
mod tests {
    use super::format_js_number;

    #[test]
    fn matches_javascript_on_the_cases_that_differ_from_rust_display() {
        // Rust's Display would spell these out positionally; JS does not.
        assert_eq!(format_js_number(1e21), "1e+21");
        assert_eq!(format_js_number(1.5e22), "1.5e+22");
        assert_eq!(format_js_number(1e-7), "1e-7");
        assert_eq!(format_js_number(-1.25e-9), "-1.25e-9");
        // And these sit just inside the window, where it stays positional.
        assert_eq!(format_js_number(1e20), "100000000000000000000");
        assert_eq!(format_js_number(1e-6), "0.000001");
    }

    #[test]
    fn exact_ties_take_the_even_last_digit() {
        // Exactly 2083078717175940.25, so the two shortest candidates are equidistant.
        assert_eq!(format_js_number(2083078717175940.2), "2083078717175940.2");
        assert_eq!(format_js_number(-76396250713801.12), "-76396250713801.12");
        assert_eq!(format_js_number(-17398314972313.562), "-17398314972313.562");
        // Not a tie: the expansion continues past the 5, so Rust's digits stand.
        assert_eq!(format_js_number(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn ordinary_numbers_and_the_zeroes() {
        assert_eq!(format_js_number(0.0), "0");
        assert_eq!(format_js_number(-0.0), "0");
        assert_eq!(format_js_number(1.0), "1");
        assert_eq!(format_js_number(-42.0), "-42");
        assert_eq!(format_js_number(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(format_js_number(f64::NAN), "NaN");
        assert_eq!(format_js_number(f64::INFINITY), "Infinity");
        assert_eq!(format_js_number(f64::NEG_INFINITY), "-Infinity");
    }
}
