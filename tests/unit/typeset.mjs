/**
 * Typesetting: how a book's chapters open, its contents and covers, and what an old
 * book reads as the first time it is typeset. Pure functions over book settings; the
 * pages they lay out are the `print` and layout suites'.
 */
const C = '../../src'
const design = await import(`${C}/print/chapterDesign.ts`)

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

/* ---- chapter designs: an old book's, derived ---- */

{
  const plain = design.designFor({ chapterNumbering: { style: 'none', includeTitle: true } })
  ok('a book that never numbered its chapters opens each with its title alone',
    !plain.showNumber && plain.showTitle && plain.chapterBreak === 'newPage')
  const numbered = design.designFor({ chapterNumbering: { style: 'words', includeTitle: false } }, { chapterStartsOnRecto: true })
  ok('one numbered without titles shows the number alone, on a right-hand page',
    numbered.showNumber && !numbered.showTitle && numbered.chapterBreak === 'newRightPage')
  const kept = design.designFor({ chapterNumbering: { style: 'numerals', includeTitle: true } })
  ok('one numbered with titles keeps both', kept.showNumber && kept.showTitle)
  const own = design.designFor({ chapterDesign: { showNumber: true, imageWidthPct: 400 }, chapterNumbering: { style: 'none' } })
  ok('a book with a design of its own keeps it, whatever its numbering says', own.showNumber)
  ok('and a stored design is filled in and kept in range', own.showSubtitle && own.imageWidthPct === 100 && own.alignment === 'center')
}

/* ---- covers: versions, and the one image a book had before them ---- */

{
  const old = design.coversOf({ coverImage: '.assets/cover.jpg' })
  ok('a book with one cover image has one version, "Cover", with it as the front',
    old.covers.length === 1 && old.covers[0].front === '.assets/cover.jpg' && old.activeCover === 'cover')
  ok('a book with no cover has no versions', design.coversOf({}).covers.length === 0 && !design.coversOf({}).activeCover)

  const two = {
    covers: [{ id: 'a', name: 'First', front: 'a.jpg' }, { id: 'b', name: 'Second', front: 'b.jpg', back: 'bb.jpg' }],
    activeCover: 'b',
    coverImage: 'stale.jpg',
  }
  ok('the active version is the one named', design.activeCoverOf(two)?.front === 'b.jpg')
  ok('an active version that has gone falls back to the first', design.activeCoverOf({ ...two, activeCover: 'gone' })?.id === 'a')

  const set = design.withCoverPart(two, 'spine', 'spine.jpg')
  ok('setting a part sets it on the active version only',
    set.covers[1].spine === 'spine.jpg' && !set.covers[0].spine && set.coverImage === 'b.jpg')
  const cleared = design.withCoverPart(two, 'front', null)
  ok('clearing the front clears the book’s cover image with it', !cleared.covers[1].front && !('coverImage' in cleared))
  const first = design.withCoverPart({}, 'front', 'new.jpg')
  ok('a front for a book with no cover makes its first version',
    first.covers.length === 1 && first.activeCover === 'cover' && first.coverImage === 'new.jpg')
  ok('clearing a part of a book with no cover changes nothing', design.withCoverPart({ title: 'X' }, 'back', null).title === 'X')
  const other = design.withCoverPart(two, 'back', 'x.jpg', 'a')
  ok('a part can be set on a version that is not active', other.covers[0].back === 'x.jpg' && other.activeCover === 'b')
}

/* ---- Typeset mode: the prose is locked, and typesetting is let through ---- */

{
  const { JSDOM } = await import('jsdom')
  const { installGlobals } = await import('./install-globals.mjs')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  installGlobals(dom.window, ['document', 'navigator', 'DOMParser', 'Node', 'Element', 'HTMLElement'])
  if (!globalThis.window) Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true })
  const { Editor } = await import('@tiptap/core')
  const { StarterKit } = await import('@tiptap/starter-kit')
  const lock = await import(`${C}/print/TypesetLock.ts`)
  const { DocPageSetup } = await import(`${C}/print/DocPageSetup.js`)

  const editor = new Editor({
    extensions: [StarterKit, DocPageSetup, lock.TypesetLock],
    content: '<h1>The Road</h1><p>She walked on.</p><p>The end.</p>',
  })
  const text = () => editor.getText()
  const before = text()
  editor.storage.typesetLock.locked = true

  editor.commands.insertContentAt(18, 'slowly ')
  ok('typing in the prose of a locked chapter is refused', text() === before)
  editor.chain().setTextSelection({ from: 12, to: 20 }).toggleBold().run()
  ok('and so is formatting it', !editor.getHTML().includes('<strong>'))
  editor.commands.insertContentAt(5, 'Long ')
  ok('the chapter’s title is typed in place', editor.state.doc.firstChild.textContent === 'The Long Road')
  const paragraphAt = editor.state.doc.firstChild.nodeSize
  const tr = editor.state.tr.setNodeAttribute(paragraphAt, 'level', 1)
  ok('a node’s attributes change — the kind of edit typesetting makes', lock.allowedWhileLocked(tr))
  const marked = editor.state.tr.insertText('x', 20).setMeta(lock.TYPESET_META, true)
  ok('anything marked as typesetting is let through', lock.allowedWhileLocked(marked))
  editor.commands.setContent('<p>A restored version.</p>')
  ok('a whole document replaced — a version restored, a load — is let through', text() === 'A restored version.')

  editor.storage.typesetLock.locked = false
  editor.commands.insertContentAt(1, 'Now ')
  ok('unlocked — in Write — the prose is written as ever', text().startsWith('Now A restored'))

  ok('a matter document is a page of the book’s own, in its folder’s .book/',
    lock.isMatterPath('Novel/.book/dedication-d1') && lock.isMatterPath('.book/copyright-c') && !lock.isMatterPath('Novel/One') && !lock.isMatterPath('Novel/.bookish'))
  editor.destroy()
}
