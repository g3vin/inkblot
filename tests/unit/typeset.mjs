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

/* ---- a book's contents: its own order, reconciled with the folder ---- */

{
  const items = await import(`${C}/print/bookItems.ts`)
  const { bookRows } = await import(`${C}/print/bookRows.ts`)
  const matter = await import(`${C}/print/bookMatter.ts`)
  const tree = ['Novel/One', 'Novel/Two', 'Novel/Act II/Three', 'Novel/Act II/Four', 'Novel/Five']

  const fresh = items.reconcileBookItems({
    excluded: ['Novel/Two'],
    frontMatter: { halfTitle: true, dedication: 'For M.', contents: true },
    backMatter: { aboutTheAuthor: 'Lives by the sea.' },
  }, tree, 'Novel')
  const kinds = fresh.map((it) => it.generated || it.matter || (it.kind === 'part' ? `part:${it.title}` : it.path))
  ok('a book never typeset reads as its old front matter, the tree’s chapters with a part per subfolder, and its back matter',
    JSON.stringify(kinds) === JSON.stringify(['halfTitle', 'dedication', 'contents', 'Novel/One', 'Novel/Two', 'part:Act II', 'Novel/Act II/Three', 'Novel/Act II/Four', 'Novel/Five', 'aboutAuthor']))
  ok('a chapter left out is hidden, not gone', fresh.find((it) => it.path === 'Novel/Two').hidden)
  ok('its text matter is legacy until it is made a page', items.isLegacyMatter(fresh.find((it) => it.matter === 'dedication')))
  ok('the part after it runs to the end of the chapters: a book’s parts do not end',
    items.sectionsOf(fresh).body.at(-1).path === 'Novel/Five')

  const stored = [
    { id: 'd', kind: 'matter', matter: 'dedication', path: 'Novel/.book/dedication-d', hidden: false },
    { id: 'c:Novel/Five', kind: 'chapter', path: 'Novel/Five', hidden: false },
    { id: 'c:Novel/One', kind: 'chapter', path: 'Novel/One', hidden: false },
    { id: 'c:Novel/Gone', kind: 'chapter', path: 'Novel/Gone', hidden: false },
    { id: 'a', kind: 'matter', matter: 'aboutAuthor', path: 'Novel/.book/aboutAuthor-a', hidden: false },
  ]
  const now = items.reconcileBookItems({ items: stored }, ['Novel/One', 'Novel/New', 'Novel/Five', 'Novel/Newer'], 'Novel')
  ok('the book keeps its own order, whatever the tree’s', now.findIndex((it) => it.path === 'Novel/Five') < now.findIndex((it) => it.path === 'Novel/One'))
  ok('a chapter whose document has gone drops out', !now.some((it) => it.path === 'Novel/Gone'))
  ok('a new document goes in after the chapter before it in the tree',
    now.findIndex((it) => it.path === 'Novel/New') === now.findIndex((it) => it.path === 'Novel/One') + 1)
  ok('…and after that one, even when the book moved it',
    now.findIndex((it) => it.path === 'Novel/Newer') === now.findIndex((it) => it.path === 'Novel/Five') + 1)
  ok('front and back matter stay where they were', now[0].id === 'd' && now.at(-1).id === 'a')

  const copyright = { id: 'k', kind: 'matter', matter: 'copyright', hidden: false }
  const withCopyright = items.insertMatterItem(now, copyright)
  ok('a new copyright page goes before the dedication, where the standard order has it', withCopyright[0].id === 'k')
  const withContents = items.insertMatterItem(withCopyright, { id: 'g', kind: 'generated', generated: 'contents', hidden: false })
  ok('the contents after them both, before the chapters', withContents[2].id === 'g' && withContents[3].kind === 'chapter')
  const withAck = items.insertMatterItem(withContents, { id: 'ack', kind: 'matter', matter: 'acknowledgements', hidden: false })
  ok('acknowledgements before About the Author, at the back', withAck.at(-2).id === 'ack' && withAck.at(-1).id === 'a')
  const alsoByBack = items.insertMatterItem(withAck, { id: 'ab', kind: 'matter', matter: 'alsoBy', hidden: false }, 'back')
  ok('Also By can go either side: asked for at the back, it goes there', alsoByBack.at(-1).id === 'ab')
  ok('moving an entry moves only it', items.moveItem(withAck, 'a', 'k')[0].id === 'a' && items.moveItem(withAck, 'k', null).at(-1).id === 'k')

  const typed = [
    { id: 'p', kind: 'chapter', path: 'P', chapterType: 'prologue', hidden: false },
    { id: '1', kind: 'chapter', path: 'A', hidden: false },
    { id: 'x', kind: 'chapter', path: 'X', hidden: true },
    { id: '2', kind: 'chapter', path: 'B', hidden: false },
    { id: 'e', kind: 'chapter', path: 'E', chapterType: 'epilogue', hidden: false },
  ]
  const fromOne = items.chapterNumbers(typed, 1)
  ok('only chapters are numbered — not a prologue, an epilogue or a hidden chapter',
    fromOne.get('1') === 1 && fromOne.get('2') === 2 && !fromOne.has('p') && !fromOne.has('x') && !fromOne.has('e'))
  ok('and they can count from zero', items.chapterNumbers(typed, 0).get('1') === 0)

  const rows = bookRows([...fresh.slice(0, 3), ...typed, { id: 'pt', kind: 'part', title: 'Two', hidden: false }, { id: '3', kind: 'chapter', path: 'C', hidden: false }, fresh.at(-1)],
    { style: 'words', prefix: 'Chapter', startAt: 1 })
  const row = (id) => rows.find((r) => r.id === id)
  ok('a numbered chapter’s row says what its head will', row('1').label === 'Chapter One' && row('2').number === 2)
  ok('a prologue’s says Prologue', row('p').label === 'Prologue' && row('p').number === undefined)
  ok('a part is numbered as a part, and its chapters are in it', row('pt').label === 'Part One' && row('3').part === 'pt' && !row('1').part)
  ok('each row knows its side of the book',
    row(fresh[0].id).section === 'front' && row('1').section === 'body' && row(fresh.at(-1).id).section === 'back')
  ok('a dedication’s page sits down the page, on a recto, with no running head',
    row(fresh[1].id).page.position === 'sunk' && row(fresh[1].id).page.start === 'recto' && !row(fresh[1].id).page.runningHeads)

  const sections = [
    { item: fresh[1], path: '', name: 'Dedication', content: null },
    { item: typed[0], path: 'P', name: 'P', content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Before' }] }] } },
    { item: { id: 'pt', kind: 'part', title: 'The Crossing', hidden: false }, path: '', name: 'The Crossing', content: null },
    { item: typed[1], path: 'A', name: 'A', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] } },
    { item: fresh.at(-1), path: '', name: 'About the Author', content: null },
  ]
  const compiled = matter.compileSections(sections, {
    chapterNumbering: { style: 'numerals', prefix: 'Chapter', includeTitle: true, startAt: 0 },
    frontMatter: { dedication: 'For M.' },
    backMatter: { aboutTheAuthor: 'Lives by the sea.' },
  })
  const headText = (doc) => (doc.content[0].content || []).map((n) => n.text || ' / ').join('')
  ok('legacy matter is set from its old text', compiled[0].role === 'front' && compiled[0].content.content[0].content[0].text === 'For M.')
  ok('a prologue is headed "Prologue" over its own title', headText(compiled[1].content) === 'Prologue / Before' && compiled[1].role === 'body')
  ok('a part is a divider page, numbered as the chapters are', headText(compiled[2].content) === 'Part 1 / The Crossing')
  ok('the first chapter counted from zero is Chapter 0, titled by its name', headText(compiled[3].content) === 'Chapter 0 / A')
  ok('the back matter is the back', compiled[4].role === 'back' && headText(compiled[4].content) === 'About the Author')
}

/* ---- changing a book's contents, on disk ---- */

{
  const { saveDocument, loadDocument } = await import(`${C}/lib/FileSystem.js`)
  const contents = await import(`${C}/print/bookContents.js`)
  const store = await import(`${C}/print/printLayoutStore.js`)
  const { relocateBooks, booksSettled } = await import(`${C}/print/bookStore.js`)
  const { setInvokeHandler } = await import('./stub-core.mjs')
  setInvokeHandler(async () => null)
  const P = 'Typeset'
  const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  for (const name of ['One', 'Two', 'Three']) await saveDocument(P, `Novel/${name}`, { content: { type: 'doc', content: [para(name)] }, notes: [] })
  await booksSettled(P)
  store.setBookSettings(P, 'Novel', { ...store.getBookSettings(P, 'Novel'), frontMatter: { dedication: 'For M.' } })

  const before = await contents.currentBookItems(P, 'Novel')
  ok('a book on disk reads as its folder’s documents and its old dedication',
    before.map((it) => it.path || it.matter).join() === 'dedication,Novel/One,Novel/Two,Novel/Three')

  await contents.moveBookItem(P, 'Novel', 'c:Novel/Two', 'c:Novel/One')
  const moved = store.getBookSettings(P, 'Novel').items
  ok('moving a chapter stores the book’s order', moved.filter((it) => it.kind === 'chapter').map((it) => it.path).join() === 'Novel/Two,Novel/One,Novel/Three')
  const dedication = moved.find((it) => it.matter === 'dedication')
  ok('and the first change makes the old dedication a document of the book’s own',
    dedication.path?.startsWith('Novel/.book/dedication-') && (await loadDocument(P, dedication.path))?.content?.content?.[0]?.content?.[0]?.text === 'For M.')

  await contents.setBookItemHidden(P, 'Novel', 'c:Novel/Three', true)
  ok('hiding a chapter hides it', store.getBookSettings(P, 'Novel').items.find((it) => it.path === 'Novel/Three').hidden)

  const about = await contents.addBookItem(P, 'Novel', { matter: 'aboutAuthor' })
  const saved = await loadDocument(P, about.path)
  ok('About the Author is added at the back, as a document made from its template',
    store.getBookSettings(P, 'Novel').items.at(-1).id === about.id && saved?.content?.content?.[0]?.type === 'heading')
  const contentsPage = await contents.addBookItem(P, 'Novel', { generated: 'contents' })
  const again = await contents.addBookItem(P, 'Novel', { generated: 'contents' })
  ok('a generated page is one of a kind', again.id === contentsPage.id &&
    store.getBookSettings(P, 'Novel').items.filter((it) => it.generated === 'contents').length === 1)
  const part = await contents.addBookItem(P, 'Novel', { part: true, title: 'Beginnings', before: 'c:Novel/One' })
  const order = store.getBookSettings(P, 'Novel').items.map((it) => it.id)
  ok('a part goes before the entry it was dropped on', order.indexOf(part.id) === order.indexOf('c:Novel/One') - 1)

  await contents.editBookItem(P, 'Novel', { id: 'c:Novel/Two', chapterType: 'prologue', title: '  ' })
  await contents.editBookItem(P, 'Novel', { id: part.id, title: 'The Beginning' })
  const edited = store.getBookSettings(P, 'Novel').items
  ok('a chapter can be made a prologue, and a part renamed',
    edited.find((it) => it.id === 'c:Novel/Two').chapterType === 'prologue' && edited.find((it) => it.id === part.id).title === 'The Beginning')
  await contents.editBookItem(P, 'Novel', { id: 'c:Novel/Two', chapterType: 'chapter' })
  ok('and a chapter again', !store.getBookSettings(P, 'Novel').items.find((it) => it.id === 'c:Novel/Two').chapterType)

  await contents.removeBookItem(P, 'Novel', about.id)
  ok('removing a matter page takes its document with it',
    !store.getBookSettings(P, 'Novel').items.some((it) => it.id === about.id) && !(await loadDocument(P, about.path)))
  await contents.removeBookItem(P, 'Novel', 'c:Novel/One')
  ok('a chapter cannot be removed from the book, only hidden', store.getBookSettings(P, 'Novel').items.some((it) => it.id === 'c:Novel/One'))

  await relocateBooks(P, 'Novel', 'Book', { folder: true })
  const relocated = store.getBookSettings(P, 'Book').items
  ok('renaming the folder takes the book, its chapters’ and its pages’ paths with it',
    relocated.some((it) => it.path === 'Book/One') && relocated.find((it) => it.matter === 'dedication').path.startsWith('Book/.book/'))

  const { bookFolderFor } = await import(`${C}/print/compile.ts`)
  ok('a page of the book’s own belongs to the book’s folder',
    bookFolderFor('Book/.book/dedication-x', 'folder') === 'Book' && bookFolderFor('.book/copyright-y', 'folder') === '' && bookFolderFor('Book/One', 'folder') === 'Book')
}
