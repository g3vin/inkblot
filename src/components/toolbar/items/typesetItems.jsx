/**
 * The Typeset toolbar's items, over `pageLayoutState` and the commands
 * usePrintLayoutController answers. A document's Style item (a named text style)
 * is shared with the document toolbar.
 */
import { EditionAction, EditionKind, PageBreakKind, PrintScope, TypesetView, ZoomFit } from '../../../types'
import { ItemFrame, MenuButton, ToolButton } from '../ToolbarControls'
import { exportMenuItems } from './exportMenu'

const TRACKING_STEP = 5

const hasDocument = (ctx) => Boolean(ctx.layout?.docPath)

export function TypesetViewItem({ ctx, spec }) {
  const view = ctx.layout?.typesetView || TypesetView.Print
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="book.pages" label="Print" title="The printed pages" display={ctx.display} active={view === TypesetView.Print} disabled={!hasDocument(ctx)} onClick={() => ctx.send('setTypesetView', { view: TypesetView.Print })} />
      <ToolButton symbol="ipad.and.iphone" label="Digital" title="The e-book, as a reader shows it" display={ctx.display} active={view === TypesetView.Digital} disabled={!hasDocument(ctx)} onClick={() => ctx.send('setTypesetView', { view: TypesetView.Digital })} />
    </ItemFrame>
  )
}

export function EditionItem({ ctx, spec }) {
  const editions = ctx.layout?.book?.editions ?? []
  const active = ctx.layout?.book?.activeEdition
  const current = editions.find((edition) => edition.id === active)
  const edit = (action, extra = {}) => ctx.send('editEditions', { action, ...extra })
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        symbol="books.vertical"
        label={current ? current.name : 'The Book as Set Up'}
        title="Which edition Typeset shows"
        display={ctx.display}
        disabled={!hasDocument(ctx)}
        items={() => [
          { text: 'The Book as Set Up', checked: !active, action: () => edit(EditionAction.Activate) },
          editions.length ? { separator: true } : null,
          ...editions.map((edition) => ({ text: edition.name, checked: edition.id === active, action: () => edit(EditionAction.Activate, { id: edition.id }) })),
          { separator: true },
          {
            text: 'Add an Edition',
            items: [
              { text: 'Paperback', action: () => edit(EditionAction.Add, { kind: EditionKind.Paperback }) },
              { text: 'Hardcover', action: () => edit(EditionAction.Add, { kind: EditionKind.Hardcover }) },
              { text: 'Large Print', action: () => edit(EditionAction.Add, { kind: EditionKind.LargePrint }) },
              { text: 'eBook', action: () => edit(EditionAction.Add, { kind: EditionKind.Ebook }) },
            ],
          },
          editions.length ? { text: 'Export All Editions…', action: () => ctx.send('exportAllEditions', {}) } : null,
        ]}
      />
    </ItemFrame>
  )
}

function DisplayToggle({ ctx, spec, field, symbol, label, title }) {
  const on = Boolean(ctx.layout?.[field === 'grid' ? 'showGrid' : field])
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={symbol} label={label} title={title} display={ctx.display} active={on} disabled={!hasDocument(ctx)} onClick={() => ctx.send('setTypesetDisplay', { [field]: !on })} />
    </ItemFrame>
  )
}
export const SpreadItem = (props) => <DisplayToggle {...props} field="spread" symbol="book" label="Spreads" title="Facing pages, as the book opens" />
export const ProofItem = (props) => <DisplayToggle {...props} field="proof" symbol="checkmark.seal" label="Proof" title="Mark widows, orphans, rivers and loose lines" />
export const GridItem = (props) => <DisplayToggle {...props} field="grid" symbol="line.3.horizontal" label="Baseline Grid" title="Show the baseline grid over the text" />

export function TightenItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={spec.symbol} label={spec.label} title="Set the paragraph a little tighter, to take a line back" display={ctx.display} disabled={!ctx.layout?.paragraph} onClick={() => ctx.send('setParagraphTypeset', { nudgeTracking: -TRACKING_STEP })} />
    </ItemFrame>
  )
}

export function LoosenItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={spec.symbol} label={spec.label} title="Set the paragraph a little looser, to push a word over" display={ctx.display} disabled={!ctx.layout?.paragraph} onClick={() => ctx.send('setParagraphTypeset', { nudgeTracking: TRACKING_STEP })} />
    </ItemFrame>
  )
}

export function KeepTogetherItem({ ctx, spec }) {
  const on = Boolean(ctx.layout?.paragraph?.keepTogether)
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol={spec.symbol} label={spec.label} title="Never split this paragraph across pages" display={ctx.display} active={on} disabled={!ctx.layout?.paragraph} onClick={() => ctx.send('setParagraphTypeset', { keepTogether: !on })} />
    </ItemFrame>
  )
}

/** A named text style (a letter, verse) for the paragraph, in either toolbar. */
export function NamedTextStyleItem({ ctx, spec }) {
  const current = ctx.layout?.paragraph?.styleName
  const styles = ctx.layout?.textStyles ?? []
  const name = styles.find((look) => look.id === current)?.name
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        symbol="text.quote"
        label={name ? `Style: ${name}` : 'Text Style'}
        title="Set the paragraph as a letter, a text message, verse… — how each looks is the book’s"
        display={ctx.display}
        disabled={!ctx.toolbar.target}
        items={() => [
          { text: 'Body Text', checked: !current, action: () => ctx.send('setTextStyle', {}) },
          { separator: true },
          ...styles.map((look) => ({ text: look.name, checked: current === look.id, action: () => ctx.send('setTextStyle', { style: look.id }) })),
        ]}
      />
    </ItemFrame>
  )
}

export function InsertBreakItem({ ctx, spec }) {
  const target = ctx.toolbar.target
  const insert = (kind) => target && ctx.send('insertBreak', { target, kind })
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        symbol="rectangle.split.1x2"
        label={spec.label}
        title="Start what follows on a new page"
        display={ctx.display}
        disabled={!target}
        items={[
          { text: 'Page Break', action: () => insert(PageBreakKind.Page) },
          { text: 'Next Right-Hand Page', action: () => insert(PageBreakKind.Recto) },
          { text: 'Column Break', action: () => insert(PageBreakKind.Column) },
        ]}
      />
    </ItemFrame>
  )
}

export function TypesetZoomItem({ ctx, spec }) {
  const zoom = ctx.layout?.zoom ?? 1
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton
        label="Zoom"
        title="Zoom the pages"
        display={ctx.display}
        disabled={!hasDocument(ctx)}
        items={[
          { text: 'Fit Width', action: () => ctx.send('setPrintZoom', { fit: ZoomFit.Width }) },
          { text: 'Fit Page', action: () => ctx.send('setPrintZoom', { fit: ZoomFit.Page }) },
          { text: 'Actual Size', action: () => ctx.send('setPrintZoom', { fit: ZoomFit.Actual }) },
          { separator: true },
          ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => ({ text: `${Math.round(z * 100)}%`, checked: Math.abs(z - zoom) < 0.001, action: () => ctx.send('setPrintZoom', { zoom: z }) })),
        ]}
      >
        {ctx.display === 'label' ? <span className="tb-text">Zoom</span> : <span className="tb-text tb-zoom-readout">{Math.round(zoom * 100)}%</span>}
      </MenuButton>
    </ItemFrame>
  )
}

export function PrintItem({ ctx, spec }) {
  const scope = ctx.layout?.scope || PrintScope.Document
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <ToolButton symbol="printer" label={spec.label} title="Print what Typeset is working on (⌘P)" display={ctx.display} disabled={!hasDocument(ctx)} onClick={() => ctx.send('printDocument', { scope, bound: false })} />
    </ItemFrame>
  )
}

export function ExportItem({ ctx, spec }) {
  return (
    <ItemFrame id={spec.id} label={spec.label} display={ctx.display}>
      <MenuButton symbol="square.and.arrow.up" label={spec.label} title="Export the book or the document" display={ctx.display} disabled={!hasDocument(ctx)} items={() => exportMenuItems(ctx)} />
    </ItemFrame>
  )
}
