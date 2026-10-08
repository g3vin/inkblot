/**
 * editorExtensions.js — the TipTap extension sets used across the app.
 *
 * Extracted from EditorCanvas so canvas cards can share one definition of "what
 * a document can contain" with the main panes. Keeping them in one place means
 * a Toolbar button can't work in a pane and throw in a card.
 */
import { StarterKit } from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import { Dropcursor } from '@tiptap/extension-dropcursor'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { getSchema } from '@tiptap/core'

import { Bibliography } from '../extensions/Bibliography'
import { BubbleSession } from '../extensions/BubbleSession'
import { Citation } from '../extensions/Citation'
import { CustomTextStyle } from '../extensions/CustomTextStyle'
import ConversationTile from '../extensions/ConversationTile'
import { DictationInline } from '../extensions/DictationInline'
import { DocChangeReporter } from '../extensions/DocChangeReporter'
import { NoteAnnotation } from '../extensions/NoteAnnotation'
import { TimelineAnchors } from '../extensions/TimelineAnchors'
import PinterestBoard from '../extensions/PinterestBoard'
import { ReadAloudHighlight } from '../extensions/ReadAloudHighlight'
import ResizableImage from '../extensions/ResizableImage'
import TabIndent from '../extensions/TabIndent'
import { ChapterHead } from '../print/ChapterHead'
import { ChapterHeadDecorations } from '../print/ChapterHeadDecorations'
import { DocChapterMeta } from '../print/DocChapterMeta'
import { DocPageSetup } from '../print/DocPageSetup'
import { PageBreak } from '../print/PageBreak'
import { Pagination } from '../print/PaginationExtension'
import { TypesetAnchors } from '../print/TypesetAnchors'
import { ParagraphTypeset } from '../print/ParagraphTypeset'
import { ProofMarks } from '../print/proofIssues'
import { Footnote } from '../print/Footnote'
import { TypesetLock } from '../print/TypesetLock'
import { DocWritingFormat } from '../script/DocWritingFormat'
import { ScriptElement } from '../script/ScriptElement'

/**
 * Everything both panes and cards understand.
 *
 * No Underline here: StarterKit v3 already provides it, and adding
 * @tiptap/extension-underline on top registered the mark twice — TipTap warns
 * "Duplicate extension names found: ['underline']" and the second definition
 * silently wins.
 */
const sharedExtensions = () => [
  CustomTextStyle,
  DocChangeReporter,
  BubbleSession,
  Color,
  FontFamily,
  ReadAloudHighlight,
  DictationInline,
  TabIndent,
  TextAlign.configure({
    types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
  }),
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  ResizableImage.configure({
    inline: true,
    allowBase64: true,
  }),
]

/**
 * The full document extension set. `starterKit` is injected because the primary
 * pane configures list marks differently from the secondary one.
 */
export const buildEditorExtensions = (starterKit) => [
  // The empty paragraph the editor keeps last would be prose in a script: a script
  // ends on its own lines (ScriptElement.ts).
  starterKit.configure({ trailingNode: { notAfter: ['scriptElement'] } }),
  Dropcursor.configure({
    color: 'var(--accent-color)',
    width: 2,
  }),
  NoteAnnotation,
  TimelineAnchors,
  ConversationTile,
  PinterestBoard,
  Citation,
  Bibliography,
  DocPageSetup,
  DocChapterMeta,
  // A compiled chapter's head (bookMatter.ts): never in a document on disk.
  ChapterHead,
  // A chapter's designed head, drawn around its real title in Typeset.
  ChapterHeadDecorations,
  PageBreak,
  // A note at its mark, set at the page's foot or after the chapter.
  Footnote,
  Pagination,
  // A chapter's prose, held while the book is typeset (Typeset mode).
  TypesetLock,
  // A stable name for each block the typesetter touched (the typeset history).
  TypesetAnchors,
  // A paragraph's tracking and keeps, set to mend a page.
  ParagraphTypeset,
  // The proof's marks on the Typeset pages.
  ProofMarks,
  // A screenplay's or a play's lines, and which the document is written as.
  ScriptElement,
  DocWritingFormat,
  ...sharedExtensions(),
]

/**
 * The extension set for a canvas card.
 *
 * Drops the document-scoped extensions that have no meaning inside a card:
 * NoteAnnotation (its anchors are positions in a document's notes list),
 * ConversationTile, PinterestBoard, and citations and the bibliography (their sources
 * are attached to a document). Everything the Toolbar can invoke stays,
 * so a card's editor answers the same commands a pane's editor does.
 *
 * Returns a fresh array each call — TipTap extension instances are stateful and
 * must not be shared between live editors.
 */
export const buildCardExtensions = () => [
  StarterKit.configure({
    bulletList: { keepMarks: true },
    orderedList: { keepMarks: true },
  }),
  ...sharedExtensions(),
]

/**
 * Schema for rendering a card's stored JSON to static HTML. Built once: a schema
 * is immutable and generateHTML() only reads each node's renderHTML, so no node
 * view ever runs for a card that isn't being edited.
 */
let cardSchemaCache = null
export const getCardSchema = () => {
  if (!cardSchemaCache) cardSchemaCache = getSchema(buildCardExtensions())
  return cardSchemaCache
}

/** The extension list generateHTML() needs. Stable identity, safe to memo against. */
let cardExtensionsCache = null
export const getCardExtensions = () => {
  if (!cardExtensionsCache) cardExtensionsCache = buildCardExtensions()
  return cardExtensionsCache
}

/**
 * The extension set for rendering a PROJECT DOCUMENT to static HTML — the preview on
 * a canvas document card (useDocPreview).
 *
 * Deliberately NOT getCardExtensions(). A document is authored with the full pane
 * schema, so it can hold the three nodes a card deliberately drops: ConversationTile,
 * PinterestBoard, and NoteAnnotation's decorations. generateHTML() throws on a node
 * type its schema doesn't know, and that throw is caught one level up — so rendering
 * a document with the card schema would blank the ENTIRE preview of any chapter that
 * happens to contain one Pinterest board. With the document set, those nodes render.
 */
let docPreviewExtensionsCache = null
export const getDocPreviewExtensions = () => {
  if (!docPreviewExtensionsCache) {
    docPreviewExtensionsCache = buildEditorExtensions(
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      })
    )
  }
  return docPreviewExtensionsCache
}
