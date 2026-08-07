import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

let pinterestWindow = null
let pinterestWindowReady = null

export const PINTEREST_WINDOW_LABEL = 'pinterest'
const PINTEREST_HOME_URL = 'https://www.pinterest.com'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const waitForWindowCreated = (win, { timeoutMs = 5000 } = {}) => {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    try {
      win.once('tauri://created', () => finish(win))
      win.once('tauri://error', () => finish(null))
    } catch {
      finish(win)
      return
    }

    setTimeout(() => finish(win), Math.max(300, Number(timeoutMs) || 5000))
  })
}

const getPinterestConnectUrl = (targetUrl = '') => {
  const next = String(targetUrl || '').trim()
  if (!next) return 'https://www.pinterest.com/login/'
  return `https://www.pinterest.com/login/?next=${encodeURIComponent(next)}`
}

export async function getPinterestWindow({ waitForCreate = false, timeoutMs = 5000 } = {}) {
  if (waitForCreate && pinterestWindowReady) {
    const readyWindow = await pinterestWindowReady
    if (readyWindow) return readyWindow
  }

  if (pinterestWindow) {
    return pinterestWindow
  }

  const deadline = Date.now() + Math.max(300, Number(timeoutMs) || 5000)
  while (Date.now() < deadline) {
    const byLabel = await WebviewWindow.getByLabel(PINTEREST_WINDOW_LABEL)
    if (byLabel) {
      pinterestWindow = byLabel
      return byLabel
    }
    await sleep(120)
  }

  return null
}

export async function openPinterest(query = '', options = {}) {
  const raw = String(query || '').trim()
  const shouldFocus = options?.focus !== false
  const shouldShowOnCreate = options?.visible !== false && shouldFocus
  const shouldSkipTaskbar = options?.skipTaskbar === true || options?.visible === false
  let url = PINTEREST_HOME_URL
  let title = 'Pinterest'

  // If the caller passes a full URL, navigate directly.
  // This allows using the logged-in Pinterest window for private boards.
  if (raw) {
    try {
      const parsed = new URL(raw)
      url = parsed.toString()
      title = 'Pinterest'
    } catch {
      url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(raw)}`
      title = `Pinterest — ${raw}`
    }
  }

  // If the window already exists, just navigate it (no destroy)
  if (pinterestWindow) {
    try {
      if (!shouldFocus && options?.visible === false) {
        try {
          await pinterestWindow.hide()
        } catch (e) {
          console.warn('Failed to hide Pinterest window for background use:', e)
        }
      }

      // Bring window to front if it’s behind others
      if (shouldFocus) {
        try {
          await pinterestWindow.setFocus()
          await pinterestWindow.show()
          // On some OSes show() doesn’t always raise, so this ensures it’s top-most
          await pinterestWindow.setAlwaysOnTop(true)
          await new Promise(resolve => setTimeout(resolve, 150)) // small delay
          await pinterestWindow.setAlwaysOnTop(false)
        } catch (e) {
          console.warn('Failed to bring Pinterest window to front:', e)
        }
      }

      // Ask the Rust side to navigate the webview (command added below)
      await invoke('navigate_webview', { label: PINTEREST_WINDOW_LABEL, url })

      // Update title to reflect query
      try { await pinterestWindow.setTitle(title) } catch { /* ignore */ }

      return pinterestWindow
    } catch (err) {
      console.warn('Failed to update Pinterest window via navigate_webview, falling back to recreate:', err)
      try {
        await pinterestWindow.destroy()
      } catch (e) {
        console.warn('Failed to destroy fallback pinterestWindow:', e)
      }
      pinterestWindow = null
      pinterestWindowReady = null
    }
  }

  // Create the window if it doesn't exist
  const w = window?.innerWidth ?? 1200
  const h = window?.innerHeight ?? 800

  pinterestWindow = new WebviewWindow(PINTEREST_WINDOW_LABEL, {
    url,
    title,
    width: Math.round(w * 0.45),
    height: h,
    resizable: true,
    focus: shouldFocus,
    skipTaskbar: shouldSkipTaskbar,
    visible: shouldShowOnCreate,
  })
  pinterestWindowReady = waitForWindowCreated(pinterestWindow)

  pinterestWindow.once('tauri://destroyed', () => {
    pinterestWindow = null
    pinterestWindowReady = null
  })

  return options?.waitForCreate ? await getPinterestWindow({ waitForCreate: true }) : pinterestWindow
}

export async function connectPinterest(targetUrl = '') {
  return openPinterest(getPinterestConnectUrl(targetUrl || PINTEREST_HOME_URL))
}
