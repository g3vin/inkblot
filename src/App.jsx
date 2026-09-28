/**
 * App.jsx — application root.
 *
 * Owns app-wide chrome and preferences that live above the editor:
 * theme (light/dark/system), accent colour, and the word-count badge
 * toggle. Wires those preferences into the native Tauri "View" menu
 * and persists them through lib/preferences.ts. Renders the Editor, the
 * accent-colour dialog, and the command palette (⌘K) with the app-level commands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openPinterest } from './lib/openPinterest'
import Editor from './components/Editor.jsx'
import { getPreference, setPreference, removePreference } from './lib/preferences'
import { documentSurface } from './bridge'
import { isNativeShell, nativeOwns } from './lib/host'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from './lib/palette'
import { applyAccentAttribute, applyThemeAttribute, resolveTheme, watchSystemTheme } from './lib/theme'
import { useCommands } from './lib/commands'
import Dialog from './ui/Dialog'
import Button from './ui/Button'
import InkPicker from './ui/InkPicker'
import CommandPalette from './ui/CommandPalette'

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

/** Choose the accent: one of the curated inks, so every accent suits the palette. */
function AccentColorDialog({ open, accent, onChange, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Appearance"
      title="Accent colour"
      description="Tints selections, focus rings and primary buttons. Ink Blue is Inkblot’s own."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onChange(DEFAULT_ACCENT)} disabled={accent === DEFAULT_ACCENT}>
            Reset
          </Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <InkPicker
        label="Accent colour"
        value={accent}
        onChange={onChange}
        inks={ACCENT_PRESETS.map((preset) => preset.id)}
        showLabels
      />
    </Dialog>
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
  const [accent, setAccent] = useState(DEFAULT_ACCENT)
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false)
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

  // Apply a theme ('system' | 'light' | 'dark') and persist it. <html data-theme> always
  // carries the resolved theme (src/lib/theme.js); 'system' just isn't stored.
  const applyTheme = useCallback((theme) => {
    if (!theme) return
    currentThemeRef.current = theme
    applyThemeAttribute(theme)
    if (theme === 'system') removePreference(THEME_STORAGE_KEY)
    else setPreference(THEME_STORAGE_KEY, theme)
    updateMenu(theme)
  }, [updateMenu])

  // The accent is one of the curated inks (src/lib/palette.ts). A hex saved before the
  // ink palette maps to its nearest ink.
  const applyAccent = useCallback((nextAccent) => {
    const id = applyAccentAttribute(nextAccent)
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

  // The native toolbar's Word Count item: the shell asks, and this stays the setting's
  // owner — the same path the View menu's checkbox takes.
  useEffect(() => {
    if (!nativeOwns('toolbar')) return undefined
    return documentSurface.onCommand('setWordCountVisible', ({ visible }) => applyWordCountBadgeVisibility(visible))
  }, [applyWordCountBadgeVisibility])
  useEffect(() => {
    if (nativeOwns('toolbar')) documentSurface.publishViewOptions({ wordCountVisible: showWordCountBadge })
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
      const accentItems = [
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'accent-color-picker',
          text: 'Accent Colour…',
          action: () => setIsAccentPickerOpen(true),
        }),
        await MenuItem.new({
          id: 'command-palette',
          text: 'Command Palette…  ⌘K',
          action: () => dispatchAppEvent('inkblot:command-palette'),
        }),
      ]
      const displayItems = [await PredefinedMenuItem.new({ item: 'Separator' }), wordCountItem, ...(native ? [] : [printLayoutItem])]

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
  }, [applyAccent, applyTheme, applyWordCountBadgeVisibility, getResolvedTheme, updateMenu])

  // Follow the OS when the theme is 'system', and keep the menu labels in step.
  useEffect(() => watchSystemTheme(() => {
    if (currentThemeRef.current !== 'system') return
    applyThemeAttribute('system')
    updateMenu('system')
  }), [updateMenu])

  // App-level commands for the palette (⌘K). Features register their own where they live.
  useCommands(() => [
    { id: 'view.theme.light', section: 'View', title: 'Use light theme', icon: 'sun', keywords: ['paper', 'appearance', 'mode'], run: () => applyTheme('light') },
    { id: 'view.theme.dark', section: 'View', title: 'Use dark theme', icon: 'moon', keywords: ['ink', 'appearance', 'mode', 'night'], run: () => applyTheme('dark') },
    { id: 'view.theme.system', section: 'View', title: 'Match system theme', icon: 'settings', keywords: ['appearance', 'auto'], run: () => applyTheme('system') },
    { id: 'view.accent', section: 'View', title: 'Change accent colour…', icon: 'palette', keywords: ['color', 'tint', 'highlight'], run: () => setIsAccentPickerOpen(true) },
    { id: 'view.word-count', section: 'View', title: 'Show or hide word count', icon: 'gauge', keywords: ['words', 'stats', 'badge'], run: () => applyWordCountBadgeVisibility(!showWordCountBadgeRef.current) },
    { id: 'print.layout', section: 'Print & export', title: 'Toggle print layout', icon: 'print', shortcut: '⌥⌘P', keywords: ['pages', 'preview', 'book'], run: () => dispatchAppEvent('inkblot:print-layout-toggle') },
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

  // Escape closes the accent picker first; otherwise it exits fullscreen.
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
      <AccentColorDialog
        open={isAccentPickerOpen}
        accent={accent}
        onChange={applyAccent}
        onClose={() => setIsAccentPickerOpen(false)}
      />
      <CommandPalette />
    </>
  )
}
