import POSTile from '../POSTile.jsx'
import SynonymTile from '../SynonymTile.jsx'
import DefinitionTile from '../DefinitionTile.jsx'
import RhymeTile from '../RhymeTile.jsx' // ✅ NEW import

export default function Workbench({ tiles, setTiles }) {
  const removeTile = id => setTiles(prev => prev.filter(t => t.id !== id))

  const replaceWord = newWord => {
    // optional: handle replace logic globally if you want word replacement in editor
    console.log('Replace selected word with:', newWord)
  }

  return (
    <>
      <div className="panel-header">
        <span>WORKBENCH</span>
        {tiles.length > 0 && (
          <button className="clear-btn" onClick={() => setTiles([])}>
            Clear All
          </button>
        )}
      </div>

      {tiles.map(tile => {
        switch (tile.type) {
          case 'synonym':
            return (
              <SynonymTile
                key={tile.id}
                word={tile.text}
                onReplace={replaceWord}
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
          case 'rhyme': // ✅ NEW tile type
            return (
              <RhymeTile
                key={tile.id}
                word={tile.text}
                onReplace={replaceWord}
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
    </>
  )
}