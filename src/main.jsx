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
import './index.css'
import App from './App.jsx'
import { hydratePreferences } from './lib/preferences'

await hydratePreferences()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
