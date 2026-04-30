import SFIcon from '../SFIcon'
import POSTile from '../POSTile.jsx'
import SynonymTile from '../SynonymTile.jsx'
import DefinitionTile from '../DefinitionTile.jsx'
import RhymeTile from '../RhymeTile.jsx'

export default function Workbench({
  tiles,
  setTiles,
  editor,
  secondaryEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
}) {
  const removeTile = id => setTiles(prev => prev.filter(t => t.id !== id))

  const getEditorForTile = (tile) => {
    if (!tile?.doc) return editor
    if (tile.doc === secondaryDoc) return secondaryEditor || editor
    if (tile.doc === currentDoc) return editor
    if (tile.doc === activeDoc) {
      if (tile.doc === secondaryDoc) return secondaryEditor || editor
      return editor
    }
    return editor
  }

  const findAnchorRange = (targetEditor, tile) => {
    if (!targetEditor || !tile) return null

    if (typeof tile.from === 'number' && typeof tile.to === 'number') {
      const currentText = targetEditor.state.doc.textBetween(tile.from, tile.to, ' ')
      if (currentText) {
        return { from: tile.from, to: tile.to }
      }
    }

    const needle = tile.anchor || tile.text
    if (!needle) return null

    let found = null
    targetEditor.state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const idx = node.text.indexOf(needle)
      if (idx !== -1) {
        found = { from: pos + idx, to: pos + idx + needle.length }
        return false
      }
    })

    return found
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
      <div className="panel-header workbench-header">
        <div className="panel-header-title">
          <SFIcon name="hammer" />
          <span className="panel-header-label">Workbench</span>
        </div>
        {tiles.length > 0 && (
          <button className="panel-action-btn" onClick={() => setTiles([])}>
            Clear All
          </button>
        )}
      </div>
      <div className="sidebar-list workbench-list">
        {tiles.map(tile => {
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
