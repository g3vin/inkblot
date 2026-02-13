import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

let pinterestWindow = null

export async function openPinterest(query = '') {
  const raw = String(query || '').trim()
  let url = 'https://www.pinterest.com'
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
      console.log('Updating existing Pinterest window URL')

      // Bring window to front if it’s behind others
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

      // Ask the Rust side to navigate the webview (command added below)
      await invoke('navigate_webview', { label: 'pinterest', url })

      // Update title to reflect query
      try { await pinterestWindow.setTitle(title) } catch (e) { /* ignore */ }

      return
    } catch (err) {
      console.warn('Failed to update Pinterest window via navigate_webview, falling back to recreate:', err)
      try {
        await pinterestWindow.destroy()
      } catch (e) {
        console.warn('Failed to destroy fallback pinterestWindow:', e)
      }
      pinterestWindow = null
    }
  }

  // Create the window if it doesn't exist
  const w = window?.innerWidth ?? 1200
  const h = window?.innerHeight ?? 800

  pinterestWindow = new WebviewWindow('pinterest', {
    url,
    title,
    width: Math.round(w * 0.45),
    height: h,
    resizable: true,
  })

  pinterestWindow.once('tauri://destroyed', () => {
    pinterestWindow = null
  })

}