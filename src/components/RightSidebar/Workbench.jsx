/**
 * Workbench.jsx — the Workbench tab of the right sidebar.
 *
 * Renders the language-tool tiles (part-of-speech, synonyms, definition,
 * rhymes) created from the editor context menu. Tiles remember the text
 * range they were created from so replacements land back in the document.
 */
import { editorForTile, replaceTileWord, selectTileWord as selectWord } from '../../lib/workbenchActions'
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

  const panes = { editor, secondaryEditor, secondaryDoc }

  const selectTileWord = (tile) => {
    selectWord(editorForTile(tile, panes), tile)
  }

  // Replace the tile's word in the document and retarget the tile to the new text.
  const replaceWord = (tile, newWord) => {
    const updated = replaceTileWord(editorForTile(tile, panes), tile, newWord)
    if (!updated) return
    setTiles(prev => prev.map(t => (t.id === tile.id ? updated : t)))
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
