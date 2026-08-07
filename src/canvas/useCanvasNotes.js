/**
 * useCanvasNotes.js — the hook half of CanvasNotesContext.
 *
 * Split out from the provider because a file that exports both a component and a
 * hook breaks Fast Refresh (react-refresh/only-export-components).
 */
import { useContext } from 'react'
import { CanvasNotesContext } from './notesContext'

export const useCanvasNotes = () => useContext(CanvasNotesContext)
