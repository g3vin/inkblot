//! The Rust half of the differential parity harness.
//!
//! Reads `{"cases":[{"id":N,"fn":"name","args":[...]}]}` on stdin and writes
//! `{"results":[{"id":N,"ok":<json>}|{"id":N,"err":"..."}]}` on stdout. The Node half
//! (`scripts/parity/run.mjs`) runs the same corpus through the JS implementation and
//! compares. Nothing here is part of the library's API; it exists so that "the Rust
//! port behaves identically" is a thing a gate can prove rather than a claim.
//!
//! **Why a subprocess rather than a Rust test with a checked-in corpus:** a corpus
//! two halves each maintain is a corpus that drifts. Piping one corpus through both
//! implementations in one run is the only version of this that stays honest.

use std::io::{self, Read, Write};

use serde_json::{json, Map, Value};

use inkblot_core::{doc_kind, js_number::format_js_number};

/// `String(x || '')`, the coercion the JS entry points open with.
///
/// The Rust functions take `&str` — they are not defensive about being handed a
/// number, because nothing inside the core ever is. This shim is where that
/// difference lives, so the corpus can still carry the non-string values the JS side
/// tolerates and the harness can still compare the results.
fn js_string_or_empty(value: Option<&Value>) -> Result<String, String> {
    Ok(match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::Bool(false)) => String::new(),
        Some(Value::Bool(true)) => "true".to_string(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => {
            let float = number.as_f64().unwrap_or(f64::NAN);
            // `0 || ''` and `NaN || ''` are both falsy, so both coerce to empty.
            if float == 0.0 || float.is_nan() {
                String::new()
            } else {
                format_js_number(float)
            }
        }
        Some(other) => {
            return Err(format!(
                "the corpus may not carry {other} — String() on arrays and objects is \
                 a JS-ism the core has no opinion about"
            ))
        }
    })
}

fn f64_arg(args: &[Value], index: usize) -> Result<f64, String> {
    match args.get(index) {
        Some(Value::Number(number)) => number
            .as_f64()
            .ok_or_else(|| format!("arg {index} is not representable as f64")),
        // JSON has no NaN or Infinity; the corpus spells them as strings.
        Some(Value::String(text)) => match text.as_str() {
            "NaN" => Ok(f64::NAN),
            "Infinity" => Ok(f64::INFINITY),
            "-Infinity" => Ok(f64::NEG_INFINITY),
            "-0" => Ok(-0.0),
            other => Err(format!("arg {index}: {other} is not a number")),
        },
        other => Err(format!("arg {index} is missing or not a number: {other:?}")),
    }
}

fn dispatch(name: &str, args: &[Value]) -> Result<Value, String> {
    let text = || js_string_or_empty(args.first());

    Ok(match name {
        /* ---- js_number ---- */
        "formatJsNumber" => json!(format_js_number(f64_arg(args, 0)?)),

        /* ---- doc_kind ---- */
        "getDocKind" => json!(doc_kind::get_doc_kind(&text()?)),
        "isCanvasDoc" => json!(doc_kind::is_canvas_doc(&text()?)),
        "withCanvasSuffix" => json!(doc_kind::with_canvas_suffix(&text()?)),
        "stripCanvasSuffix" => json!(doc_kind::strip_canvas_suffix(&text()?)),
        "getDocDisplayName" => json!(doc_kind::get_doc_display_name(&text()?)),

        unknown => return Err(format!("no such function: {unknown}")),
    })
}

fn main() -> io::Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;

    let request: Value = serde_json::from_str(&input)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let cases = request["cases"].as_array().cloned().unwrap_or_default();

    let results: Vec<Value> = cases
        .iter()
        .map(|case| {
            let id = case["id"].clone();
            let name = case["fn"].as_str().unwrap_or_default();
            let args = case["args"].as_array().cloned().unwrap_or_default();

            let mut row = Map::new();
            row.insert("id".to_string(), id);
            match dispatch(name, &args) {
                Ok(value) => row.insert("ok".to_string(), value),
                Err(message) => row.insert("err".to_string(), Value::String(message)),
            };
            Value::Object(row)
        })
        .collect();

    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &json!({ "results": results }))?;
    stdout.write_all(b"\n")?;
    Ok(())
}
