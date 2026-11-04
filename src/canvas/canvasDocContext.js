/**
 * canvasDocContext.js — the canvas a card is on, for what a card needs that its props
 * don't carry: its name tags leave the canvas's own name untagged (cardTags.js), as a
 * document leaves its own.
 */
import { createContext, useContext } from 'react'

export const CanvasDocContext = createContext(null)

/** The tree path of the canvas this card is on, or null outside one. */
export const useCanvasDocPath = () => useContext(CanvasDocContext)
