/**
 * CustomTextStyle.js — TextStyle mark extended with a fontSize attribute,
 * so the toolbar's font-size picker persists through the textStyle mark.
 */
import { TextStyle } from '@tiptap/extension-text-style'

export const CustomTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: el => el.style.fontSize,
        renderHTML: attrs =>
          attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
      },
    }
  },
})