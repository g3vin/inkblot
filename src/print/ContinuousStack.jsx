/**
 * ContinuousStack.jsx — a folder read as one document, in Write.
 *
 * With a folder's book set to read continuously, the document open is written in as
 * ever, and the folder's other documents stand above and below it, in the order the file
 * tree has them (less what the book hides), each under a slim divider with its name —
 * and its number, where the tree numbers them — so the writer scrolls from the end of one
 * chapter into the next. The neighbours are drawn, not live: clicking into one opens it
 * in the pane, the caret where the click was, and the one left becomes drawn in its
 * place; the arrow keys cross from the end of one into the next, and back.
 *
 * A neighbour's text is read when it scrolls near, and the one just left is drawn from
 * what it held when it was left, so a save still on its way never shows old text.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { generateHTML } from '@tiptap/core'

import { loadDocument } from '../lib/FileSystem'
import { getDocPreviewExtensions } from '../lib/editorExtensions'
import { isTextDoc } from '../lib/docKind'

const baseName = (path) => (path || '').split('/').filter(Boolean).pop() || ''

/** A neighbour: its divider, and its text once it has been read. */
function Neighbour({ path, number, html, onVisible, onOpen }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || html != null) return undefined
    // With nothing to say when it scrolls near, it is read now.
    if (typeof IntersectionObserver === 'undefined') {
      onVisible(path)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onVisible(path)
    }, { rootMargin: '800px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [html, onVisible, path])
  return (
    <section ref={ref} className="continuous-doc" data-path={path} onClick={(event) => onOpen(path, event)}>
      <Divider name={baseName(path)} number={number} />
      {html == null
        ? <div className="continuous-placeholder" />
        : <div className="editor"><div className="ProseMirror continuous-text" dangerouslySetInnerHTML={{ __html: html }} /></div>}
    </section>
  )
}

function Divider({ name, number }) {
  return (
    <div className="continuous-divider" aria-hidden="true">
      {number != null ? <span className="continuous-number">{number}</span> : null}
      <span className="continuous-name">{name}</span>
    </div>
  )
}

export default function ContinuousStack({ projectName, docPath, editor, placement, scrollEl, onOpenDoc, children }) {
  const [htmls, setHtmls] = useState({})
  const pendingRef = useRef(null)
  const liveRef = useRef(null)
  const lastLive = useRef({ path: null, doc: null })

  // The folder's documents, in tree order, less what the book hides.
  const sequence = useMemo(() => {
    const hidden = new Set(placement.items.filter((it) => it.hidden).map((it) => it.path))
    for (const path of placement.book.excluded || []) hidden.add(path)
    return (placement.chapters || []).filter((path) => isTextDoc(path) && (!hidden.has(path) || path === docPath))
  }, [docPath, placement])

  // Numbers as the tree shows them, where it does.
  const numbers = useMemo(() => {
    const numbering = placement.book.chapterNumbering || {}
    if (!numbering.showInTree) return {}
    const skip = new Set(placement.items.filter((it) => it.chapterType && it.chapterType !== 'chapter').map((it) => it.path))
    const out = {}
    let n = numbering.startAt === 0 ? 0 : 1
    for (const path of sequence) {
      if (skip.has(path)) continue
      out[path] = n
      n += 1
    }
    return out
  }, [placement, sequence])

  const { before, after } = useMemo(() => {
    const index = sequence.indexOf(docPath)
    return { before: index > 0 ? sequence.slice(0, index) : [], after: index >= 0 ? sequence.slice(index + 1) : [] }
  }, [docPath, sequence])

  // What the live document holds, kept to draw it with when it is left.
  useEffect(() => {
    if (!editor) return undefined
    const keep = () => { lastLive.current = { path: docPath, doc: editor.state.doc } }
    keep()
    editor.on('update', keep)
    return () => editor.off('update', keep)
  }, [docPath, editor])

  const render = useCallback((content) => {
    try {
      return generateHTML(content, getDocPreviewExtensions())
    } catch {
      return ''
    }
  }, [])

  // The document just left is drawn from what it held; the rest as they come near.
  useEffect(() => {
    const left = lastLive.current
    if (left.path && left.path !== docPath && left.doc) {
      setHtmls((h) => ({ ...h, [left.path]: render(left.doc.toJSON()) }))
    }
  }, [docPath, render])

  const read = useCallback((path) => {
    setHtmls((h) => (path in h ? h : { ...h, [path]: undefined }))
    loadDocument(projectName, path)
      .then((saved) => setHtmls((h) => (h[path] ? h : { ...h, [path]: render(saved?.content || { type: 'doc', content: [] }) })))
      .catch(() => setHtmls((h) => ({ ...h, [path]: '' })))
  }, [projectName, render])

  /** Open a neighbour where it was clicked: the caret goes where the click was. */
  const open = useCallback((path, event) => {
    if (!path || path === docPath) return
    const section = event?.currentTarget
    pendingRef.current = {
      caret: event ? { left: event.clientX, top: event.clientY } : null,
      edge: null,
      anchorTop: section ? section.getBoundingClientRect().top : null,
      fromDoc: editor?.state.doc,
    }
    onOpenDoc?.(path)
  }, [docPath, editor, onOpenDoc])

  // Arriving in a neighbour: once the editor holds it (it is loaded a moment after the
  // pane switches), held where it was on screen, and the caret put in.
  useLayoutEffect(() => {
    const pending = pendingRef.current
    if (!pending || !editor) return undefined
    let frame = 0
    let tries = 0
    const settle = () => {
      if (editor.isDestroyed) return
      if (editor.state.doc === pending.fromDoc && tries < 90) {
        tries += 1
        frame = requestAnimationFrame(settle)
        return
      }
      pendingRef.current = null
      const live = liveRef.current
      if (live && scrollEl && pending.anchorTop != null) {
        scrollEl.scrollTop += live.getBoundingClientRect().top - pending.anchorTop
      }
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        if (pending.edge === 'start') editor.chain().focus('start').scrollIntoView().run()
        else if (pending.edge === 'end') editor.chain().focus('end').scrollIntoView().run()
        else if (pending.caret) {
          const at = editor.view.posAtCoords(pending.caret)
          editor.chain().focus().setTextSelection(at?.pos ?? 1).run()
        }
      })
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [docPath, editor, scrollEl])

  // The arrow keys cross from the end of one document into the next, and back.
  useEffect(() => {
    if (!editor) return undefined
    const dom = editor.view.dom
    const onKey = (event) => {
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
      const { selection, doc } = editor.state
      if (!selection.empty) return
      const atEnd = (event.key === 'ArrowDown' || event.key === 'ArrowRight') && editor.view.endOfTextblock(event.key === 'ArrowDown' ? 'down' : 'right') && selection.$head.pos >= doc.content.size - 1
      const atStart = (event.key === 'ArrowUp' || event.key === 'ArrowLeft') && editor.view.endOfTextblock(event.key === 'ArrowUp' ? 'up' : 'left') && selection.$head.pos <= 1
      const next = atEnd ? after[0] : atStart ? before[before.length - 1] : null
      if (!next) return
      event.preventDefault()
      pendingRef.current = { edge: atEnd ? 'start' : 'end', caret: null, anchorTop: null, fromDoc: editor.state.doc }
      onOpenDoc?.(next)
    }
    dom.addEventListener('keydown', onKey)
    return () => dom.removeEventListener('keydown', onKey)
  }, [after, before, editor, onOpenDoc])

  return (
    <div className="continuous-stack">
      {before.map((path) => (
        <Neighbour key={path} path={path} number={numbers[path]} html={htmls[path]} onVisible={read} onOpen={open} />
      ))}
      <div ref={liveRef} className="continuous-live">
        <Divider name={baseName(docPath)} number={numbers[docPath]} />
        {children}
      </div>
      {after.map((path) => (
        <Neighbour key={path} path={path} number={numbers[path]} html={htmls[path]} onVisible={read} onOpen={open} />
      ))}
    </div>
  )
}
