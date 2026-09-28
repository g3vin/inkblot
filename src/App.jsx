/**
 * App.jsx — application root.
 *
 * Owns app-wide chrome and preferences that live above the editor:
 * theme (light/dark/system), accent color, and the word-count badge
 * toggle. Wires those preferences into the native Tauri "View" menu
 * and persists them through lib/preferences.ts. Renders the Editor plus the
 * accent-color picker dialog.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { openPinterest } from './lib/openPinterest'
import Editor from './components/Editor.jsx'
import { getPreference, setPreference, removePreference } from './lib/preferences'
import { resolveTheme, setThemeAttribute } from './lib/theme'
import { documentSurface } from './bridge'
import { isNativeShell } from './lib/host'
import SettingsSheet from './components/settings/SettingsSheet.jsx'
import TimerCapsule from './components/stats/TimerCapsule.jsx'
import { getStatsRuntime, useStatsRuntime } from './stats/useStats.js'
import { OPEN_SETTINGS, primaryTimerAction } from './stats/timerMenu.js'
import { allRoutines } from './stats/config.js'
import { setShowsTabBar, showsTabBar } from './components/tabs/tabBarState.js'

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

/**
 * The OS accent color (System Settings → Appearance on macOS) as `#rrggbb`, or null
 * where the host has none to give. Asked of the host because WebKit's
 * `-apple-system-control-accent` keyword reports stock blue to page content whatever
 * the user picked. Where there is one, the accent is the system's — like every native
 * control beside the page — and the picker is not offered.
 */
const readSystemAccent = async () => {
  try {
    const hex = await invoke('system_accent_color')
    return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null
  } catch {
    return null
  }
}

/** Coerce any stored/user value to a valid 6-digit hex color, falling back to the default accent. */
const normalizeAccentColor = (value) => {
  if (typeof value !== 'string') return DEFAULT_ACCENT
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : DEFAULT_ACCENT
}

const openSettings = (pane) => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS, { detail: { pane } }))

/**
 * The menu bar's Timer menu. Its first item says what it does now — Start, Pause,
 * Resume — and the others enable as the timer's state allows, kept in step with the
 * stats runtime.
 */
async function buildTimerMenu({ MenuItem, Submenu, PredefinedMenuItem }) {
  const stats = getStatsRuntime()
  const timer = stats.timer
  const primary = await MenuItem.new({ id: 'timer-primary', text: primaryTimerAction(stats).text, action: () => primaryTimerAction(stats).action() })
  const skip = await MenuItem.new({ id: 'timer-skip', text: 'Skip to Next Segment', enabled: false, action: () => timer.skip() })
  const stop = await MenuItem.new({ id: 'timer-stop', text: 'Stop', enabled: false, action: () => timer.stop() })
  const routines = await Submenu.new({
    text: 'Start Routine',
    items: await Promise.all(allRoutines(stats.config).map((routine) => MenuItem.new({ text: routine.name, action: () => stats.startTimer(routine) }))),
  })
  let last = ''
  stats.subscribe(() => {
    const text = primaryTimerAction(stats).text
    const key = `${text}|${timer.state}`
    if (key === last) return
    last = key
    primary.setText(text)
    skip.setEnabled(timer.state === 'running' || timer.state === 'paused')
    stop.setEnabled(timer.isActive)
  })
  return Submenu.new({
    text: 'Timer',
    items: [
      primary, skip, stop,
      await PredefinedMenuItem.new({ item: 'Separator' }),
      routines,
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({ id: 'timer-show-stats', text: 'Show Stats', action: () => stats.showStats() }),
      await MenuItem.new({ id: 'timer-edit-routines', text: 'Edit Routines…', action: () => openSettings('timers') }),
    ],
  })
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
  const [theme, setTheme] = useState('system')
  const [hasSystemAccent, setHasSystemAccent] = useState(false)
  useStatsRuntime()
  const [showWordCountBadge, setShowWordCountBadge] = useState(true)

  // Resolve 'system' to the OS-reported light/dark preference.
  const getResolvedTheme = useCallback((theme) => resolveTheme(theme), [])

  // Keep the native View-menu labels/checkmarks in sync with the active theme.
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

  // Apply a theme to the document root and persist it ('system' clears the override).
  const applyTheme = useCallback((theme) => {
    if (!theme) return
    currentThemeRef.current = theme
    setTheme(theme)
    setThemeAttribute(theme)

    if (theme === 'system') {
      removePreference(THEME_STORAGE_KEY)
    } else {
      setPreference(THEME_STORAGE_KEY, theme)
    }
    updateMenu(theme)
  }, [updateMenu])

  const applyAccentColor = useCallback((nextAccent) => {
    const normalized = normalizeAccentColor(nextAccent)
    document.documentElement.style.setProperty('--accent-color', normalized)
    setPreference(ACCENT_STORAGE_KEY, normalized)
    setAccentColor(normalized)
  }, [])

  // The system's accent is not a preference: it is shown, never stored, so the user's
  // own pick is still there wherever the host has no system accent to give.
  const followSystemAccent = useCallback((hex) => {
    document.documentElement.style.setProperty('--accent-color', hex)
    setAccentColor(hex)
    setHasSystemAccent(true)
  }, [])

  const applyWordCountBadgeVisibility = useCallback((visible) => {
    const nextVisible = Boolean(visible)
    showWordCountBadgeRef.current = nextVisible
    setPreference(WORD_COUNT_BADGE_STORAGE_KEY, nextVisible ? 'true' : 'false')
    setShowWordCountBadge(nextVisible)
    menuRefs.current.wordCountItem?.setChecked(nextVisible)
  }, [])

  // The toolbar's Word Count item asks, and this stays the setting's owner — the same
  // path the View menu's checkbox takes.
  useEffect(() => (
    documentSurface.onCommand('setWordCountVisible', ({ visible }) => applyWordCountBadgeVisibility(visible))
  ), [applyWordCountBadgeVisibility])
  useEffect(() => {
    documentSurface.publishViewOptions({ wordCountVisible: showWordCountBadge })
  }, [showWordCountBadge])

  // Backend-initiated Pinterest searches (e.g. from a native menu) open the scraper window.
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

  // On startup: restore persisted preferences, then build the native View menu entries.
  useEffect(() => {
    const stored = getPreference(THEME_STORAGE_KEY) || 'system'
    const storedAccent = normalizeAccentColor(getPreference(ACCENT_STORAGE_KEY))
    const storedWordCountBadge = getPreference(WORD_COUNT_BADGE_STORAGE_KEY)
    const showStoredWordCountBadge = storedWordCountBadge !== 'false'
    applyAccentColor(storedAccent)
    applyTheme(stored)
    applyWordCountBadgeVisibility(showStoredWordCountBadge)

    const systemAccent = readSystemAccent()
    systemAccent.then((hex) => hex && followSystemAccent(hex))

    const setupMenu = async () => {
      const { Menu, MenuItem, Submenu, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')

      const menu = await Menu.default()
      const items = await menu.items()

      let viewSubmenu = null
      let fileSubmenu = null
      for (const item of items) {
        if (item instanceof Submenu) {
          const text = await item.text()
          if (text === 'View') {
            viewSubmenu = item
          } else if (text === 'File') {
            fileSubmenu = item
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

      const wordCountItem = await CheckMenuItem.new({
        id: 'word-count-badge-toggle',
        text: 'Show Word Count',
        checked: showWordCountBadgeRef.current,
        action: () => applyWordCountBadgeVisibility(!showWordCountBadgeRef.current),
      })

      menuRefs.current.toggleItem = toggleItem
      menuRefs.current.systemItem = systemItem
      menuRefs.current.wordCountItem = wordCountItem

      // Print Layout, printing and export act on the active document; the pane that
      // owns it listens for these (usePrintLayoutController).
      const printEvent = (type, detail) => () => window.dispatchEvent(new CustomEvent(type, { detail }))
      const printLayoutItem = await MenuItem.new({
        id: 'print-layout-toggle',
        text: 'Print Layout  ⌥⌘P',
        action: printEvent('inkblot:print-layout-toggle'),
      })
      const exportItems = (scope, labelSuffix = '') => Promise.all([
        MenuItem.new({ id: `export-pdf-${scope}`, text: `PDF${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'pdf', scope }) }),
        ...(scope === 'folder'
          ? [MenuItem.new({ id: 'export-pdf-bound', text: 'PDF for Binding…', action: printEvent('inkblot:export', { format: 'pdf', scope, bound: true }) })]
          : []),
        MenuItem.new({ id: `export-epub-${scope}`, text: `EPUB${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'epub', scope }) }),
        MenuItem.new({ id: `export-docx-${scope}`, text: `Word (.docx)${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'docx', scope }) }),
        MenuItem.new({ id: `export-md-${scope}`, text: `Markdown${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'markdown', scope }) }),
        MenuItem.new({ id: `export-html-${scope}`, text: `HTML${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'html', scope }) }),
        MenuItem.new({ id: `export-text-${scope}`, text: `Plain Text${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'plainText', scope }) }),
        PredefinedMenuItem.new({ item: 'Separator' }),
        MenuItem.new({ id: `export-fountain-${scope}`, text: `Fountain${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'fountain', scope }) }),
        MenuItem.new({ id: `export-fdx-${scope}`, text: `Final Draft (.fdx)${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'fdx', scope }) }),
      ])
      const fileItems = [
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ id: 'page-setup', text: 'Page Setup…', action: printEvent('inkblot:page-setup') }),
        await Submenu.new({
          text: 'Write As',
          items: await Promise.all([['prose', 'Prose'], ['screenplay', 'Screenplay'], ['stageplay', 'Stage Play']].map(([format, text]) => (
            MenuItem.new({ id: `write-as-${format}`, text, action: printEvent('inkblot:writing-format', { format }) })
          ))),
        }),
        await MenuItem.new({ id: 'print-document', text: 'Print…  ⌘P', action: printEvent('inkblot:print', { scope: 'document' }) }),
        await MenuItem.new({ id: 'print-book', text: 'Print Book…', action: printEvent('inkblot:print', { scope: 'folder' }) }),
        await MenuItem.new({ id: 'print-book-bound', text: 'Print Book for Binding…', action: printEvent('inkblot:print', { scope: 'folder', bound: true }) }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ id: 'import-fountain', text: 'Import Fountain Script…', action: printEvent('inkblot:import-script') }),
        await Submenu.new({ text: 'Export', items: await exportItems('document') }),
        await Submenu.new({ text: 'Export Book', items: await exportItems('folder') }),
      ]
      // The Swift shell draws File ▸ Print and Export, and View ▸ Print Layout, itself.
      const native = isNativeShell()
      if (!native) {
        if (fileSubmenu) await fileSubmenu.append(fileItems)
        else await menu.append(await Submenu.new({ text: 'File', items: fileItems.slice(1) }))
      }

      const themeItems = [toggleItem, systemItem]
      const accentItems = (await systemAccent)
        ? []
        : [
            await PredefinedMenuItem.new({ item: 'Separator' }),
            await MenuItem.new({
              id: 'accent-color-picker',
              text: 'Accent Color…',
              action: () => openSettings('general'),
            }),
          ]
      const tabBarItem = native ? null : await CheckMenuItem.new({
        id: 'tab-bar-toggle',
        text: 'Show Tab Bar',
        checked: showsTabBar(),
        action: () => {
          setShowsTabBar(!showsTabBar())
          tabBarItem.setChecked(showsTabBar())
        },
      })
      const displayItems = [await PredefinedMenuItem.new({ item: 'Separator' }), wordCountItem, ...(native ? [] : [tabBarItem, printLayoutItem])]

      if (viewSubmenu) {
        await viewSubmenu.append([...themeItems, ...accentItems, ...displayItems])
      } else {
        const viewMenu = await Submenu.new({
          text: 'View',
          items: [...themeItems, ...accentItems, ...displayItems],
        })
        await menu.append(viewMenu)
      }

      // Settings…, and the writing timer's menu. The Swift shell has its own.
      if (!native) {
        const settingsItem = await MenuItem.new({ id: 'settings', text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => openSettings() })
        const appSubmenu = items[0] instanceof Submenu && !['File', 'Edit', 'View', 'Window', 'Help'].includes(await items[0].text()) ? items[0] : null
        if (appSubmenu) await appSubmenu.insert([await PredefinedMenuItem.new({ item: 'Separator' }), settingsItem], 1)
        else if (fileSubmenu) await fileSubmenu.append([await PredefinedMenuItem.new({ item: 'Separator' }), settingsItem])
        await menu.append(await buildTimerMenu({ MenuItem, Submenu, PredefinedMenuItem }))
      }

      await menu.setAsAppMenu()
      updateMenu(currentThemeRef.current)
    }

    setupMenu()
  }, [applyAccentColor, applyTheme, applyWordCountBadgeVisibility, followSystemAccent, getResolvedTheme, updateMenu])

  // The accent is changed in System Settings, so coming back to the window is when it
  // may have moved.
  useEffect(() => {
    const onFocus = async () => {
      const systemAccent = await readSystemAccent()
      if (systemAccent) followSystemAccent(systemAccent)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [followSystemAccent])

  // Refresh menu labels when the OS theme flips while in 'system' mode.
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (currentThemeRef.current === 'system') {
        setThemeAttribute('system')
        updateMenu('system')
      }
    }

    media.addEventListener?.('change', handler)
    return () => media.removeEventListener?.('change', handler)
  }, [updateMenu])

  // Escape exits fullscreen.
  useEffect(() => {
    const appWindow = getCurrentWindow()
    const onKeyDown = async (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
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
  }, [])

  const appearance = {
    theme,
    onTheme: applyTheme,
    accentColor,
    onAccent: applyAccentColor,
    accentPresets: ACCENT_PRESETS,
    defaultAccent: DEFAULT_ACCENT,
    systemAccent: hasSystemAccent,
    wordCount: showWordCountBadge,
    onWordCount: applyWordCountBadgeVisibility,
  }

  return (
    <>
      <Editor showWordCountBadge={showWordCountBadge} />
      <SettingsSheet appearance={appearance} />
      {isNativeShell() ? null : <TimerCapsule />}
    </>
  )
}
