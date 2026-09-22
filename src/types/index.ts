/**
 * The domain types, as the web layer sees them.
 *
 * `./inkblot-core` is generated from the Rust definitions in
 * `src-tauri/crates/inkblot-core/src/types/` by `scripts/generate-types.sh` — never
 * edit it by hand. This file is the hand-written façade: it re-exports the generated
 * types and adds the two things typeshare cannot express.
 *
 * **1. Preserved unknown keys.** Canvas nodes, canvas edges and notes all round-trip
 * keys we do not model — another JSON Canvas app's data on a node, a key written by
 * a newer build of Inkblot on a note. In Rust that is a `#[serde(flatten)]` map;
 * typeshare has no way to emit it (it rejects `flatten` outright), so the `Stored*`
 * aliases below carry the index signature instead. Use a `Stored*` type wherever a
 * value came off disk or is headed back to it, and the plain generated type where
 * only the modeled fields matter.
 *
 * **2. Which optional fields are `null` rather than absent.** The generated file says
 * `field?: T | null` for both, because `Option<T>` is one type in Rust. Where it
 * matters — `note.from`/`to`/`parentNoteId` and `version.name` are written as
 * explicit `null` by `normalizeNote` and `buildTextVersionEntry` — the doc comment on
 * the Rust field says so.
 *
 * It also holds `Loose<T>`, which is about neither: it is the input side of a
 * normalizer, and normalizers are most of what Phase 3 converted.
 */
export * from './inkblot-core'

import type { CanvasEdge, CanvasNode, CanvasState, Note } from './inkblot-core'

/** Anything we did not model, carried through a round-trip untouched. */
export type UnknownKeys = Record<string, unknown>

/** A canvas node as it exists on disk: modeled fields plus another app's keys. */
export type StoredCanvasNode = CanvasNode & UnknownKeys

/** A canvas edge as it exists on disk. */
export type StoredCanvasEdge = CanvasEdge & UnknownKeys

/** A note as it exists on disk. `normalizeNote` spreads the original note before
 *  overriding the fields it owns, so unknown keys survive (noteUtils.js:107). */
export type StoredNote = Note & UnknownKeys

/**
 * A whole canvas in memory between a load and the save that follows it.
 *
 * This is what the reducer holds, and it is `StoredCanvasNode`/`StoredCanvasEdge`
 * rather than the plain generated types for the reason those aliases exist: every
 * node and edge in it is on its way back to the file it came from, so the keys we do
 * not model have to survive the round trip.
 */
export type StoredCanvasState = Omit<CanvasState, 'nodes' | 'edges'> & {
  nodes: Record<string, StoredCanvasNode>
  edges: Record<string, StoredCanvasEdge>
}

/**
 * `T` as it actually arrives — the right keys, none of the guarantees.
 *
 * Every normalizer in this codebase exists because its input came from somewhere it
 * does not control: a stored preference, a document written by an older build, a
 * hand-edited file, a DOM attribute. The output is `T`; the input is this. Each field
 * is `unknown`, so reading one without deciding what to do when it is the wrong type
 * does not compile.
 */
export type Loose<T> = { [K in keyof T]?: unknown }
