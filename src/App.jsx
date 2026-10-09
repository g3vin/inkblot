/**
 * App.jsx — application root.
 *
 * Owns app-wide chrome and preferences that live above the editor:
 * theme (light/dark/system), accent colour (an ink from lib/palette.ts), and the
 * word-count badge toggle. Wires those preferences into the native Tauri menus and
 * persists them through lib/preferences.ts. Renders the Editor, the Settings sheet,
 * the timer capsule, and the command palette (⌘K) with the app-level commands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openPinterest } from './lib/openPinterest'
import Editor from './components/Editor.jsx'
import { getPreference, setPreference, removePreference } from './lib/preferences'
import { resolveTheme, setAccentAttribute, setThemeAttribute, watchSystemTheme } from './lib/theme'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from './lib/palette'
import { useCommands } from './lib/commands'
import CommandPalette from './ui/CommandPalette.jsx'
import { documentSurface } from './bridge'
import SettingsSheet from './components/settings/SettingsSheet.jsx'
import TimerCapsule from './components/stats/TimerCapsule.jsx'
import { getStatsRuntime, useStatsRuntime } from './stats/useStats.js'
import { OPEN_SETTINGS, primaryTimerAction } from './stats/timerMenu.js'
import { allRoutines } from './stats/config.js'
import { setShowsTabBar, showsTabBar } from './components/tabs/tabBarState.js'
import { buildFormatMenu, buildInsertMenu, fileExtraItems, pasteAndMatchStyleItem, viewItems, windowTabItems } from './menus/appMenus.js'

const THEME_STORAGE_KEY = 'inkblot-theme'
const ACCENT_STORAGE_KEY = 'inkblot-accent-color'
const WORD_COUNT_BADGE_STORAGE_KEY = 'inkblot-show-word-count-badge'

const EXPORT_FORMATS = [
  ['pdf', 'PDF'],
  ['epub', 'EPUB'],
  ['docx', 'Word (.docx)'],
  ['markdown', 'Markdown'],
  ['html', 'HTML'],
  ['plainText', 'Plain text'],
  ['fountain', 'Fountain'],
  ['fdx', 'Final Draft (.fdx)'],
]

const dispatchAppEvent = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }))

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
  const skip = await MenuItem.new({ id: 'timer-skip', text: 'Skip to next segment', enabled: false, action: () => timer.skip() })
  const stop = await MenuItem.new({ id: 'timer-stop', text: 'Stop', enabled: false, action: () => timer.stop() })
  const routines = await Submenu.new({
    text: 'Start routine',
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
      await MenuItem.new({ id: 'timer-show-stats', text: 'Show stats', action: () => stats.showStats() }),
      await MenuItem.new({ id: 'timer-edit-routines', text: 'Edit routines…', action: () => openSettings('timers') }),
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
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [theme, setTheme] = useState('system')
  useStatsRuntime()
  const [showWordCountBadge, setShowWordCountBadge] = useState(true)

  // Resolve 'system' to the OS-reported light/dark preference.
  const getResolvedTheme = useCallback((theme) => resolveTheme(theme), [])

  // Keep the native View-menu labels/checkmarks in sync with the active theme.
  const updateMenu = useCallback((theme) => {
    const resolved = getResolvedTheme(theme)
    const toggleLabel = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

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

  // The accent is one of the curated inks (lib/palette.ts), so every accent suits the
  // palette. A hex saved before the ink palette maps to its nearest ink.
  const applyAccent = useCallback((nextAccent) => {
    const id = setAccentAttribute(nextAccent)
    setPreference(ACCENT_STORAGE_KEY, id)
    setAccent(id)
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
    const storedAccent = getPreference(ACCENT_STORAGE_KEY)
    const storedWordCountBadge = getPreference(WORD_COUNT_BADGE_STORAGE_KEY)
    const showStoredWordCountBadge = storedWordCountBadge !== 'false'
    applyAccent(storedAccent)
    applyTheme(stored)
    applyWordCountBadgeVisibility(showStoredWordCountBadge)

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
        text: 'Switch to dark mode',
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
        text: 'Show word count',
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
        text: 'Print layout  ⌥⌘P',
        action: printEvent('inkblot:print-layout-toggle'),
      })
      const exportItems = (scope, labelSuffix = '') => Promise.all([
        MenuItem.new({ id: `export-pdf-${scope}`, text: `PDF${labelSuffix}…`, action: printEvent('inkblot:export', { format: 'pdf', scope }) }),
        ...(scope === 'folder'
          ? [MenuItem.new({ id: 'export-pdf-bound', text: 'PDF for binding…', action: printEvent('inkblot:export', { format: 'pdf', scope, bound: true }) })]
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
        await MenuItem.new({ id: 'page-setup', text: 'Page setup…', action: printEvent('inkblot:page-setup') }),
        await Submenu.new({
          text: 'Write as',
          items: await Promise.all([['prose', 'Prose'], ['screenplay', 'Screenplay'], ['stageplay', 'Stage play']].map(([format, text]) => (
            MenuItem.new({ id: `write-as-${format}`, text, action: printEvent('inkblot:writing-format', { format }) })
          ))),
        }),
        await MenuItem.new({ id: 'print-document', text: 'Print…  ⌘P', action: printEvent('inkblot:print', { scope: 'document' }) }),
        await MenuItem.new({ id: 'print-book', text: 'Print Book…', action: printEvent('inkblot:print', { scope: 'folder' }) }),
        await MenuItem.new({ id: 'print-book-bound', text: 'Print book for binding…', action: printEvent('inkblot:print', { scope: 'folder', bound: true }) }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ id: 'import-fountain', text: 'Import Fountain script…', action: printEvent('inkblot:import-script') }),
        await Submenu.new({ text: 'Export', items: await exportItems('document') }),
        await Submenu.new({ text: 'Export Book', items: await exportItems('folder') }),
      ]
      if (fileSubmenu) await fileSubmenu.append(fileItems)
      else await menu.append(await Submenu.new({ text: 'File', items: fileItems.slice(1) }))

      const themeItems = [toggleItem, systemItem]
      const accentItems = [
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'accent-color-picker',
          text: 'Accent colour…',
          action: () => openSettings('general'),
        }),
        await MenuItem.new({
          id: 'command-palette',
          text: 'Command palette…  ⌘K',
          action: () => dispatchAppEvent('inkblot:command-palette'),
        }),
      ]
      const tabBarItem = await CheckMenuItem.new({
        id: 'tab-bar-toggle',
        text: 'Show tab bar',
        checked: showsTabBar(),
        action: () => {
          setShowsTabBar(!showsTabBar())
          tabBarItem.setChecked(showsTabBar())
        },
      })
      const displayItems = [await PredefinedMenuItem.new({ item: 'Separator' }), wordCountItem, tabBarItem, printLayoutItem]

      const pageItems = await viewItems({ MenuItem, Submenu, PredefinedMenuItem })
      if (viewSubmenu) {
        await viewSubmenu.append([...themeItems, ...accentItems, ...displayItems, ...pageItems])
      } else {
        const viewMenu = await Submenu.new({
          text: 'View',
          items: [...themeItems, ...accentItems, ...displayItems, ...pageItems],
        })
        await menu.append(viewMenu)
      }

      // Settings…, the other menus, and the writing timer's.
      const settingsItem = await MenuItem.new({ id: 'settings', text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => openSettings() })
      const appSubmenu = items[0] instanceof Submenu && !['File', 'Edit', 'View', 'Window', 'Help'].includes(await items[0].text()) ? items[0] : null
      if (appSubmenu) await appSubmenu.insert([await PredefinedMenuItem.new({ item: 'Separator' }), settingsItem], 1)
      else if (fileSubmenu) await fileSubmenu.append([await PredefinedMenuItem.new({ item: 'Separator' }), settingsItem])
      const api = { MenuItem, Submenu, PredefinedMenuItem, CheckMenuItem }
      const submenus = await Promise.all(items.map(async (item) => (item instanceof Submenu ? [await item.text(), item] : [null, item])))
      const named = (name) => submenus.find(([text]) => text === name)?.[1] ?? null
      const extras = await fileExtraItems(api)
      if (fileSubmenu) await fileSubmenu.insert(extras, 0)
      await named('Edit')?.append([await PredefinedMenuItem.new({ item: 'Separator' }), await pasteAndMatchStyleItem(api)])
      await named('Window')?.insert(await windowTabItems(api), 0)
      // Insert, Format and Timer before Window, where a Mac app has them.
      const added = [await buildInsertMenu(api), await buildFormatMenu(api), await buildTimerMenu(api)]
      const windowAt = submenus.findIndex(([text]) => text === 'Window')
      if (windowAt >= 0) await menu.insert(added, windowAt)
      else await menu.append(added)

      await menu.setAsAppMenu()
      updateMenu(currentThemeRef.current)
    }

    setupMenu()
  }, [applyAccent, applyTheme, applyWordCountBadgeVisibility, getResolvedTheme, updateMenu])

  // Follow the OS when the theme is 'system', and keep the menu labels in step.
  useEffect(() => watchSystemTheme(() => {
    if (currentThemeRef.current !== 'system') return
    setThemeAttribute('system')
    updateMenu('system')
  }), [updateMenu])

  // App-level commands for the palette (⌘K). Features register their own where they live.
  useCommands(() => [
    { id: 'app.settings', section: 'App', title: 'Open settings', icon: 'settings', shortcut: '⌘,', keywords: ['preferences', 'options'], run: () => openSettings() },
    { id: 'view.theme.light', section: 'View', title: 'Use light theme', icon: 'sun', keywords: ['paper', 'appearance', 'mode'], run: () => applyTheme('light') },
    { id: 'view.theme.dark', section: 'View', title: 'Use dark theme', icon: 'moon', keywords: ['ink', 'appearance', 'mode', 'night'], run: () => applyTheme('dark') },
    { id: 'view.theme.system', section: 'View', title: 'Match system theme', icon: 'settings', keywords: ['appearance', 'auto'], run: () => applyTheme('system') },
    { id: 'view.accent', section: 'View', title: 'Change accent colour…', icon: 'palette', keywords: ['color', 'tint', 'highlight'], run: () => openSettings('general') },
    { id: 'view.word-count', section: 'View', title: 'Show or hide word count', icon: 'gauge', keywords: ['words', 'stats', 'badge'], run: () => applyWordCountBadgeVisibility(!showWordCountBadgeRef.current) },
    { id: 'view.tab-bar', section: 'View', title: 'Show or hide tab bar', icon: 'sidebar', keywords: ['tabs'], run: () => setShowsTabBar(!showsTabBar()) },
    { id: 'timer.stats', section: 'Writing', title: 'Show writing stats', icon: 'chart', keywords: ['words', 'goals', 'progress'], run: () => getStatsRuntime().showStats() },
    { id: 'timer.routines', section: 'Writing', title: 'Edit timer routines…', icon: 'timer', keywords: ['pomodoro', 'sprint'], run: () => openSettings('timers') },
    { id: 'print.layout', section: 'Print & export', title: 'Toggle print layout', icon: 'print', shortcut: '⌥⌘P', keywords: ['pages', 'preview', 'book', 'typeset'], run: () => dispatchAppEvent('inkblot:print-layout-toggle') },
    { id: 'print.page-setup', section: 'Print & export', title: 'Page setup…', icon: 'sliders', keywords: ['margins', 'trim', 'paper size'], run: () => dispatchAppEvent('inkblot:page-setup') },
    { id: 'print.document', section: 'Print & export', title: 'Print document…', icon: 'print', shortcut: '⌘P', run: () => dispatchAppEvent('inkblot:print', { scope: 'document' }) },
    { id: 'print.book', section: 'Print & export', title: 'Print book…', icon: 'books', keywords: ['folder', 'manuscript'], run: () => dispatchAppEvent('inkblot:print', { scope: 'folder' }) },
    ...EXPORT_FORMATS.map(([format, label]) => ({
      id: `export.document.${format}`,
      section: 'Print & export',
      title: `Export as ${label}…`,
      icon: 'export',
      keywords: ['save as', 'download', format],
      run: () => dispatchAppEvent('inkblot:export', { format, scope: 'document' }),
    })),
    { id: 'import.fountain', section: 'Document', title: 'Import Fountain script…', icon: 'download', keywords: ['screenplay', 'import'], run: () => dispatchAppEvent('inkblot:import-script') },
    ...[['prose', 'prose'], ['screenplay', 'a screenplay'], ['stageplay', 'a stage play']].map(([format, label]) => ({
      id: `document.write-as.${format}`,
      section: 'Document',
      title: `Write as ${label}`,
      icon: format === 'prose' ? 'document' : 'story',
      keywords: ['format', 'script', format],
      run: () => dispatchAppEvent('inkblot:writing-format', { format }),
    })),
  ], [applyTheme, applyWordCountBadgeVisibility])

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
    accent,
    onAccent: applyAccent,
    accentPresets: ACCENT_PRESETS,
    defaultAccent: DEFAULT_ACCENT,
    wordCount: showWordCountBadge,
    onWordCount: applyWordCountBadgeVisibility,
  }

  return (
    <>
      <Editor showWordCountBadge={showWordCountBadge} />
      <SettingsSheet appearance={appearance} />
      <TimerCapsule />
      <CommandPalette />
    </>
  )
}
