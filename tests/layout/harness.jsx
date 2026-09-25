/**
 * The page the WebKit layout tests drive: the real editor extensions, the real
 * PrintLayoutView and the app's stylesheets, with nothing else of the app around
 * them. `window.__print` is the tests' handle on it.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'

import '../../src/index.css'
import '../../src/components/Editor.css'
import { buildEditorExtensions } from '../../src/lib/editorExtensions'
import PrintLayoutView from '../../src/print/PrintLayoutView'
import { computePushes, paginationKey } from '../../src/print/PaginationExtension'
import { preparePrint } from '../../src/print/printJob'

const params = new URLSearchParams(location.search)
const initialSetup = JSON.parse(params.get('setup') || 'null')

// An entry script, not a module anything imports: there is nothing to hot-reload into.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [zoom, setZoom] = useState(Number(params.get('zoom') || 1))
  const [scrollEl, setScrollEl] = useState(null)
  const editor = useEditor({
    extensions: buildEditorExtensions(StarterKit),
    content: window.__content || '<p>Hello</p>',
    onCreate: ({ editor: created }) => {
      if (initialSetup) created.commands.setPageSetup(initialSetup)
    },
  })
  window.__print = { editor, paginationKey, computePushes, preparePrint, setZoom }
  const setup = editor?.state.doc.attrs.pageSetup || initialSetup
  return (
    <div className="pane primary-pane" style={{ position: 'relative', height: '100vh' }}>
      <div ref={setScrollEl} className="pane-scroll" style={{ height: '100vh', overflow: 'auto' }} tabIndex={-1}>
        {editor ? (
          <PrintLayoutView editor={editor} pageSetup={setup} zoom={zoom} onZoomChange={setZoom} docTitle="Harness" scrollEl={scrollEl}>
            <EditorContent editor={editor} className="editor" />
          </PrintLayoutView>
        ) : null}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)
