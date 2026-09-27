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

/* ---- chapter heads, as the book designs them ---- */

{
  const matter = await import(`${C}/print/bookMatter.ts`)
  const { DEFAULT_CHAPTER_DESIGN } = await import(`${C}/print/chapterDesign.ts`)
  const { chapterHeadSpec, chapterHeadText } = await import(`${C}/print/ChapterHead.js`)
  const portable = await import(`${C}/print/export/portable.ts`)
  const { runOn } = await import(`${C}/print/printJob.js`)
  const { BOOK_STYLES, applyBookStyle, bookStyle } = await import(`${C}/print/bookStyles.ts`)
  const { normalizeChapterMeta } = await import(`${C}/print/DocChapterMeta.js`)
  const { generateHTML, Editor } = await import('@tiptap/core')
  const { getDocPreviewExtensions } = await import(`${C}/lib/editorExtensions.js`)
  const { normalizePageSetup } = await import(`${C}/print/pageSetup.ts`)

  const h1 = (text) => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] })
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const design = { ...DEFAULT_CHAPTER_DESIGN, showNumber: true, ornament: 'glyph', ornamentGlyph: '❦', ornamentPosition: 'below' }
  const chapter = {
    type: 'doc',
    attrs: { chapter: { subtitle: 'In which it rains', image: '.assets/storm.png', epigraph: 'Rain.', epigraphSource: 'A Poet' } },
    content: [h1('The Storm'), p('It rained.')],
  }

  const headed = matter.headWithDesign(chapter, 'storm', 'Chapter One', design)
  const head = headed.content[0].attrs.head
  ok('a chapter opens with its head: number, title from its Heading 1, and its own subtitle, picture and epigraph',
    headed.content[0].type === 'chapterHead' && head.label === 'Chapter One' && head.title === 'The Storm' &&
    head.subtitle === 'In which it rains' && head.image === '.assets/storm.png' && head.epigraphSource === 'A Poet')
  ok('…in place of the Heading 1, the text after it untouched', headed.content.length === 2 && headed.content[1].content[0].text === 'It rained.')
  const quiet = matter.headWithDesign(chapter, 'storm', 'Chapter One', { ...design, showNumber: false, showSubtitle: false, showImage: false })
  ok('what the design leaves out, the head does not show',
    !quiet.content[0].attrs.head.label && !quiet.content[0].attrs.head.subtitle && !quiet.content[0].attrs.head.image && quiet.content[0].attrs.head.title === 'The Storm')
  ok('a chapter with no Heading 1 is titled by its document’s name',
    matter.headWithDesign({ type: 'doc', content: [p('x')] }, 'Rainfall', null, design).content[0].attrs.head.title === 'Rainfall')

  const spec = JSON.stringify(chapterHeadSpec(head))
  ok('the head renders number, title, subtitle, the ornament below the title, and the epigraph, in that order',
    spec.indexOf('ch-number') < spec.indexOf('ch-title') && spec.indexOf('ch-title') < spec.indexOf('ch-subtitle') &&
    spec.indexOf('ch-subtitle') < spec.indexOf('is-glyph') && spec.indexOf('is-glyph') < spec.indexOf('ch-epigraph'))
  ok('its running head and contents entry read "Chapter One: The Storm"', chapterHeadText(head) === 'Chapter One: The Storm' &&
    matter.chapterTitleOf(headed, 'x') === 'Chapter One: The Storm')
  const html = generateHTML(headed, getDocPreviewExtensions())
  ok('generateHTML draws it — as the HTML and EPUB exports do', html.includes('class="chapter-head"') && html.includes('<h1 class="ch-title">The Storm</h1>') && html.includes('❦'))

  ok('a head’s pictures are among the document’s, for an export to package', JSON.stringify(portable.collectImageSources(headed)) === '[".assets/storm.png"]')
  const mapped = portable.mapImageSources(headed, (src) => `images/${src.split('/').pop()}`)
  ok('…and rewritten with the rest', mapped.content[0].attrs.head.image === 'images/storm.png')
  const blocks = portable.headsToBlocks(headed)
  ok('for Markdown, text and Word the head is a heading and blocks: number and title, subtitle, picture, epigraph',
    blocks.content.some((n) => n.type === 'heading' && n.content.map((c) => c.text || '/').join('') === 'Chapter One/The Storm') &&
    blocks.content.some((n) => n.content?.[0]?.text === 'In which it rains') &&
    blocks.content.some((n) => n.content?.[0]?.type === 'image') && blocks.content.some((n) => n.type === 'blockquote'))
  ok('the head’s title is the document’s first heading in an export', portable.firstHeadingText(headed) === 'Chapter One: The Storm')

  const sections = [
    { item: { id: 'p', kind: 'chapter', path: 'P', chapterType: 'prologue', hidden: false }, path: 'P', name: 'P', content: { type: 'doc', content: [h1('Before'), p('.')] } },
    { item: { id: 'pt', kind: 'part', title: 'The Crossing', hidden: false }, path: '', name: 'The Crossing', content: null },
    { item: { id: 'a', kind: 'chapter', path: 'A', hidden: false }, path: 'A', name: 'A', content: chapter },
  ]
  const compiled = matter.compileSections(sections, {
    chapterNumbering: { style: 'none', prefix: 'Chapter', includeTitle: true, startAt: 1 },
    chapterDesign: design,
  })
  ok('a designed book heads each chapter with the design: "Chapter One" in words, though numbering was never chosen',
    compiled[2].content.content[0].attrs.head.label === 'Chapter One')
  ok('a prologue is headed "Prologue" and not counted', compiled[0].content.content[0].attrs.head.label === 'Prologue' && compiled[0].number === undefined)
  ok('a part is a designed head too', compiled[1].content.content[0].type === 'chapterHead' && compiled[1].content.content[0].attrs.head.label === 'Part One')

  // Chapters run on: one flow, each member knowing where it starts.
  const flow = runOn([compiled[0], compiled[2]], { chapterBreak: 'continue' })
  const editor = new Editor({ extensions: getDocPreviewExtensions(), content: flow[0].content })
  const firstSize = editor.state.doc.content.child(0).nodeSize + editor.state.doc.content.child(1).nodeSize
  ok('chapters that run on are one flow', flow.length === 1 && flow[0].members.length === 2)
  ok('…each starting where the one before ended, counted as ProseMirror counts', flow[0].members[1].pos === firstSize &&
    editor.state.doc.nodeAt(flow[0].members[1].pos)?.type.name === 'chapterHead')
  editor.destroy()
  ok('a part is not run into', runOn(compiled, { chapterBreak: 'continue' }).length === 3)
  ok('nor anything, when chapters start on new pages', runOn([compiled[0], compiled[2]], { chapterBreak: 'newPage' }).length === 2)

  // Book styles.
  ok('style ids are unique, and each is its own design', new Set(BOOK_STYLES.map((s) => s.id)).size === BOOK_STYLES.length &&
    BOOK_STYLES.every((s) => s.design.styleId === s.id))
  const styled = applyBookStyle({ title: 'T' }, bookStyle('classic'), normalizePageSetup({ presetId: 'trade-6x9' }))
  ok('applying a style gives the book its type, heads and chapter design',
    styled.pageSetup.typography.chapterOpening === 'dropCapAndSmallCaps' && styled.chapterDesign.styleId === 'classic' &&
    styled.pageSetup.mirrorMargins && styled.pageSetup.versoHeader?.center === '{author}' && styled.pageSetup.chapterStartsOnRecto)
  const restyled = applyBookStyle(styled, bookStyle('manuscript'), normalizePageSetup(null))
  ok('and another replaces it, keeping the book’s own page', restyled.chapterDesign.styleId === 'manuscript' && !restyled.pageSetup.versoHeader &&
    restyled.pageSetup.widthMm === styled.pageSetup.widthMm)

  ok('a chapter’s head with nothing in it is none', normalizeChapterMeta({ subtitle: '' }) === null)
  ok('a subtitle is one line', normalizeChapterMeta({ subtitle: 'a\nb' }).subtitle === 'a b')
}

/* ---- typesetting is allowed on a locked chapter ---- */

{
  const { Editor } = await import('@tiptap/core')
  const { StarterKit } = await import('@tiptap/starter-kit')
  const { TypesetLock } = await import(`${C}/print/TypesetLock.ts`)
  const { DocPageSetup } = await import(`${C}/print/DocPageSetup.js`)
  const { DocChapterMeta, readChapterMeta } = await import(`${C}/print/DocChapterMeta.js`)
  const editor = new Editor({ extensions: [StarterKit, DocPageSetup, DocChapterMeta, TypesetLock], content: '<h1>A</h1><p>b</p>' })
  editor.storage.typesetLock.locked = true
  editor.commands.setChapterMeta({ subtitle: 'Sub' })
  editor.commands.setPageSetup({ presetId: 'a5' })
  ok('a chapter’s subtitle and page setup are set on a locked chapter',
    readChapterMeta(editor.state.doc)?.subtitle === 'Sub' && editor.state.doc.attrs.pageSetup?.presetId === 'a5')
  editor.destroy()
}

/* ---- the typeset history ---- */

{
  const { Editor } = await import('@tiptap/core')
  const { getDocPreviewExtensions } = await import(`${C}/lib/editorExtensions.js`)
  const history = await import(`${C}/print/typesetHistory.ts`)
  const { anchorBlock } = await import(`${C}/print/TypesetAnchors.ts`)
  const docSetup = await import(`${C}/print/DocPageSetup.js`)

  const editor = new Editor({ extensions: getDocPreviewExtensions(), content: '<p>One two three.</p><p>Four.</p>' })
  const tighten = (pos, value) => {
    const tr = editor.state.tr
    anchorBlock(tr, pos)
    tr.setNodeAttribute(pos, 'textAlign', null)
    editor.view.dispatch(tr)
    return value
  }
  tighten(0)
  const id = editor.state.doc.firstChild.attrs.typesetId
  ok('a block the typesetter touches gets a typeset id, and keeps it', Boolean(id) && anchorBlock(editor.state.tr, 0) === id)
  ok('a block never touched has none', !editor.state.doc.child(1).attrs.typesetId)
  editor.commands.setTextSelection(5)
  editor.commands.splitBlock()
  const ids = []
  editor.state.doc.forEach((node) => ids.push(node.attrs.typesetId))
  ok('a block split in two is two blocks with ids of their own', ids[0] === id && ids[1] && ids[1] !== id)
  editor.destroy()

  const chapter = (width, setup, subtitle, text = 'x') => ({
    type: 'doc',
    attrs: { pageSetup: setup, chapter: subtitle ? { subtitle } : null },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      { type: 'image', attrs: { src: 'a.png', width, align: 'center', typesetId: 'img1' } },
    ],
  })
  const setupA = { presetId: 'trade-6x9', widthMm: 152.4, heightMm: 228.6, margins: { topMm: 19, bottomMm: 19, insideMm: 19, outsideMm: 16, gutterMm: 3 } }
  const setupB = { ...setupA, margins: { ...setupA.margins, insideMm: 22 } }
  const bookA = { title: 'T', author: 'A', chapterDesign: { styleId: 'classic' }, items: [{ id: 'c1', kind: 'chapter', path: 'N/One', hidden: false }] }
  const bookB = { ...bookA, title: 'Changed Title', chapterDesign: { styleId: 'modern' }, items: [{ id: 'c1', kind: 'chapter', path: 'N/One', hidden: true }] }
  const a = history.snapshotOf(bookA, { 'N/One': chapter(200, setupA, '') })
  const b = history.snapshotOf(bookB, { 'N/One': chapter(300, setupB, 'Rain') })
  ok('a typeset snapshot leaves out the book’s title and author', !('title' in a.book) && !('author' in a.book))
  ok('…and holds each chapter’s setup, head and typeset blocks', a.chapters['N/One'].blocks.img1.width === 200 && a.chapters['N/One'].pageSetup.presetId === 'trade-6x9')
  ok('the same typeset is the same, whatever order its keys are in',
    history.sameSnapshot(a, history.snapshotOf({ items: bookA.items, chapterDesign: { styleId: 'classic' }, author: 'Z' }, { 'N/One': chapter(200, setupA, '') })))
  ok('changing a title is not a change of typesetting', history.sameSnapshot(a, history.snapshotOf({ ...bookA, title: 'X' }, { 'N/One': chapter(200, setupA, '') })))
  const lines = history.typesetDiff(a, b)
  ok('what changed reads as a designer would say it',
    lines.includes('Style classic → modern') && lines.some((l) => /One: Inside margin 19 mm → 22 mm/.test(l)) &&
    lines.includes('One: subtitle added') && lines.includes('One hidden') && lines.some((l) => /1 paragraph or picture set/.test(l)), JSON.stringify(lines))
  ok('the first version says the typesetting began', history.typesetDiff(null, a)[0] === 'Typesetting begun')

  const rewritten = chapter(300, setupB, 'Rain', 'words written since')
  rewritten.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'and more' }] })
  const restored = history.applyChapterTypeset(rewritten, a.chapters['N/One'])
  ok('restoring a typeset puts its settings back onto the text as it is now',
    restored.content.content[0].content[0].text === 'words written since' && restored.content.content[2].content[0].text === 'and more' &&
    restored.content.content[1].attrs.width === 200 && restored.content.attrs.pageSetup.margins.insideMm === 19 && !restored.content.attrs.chapter)
  const gone = history.applyChapterTypeset({ type: 'doc', content: [{ type: 'paragraph' }] }, a.chapters['N/One'])
  ok('…and says how many settings had nowhere left to go', gone.orphans === 1)
  ok('restoring keeps the book’s title', history.restoreBook({ title: 'Now', author: 'B', chapterDesign: {} }, a).title === 'Now' &&
    history.restoreBook({ title: 'Now' }, a).chapterDesign.styleId === 'classic')

  let entries = []
  for (let i = 0; i < 70; i += 1) entries = history.pushEntry(entries, { id: `a${i}`, kind: i === 3 ? 'named' : i === 5 ? 'export' : 'auto', summary: [], snapshot: a, timestamp: '' })
  ok('automatic versions are capped, the oldest going first; named and exported ones stay',
    entries.filter((e) => e.kind === 'auto').length === history.AUTO_CAP && entries.some((e) => e.id === 'a3') && entries.some((e) => e.id === 'a5') && !entries.some((e) => e.id === 'a0'))

  // A text version restored keeps the typesetting as it is now.
  const ed = new Editor({ extensions: getDocPreviewExtensions(), content: chapter(250, setupB, 'Rain') })
  docSetup.setContentKeepingPageSetup(ed, chapter(100, setupA, '', 'an older draft'))
  const after = ed.getJSON()
  ok('restoring a text version keeps the typesetting as it is now',
    after.content[0].content[0].text === 'an older draft' && JSON.stringify(after).includes('"width":250') &&
    after.attrs.pageSetup.margins.insideMm === 22 && after.attrs.chapter?.subtitle === 'Rain')
  ed.destroy()
}

/* ---- the typeset history, on disk ---- */

{
  const store = await import(`${C}/print/typesetHistoryStore.js`)
  const { files } = await import('./stub-fs.mjs')
  const P = 'History'
  const entry = (id, kind = 'auto') => ({ id, kind, timestamp: '2026-09-26T12:00:00Z', summary: ['x'], snapshot: { book: {}, chapters: { 'Novel/One': { pageSetup: null, chapter: null, blocks: {} } } } })
  await store.addTypesetEntry(P, 'Novel', entry('v1'))
  await store.addTypesetEntry(P, 'Novel', entry('v2'))
  await store.renameTypesetEntry(P, 'Novel', 'v1', 'Proof one')
  const renamed = await store.typesetEntries(P, 'Novel')
  ok('a version kept is in the project’s history file, and naming it makes it named',
    [...files.keys()].some((k) => k.endsWith('/History/.inkblot-typeset-history.json')) && renamed[0].name === 'Proof one' && renamed[0].kind === 'named')
  await store.deleteTypesetEntry(P, 'Novel', 'v2')
  ok('a version deleted is gone', (await store.typesetEntries(P, 'Novel')).length === 1)
  await store.relocateTypesetHistory(P, 'Novel', 'Book', { folder: true })
  const moved = await store.typesetEntries(P, 'Book')
  ok('renaming the folder takes its history with it, chapters and all',
    moved.length === 1 && Object.keys(moved[0].snapshot.chapters)[0] === 'Book/One' && (await store.typesetEntries(P, 'Novel')).length === 0)
}

/* ---- covers: the wrap, its checks, its versions ---- */

{
  const wrap = await import(`${C}/print/coverWrap.ts`)
  const design = await import(`${C}/print/chapterDesign.ts`)
  const { spineWidthMm } = await import(`${C}/print/preflight.ts`)
  const { mmToPx } = await import(`${C}/print/pageSizes.ts`)

  const spine = spineWidthMm({ pageCount: 220, paper: 'cream', service: 'kdp' })
  const g = wrap.wrapGeometry(152.4, 228.6, spine)
  ok('a 6 × 9 wrap is two covers, the spine and ⅛″ of bleed each side wide, and the trim and bleed high',
    Math.abs(g.wrapWidthMm - (2 * 152.4 + spine + 2 * 3.175)) < 1e-9 && Math.abs(g.wrapHeightMm - (228.6 + 2 * 3.175)) < 1e-9)
  ok('…the back on the left, the front on the right, the spine between',
    g.back.x === 0 && Math.abs(g.spine.x - (3.175 + 152.4)) < 1e-9 && Math.abs(g.front.x + g.front.width - g.wrapWidthMm) < 1e-9)

  const set = { id: 'v', name: 'Cover', front: 'f.jpg', back: 'b.jpg', spine: 's.jpg', fit: 'fill', madeForSpineMm: spine + 2 }
  const good = { width: Math.ceil((g.front.width / 25.4) * 300), height: Math.ceil((g.wrapHeightMm / 25.4) * 300) }
  const checks = wrap.coverChecks({ set, geometry: g, pageCount: 220, sizes: { front: good, back: { width: 600, height: 900 }, spine: { width: 200, height: 3000 } } })
  const ids = checks.map((c) => c.id)
  ok('a back too small to print sharp is pointed out, a front big enough is not',
    ids.includes('cover-dpi-back') && !ids.includes('cover-dpi-front'))
  ok('a spine made for another page count is pointed out', ids.includes('cover-spine-changed'))
  ok('a print-sized front is also judged as an e-book cover', ids.includes('cover-ebook-shape') === (Math.abs(good.height / good.width - 1.6) > 0.08))
  ok('under 80 pages the spine takes no text',
    wrap.coverChecks({ set, geometry: wrap.wrapGeometry(152.4, 228.6, 2), pageCount: 60, sizes: {} }).some((c) => c.id === 'cover-spine-text'))
  ok('no cover at all says so, and nothing else', wrap.coverChecks({ set: null, geometry: g, pageCount: 0, sizes: {} }).map((c) => c.id).join() === 'cover-none')
  ok('uncounted pages are pointed out, for the spine', wrap.coverChecks({ set, geometry: g, pageCount: 0, sizes: {} }).some((c) => c.id === 'cover-count'))

  const page = wrap.coverPage(g, set, { front: 'data:f', back: 'data:b', spine: 'data:s' })
  const imgs = [...page.querySelectorAll('img')]
  ok('the cover prints as one page the size of the wrap, each picture on its part',
    page.style.width === `${mmToPx(g.wrapWidthMm)}px` && imgs.length === 3 && imgs[2].style.left === `${mmToPx(g.front.x)}px` && imgs[0].style.objectFit === 'cover')
  const whole = wrap.coverPage(g, { ...set, wrap: 'data:w', fit: 'fit' }, { wrap: 'data:w' })
  ok('a wrap picture is one, across it all', whole.querySelectorAll('img').length === 1 && whole.querySelector('img').style.objectFit === 'contain')

  let book = { title: 'T', coverImage: 'old.jpg' }
  book = design.editCovers(book, { action: 'add', newId: 'n1' })
  ok('a new version joins the book’s old cover, and is the one in use', book.covers.length === 2 && book.activeCover === 'n1' && !book.coverImage)
  book = design.editCovers(book, { action: 'duplicate', id: 'cover', newId: 'n2' })
  ok('a copy is named as one', book.covers.find((c) => c.id === 'n2').name === 'Cover Copy' && book.coverImage === 'old.jpg')
  book = design.editCovers(book, { action: 'rename', id: 'n2', name: 'Hardcover', newId: 'x' })
  book = design.editCovers(book, { action: 'setFit', id: 'n2', fit: 'stretch', newId: 'x' })
  book = design.editCovers(book, { action: 'delete', id: 'n2', newId: 'x' })
  ok('deleting the one in use makes the first the cover', book.covers.length === 2 && book.activeCover === 'cover' && book.coverImage === 'old.jpg')
  ok('an action on a version that is not there changes nothing', design.editCovers(book, { action: 'rename', id: 'gone', name: 'X', newId: 'x' }) === book)
}

/* ---- the e-book: its stylesheet, what it leaves out, its checks, the reader ---- */

{
  const ebook = await import(`${C}/print/export/ebook.ts`)
  const design = await import(`${C}/print/chapterDesign.ts`)
  const devices = await import(`${C}/print/devicePresets.ts`)
  const { normalizeTypography } = await import(`${C}/print/typography.ts`)

  ok('a book with no e-book options has the defaults', JSON.stringify(design.digitalOf({})) === JSON.stringify(design.DEFAULT_DIGITAL))
  ok('…and one with some keeps them, and only booleans',
    design.digitalOf({ digital: { dropCaps: false, headImages: 'no' } }).dropCaps === false && design.digitalOf({ digital: { headImages: 'no' } }).headImages === true)

  const t = normalizeTypography({ fontFamily: 'Palatino', fontSizePt: 11, firstLineIndentMm: 5, alignment: 'justify', hyphenate: true, sceneBreak: '❦', chapterOpening: 'dropCapAndSmallCaps', noIndentAfterBreak: true })
  const css = ebook.ebookCss({ typography: t })
  ok('the e-book is set in the book’s face, justified and hyphenated', css.includes('font-family: Palatino;') && css.includes('text-align: justify;') && css.includes('hyphens: auto;'))
  ok('its indent is the print’s, in ems', /p \{ text-indent: 1\.29em; margin: 0; \}/.test(css))
  ok('its chapters open with the drop cap and small capitals, as floats a reader can draw',
    css.includes('.chapter-head + p::first-letter { float: left;') && css.includes('::first-line { font-variant: small-caps;'))
  ok('its scene breaks are the book’s ornament', css.includes('hr::after { content: "❦";'))
  ok('the head is drawn as designed', css.includes(".chapter-head[data-title-case='smallCaps'] .ch-title"))
  const plain = ebook.ebookCss({ typography: t, digital: { ...design.DEFAULT_DIGITAL, dropCaps: false, publisherFont: false, plainSceneBreaks: true, invertOrnamentsInDark: false } })
  ok('without drop caps, the book’s font or its ornament, the e-book has none of them',
    !plain.includes('::first-letter') && !plain.includes('font-family: Palatino') && plain.includes('content: "* * *"') && !plain.includes('invert(1)'))
  ok('ornament pictures are inverted on a dark page unless told not to', css.includes(':root.reader-dark .chapter-head .ch-ornament.is-image img { filter: invert(1); }'))

  const doc = { type: 'doc', content: [
    { type: 'chapterHead', attrs: { head: { title: 'One', image: '.assets/a.jpg', ornament: 'image', ornamentImage: '.assets/o.png' } } },
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: '.assets/b.jpg', alt: '' } }] },
  ] }
  ok('with its pictures, a chapter is as it was', ebook.digitalContent(doc, design.DEFAULT_DIGITAL) === doc)
  const bare = ebook.digitalContent(doc, { ...design.DEFAULT_DIGITAL, headImages: false })
  ok('without, its head has no picture and no picture ornament, and the text keeps its own',
    !bare.content[0].attrs.head.image && bare.content[0].attrs.head.ornament === 'none' && bare.content[1].content[0].attrs.src === '.assets/b.jpg')

  const images = ebook.ebookImagesOf(doc)
  ok('the e-book’s pictures are the head’s and the text’s', images.length === 2 && images[1].alt === '')
  const checks = ebook.ebookChecks({
    images: [{ src: 'a', alt: '' }, { src: 'b', alt: 'x', bytes: 6 * 1024 * 1024 }, { src: 'c', alt: 'y', width: 3000, height: 2000 }],
    chapters: 3,
    cover: { width: 1600, height: 2000 },
  }).map((c) => c.id)
  ok('a picture without alt text, one over 5 MB, one over 4 megapixels and a squat cover are each pointed out',
    ['ebook-alt', 'ebook-image-bytes', 'ebook-image-pixels', 'ebook-cover-shape'].every((id) => checks.includes(id)))
  ok('a book with no chapters, and no cover, is told so',
    ebook.ebookChecks({ images: [], chapters: 0, cover: null }).map((c) => c.id).join() === 'ebook-empty,ebook-cover')
  ok('a well-made e-book passes', ebook.ebookChecks({ images: [{ src: 'a', alt: 'A map' }], chapters: 1, cover: { width: 1600, height: 2560 } }).length === 0)

  ok('a device dragged too small or too large is held to the limits',
    devices.clampViewport(10, 99999).width === devices.VIEWPORT_MIN.width && devices.clampViewport(10, 99999).height === devices.VIEWPORT_MAX.height)
  ok('a wide screen held landscape reads as a spread; a phone does not',
    devices.isSpreadViewport(1024, 720) && !devices.isSpreadViewport(393, 852))
  ok('reader settings out of range fall back', JSON.stringify(devices.normalizeReader({ scale: 7, theme: 'plaid', margins: 'wide' })) === JSON.stringify({ ...devices.DEFAULT_READER, margins: 'wide' }))
  const reader = devices.readerCss({ ...devices.DEFAULT_READER, theme: 'night', scale: 1.5, align: 'left', publisherFont: false }, 400, 600)
  ok('a page is a column one screen wide, less its margins, with the gap making up the rest',
    reader.includes('column-width: 344px') && reader.includes('column-gap: 56px'))
  ok('the reader’s theme, size, font and alignment go over the book’s',
    reader.includes('background: #000000') && reader.includes('font-size: 27px') && reader.includes('Georgia') && reader.includes('text-align: left !important'))
  const spread = devices.readerCss(devices.DEFAULT_READER, 1024, 720)
  ok('a spread sets two columns to the screen', spread.includes(`column-width: ${(1024 - 72 * 4) / 2}px`))
}

/* ---- the typesetter's fixes, as pagination honours them ---- */

{
  const { paginate } = await import(`${C}/print/paginate.ts`)
  const near = (a, b) => Math.abs(a - b) < 0.01
  const frame = { slotHeight: 100, stride: 150, columns: 1, minLines: 2 }
  const para = (pos, top, n, extra = {}) => ({
    kind: 'text', pos, top, bottom: top + n * 10, ...extra,
    lines: Array.from({ length: n }, (_, i) => ({ top: top + i * 10, bottom: top + (i + 1) * 10, pos: pos + 1 + i * 10 })),
  })

  let r = paginate([para(0, 0, 6), para(100, 60, 6, { split: 'never' })], frame)
  ok('a paragraph kept together goes over whole rather than split', r.pushes.length === 1 && r.pushes[0].kind === 'block' && r.pushes[0].pos === 100)

  r = paginate([para(0, 0, 6), para(100, 60, 3, { keepWithNext: true }), para(200, 90, 4)], frame)
  ok('one kept with the next goes over with it', r.pushes[0].kind === 'block' && r.pushes[0].pos === 100)

  // Eleven lines: ten fit, and widow control would send two over.
  r = paginate([para(0, 0, 11, { pageAdjust: 1 })], frame)
  ok('a page run a line long takes the eleventh line, and nothing goes over', r.pushes.length === 0 && r.pageCount === 1)
  r = paginate([para(0, 0, 10, { pageAdjust: -1 })], frame)
  ok('a page run a line short sends lines over that would have fit', r.pushes.length === 1 && r.pushes[0].kind === 'line' && r.pageCount === 2)

  // A picture 25px tall, then a paragraph: on a 10px grid it starts at 30, not 25.
  r = paginate([para(0, 0, 2), { kind: 'atom', pos: 30, top: 20, bottom: 45 }, para(60, 45, 2)], { ...frame, grid: 10 })
  ok('on the baseline grid, a paragraph after an odd-sized picture starts on the next whole line',
    r.pushes.length === 1 && r.pushes[0].pos === 60 && near(r.pushes[0].height, 5))
  r = paginate([para(0, 0, 9), para(100, 95, 3)], { ...frame, grid: 10 })
  ok('…and one lifted past the foot starts the next page, in one push', r.pushes.filter((p) => p.pos === 100).length === 1 && near(r.pushes[0].height, 150 - 95))
}

/* ---- composition: how lines are set ---- */

{
  const ty = await import(`${C}/print/typography.ts`)
  const base = ty.normalizeTypography({ fontFamily: 'Palatino', fontSizePt: 11, lineSpacing: 'exact', lineValue: 14, paragraphSpacingPt: 10 })
  ok('a typography without a composition composes as the defaults: balanced, punctuation hung',
    ty.typographyClasses(base).includes('pt-balance') && ty.typographyClasses(base).includes('pt-hang') && !ty.typographyClasses(base).includes('pt-grid'))
  ok('…and one that has none gains none when normalised', !('composition' in base) && !('features' in base))
  const vars = ty.typographyVars(base)
  ok('the hyphenation limits and the features are the page’s properties',
    vars['--pt-hyphen-lines'] === '2' && vars['--pt-hyphen-word'] === '6' && vars['--pt-ligatures'] === 'common-ligatures no-discretionary-ligatures' && vars['--pt-kerning'] === 'normal')
  const tuned = ty.normalizeTypography({ ...base, composition: { balance: false, hyphenLimitLines: 0, baselineGrid: true }, features: { oldStyleFigures: true, swashes: true, kerning: 'x' } })
  const tv = ty.typographyVars(tuned)
  ok('a composition set is kept, filled in: no limit, on the grid',
    tuned.composition.hangingPunctuation && tv['--pt-hyphen-lines'] === 'no-limit' && ty.typographyClasses(tuned).includes('pt-grid') && !ty.typographyClasses(tuned).includes('pt-balance'))
  ok('on the grid, the space between paragraphs is whole lines', tv['--pt-para'] === '14pt')
  ok('features set are set, and a feature not a boolean falls back', tv['--pt-numeric'] === 'oldstyle-nums' && tv['--pt-feature-settings'] === '"swsh" 1' && tv['--pt-kerning'] === 'normal')
  ok('the grid’s pitch is the leading, in px, and none off the grid',
    Math.abs(ty.baselineGridPx(tuned) - 14 * 96 / 72) < 0.01 && ty.baselineGridPx(base) === 0)
}

/* ---- the proof: what a proofreader marks ---- */

{
  const { analyzeLines } = await import(`${C}/print/proofIssues.ts`)
  let at = 0
  const word = (text, left, width, broken = false) => {
    const w = { text, from: at, to: at + text.length, left, right: left + width, broken }
    at += text.length + 1
    return w
  }
  const line = (page, words, right = 300) => ({ page, top: 0, left: 0, right, words })
  const para = (lines, justified = true) => ({ pos: 0, justified, fontSize: 16, lines })
  const full = (page) => line(page, [word('a', 0, 96), word('b', 100, 96), word('c', 200, 100)])

  const found = (paras) => analyzeLines(paras, { hyphenLimit: 2 }).map((i) => i.kind)
  ok('a paragraph’s last line alone at a page’s head is a widow', found([para([full(1), full(1), line(2, [word('end.', 0, 40), word('Then', 50, 40)])])]).includes('widow'))
  ok('its first line alone at the foot is an orphan', found([para([full(1), full(2), line(2, [word('x', 0, 5), word('y', 10, 5)])])]).includes('orphan'))
  ok('a last line of one short word is a runt', found([para([full(1), line(1, [word('it.', 0, 20)])])]).includes('runt'))
  ok('…but a long one is not', !found([para([full(1), line(1, [word('extraordinarily.', 0, 120)])])]).includes('runt'))
  ok('a justified line of three words across the measure is loose',
    found([para([line(1, [word('a', 0, 20), word('b', 140, 20), word('c', 280, 20)]), full(1)])]).includes('loose'))
  ok('…but not left-aligned, nor a paragraph’s last line',
    !found([para([line(1, [word('a', 0, 20), word('b', 140, 20), word('c', 280, 20)]), full(1)], false)]).includes('loose') &&
    !found([para([full(1), line(1, [word('a', 0, 20), word('b', 140, 20), word('c', 280, 20)])])]).includes('loose'))
  const hy = (page) => line(page, [word('a', 0, 140), word('hyph', 150, 150, true)])
  ok('three lines in a row ending in a hyphen are a ladder, where two may',
    found([para([hy(1), hy(1), hy(1), full(1), line(1, [word('the', 0, 30), word('end', 40, 30)])])]).includes('stackedHyphens') &&
    !found([para([hy(1), hy(1), full(1), line(1, [word('the', 0, 30), word('end', 40, 30)])])]).includes('stackedHyphens'))
  const shortPage = analyzeLines([para([full(1), full(1), full(1)]), para([full(1), full(2), line(2, [word('The', 0, 30), word('end.', 40, 40)])])], { hyphenLimit: 2 })
  const sp = shortPage.find((i) => i.kind === 'shortPage')
  ok('a chapter ending on a page of two lines has a short last page, fixed by running the page before long',
    sp && sp.page === 2 && sp.fixes.includes('runLong'))
}

/* ---- a font file: its family, and whether it may be embedded ---- */

{
  const { readFontInfo, familyFromFileName, styleFromName } = await import(`${C}/print/fontFile.ts`)
  // An sfnt with a `name` table (family 1, style 2, typographic family 16) and an OS/2.
  const build = ({ fsType, weight = 400, family = 'Test Serif', sub = 'Bold Italic' }) => {
    const strings = [[1, 'Test Serif Bold'], [2, sub], [16, family]]
    const encoded = strings.map(([, text]) => Buffer.from(text, 'utf16le').swap16())
    const nameLength = 6 + strings.length * 12 + encoded.reduce((n, b) => n + b.length, 0)
    const os2Length = 12
    const tables = 2
    const headerLength = 12 + tables * 16
    const buf = Buffer.alloc(headerLength + nameLength + os2Length)
    buf.writeUInt32BE(0x00010000, 0)
    buf.writeUInt16BE(tables, 4)
    const nameAt = headerLength
    const os2At = headerLength + nameLength
    buf.write('name', 12, 'ascii'); buf.writeUInt32BE(nameAt, 20); buf.writeUInt32BE(nameLength, 24)
    buf.write('OS/2', 28, 'ascii'); buf.writeUInt32BE(os2At, 36); buf.writeUInt32BE(os2Length, 40)
    buf.writeUInt16BE(0, nameAt); buf.writeUInt16BE(strings.length, nameAt + 2); buf.writeUInt16BE(6 + strings.length * 12, nameAt + 4)
    let offset = 0
    strings.forEach(([id], i) => {
      const at = nameAt + 6 + i * 12
      buf.writeUInt16BE(3, at); buf.writeUInt16BE(1, at + 2); buf.writeUInt16BE(0x409, at + 4); buf.writeUInt16BE(id, at + 6)
      buf.writeUInt16BE(encoded[i].length, at + 8); buf.writeUInt16BE(offset, at + 10)
      encoded[i].copy(buf, nameAt + 6 + strings.length * 12 + offset)
      offset += encoded[i].length
    })
    buf.writeUInt16BE(weight, os2At + 4)
    buf.writeUInt16BE(fsType, os2At + 8)
    return new Uint8Array(buf)
  }
  const free = readFontInfo(build({ fsType: 0, weight: 700 }), 'whatever.ttf')
  ok('a font file names its family — the typographic one — its weight and slant',
    free.family === 'Test Serif' && free.weight === 700 && free.style === 'italic' && free.embeddable && free.format === 'truetype')
  ok('one whose licence is restricted may not be embedded', !readFontInfo(build({ fsType: 2 }), 'x.ttf').embeddable)
  ok('…while print-and-preview and editable ones may', readFontInfo(build({ fsType: 4 }), 'x.ttf').embeddable && readFontInfo(build({ fsType: 8 }), 'x.ttf').embeddable)
  ok('a WOFF is known by its file name', readFontInfo(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]), 'EBGaramond-BoldItalic.woff2').family === 'EBGaramond')
  ok('a file name’s style words are its style', familyFromFileName('Crimson_Semibold.otf') === 'Crimson' && styleFromName('Semibold Italic').weight === 600)
}

/* ---- named text styles ---- */

{
  const ts = await import(`${C}/print/textStyles.ts`)
  const { Editor } = await import('@tiptap/core')
  const { StarterKit } = await import('@tiptap/starter-kit')
  const { ParagraphTypeset, setParagraphTypeset } = await import(`${C}/print/ParagraphTypeset.ts`)
  const { TypesetAnchors } = await import(`${C}/print/TypesetAnchors.ts`)
  const { TYPESET_META } = await import(`${C}/print/TypesetLock.ts`)

  const plain = ts.textStylesOf({})
  ok('a book has the app’s styles, in the menu’s order', plain[0].id === 'letter' && plain.some((s) => s.id === 'textMessage') && plain.length === ts.BUILTIN_TEXT_STYLES.length)
  const own = ts.textStylesOf({ textStyles: [{ id: 'letter', italic: true, size: 99 }, { id: 'custom-1', name: 'Radio', smallCaps: true }, { name: 'no id' }] })
  const letter = own.find((s) => s.id === 'letter')
  ok('its own look for one of them is kept over the app’s, the rest filled in and held in range',
    letter.italic && letter.name === 'Letter' && letter.indentEm === 2 && letter.size === 3)
  ok('and styles of its own follow the app’s; one with no id is dropped',
    own[own.length - 1].id === 'custom-1' && own[own.length - 1].smallCaps && own.length === ts.BUILTIN_TEXT_STYLES.length + 1)

  const css = ts.textStylesCss(own, '.has-print-type .ProseMirror')
  ok('each look is the page’s CSS, under the page', /\.has-print-type \.ProseMirror \[data-style="letter"\] \{[^}]*font-style: italic;/.test(css) && css.includes('[data-style="sign"] {') && css.includes('border: 1px solid currentColor'))
  ok('a run of one style is spaced as one: space before its first, after its last',
    css.includes('[data-style="letter"]:not([data-style="letter"] + *) { margin-top: calc(var(--pt-leading, 1.4em) * 1); }') &&
    css.includes('[data-style="letter"]:not(:has(+ [data-style="letter"])) { margin-bottom:'))

  const editor = new Editor({ extensions: [StarterKit, TypesetAnchors, ParagraphTypeset], content: '<p>Dear M,</p><p>Yours.</p><p>After.</p>' })
  const tr = editor.state.tr
  const changed = setParagraphTypeset(tr, 1, 17, { styleName: 'letter' })
  editor.view.dispatch(tr)
  const [a, b, c] = [0, 1, 2].map((i) => editor.state.doc.child(i))
  ok('a style is set on each paragraph selected, as typesetting, each anchored',
    changed === 2 && a.attrs.styleName === 'letter' && b.attrs.styleName === 'letter' && !c.attrs.styleName && a.attrs.typesetId && tr.getMeta(TYPESET_META))
  ok('and it is in the page’s HTML as the name the CSS looks for', editor.getHTML().includes('<p data-style="letter">Dear M,</p>'))
  editor.chain().setTextSelection(8).splitBlock().run()
  ok('Enter in a letter goes on in the letter', editor.state.doc.child(1).attrs.styleName === 'letter')
  const clear = editor.state.tr
  setParagraphTypeset(clear, 1, 3, { styleName: null })
  editor.view.dispatch(clear)
  ok('and none takes it off', editor.state.doc.child(0).attrs.styleName == null)
  editor.destroy()
}

/* ---- footnotes and endnotes ---- */

{
  const notes = await import(`${C}/print/notes.ts`)
  const { paginate } = await import(`${C}/print/paginate.ts`)
  const fn = (id, text) => ({ type: 'footnote', attrs: { id, text } })
  const para = (...inline) => ({ type: 'paragraph', content: inline })
  const t = (text) => ({ type: 'text', text })
  const chapter = (id, ...notesIn) => ({
    item: { id, kind: 'chapter' }, role: 'body', name: id,
    content: { type: 'doc', content: [para(t('Words'), ...notesIn)] },
  })
  const book = () => [
    chapter('one', fn('a', 'First.'), fn('b', 'Second.')),
    chapter('two', fn('c', 'Third.')),
    { item: { id: 'ack', kind: 'matter' }, role: 'back', name: 'Acknowledgements', content: { type: 'doc', content: [] } },
  ]
  const marksOf = (section) => {
    const out = []
    const walk = (n) => { if (n.type === 'footnote') out.push(n.attrs.mark); (n.content || []).forEach(walk) }
    walk(section.content)
    return out
  }

  ok('marks are numbers, or the six symbols, doubled after', notes.noteMark(3) === '3' && notes.noteMark(2, 'symbols') === '†' && notes.noteMark(8, 'symbols') === '††')
  let set = notes.setBookNotes(book(), notes.notesOptionsOf({}))
  ok('at the page’s foot, each chapter’s notes are numbered afresh, and stay at their marks',
    marksOf(set[0]).join() === '1,2' && marksOf(set[1]).join() === '1' && set[0].content.content.length === 1 && !set[0].content.content[0].content[1].attrs.end)
  set = notes.setBookNotes(book(), notes.notesOptionsOf({ notes: { numbering: 'continuous', marks: 'symbols' } }))
  ok('numbered on through the book, as symbols', marksOf(set[1]).join() === '‡')
  set = notes.setBookNotes(book(), notes.notesOptionsOf({ notes: { placement: 'chapter', heading: 'Sources' } }))
  const after = set[0].content.content
  ok('after each chapter: its marks are references, and its notes follow under the heading',
    after[0].content[1].attrs.end && after[1].type === 'heading' && after[1].content[0].text === 'Sources' && after[2].content.map((n) => n.text).join('') === '1. First.')
  set = notes.setBookNotes(book(), notes.notesOptionsOf({ notes: { placement: 'book' } }))
  const notesAt = set.findIndex((s) => s.item.generated === 'notes')
  ok('at the end of the book: a Notes section before the back matter, chapter by chapter',
    notesAt === 2 && set[3].item.id === 'ack' && set[notesAt].content.content.filter((n) => n.type === 'heading' && n.attrs.level === 3).length === 2 && set[0].content.content.length === 1)
  const withEntry = notes.setBookNotes([...book(), { item: { id: 'g1', kind: 'generated', generated: 'notes' }, role: 'back', name: 'Notes' }], notes.notesOptionsOf({ notes: { placement: 'book' } }))
  ok('…or in the book’s own Notes entry, where it has one', withEntry.length === 4 && withEntry[3].content?.content[0].content[0].text === 'Notes')

  const bySlot = notes.notesBySlot([{ pos: 5 }, { pos: 150 }, { pos: 260 }], [0, 100, null, 250])
  ok('a note is set on the page its mark is on', bySlot.get(0).length === 1 && bySlot.get(1)[0].pos === 150 && bySlot.get(3)[0].pos === 260)

  // A 100px page; the third line's note takes 30px, and its rule 10px.
  const lines = (n, notesAt = {}) => Array.from({ length: n }, (_, i) => ({ top: i * 10, bottom: (i + 1) * 10, pos: 1 + i * 10, ...(notesAt[i] ? { notes: notesAt[i] } : {}) }))
  const frame = { slotHeight: 100, stride: 150, columns: 1, minLines: 2, noteGap: 10 }
  let r = paginate([{ kind: 'text', pos: 0, top: 0, bottom: 100, lines: lines(10, { 2: 30 }) }], frame)
  ok('a page keeps room at its foot for the notes of the lines on it: six lines, not ten, fit over them',
    r.pushes.length === 1 && r.pushes[0].kind === 'line' && r.pushes[0].pos === 1 + 6 * 10)
  r = paginate([{ kind: 'text', pos: 0, top: 0, bottom: 100, lines: lines(10) }], frame)
  ok('…and none without notes', r.pushes.length === 0)
  r = paginate([{ kind: 'text', pos: 0, top: 0, bottom: 100, lines: lines(10, { 8: 40 }) }], frame)
  ok('a mark that would not fit with its note goes over with it', r.pushes[0].kind === 'line' && r.pushes[0].pos <= 1 + 8 * 10)
}

/* ---- a note in the editor, and in the files a book is exported as ---- */

{
  const { Editor, generateHTML } = await import('@tiptap/core')
  const { StarterKit } = await import('@tiptap/starter-kit')
  const { Footnote } = await import(`${C}/print/Footnote.ts`)
  const { toMarkdown } = await import(`${C}/print/export/markdown.ts`)
  const { buildPlainText } = await import(`${C}/print/export/text.ts`)
  const { withLinkedNotes } = await import(`${C}/print/export/html.ts`)
  const { inTextNotes } = await import(`${C}/print/export/portable.ts`)

  const editor = new Editor({ extensions: [StarterKit, Footnote], content: '<p>It rained.</p>' })
  editor.chain().setTextSelection(11).insertFootnote('Or so they said > then.').run()
  const node = editor.state.doc.firstChild.child(1)
  ok('a note goes in after the words, holding its text', node.type.name === 'footnote' && node.attrs.text === 'Or so they said > then.' && node.attrs.id)
  const html = editor.getHTML()
  const again = new Editor({ extensions: [StarterKit, Footnote], content: html })
  ok('and comes back from its HTML as it was', again.state.doc.firstChild.child(1).attrs.text === 'Or so they said > then.')
  editor.destroy(); again.destroy()

  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It rained.' }, { type: 'footnote', attrs: { id: 'n1', text: 'Or so they said.', mark: '1' } }] }] }
  ok('in Markdown a note is a footnote, defined after the text', toMarkdown(doc) === 'It rained.[^1]\n\n[^1]: Or so they said.\n')
  ok('in plain text its mark in brackets, the note after', buildPlainText([doc]).includes('It rained.[1]\n\n[1] Or so they said.'))
  const body = generateHTML(doc, [StarterKit, Footnote])
  const linked = withLinkedNotes(body, inTextNotes(doc), { epub: true })
  ok('in an e-book the mark links to a pop-up note, which links back',
    linked.includes('<a class="noteref" href="#fn-n1" id="fnref-n1" epub:type="noteref" role="doc-noteref"><sup>1</sup></a>') &&
    linked.includes('<aside epub:type="footnote" role="doc-footnote" id="fn-n1" class="footnote"><p><a href="#fnref-n1">1</a>. Or so they said.</p></aside>'))
  ok('in HTML, a list of notes after the chapter', withLinkedNotes(body, inTextNotes(doc)).includes('<li id="fn-n1" class="footnote">Or so they said. <a href="#fnref-n1"'))
}
