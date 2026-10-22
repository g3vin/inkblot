/**
 * Design review prototypes (docs/design-review). Dev only: main.jsx loads this when the
 * URL has `?variant=`, and production builds never include it.
 *
 *   ?variant=modals:2B          one decision of a family on an option
 *   ?variant=modals:1B,3C       several
 *   ?variant=modals:B           every decision of the family on that option
 *   ?variant=modals:B;pop:1C    several families, split by `;`
 */
// A round's family, while its options are being reviewed:
//   name: { decisions: { 1: 'header', … }, install: (picks) => { variants.X = … } }
// Rounds 01 (modals), 02 (pop-ups) and 02b (menus) are applied; their prototypes are
// removed.
const FAMILIES = {}

/** `modals:1B,3C` → { modals: { 1: 'B', 3: 'C' } }. */
export function parseVariant(value) {
  const out = {}
  for (const part of String(value || '').split(';')) {
    const [family, list = ''] = part.split(':')
    if (!FAMILIES[family]) continue
    const picks = {}
    for (const token of list.split(',').map((t) => t.trim()).filter(Boolean)) {
      if (/^[A-Z]$/.test(token)) for (const n of Object.keys(FAMILIES[family].decisions)) picks[n] = token
      else if (/^\d+[A-Z]$/.test(token)) picks[token.slice(0, -1)] = token.slice(-1)
    }
    out[family] = picks
  }
  return out
}

export function installVariants(value) {
  const parsed = parseVariant(value)
  for (const [family, picks] of Object.entries(parsed)) FAMILIES[family].install(picks)
}
