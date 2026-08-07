import React, { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDownToDot,
  IconArrowUpFromDot,
  IconBookOpen,
  IconBold,
  IconCheck,
  IconChevronLeft,
  IconClipboardList,
  IconClock,
  IconCopy,
  IconEdit,
  IconFile,
  IconFilter,
  IconFolder,
  IconGitPullRequest,
  IconHammer,
  IconList,
  IconListBullets,
  IconMap,
  IconMapPin,
  IconMenuDots,
  IconMic,
  IconMinus,
  IconPalette,
  IconNotebookPen,
  IconNotebookText,
  IconPin,
  IconPinOff,
  IconPlus,
  IconSearch,
  IconSpeech,
  IconTableGrid,
  IconTrash,
  IconUnderline,
  IconUserRound,
  IconUsers,
  IconX,
} from './anicon'

const ICON_HOVER_TRIGGER_SELECTOR = [
  'button',
  '[role="button"]',
  '.file-item',
  '.tile',
  '.sidebar-card',
  '.note-tile',
  '.panel-header-title',
  '.file-tree-create-option',
  '.sidebar-search-field',
].join(', ')

const renderIcon = (name, filled, props) => {
  const normalizedName = name.replace(/\.fill$/, '')

  switch (normalizedName) {
    case 'pin':
      return filled ? <IconPin {...props} /> : <IconPinOff {...props} />
    case 'bold':
      return <IconBold {...props} />
    case 'italic':
      return <IconEdit {...props} />
    case 'underline':
      return <IconUnderline {...props} />
    case 'strikethrough':
      return <IconMinus {...props} />
    case 'text.alignleft':
      return <IconAlignLeft {...props} />
    case 'text.aligncenter':
      return <IconAlignCenter {...props} />
    case 'text.alignright':
      return <IconAlignRight {...props} />
    case 'tablecells':
    case 'table.grid':
    case 'tablecells.badge.ellipsis':
      return <IconTableGrid {...props} />
    case 'doc.text':
      return <IconNotebookPen {...props} />
    case 'doc':
      return <IconFile {...props} />
    case 'doc.characters':
      return <IconUserRound {...props} />
    case 'doc.settings':
      return <IconMapPin {...props} />
    case 'doc.outline':
      return <IconListBullets {...props} />
    case 'doc.novel':
      return <IconNotebookText {...props} />
    case 'paintpalette':
      return <IconPalette {...props} />
    case 'plus':
      return <IconPlus {...props} />
    case 'magnifyingglass':
    case 'magnifyingglass.circle':
      return <IconSearch {...props} />
    case 'doc.on.clipboard':
      return <IconClipboardList {...props} />
    case 'hammer':
      return <IconHammer {...props} />
    case 'clock':
      return <IconClock {...props} />
    case 'chevron.left':
      return <IconChevronLeft {...props} />
    case 'folder':
      return <IconFolder {...props} />
    case 'folder.characters':
      return <IconUsers {...props} />
    case 'folder.settings':
      return <IconMap {...props} />
    case 'folder.outline':
      return <IconList {...props} />
    case 'folder.novel':
      return <IconBookOpen {...props} />
    case 'arrow.down.to.dot':
      return <IconArrowDownToDot {...props} />
    case 'arrow.up.from.dot':
      return <IconArrowUpFromDot {...props} />
    case 'arrow.triangle.pull':
    case 'git.pullrequest':
      return <IconGitPullRequest {...props} />
    case 'line.3.horizontal.decrease.circle':
      return <IconFilter {...props} />
    case 'checkmark':
      return <IconCheck {...props} />
    case 'doc.on.doc':
      return <IconCopy {...props} />
    case 'trash':
      return <IconTrash {...props} />
    case 'ellipsis':
    case 'ellipsis.circle':
      return <IconMenuDots {...props} />
    case 'mic':
    case 'mic.fill':
      return <IconMic {...props} />
    case 'speech':
    case 'speech.fill':
      return <IconSpeech {...props} />
    case 'xmark':
      return <IconX {...props} />
    default:
      return <IconSearch {...props} />
  }
}

export default function SFIcon({
  name,
  filled = false,
  className = '',
  title,
  size = 16,
  strokeWidth = 1.1,
  forceAnimate = false,
}) {
  const prefersReducedMotion = useReducedMotion()
  const wrapperRef = useRef(null)
  const [ancestorHovered, setAncestorHovered] = useState(false)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const trigger = wrapper?.parentElement?.closest(ICON_HOVER_TRIGGER_SELECTOR)

    if (!wrapper || !trigger) return undefined

    const activate = () => setAncestorHovered(true)
    const deactivate = () => setAncestorHovered(false)
    const deactivateIfFocusLeft = () => {
      if (trigger.contains(document.activeElement)) return
      setAncestorHovered(false)
    }

    trigger.addEventListener('pointerenter', activate)
    trigger.addEventListener('pointerleave', deactivate)
    trigger.addEventListener('focusin', activate)
    trigger.addEventListener('focusout', deactivateIfFocusLeft)

    const initialStateFrame = window.requestAnimationFrame(() => {
      setAncestorHovered(trigger.matches(':hover') || trigger.contains(document.activeElement))
    })

    return () => {
      window.cancelAnimationFrame(initialStateFrame)
      trigger.removeEventListener('pointerenter', activate)
      trigger.removeEventListener('pointerleave', deactivate)
      trigger.removeEventListener('focusin', activate)
      trigger.removeEventListener('focusout', deactivateIfFocusLeft)
    }
  }, [])

  const iconProps = {
    className: className || undefined,
    size,
    strokeWidth,
    'aria-hidden': 'true',
    focusable: 'false',
    ...(!prefersReducedMotion ? { animate: ancestorHovered || forceAnimate ? 'hover' : 'rest' } : {}),
  }

  return (
    <span ref={wrapperRef} className="sf-icon" aria-hidden="true" title={title}>
      {renderIcon(name, filled, iconProps)}
    </span>
  )
}
