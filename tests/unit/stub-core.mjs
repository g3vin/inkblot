// Stand-in for @tauri-apps/api/core.
export function convertFileSrc(path) {
  return `asset://localhost/${encodeURIComponent(path)}`
}

/**
 * A suite that needs `invoke` installs a handler; everything else gets the throw,
 * which is what the extension graph expects — it imports the module without ever
 * calling it (editorExtensions → PinterestBoard → openPinterest).
 */
let handler = null

export function setInvokeHandler(next) {
  handler = next
}

export async function invoke(command, args) {
  if (!handler) throw new Error('invoke() is not available in the headless test harness')
  return handler(command, args)
}

export function isTauri() {
  return false
}
