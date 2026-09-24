/**
 * useDocPageSetup.js — an editor's page setup, as React state that follows the doc
 * node through every transaction (a setPageSetup, an undo of one, a restore).
 */
import { useEffect, useState } from 'react'

import { readDocPageSetup } from './DocPageSetup'

/** The editor's page setup, following it through every transaction. */
export const useDocPageSetup = (editor) => {
  const [setup, setSetup] = useState(() => (editor && !editor.isDestroyed ? readDocPageSetup(editor.state.doc) : null))
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const read = () => setSetup(readDocPageSetup(editor.state.doc))
    read()
    editor.on('transaction', read)
    return () => editor.off('transaction', read)
  }, [editor])
  return setup
}

