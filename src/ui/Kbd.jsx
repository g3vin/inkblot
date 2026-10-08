/** Kbd.jsx — a keyboard shortcut hint, set in the typewriter face. */
import './Kbd.css'

export default function Kbd({ children, className }) {
  return <kbd className={['ib-kbd', className].filter(Boolean).join(' ')}>{children}</kbd>
}
