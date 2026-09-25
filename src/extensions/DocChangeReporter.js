/**
 * DocChangeReporter — tells the bridge that an editor's document changed.
 *
 * In every editor, panes and canvas cards alike. It does not know which editor it is
 * in or what document it holds; the surface works that out from the registry, and
 * ignores an editor that is not registered (a version compare pane, a print job).
 */
import { Extension } from '@tiptap/core'

import { reportDocTransaction } from '../bridge/docChangeSink'

export const DocChangeReporter = Extension.create({
  name: 'docChangeReporter',

  onTransaction({ editor, transaction }) {
    if (transaction.docChanged) reportDocTransaction(editor, transaction)
  },
})
