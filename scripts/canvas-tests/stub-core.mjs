// Stand-in for @tauri-apps/api/core.
export function convertFileSrc(path) {
  return `asset://localhost/${encodeURIComponent(path)}`
}

// Never called by these suites, but the extension graph imports it
// (editorExtensions → PinterestBoard → openPinterest).
export async function invoke() {
  throw new Error('invoke() is not available in the headless test harness')
}
