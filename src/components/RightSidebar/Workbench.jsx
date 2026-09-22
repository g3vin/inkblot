/**
 * Workbench.jsx — the Workbench tab of the right sidebar.
 *
 * Renders the language-tool tiles (part-of-speech, synonyms, definition,
 * rhymes) created from the editor context menu. Tiles remember the text
 * range they were created from so replacements land back in the document.
 */
import { resolveAnchor } from '../../bridge/anchors'
import POSTile from '../tiles/POSTile.jsx'
import SynonymTile from '../tiles/SynonymTile.jsx'
import DefinitionTile from '../tiles/DefinitionTile.jsx'
import RhymeTile from '../tiles/RhymeTile.jsx'

export default function Workbench({
  tiles,
  setTiles,
  editor,
  secondaryEditor,
  secondaryDoc,
  query = '',
}) {
  const removeTile = id => setTiles(prev => prev.filter(t => t.id !== id))
  const normalizedQuery = query.trim().toLowerCase()
  const visibleTiles = normalizedQuery
    ? tiles.filter((tile) => (
        `${tile.type || ''} ${tile.text || ''} ${tile.anchor || ''} ${tile.doc || ''}`
          .toLowerCase()
          .includes(normalizedQuery)
      ))
    : tiles

  // Tiles created from the secondary pane target that pane's editor; everything
  // else goes to the primary editor.
  const getEditorForTile = (tile) => {
    if (tile?.doc && tile.doc === secondaryDoc) return secondaryEditor || editor
    return editor
  }

  // Locate the tile's source text.
  //
  // The other of the two places the handoff points at for sharp edge #3, and it now
  // goes through the same `resolveAnchor` the protocol uses. The change in behaviour
  // is the same one: this used to trust its stored range whenever that range was not
  // empty, without checking that it still held the tile's word — so a tile could
  // rewrite whatever had moved under it.
  const findAnchorRange = (targetEditor, tile) => {
    if (!targetEditor || !tile) return null

    const text = tile.anchor || tile.text
    if (!text) return null

    return resolveAnchor(targetEditor, {
      from: typeof tile.from === 'number' ? tile.from : -1,
      to: typeof tile.to === 'number' ? tile.to : -1,
      text,
    })
  }

  const selectTileWord = (tile) => {
    const targetEditor = getEditorForTile(tile)
    if (!targetEditor) return
    const range = findAnchorRange(targetEditor, tile)
    if (!range) return
    targetEditor
      .chain()
      .focus()
      .setTextSelection(range)
      .scrollIntoView()
      .run()
  }

  // Replace the tile's word in the document and retarget the tile to the new text.
  const replaceWord = (tile, newWord) => {
    const targetEditor = getEditorForTile(tile)
    if (!targetEditor) return
    const range = findAnchorRange(targetEditor, tile)
    if (!range) return
    targetEditor
      .chain()
      .focus()
      .setTextSelection(range)
      .insertContent(newWord)
      .run()

    const newRange = { from: range.from, to: range.from + newWord.length }
    setTiles(prev =>
      prev.map(t =>
        t.id === tile.id
          ? { ...t, text: newWord, anchor: newWord, from: newRange.from, to: newRange.to }
          : t
      )
    )
  }

  return (
    <div className="sidebar-panel workbench-panel">
      {tiles.length > 0 && (
        <div className="panel-header panel-header-actions-only workbench-header">
          <button className="panel-action-btn" onClick={() => setTiles([])}>
            Clear All
          </button>
        </div>
      )}
      <div className="sidebar-list workbench-list">
        {visibleTiles.length === 0 && tiles.length > 0 ? (
          <div className="notes-empty">No matching workbench items.</div>
        ) : null}
        {visibleTiles.map(tile => {
          switch (tile.type) {
            case 'synonym':
              return (
                <SynonymTile
                  key={tile.id}
                  word={tile.text}
                  onReplace={(newWord) => replaceWord(tile, newWord)}
                  onSelect={() => selectTileWord(tile)}
                  onRemove={() => removeTile(tile.id)}
                />
              )
            case 'definition':
              return (
                <DefinitionTile
                  key={tile.id}
                  word={tile.text}
                  onRemove={() => removeTile(tile.id)}
                />
              )
            case 'rhyme':
              return (
                <RhymeTile
                  key={tile.id}
                  word={tile.text}
                  onReplace={(newWord) => replaceWord(tile, newWord)}
                  onSelect={() => selectTileWord(tile)}
                  onRemove={() => removeTile(tile.id)}
                />
              )
            default:
              return (
                <POSTile
                  key={tile.id}
                  sentence={tile.text}
                  onRemove={() => removeTile(tile.id)}
                />
              )
          }
        })}
      </div>
    </div>
  )
}
