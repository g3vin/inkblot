/**
 * TabIndent.js — keyboard behavior for Tab/Shift-Tab: indent/outdent when
 * inside a list, otherwise insert a literal tab character (and swallow the
 * browser's default focus change).
 */
import { Extension } from '@tiptap/core'

const TabIndent = Extension.create({
  name: 'tabIndent',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this

        if (editor.isActive('listItem')) {
          return editor.commands.sinkListItem('listItem')
        }

        editor.commands.insertContent('\t')
        return true
      },

      'Shift-Tab': () => {
        const { editor } = this

        if (editor.isActive('listItem')) {
          return editor.commands.liftListItem('listItem')
        }

        return true
      },
    }
  },
})

export default TabIndent