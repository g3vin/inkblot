---
paths:
  - "src/bridge/**"
  - "src-tauri/crates/inkblot-core/src/bridge/**"
---

# The bridge protocol

Read ARCHITECTURE.md → "The bridge protocol" before changing a message. The invariants:

- Every request gets a reply, with an error if need be. A missing reply is a silent hang.
- No message carries a bare ProseMirror position. Use a `TextAnchor` and handle a `null`
  from `resolveAnchor`.
- Coalesce (`createCoalescer`) only events that carry the whole state, never a delta.
- Every payload must survive a JSON round trip (the transport does one).
- The chrome never keeps a second copy of surface state. It renders the latest event
  (`useLatestBridgeState`) and sends commands. Notes change by `NotePatch`.

Adding a message: use the add-bridge-message skill. Checks: `npm test -- bridge`, then
`npm run check:rust`.
