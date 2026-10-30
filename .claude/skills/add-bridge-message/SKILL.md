---
name: add-bridge-message
description: Add or change a message in Inkblot's chrome↔surface bridge protocol (a NativeCommand, WebviewEvent, BridgeRequest/Reply) or a #[typeshare] domain type — the Rust definition, generated TypeScript, surface handler, chrome use and tests, in order.
---

# Add a bridge message

The protocol is defined once in Rust and generated into TypeScript. Do these in order:

1. Read the "Adding a command or an event" steps in the header of
   `src-tauri/crates/inkblot-core/src/bridge/mod.rs`. Find the right submodule from the
   layout there (`command`, `event`, `sidebar`, `tabs`, `timeline`, `envelope`).
2. Add a **named** payload struct and the enum variant. A place in a document is a
   `TextAnchor`, never a bare position.
3. Add the wire-name test in `bridge/tests.rs` (grep for an existing variant's test and copy it).
4. Run `npm run types`. Never hand-edit `src/types/inkblot-core.ts`. For typeshare's
   limits (no flatten, HashMap not BTreeMap, enum literals), see ARCHITECTURE.md →
   Recipes → A domain type.
5. Handle it in `src/bridge/surface.ts` (or the delegate the app registers:
   `canvasDelegates.ts`, `mapDelegates.ts`). A request must reply on every path,
   including "the pane closed".
6. Use it from the chrome through `src/bridge/client.ts`. To read published state, use
   `useLatestBridgeState`.
7. Cover it in `tests/unit/bridge.mjs` (or the suite for the feature), then run
   `npm test -- bridge` and `npm run check:rust`.
