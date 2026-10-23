/**
 * main.jsx — React entry point; mounts <App /> into #root.
 *
 * Preferences are read from disk BEFORE the first render. Every call site reads them
 * synchronously during render — a `useState` initializer, a node view's constructor —
 * but reading from disk is not synchronous, so the whole store is hydrated once here
 * and answered from memory afterwards (see lib/preferences.ts).
 *
 * Mounting first and hydrating after would mean a frame of the wrong theme, an editor
 * that opens with no tabs and then replaces them, and a file tree that expands
 * everything before collapsing it again. Hydration failure is survivable — every
 * caller defaults when a key is absent — so this never blocks the app from starting.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.js'
import './index.css'
import App from './App.jsx'
import { getPreference, hydratePreferences } from './lib/preferences'
import { setAccentAttribute, setThemeAttribute, setTrayAttribute } from './lib/theme'
import { applyPlatformAttribute } from './ui/platform'
import { placeTrafficLights } from './lib/trafficLights'

// Dev only: `?mock` runs the page against scripts/dev/tauri-mock.js so it opens in a
// plain browser, and `?variant=<family>:<picks>` turns on a design-review prototype
// (src/dev/variants, docs/design-review). Production builds drop this block.
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search)
  if (params.has('mock')) await import('../scripts/dev/tauri-mock.js')
  if (params.has('variant')) (await import('./dev/variants/index.js')).installVariants(params.get('variant'))
}

// A theme before anything else paints — the OS's until the saved one is known.
setThemeAttribute('system')
applyPlatformAttribute()

await hydratePreferences()
setThemeAttribute(getPreference('inkblot-theme'))
setAccentAttribute(getPreference('inkblot-accent-color'))
setTrayAttribute(getPreference('inkblot-tray-color'))
// The traffic lights where the landing page wants them; the editor moves them with its sidebar.
placeTrafficLights()

// Dev only: `?design` renders the design-language showcase instead of the app.
const showcase = import.meta.env.DEV && new URLSearchParams(window.location.search).has('design')
const Root = showcase ? (await import('./dev/DesignShowcase.jsx')).default : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
