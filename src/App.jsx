import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openPinterest } from './openPinterest'
import Editor from './Editor.jsx'

export default function App() {
  const menuRefs = useRef({
    toggleItem: null,
    systemItem: null,
  })
  const currentThemeRef = useRef('system')

  const getResolvedTheme = (theme) => {
    if (theme !== 'system') return theme
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }

  const updateMenu = (theme) => {
    const resolved = getResolvedTheme(theme)
    const toggleLabel = resolved === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'

    if (menuRefs.current.toggleItem) {
      menuRefs.current.toggleItem.setText(toggleLabel)
    }
    if (menuRefs.current.systemItem) {
      menuRefs.current.systemItem.setChecked(theme === 'system')
    }
  }

  const applyTheme = (theme) => {
    if (!theme) return
    currentThemeRef.current = theme
    const root = document.documentElement

    if (theme === 'system') {
      root.removeAttribute('data-theme')
      root.style.colorScheme = 'light dark'
      localStorage.removeItem('inkblot-theme')
      updateMenu(theme)
      return
    }

    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
    localStorage.setItem('inkblot-theme', theme)
    updateMenu(theme)
  }

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
    const stored = localStorage.getItem('inkblot-theme') || 'system'
    applyTheme(stored)

    const setupMenu = async () => {
      const { Menu, MenuItem, Submenu, CheckMenuItem } = await import('@tauri-apps/api/menu')

      const menu = await Menu.default()
      const items = await menu.items()

      let viewSubmenu = null
      for (const item of items) {
        if (item instanceof Submenu) {
          const text = await item.text()
          if (text === 'View') {
            viewSubmenu = item
            break
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

      menuRefs.current.toggleItem = toggleItem
      menuRefs.current.systemItem = systemItem

      const themeItems = [toggleItem, systemItem]

      if (viewSubmenu) {
        await viewSubmenu.append(themeItems)
      } else {
        const viewMenu = await Submenu.new({
          text: 'View',
          items: themeItems,
        })
        await menu.append(viewMenu)
      }

      await menu.setAsAppMenu()
      updateMenu(currentThemeRef.current)
    }

    setupMenu()
  }, [])

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
  }, [])

  useEffect(() => {
    const appWindow = getCurrentWindow()
    const onKeyDown = async (e) => {
      if (e.key !== 'Escape') return

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

  return <Editor />
}