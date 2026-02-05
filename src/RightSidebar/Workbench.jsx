import POSTile from '../POSTile.jsx'
import SynonymTile from '../SynonymTile.jsx'
import DefinitionTile from '../DefinitionTile.jsx'

export default function Workbench({ tiles, setTiles }) {
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
        if (tile.type === 'synonym')
          return <SynonymTile key={tile.id} word={tile.text} />
        if (tile.type === 'definition')
          return <DefinitionTile key={tile.id} word={tile.text} />
        return <POSTile key={tile.id} sentence={tile.text} />
      })}
    </>
  )
}