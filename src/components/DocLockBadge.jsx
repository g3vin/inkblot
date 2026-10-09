/**
 * DocLockBadge — a pane's sign that its document is locked (docLocks.ts), with the way
 * to unlock it. The tab and the file tree mark a locked document too, but the tab bar
 * hides with a single tab, so the pane says it as well.
 *
 * An edit the pane refused (`LOCKED_EDIT_EVENT`) lights the badge for a moment, so a
 * keystroke that did nothing says why.
 */
import { useEffect, useState } from 'react'
import { Button, FloatingCapsule, Icon } from '../ui'
import { LOCKED_EDIT_EVENT, describeLock, setDocumentLocked, useLockReason } from '../lib/docLocks'
import './DocLockBadge.css'

const NUDGE_MS = 1200

export default function DocLockBadge({ projectName, docPath, className = '' }) {
  const reason = useLockReason(docPath)
  const [nudged, setNudged] = useState(false)

  useEffect(() => {
    if (!reason) return undefined
    let timer = null
    const onRefused = (event) => {
      if (event.detail?.docPath !== docPath) return
      setNudged(true)
      clearTimeout(timer)
      timer = setTimeout(() => setNudged(false), NUDGE_MS)
    }
    window.addEventListener(LOCKED_EDIT_EVENT, onRefused)
    return () => {
      window.removeEventListener(LOCKED_EDIT_EVENT, onRefused)
      clearTimeout(timer)
    }
  }, [docPath, reason])

  if (!reason) return null
  return (
    <FloatingCapsule
      className={`doc-lock-badge ${className}`.trim()}
      role="status"
      data-nudged={nudged}
      title={reason.by === 'folder' ? 'Unlock the folder to edit this document' : 'This document is read-only'}
    >
      <Icon name="lock" />
      <span>{describeLock(reason)}</span>
      {reason.by === 'document' ? (
        <Button className="doc-lock-unlock" onClick={() => setDocumentLocked(projectName, docPath, false)}>
          Unlock
        </Button>
      ) : null}
    </FloatingCapsule>
  )
}
