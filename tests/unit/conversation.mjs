/**
 * Conversation tiles: the style a tile is drawn in (Inkblot, iMessage or Generic),
 * how a tile saved before styles existed keeps its iMessage look and hand-picked
 * colours, and that the saved snapshot is drawn in the tile's style.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['window', 'document', 'HTMLElement', 'Element', 'Node'])

const { CONVERSATION_STYLES, conversationLook, conversationVars, normalizeConversationStyle } =
  await import('../../src/extensions/conversationStyles.ts')
const { DEFAULT_ATTRS, normalizeAttrs } = await import('../../src/extensions/conversationModel.ts')
const { buildSnapshot } = await import('../../src/extensions/conversationSnapshot.js')
const { default: iconElement } = await import('../../src/ui/iconElement.js')

ok('a new tile is drawn in the Inkblot style', normalizeAttrs(DEFAULT_ATTRS).style === 'brand')
ok('a tile saved before styles keeps the iMessage look', normalizeAttrs({}).style === 'imessage')
ok('an unknown style falls back', normalizeConversationStyle('sms') === 'brand')

const brand = conversationLook({ style: 'brand', outgoingColor: '#ff0000' })
ok('Inkblot ignores colours stored by hand', brand.outgoing === CONVERSATION_STYLES.brand.outgoing)
const legacy = conversationLook({ style: 'imessage', outgoingColor: '#ff0000' })
ok('iMessage keeps a hand-picked bubble colour', legacy.outgoing === '#ff0000')
ok('the look becomes --conv-* properties',
  conversationVars(brand)['--conv-outgoing'] === CONVERSATION_STYLES.brand.outgoing
  && conversationVars(brand)['--conv-radius'] === `${CONVERSATION_STYLES.brand.radius}px`)

const svg = decodeURIComponent(buildSnapshot(normalizeAttrs({ ...DEFAULT_ATTRS, style: 'generic' })))
ok('the snapshot is drawn in its style', svg.includes(CONVERSATION_STYLES.generic.outgoing)
  && !svg.includes(CONVERSATION_STYLES.imessage.outgoing))

const glyph = iconElement('add')
ok('iconElement draws a registered icon as an svg', glyph.tagName.toLowerCase() === 'svg' && glyph.getAttribute('aria-hidden') === 'true')
ok('each call is its own element', iconElement('add') !== glyph)
