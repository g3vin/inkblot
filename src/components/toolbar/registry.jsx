/**
 * registry.jsx — each toolbar item id's component. The ids, labels, symbols and which
 * toolbars offer them are lib/chromeLayout.ts's; this only says how each is drawn.
 *
 * Every component takes { ctx, spec } and renders even with no state to show —
 * disabled, never absent: an item that vanished would punch a hole in the user's
 * layout and move everything after it (tests/unit/toolbar.mjs mounts each one).
 */
import * as D from './items/documentItems'
import * as C from './items/canvasItems'
import * as M from './items/mapItems'
import * as T from './items/typesetItems'
import * as S from './items/sharedItems'

const panel = (tab) => {
  const Panel = (props) => <S.PanelItem {...props} tab={tab} />
  Panel.displayName = `PanelItem(${tab})`
  return Panel
}

export const TOOLBAR_COMPONENTS = {
  'inkblot.format.font': D.FontItem,
  'inkblot.format.font-size': D.FontSizeItem,
  'inkblot.format.text-style': D.TextStyleItem,
  'inkblot.format.text-color': D.TextColorItem,
  'inkblot.format.highlight': D.HighlightItem,
  'inkblot.format.alignment': D.AlignmentItem,
  'inkblot.format.paragraph-style': D.ParagraphStyleItem,
  'inkblot.format.bulleted-list': D.BulletedListItem,
  'inkblot.format.numbered-list': D.NumberedListItem,
  'inkblot.insert.table': D.TableItem,
  'inkblot.insert.conversation': D.ConversationItem,
  'inkblot.insert.note': D.AddNoteItem,
  'inkblot.edit.undo-redo': D.UndoRedoItem,
  'inkblot.edit.paste-and-match-style': D.PasteAndMatchStyleItem,
  'inkblot.view.focus-mode': D.FocusModeItem,
  'inkblot.view.word-count': D.WordCountItem,
  'inkblot.speech.dictation': D.DictationItem,
  'inkblot.speech.read-aloud': D.ReadAloudItem,
  'inkblot.view.editor-mode': D.EditorModeItem,
  'inkblot.view.page-view': D.PageViewItem,

  'inkblot.canvas.lock': C.CanvasLockItem,
  'inkblot.canvas.add-card': C.CanvasAddCardItem,
  'inkblot.canvas.add-image': C.CanvasAddImageItem,
  'inkblot.canvas.record-memo': C.CanvasRecordMemoItem,
  'inkblot.canvas.color': C.CanvasColorItem,
  'inkblot.canvas.group': C.CanvasGroupItem,
  'inkblot.canvas.undo-redo': C.CanvasUndoRedoItem,
  'inkblot.canvas.alignment-guides': C.CanvasGuidesItem,
  'inkblot.canvas.snap-to-grid': C.CanvasSnapItem,
  'inkblot.canvas.zoom': C.CanvasZoomItem,
  'inkblot.canvas.delete': C.CanvasDeleteItem,

  'inkblot.map.drawing-tools': M.MapDrawingItem,
  'inkblot.map.measure-tools': M.MapMeasureItem,
  'inkblot.map.undo-redo': M.MapUndoRedoItem,
  'inkblot.map.zoom': M.MapZoomItem,
  'inkblot.map.delete': M.MapDeleteItem,
  'inkblot.map.view': M.MapViewItem,

  'inkblot.history.snapshot': S.SnapshotItem,
  'inkblot.panel.clipboard': panel('clipboard'),
  'inkblot.panel.workbench': panel('workbench'),
  'inkblot.panel.notes': panel('notes'),
  'inkblot.panel.history': panel('history'),
  'inkblot.panel.references': panel('references'),
  'inkblot.panel.stats': panel('stats'),
  'inkblot.timer': S.TimerItem,
  'inkblot.tabs.split': S.SplitItem,

  'inkblot.typeset.view': T.TypesetViewItem,
  'inkblot.typeset.edition': T.EditionItem,
  'inkblot.typeset.spread': T.SpreadItem,
  'inkblot.typeset.proof': T.ProofItem,
  'inkblot.typeset.grid': T.GridItem,
  'inkblot.typeset.tighten': T.TightenItem,
  'inkblot.typeset.loosen': T.LoosenItem,
  'inkblot.typeset.keep-together': T.KeepTogetherItem,
  'inkblot.typeset.text-style': T.NamedTextStyleItem,
  'inkblot.typeset.insert': T.InsertBreakItem,
  'inkblot.typeset.zoom': T.TypesetZoomItem,
  'inkblot.typeset.print': T.PrintItem,
  'inkblot.typeset.export': T.ExportItem,
}
