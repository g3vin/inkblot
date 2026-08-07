/**
 * Stub for @tauri-apps/api/webview.
 *
 * Only useCanvasImageImport touches this, to subscribe to OS file drops (which do
 * NOT arrive as DOM drop events in Tauri — see invariant 9). Under the harness there
 * is no webview, so the subscription is a no-op that hands back an unlisten fn.
 */
export const getCurrentWebview = () => ({
  onDragDropEvent: async () => () => {},
})
