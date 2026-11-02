/**
 * BubbleChip — one bubble: a word, a clause, a sentence, or a mark (a round one). The
 * selected one carries its actions in a capsule above it.
 */
import { motion } from 'framer-motion'
import { SPRINGS, toFramer } from '../../ui/physics.js'
import { isPunctuation, tokenize } from '../../lib/bubbleText'

export default function BubbleChip({
  word,
  where,
  shown = word.text,
  selected,
  lifted,
  joinTarget,
  dropped,
  editor,
  onPointerDown,
  onEdit,
  actions,
}) {
  const multiword = tokenize(word.text).length > 1
  const className = [
    'bubble',
    isPunctuation(word.text) ? 'is-punctuation' : '',
    where === 'aside' ? 'is-aside' : '',
    selected ? 'is-selected' : '',
    lifted ? 'is-lifted' : '',
    joinTarget ? `is-join-target ${joinTarget.before ? 'joins-before' : 'joins-after'}` : '',
    dropped ? 'is-dropped' : '',
    editor ? 'is-editing' : '',
  ].filter(Boolean).join(' ')
  const style = where === 'aside' ? { left: `${word.x * 100}%`, top: `${word.y * 100}%` } : undefined

  return (
    <motion.div
      layout={dropped ? false : 'position'}
      transition={toFramer(SPRINGS.smooth)}
      className={className}
      style={style}
      data-bubble-id={word.id}
      onPointerDown={onPointerDown}
      onDoubleClick={onEdit}
      role="button"
      tabIndex={-1}
      aria-pressed={selected}
    >
      {editor ?? <span className="bubble-text">{shown}</span>}
      {selected && !editor ? (
        <div className="bubble-actions floating-capsule" onPointerDown={(event) => event.stopPropagation()}>
          {multiword ? <button type="button" onClick={actions.split}>Split</button> : null}
          {where === 'aside'
            ? <button type="button" onClick={actions.returnToSentence}>Return</button>
            : <button type="button" onClick={actions.setAside}>Set aside</button>}
          <button type="button" onClick={onEdit}>Edit</button>
          <button type="button" className="is-destructive" onClick={actions.remove}>Delete</button>
        </div>
      ) : null}
    </motion.div>
  )
}
