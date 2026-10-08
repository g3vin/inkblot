/**
 * The Typeset layout's two finishing tabs (TypesetPanelView, OutputPanelView):
 *
 *   - Typeset: turning a manuscript into a book's pages, in the order a book designer
 *     works — the page selected in the Book navigator, the book, its editions and
 *     style, the page, the type, the proof, how chapters open, the running heads.
 *   - Print & Export: getting it out — a script's production tools, the book checked
 *     against a print-on-demand service, its covers, and hand binding.
 *
 * Both are drawn from what the page publishes and edit by command (usePageLayout).
 */
import { useState } from 'react'
import { Button } from '../../../ui'
import SFIcon from '../../SFIcon'
import { useLatestBridgeState, shellBridge } from '../../../bridge'
import usePageLayout from './usePageLayout'
import FinishingHeader, { AuthorSheet } from './FinishingHeader'
import { FormatSection, HeaderFooterSection, PageSection, TextFlowSection, TitlePageSection, TypographySection } from './pageSetupSections'
import {
  BookInfoSection, BookSetupSection, ChapterOpeningsSection, DigitalSection, EditionsSection, NotesSection,
  PartsSection, ProofSection, StyleGallerySection, TextStylesSection, ThisPageSection,
} from './bookSections'
import { BindingSection, CoverSection, PublishingSection, ScriptProductionSection } from './outputSections'
import { Note } from './controls'
import './Finishing.css'

const NO_TOOLBAR = {}

function NoDocument() {
  return (
    <div className="inspector-placeholder">
      <SFIcon name="doc.text" size={22} />
      <strong>No Document</strong>
      <span>Open a document to set up its pages, print it, or export it.</span>
    </div>
  )
}

export function TypesetPanel({ onShowOutput }) {
  const layout = usePageLayout()
  const toolbar = useLatestBridgeState('toolbarState', NO_TOOLBAR)
  const [author, setAuthor] = useState(false)
  const { state, book, setup } = layout
  if (!state || !book) return <NoDocument />
  const selected = state.selectedBookItem ? state.bookItems?.find((row) => row.id === state.selectedBookItem) : null
  const digital = state.typesetView === 'digital'
  const hasSetup = Boolean(state.docPath && setup)
  return (
    <div className="sidebar-panel fin-panel">
      <FinishingHeader layout={layout} showsActions={false} />
      <div className="fin-body">
        {selected ? <ThisPageSection layout={layout} row={selected} /> : null}
        <BookInfoSection layout={layout} />
        <EditionsSection layout={layout} />
        {digital ? <DigitalSection layout={layout} /> : null}
        <StyleGallerySection layout={layout} />
        {hasSetup ? <><FormatSection layout={layout} /><PageSection layout={layout} /><TypographySection layout={layout} /><TextFlowSection layout={layout} toolbarTarget={toolbar?.target} send={(type, payload) => shellBridge.send(type, payload)} /></> : null}
        <ProofSection layout={layout} />
        <TextStylesSection layout={layout} />
        <ChapterOpeningsSection layout={layout} />
        <PartsSection layout={layout} />
        <NotesSection layout={layout} />
        {hasSetup ? <><HeaderFooterSection layout={layout} /><TitlePageSection layout={layout} onEditAuthor={() => setAuthor(true)} /></> : null}
        <BookSetupSection layout={layout} />
        {digital ? null : <DigitalSection layout={layout} />}
        <div className="fin-next">
          <Button variant="tinted" className="fin-grow" onClick={onShowOutput}>Next: Print & Export <SFIcon name="chevron.right" size={11} /></Button>
          <Note>Proof the pages in the editor first — the Typeset pages are what prints.</Note>
        </div>
      </div>
      {author ? <AuthorSheet profile={state.author} onSave={layout.setAuthor} onClose={() => setAuthor(false)} /> : null}
    </div>
  )
}

export function OutputPanel() {
  const layout = usePageLayout()
  const { state, book } = layout
  if (!state?.docPath || !book) return <NoDocument />
  return (
    <div className="sidebar-panel fin-panel">
      <FinishingHeader layout={layout} />
      <div className="fin-body">
        {state.script ? <ScriptProductionSection layout={layout} script={state.script} /> : null}
        <PublishingSection layout={layout} />
        <CoverSection layout={layout} />
        <BindingSection layout={layout} />
      </div>
    </div>
  )
}
