/**
 * workbenchActions.js — a workbench tile acting on the text it was made from.
 *
 * Lifted out of Workbench.jsx so the React panel and the native one (by protocol
 * command) share one implementation. A tile finds its word through `resolveAnchor`:
 * its stored range is trusted only while it still covers the tile's word, so a tile
 * never rewrites whatever has moved under it.
 */
import { resolveAnchor } from '../bridge/anchors'

/** The editor a tile belongs to: the secondary pane's if it was made there. */
export function editorForTile(tile, { editor, secondaryEditor, secondaryDoc }) {
  if (tile?.doc && tile.doc === secondaryDoc) return secondaryEditor || editor
  return editor
}

export function findTileRange(targetEditor, tile) {
  if (!targetEditor || !tile) return null
  const text = tile.anchor || tile.text
  if (!text) return null
  return resolveAnchor(targetEditor, {
    from: typeof tile.from === 'number' ? tile.from : -1,
    to: typeof tile.to === 'number' ? tile.to : -1,
    text,
  })
}

/** Select the tile's word in its document. False when the word is gone. */
export function selectTileWord(targetEditor, tile) {
  const range = findTileRange(targetEditor, tile)
  if (!range) return false
  targetEditor.chain().focus().setTextSelection(range).scrollIntoView().run()
  return true
}

/**
 * Replace the tile's word, and return the tile retargeted at the new word — or null
 * when the word could not be found, in which case nothing was changed.
 */
export function replaceTileWord(targetEditor, tile, newWord) {
  const range = findTileRange(targetEditor, tile)
  if (!range) return null
  targetEditor.chain().focus().setTextSelection(range).insertContent(newWord).run()
  return { ...tile, text: newWord, anchor: newWord, from: range.from, to: range.from + newWord.length }
}
