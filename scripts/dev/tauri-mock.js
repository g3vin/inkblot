/**
 * tauri-mock.js — a stand-in for the Tauri bridge, injected into a plain browser page so
 * the app renders outside the desktop shell (for headless screenshots; see
 * scripts/dev/screenshot.mjs). It fakes a projects folder holding "Novel" (two
 * chapters, one note) and "Short stories". Every other command answers null.
 */
(() => {
  let id = 1
  const paragraph = (i) => ({ type: 'paragraph', content: [{ type: 'text', text: `It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the glass doors of Victory Mansions. ${i}` }] })
  const doc = JSON.stringify({
    content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter One' }] }, ...Array.from({ length: 8 }, (_, i) => paragraph(i + 1))] },
    notes: [
      { id: 'n1', type: 'quote', from: 20, to: 40, anchor: 'bright cold day', content: 'Is this too on the nose?', color: '#ffd54f' },
      { id: 'n2', type: 'free', content: 'Keep the weather motif.', color: 'teal' },
    ],
  })
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const n = id++; window[`_${n}`] = cb; return n },
    unregisterCallback: () => {},
    convertFileSrc: (path) => path,
    invoke: async (cmd, args) => {
      const path = String(args?.path ?? '')
      if (cmd.includes('read_dir')) {
        if (/Novel\/?$/.test(path)) return [{ name: 'Chapter one.json', isFile: true, isDirectory: false }, { name: 'Chapter two.json', isFile: true, isDirectory: false }]
        if (/mock\/?$/.test(path)) return [{ name: 'Novel', isDirectory: true, isFile: false }, { name: 'Short stories', isDirectory: true, isFile: false }]
        return []
      }
      if (cmd.includes('exists')) return /Novel|mock|Short/.test(path) && !/versions|\.inkblot|order/.test(path)
      if (cmd.includes('read_text_file')) return Array.from(new TextEncoder().encode(/Chapter/.test(path) ? doc : '{}'))
      if (cmd.includes('read_file')) return []
      if (cmd.startsWith('plugin:path')) return '/mock'
      if (cmd === 'preferences_load') return {}
      if (cmd.includes('list_system_fonts')) return []
      if (cmd.startsWith('plugin:event')) return id++
      if (cmd.startsWith('plugin:menu')) return [id++, 'x']
      if (cmd.startsWith('plugin:window|is_fullscreen')) return false
      return null
    },
  }
})()
