/**
 * panelInsets.js — how much of the window the shell's own panels cover.
 *
 * Under the Swift shell the file tree, the inspector and the window toolbar are glass
 * floating over the page, and a map runs on underneath them. The map still has to
 * keep what it draws over itself — the scale bar, the compass, the title, the
 * timeline — where they can be seen, so the layout hands the shell's insets
 * (`setPanelInsets`) down through this. Zero everywhere under Tauri.
 */
import { createContext } from 'react'

export const NO_PANEL_INSETS = Object.freeze({ leading: 0, trailing: 0, top: 0 })

export const PanelInsetsContext = createContext(NO_PANEL_INSETS)
