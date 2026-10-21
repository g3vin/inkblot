/**
 * docChangeSink.ts — where an editor's transactions go to be counted.
 *
 * The `DocChangeReporter` extension is inside every editor, and an extension cannot
 * import the surface: the surface imports the commands, which import the extensions.
 * So the extension reports here, and `appBridge` points this at the surface. Until it
 * does — in a test that builds an editor without a bridge — reports go nowhere.
 */

export type DocChangeSink = (editor: unknown, transaction: unknown) => void

let sink: DocChangeSink | null = null

/** Point reports at `next`, or nowhere with null. */
export function setDocChangeSink(next: DocChangeSink | null): void {
  sink = next
}

/** Called by `DocChangeReporter` for each transaction that changes the document. */
export function reportDocTransaction(editor: unknown, transaction: unknown): void {
  sink?.(editor, transaction)
}
