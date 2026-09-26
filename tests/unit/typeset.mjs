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
