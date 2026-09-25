/**
 * notesContext.js — just the context object.
 *
 * Its own module so the provider (a component) and the hook can each import it
 * without a file exporting both a component and a non-component, which breaks
 * Fast Refresh.
 */
import { createContext } from 'react'

export const CanvasNotesContext = createContext(null)
