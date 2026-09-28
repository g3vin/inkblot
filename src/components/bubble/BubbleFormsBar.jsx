/**
 * BubbleFormsBar — the forms, at the bottom: a dot for each page — every saved form,
 * and a ring for the unsaved arrangement — which one is showing, and saving or
 * deleting it. While a swipe is armed to turn, the dot it would land on lights.
 */
import { currentForm, formPage, formPages } from '../../lib/bubbleForms'

const TrashGlyph = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path
      d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
)

export default function BubbleFormsBar({ state, armed = 0, onShow, onSave, onDelete }) {
  const pages = formPages(state)
  const page = formPage(state)
  const current = currentForm(state)
  const saved = current !== -1
  const label = saved ? `Form ${current + 1} of ${state.forms.length}` : 'Unsaved'
  const target = armed ? page + armed : -1

  return (
    <div className="bubble-forms floating-capsule" onPointerDown={(event) => event.stopPropagation()}>
      {state.forms.length ? (
        <>
          <div className="bubble-forms-dots" role="tablist" aria-label="Forms">
            {Array.from({ length: pages }, (_, index) => {
              const unsaved = index === state.forms.length
              const name = unsaved ? 'Unsaved' : `Form ${index + 1}`
              return (
                <button
                  key={unsaved ? 'unsaved' : state.forms[index].id}
                  type="button"
                  role="tab"
                  aria-selected={index === page}
                  aria-label={name}
                  title={`${name} — swipe sideways with two fingers, or ⌘[ ⌘], to move between forms`}
                  className={`bubble-forms-dot${index === page ? ' is-current' : ''}${unsaved ? ' is-unsaved' : ''}${index === target ? ' is-armed' : ''}`}
                  onClick={() => onShow(index)}
                />
              )
            })}
          </div>
          <span className="bubble-forms-label">{label}</span>
        </>
      ) : null}
      {saved ? (
        <button type="button" className="bubble-forms-icon is-destructive" onClick={onDelete} title="Delete this form (⌘⌫). The bubbles stay as they are." aria-label="Delete Form">
          <TrashGlyph />
        </button>
      ) : (
        <button type="button" className="bubble-forms-icon" onClick={onSave} title="Save this arrangement as a new form to come back to (⌘S)" aria-label="Save as New Form">
          {/* A stack of versions, with one more being added. */}
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="9.5" width="13" height="11" rx="2.5" />
              <path d="M6 6.5h7.5M18.5 11.5v5" />
              <path d="M19.5 3v6M16.5 6h6" />
            </g>
          </svg>
        </button>
      )}
    </div>
  )
}

export { TrashGlyph }
