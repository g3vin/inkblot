import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openPinterest } from './openPinterest'
import Editor from './Editor.jsx'
import './App.css'

const THEME_STORAGE_KEY = 'inkblot-theme'
const ACCENT_STORAGE_KEY = 'inkblot-accent-color'
const WORD_COUNT_BADGE_STORAGE_KEY = 'inkblot-show-word-count-badge'

const ACCENT_PRESETS = [
  { id: 'sky', label: 'Sky', value: '#7aaef7' },
  { id: 'mint', label: 'Mint', value: '#58cbb3' },
  { id: 'coral', label: 'Coral', value: '#ff8c73' },
  { id: 'rose', label: 'Rose', value: '#f47ca3' },
  { id: 'gold', label: 'Gold', value: '#f0be57' },
  { id: 'lagoon', label: 'Lagoon', value: '#47b8d6' },
]

const DEFAULT_ACCENT = ACCENT_PRESETS[0].value

const normalizeAccentColor = (value) => {
  if (typeof value !== 'string') return DEFAULT_ACCENT
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : DEFAULT_ACCENT
}

function AccentColorPanel({ open, accentColor, onChange, onClose }) {
  if (!open) return null

  return (
    <div className="accent-overlay" onClick={onClose}>
      <div
        className="accent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accent-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="accent-dialog-header">
          <div>
            <p className="accent-dialog-eyebrow">View Menu</p>
            <h2 id="accent-dialog-title">Accent Color</h2>
          </div>
          <button type="button" className="accent-dialog-close" onClick={onClose} aria-label="Close accent picker">
            ×
          </button>
        </div>

        <p className="accent-dialog-copy">
          Keep the app’s highlights in sync. Pick a chill preset or dial in your own.
        </p>

        <div className="accent-preview" style={{ '--accent-preview': accentColor }}>
          <div className="accent-preview-chip" />
          <div>
            <div className="accent-preview-label">Current accent</div>
            <code>{accentColor.toUpperCase()}</code>
          </div>
        </div>

        <div className="accent-grid">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`accent-swatch${accentColor === preset.value ? ' active' : ''}`}
              style={{ '--swatch-color': preset.value }}
              onClick={() => onChange(preset.value)}
              aria-label={`${preset.label} accent`}
              title={preset.label}
            >
              <span className="accent-swatch-dot" />
              <span className="accent-swatch-label">{preset.label}</span>
            </button>
          ))}
        </div>

        <div className="accent-custom-row">
          <label className="accent-custom-input">
            <span>Pick your own</span>
            <input type="color" value={accentColor} onChange={(event) => onChange(event.target.value)} />
          </label>

          <button
            type="button"
            className="accent-reset-btn"
            onClick={() => onChange(DEFAULT_ACCENT)}
            disabled={accentColor === DEFAULT_ACCENT}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const menuRefs = useRef({
    toggleItem: null,
    systemItem: null,
    wordCountItem: null,
  })
  const currentThemeRef = useRef('system')
  const showWordCountBadgeRef = useRef(true)
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT)
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false)
  const [showWordCountBadge, setShowWordCountBadge] = useState(true)

  const getResolvedTheme = useCallback((theme) => {
    if (theme !== 'system') return theme
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }, [])

  const updateMenu = useCallback((theme) => {
    const resolved = getResolvedTheme(theme)
    const toggleLabel = resolved === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'

    if (menuRefs.current.toggleItem) {
      menuRefs.current.toggleItem.setText(toggleLabel)
    }
    if (menuRefs.current.systemItem) {
      menuRefs.current.systemItem.setChecked(theme === 'system')
    }
  }, [getResolvedTheme])

  const applyTheme = useCallback((theme) => {
    if (!theme) return
    currentThemeRef.current = theme
    const root = document.documentElement

    if (theme === 'system') {
      root.removeAttribute('data-theme')
      root.style.colorScheme = 'light dark'
      localStorage.removeItem(THEME_STORAGE_KEY)
      updateMenu(theme)
      return
    }

    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    updateMenu(theme)
  }, [updateMenu])

  const applyAccentColor = useCallback((nextAccent) => {
    const normalized = normalizeAccentColor(nextAccent)
    document.documentElement.style.setProperty('--accent-color', normalized)
    localStorage.setItem(ACCENT_STORAGE_KEY, normalized)
    setAccentColor(normalized)
  }, [])

  const applyWordCountBadgeVisibility = useCallback((visible) => {
    const nextVisible = Boolean(visible)
    showWordCountBadgeRef.current = nextVisible
    localStorage.setItem(WORD_COUNT_BADGE_STORAGE_KEY, nextVisible ? 'true' : 'false')
    setShowWordCountBadge(nextVisible)
    menuRefs.current.wordCountItem?.setChecked(nextVisible)
  }, [])

  useEffect(() => {
    let unlisten

    listen('search-pinterest', e => {
      const { text } = e.payload
      openPinterest(text)
    }).then(fn => {
      unlisten = fn
    })

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) || 'system'
    const storedAccent = normalizeAccentColor(localStorage.getItem(ACCENT_STORAGE_KEY))
    const storedWordCountBadge = localStorage.getItem(WORD_COUNT_BADGE_STORAGE_KEY)
    const showStoredWordCountBadge = storedWordCountBadge !== 'false'
    applyAccentColor(storedAccent)
    applyTheme(stored)
    applyWordCountBadgeVisibility(showStoredWordCountBadge)

    const setupMenu = async () => {
      const { Menu, MenuItem, Submenu, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')

      const menu = await Menu.default()
      const items = await menu.items()

      let viewSubmenu = null
      for (const item of items) {
        if (item instanceof Submenu) {
          const text = await item.text()
          if (text === 'View') {
            viewSubmenu = item
          }
        }
      }

      const toggleItem = await MenuItem.new({
        id: 'theme-toggle',
        text: 'Switch to Dark',
        action: () => {
          const resolved = getResolvedTheme(currentThemeRef.current)
          applyTheme(resolved === 'dark' ? 'light' : 'dark')
        },
      })

      const systemItem = await CheckMenuItem.new({
        id: 'theme-system',
        text: 'System',
        checked: currentThemeRef.current === 'system',
        action: () => applyTheme('system'),
      })

      const accentItem = await MenuItem.new({
        id: 'accent-color-picker',
        text: 'Accent Color…',
        action: () => setIsAccentPickerOpen(true),
      })

      const wordCountItem = await CheckMenuItem.new({
        id: 'word-count-badge-toggle',
        text: 'Show Word Count',
        checked: showWordCountBadgeRef.current,
        action: () => applyWordCountBadgeVisibility(!showWordCountBadgeRef.current),
      })

      menuRefs.current.toggleItem = toggleItem
      menuRefs.current.systemItem = systemItem
      menuRefs.current.wordCountItem = wordCountItem

      const themeItems = [toggleItem, systemItem]
      const accentItems = [await PredefinedMenuItem.new({ item: 'Separator' }), accentItem]
      const displayItems = [await PredefinedMenuItem.new({ item: 'Separator' }), wordCountItem]

      if (viewSubmenu) {
        await viewSubmenu.append([...themeItems, ...accentItems, ...displayItems])
      } else {
        const viewMenu = await Submenu.new({
          text: 'View',
          items: [...themeItems, ...accentItems, ...displayItems],
        })
        await menu.append(viewMenu)
      }

      await menu.setAsAppMenu()
      updateMenu(currentThemeRef.current)
    }

    setupMenu()
  }, [applyAccentColor, applyTheme, applyWordCountBadgeVisibility, getResolvedTheme, updateMenu])

  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (currentThemeRef.current === 'system') {
        updateMenu('system')
      }
    }

    media.addEventListener?.('change', handler)
    return () => media.removeEventListener?.('change', handler)
  }, [updateMenu])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    const onKeyDown = async (e) => {
      if (e.key !== 'Escape') return

      if (isAccentPickerOpen) {
        setIsAccentPickerOpen(false)
        return
      }

      try {
        const isFullscreen = await appWindow.isFullscreen()
        if (isFullscreen) {
          await appWindow.setFullscreen(false)
        }
      } catch {
        // Ignore window state errors
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAccentPickerOpen])

  return (
    <>
      <Editor showWordCountBadge={showWordCountBadge} />
      <AccentColorPanel
        open={isAccentPickerOpen}
        accentColor={accentColor}
        onChange={applyAccentColor}
        onClose={() => setIsAccentPickerOpen(false)}
      />
    </>
  )
}
