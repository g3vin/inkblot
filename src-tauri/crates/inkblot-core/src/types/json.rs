//! `JsonValue` — the escape hatch for the parts of the format that are not ours.
//!
//! Three things in the document format are arbitrary JSON and must survive a
//! round-trip byte-for-byte:
//!   - `content` / `contentJson`, a TipTap document
//!   - `node.inkblotTipTap`, a card's TipTap document
//!   - the unknown keys another JSON Canvas app wrote (see `CanvasNode::extra`)
//!
//! Typeshare maps this alias to `any` in TypeScript and `AnyCodable` in Swift (see
//! `typeshare.toml`); the Swift shell supplies `AnyCodable` from its own package.

/// Arbitrary JSON we carry but never interpret.
pub type JsonValue = serde_json::Value;

/// Unknown sibling keys captured by `#[serde(flatten)]`.
pub type JsonMap = std::collections::BTreeMap<String, JsonValue>;
