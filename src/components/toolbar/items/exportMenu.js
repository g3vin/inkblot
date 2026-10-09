import { ExportFormat, PrintScope } from '../../../types'

/** The Export menu, as FinishingActionHeader.exportItems builds it. */
export function exportMenuItems(ctx, { bindable = false } = {}) {
  const layout = ctx.layout || {}
  const scope = layout.scope || PrintScope.Document
  const exportAs = (format, extra = {}) => ctx.send('exportDocument', { format, scope, ...extra })
  const last = layout.lastExport
  const script = Boolean(layout.script)
  const fileName = (path) => String(path || '').split(/[\\/]/).pop()
  return [
    last && last.scope === scope ? { text: `Export Again: ${fileName(last.path)}`, action: () => ctx.send('exportAgain', {}) } : null,
    last && last.scope === scope ? { separator: true } : null,
    { text: 'PDF…', action: () => exportAs(ExportFormat.Pdf) },
    { text: 'Word (.docx)…', action: () => exportAs(ExportFormat.Docx) },
    { text: 'EPUB…', action: () => exportAs(ExportFormat.Epub) },
    { separator: true },
    { text: 'Markdown…', action: () => exportAs(ExportFormat.Markdown) },
    { text: 'HTML…', action: () => exportAs(ExportFormat.Html) },
    { text: 'Plain text…', action: () => exportAs(ExportFormat.PlainText) },
    script ? { separator: true } : null,
    script ? { text: 'Fountain…', action: () => exportAs(ExportFormat.Fountain) } : null,
    script ? { text: 'Final Draft (.fdx)…', action: () => exportAs(ExportFormat.Fdx) } : null,
    bindable ? { separator: true } : null,
    bindable ? { text: 'PDF for binding…', action: () => exportAs(ExportFormat.Pdf, { bound: true }) } : null,
    { separator: true },
    { text: 'Cover PDF (full wrap)…', action: () => ctx.send('exportDocument', { format: ExportFormat.CoverPdf, scope: scope === PrintScope.Document ? PrintScope.Folder : scope }) },
    layout.book?.editions?.length ? { text: 'All editions…', action: () => ctx.send('exportAllEditions', {}) } : null,
  ]
}
