import { Extension } from '@tiptap/core'

const TabIndent = Extension.create({
  name: 'tabIndent',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this

        // 🔹 If inside a list → indent
        if (editor.isActive('listItem')) {
          return editor.commands.sinkListItem('listItem')
        }

        // 🔹 Otherwise insert a tab
        editor.commands.insertContent('\t')
        return true
      },

      'Shift-Tab': () => {
        const { editor } = this

        // 🔹 If inside a list → outdent
        if (editor.isActive('listItem')) {
          return editor.commands.liftListItem('listItem')
        }

        return true
      },
    }
  },
})

export default TabIndent